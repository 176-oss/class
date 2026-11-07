// 동기화 흐름 (contract 14절). DOM·window·indexedDB·localStorage 없음. 드라이브·사본·시계·타이머를 주입받는다.
// 원본은 드라이브의 sgb-data.json, IndexedDB는 임시 사본.
import { DEVICE_SETTING_KEYS } from './core/model.js';
import { mergeData, checkDataFile, toDriveFile, withoutSecrets, sameData, prepareReplace, summarize, hasData } from './core/sync-merge.js';
import { DriveError, metaStamp, dayStamp, backupName } from './core/drive-common.js';

const RETRY_KINDS = new Set(['network', 'busy', 'conflict', 'unknown', 'notfound']);
const MAX_ATTEMPTS = 3;

export function createSync({
  drive,
  local,
  now = () => new Date(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  isOnline = () => true,
  uploadDelayMs = 3000,
  retryMs = [5000, 15000, 60000, 300000],
  keepBackups = 7,
  choose = async () => 'merge',
}) {
  let st = { connected: false, fileId: null, stamp: null, lastSyncAt: null, lastBackupDay: null, secretsSeen: null };
  let pending = false;
  let gen = 0;
  let running = null;
  let timer = null;
  let retryIdx = 0;
  let lastPulled = null; // 마지막으로 받은 드라이브 데이터 (복원 알림용)
  const offered = new Set();
  const listeners = new Set();

  const status = { state: 'off', lastSyncAt: null, message: '', errorKind: null, connected: false };
  const nowIso = () => now().toISOString();

  function emit(event) {
    for (const fn of [...listeners]) { try { fn(event); } catch { /* 화면 쪽 오류는 동기화를 멈추지 않음 */ } }
  }
  function setStatus(state, { message = '', errorKind = null } = {}) {
    Object.assign(status, { state, message, errorKind, connected: !!st.connected, lastSyncAt: st.lastSyncAt });
    emit({ type: 'status', status: { ...status } });
  }
  async function saveState(patch) {
    st = { ...st, ...patch };
    await local.writeState(patch);
  }
  function schedule(ms, reason) {
    if (timer) clearTimer(timer);
    timer = setTimer(() => { timer = null; syncNow({ reason }).catch(() => {}); }, ms);
  }
  function cancelTimer() {
    if (timer) { clearTimer(timer); timer = null; }
  }
  const result = (patch = {}) => ({ ok: false, uploaded: false, unchanged: false, changes: null, error: null, ...patch });

  async function ensureToken(interactive) {
    if (drive.hasToken()) return;
    if (interactive) await drive.requestToken();
    else await drive.requestToken({ silent: true });
  }

  function offerSecrets(data) {
    const s = data?.secrets;
    if (!s || !s.geminiKey || !s.updatedAt) return;
    if (st.secretsSeen === s.updatedAt || offered.has(s.updatedAt)) return;
    offered.add(s.updatedAt);
    emit({ type: 'secrets-offer', updatedAt: s.updatedAt, geminiKey: s.geminiKey });
  }

  /** 드라이브 파일을 (바뀌었으면) 받아 사본과 합친다 */
  async function pullMerge(reason) {
    let fileId = st.fileId;
    let meta = null;
    if (fileId) {
      try { meta = await drive.getMeta(fileId); } catch (e) { if (e?.kind !== 'notfound') throw e; fileId = null; }
    }
    if (!fileId) {
      meta = await drive.findDataFile();
      fileId = meta?.id || null;
    }
    if (!meta) return { fileId: null, meta: null, remote: null, needUpload: true, changes: null };
    if (metaStamp(meta) === st.stamp && fileId === st.fileId) {
      return { fileId, meta, remote: null, needUpload: pending, changes: null };
    }
    const raw = await drive.download(fileId);
    const chk = checkDataFile(raw);
    if (chk.newer) throw new DriveError('newer');
    if (!chk.ok) throw new DriveError('parse');
    lastPulled = chk.data;
    // read 다음 apply까지 await 없이: 그 사이 사용자 입력이 끼지 않게
    const mine = await local.read();
    const { data: merged, changes } = mergeData(mine, chk.data, { now: now() });
    if (!sameData(merged, mine)) await local.apply(merged);
    if (changes.added + changes.updated + changes.removed > 0) emit({ type: 'merged', changes, fromRemote: true, reason });
    offerSecrets(merged);
    return { fileId, meta, remote: chk.data, needUpload: pending || !sameData(merged, chk.data), changes };
  }

  async function autoBackup(file) {
    const today = dayStamp(now());
    if (st.lastBackupDay === today) return;
    try {
      await drive.writeBackup(today, withoutSecrets(file));
      const list = await drive.listBackups();
      for (const old of list.slice(keepBackups)) await drive.deleteFile(old.id);
      await saveState({ lastBackupDay: today });
    } catch { /* 백업 실패는 저장 실패로 치지 않는다 */ }
  }

  function handleError(e) {
    const err = e instanceof DriveError ? e : new DriveError(e?.kind || 'unknown');
    if (err.kind === 'network') setStatus('offline', { message: err.userMessage, errorKind: err.kind });
    else if (err.kind === 'auth') setStatus('auth', { message: err.userMessage, errorKind: err.kind });
    else setStatus('error', { message: err.userMessage, errorKind: err.kind });
    if (RETRY_KINDS.has(err.kind)) {
      schedule(retryMs[Math.min(retryIdx, retryMs.length - 1)], 'retry');
      retryIdx += 1;
    }
    return result({ error: err });
  }

  async function doSync(reason) {
    cancelTimer();
    if (!st.connected) { setStatus('off'); return result(); }
    if (!isOnline()) return handleError(new DriveError('network'));
    const genAtStart = gen;
    try {
      await ensureToken(reason === 'button');
      setStatus('saving');
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const p = await pullMerge(reason);
        if (!p.needUpload) {
          await saveState({ fileId: p.fileId, stamp: metaStamp(p.meta), lastSyncAt: nowIso() });
          if (gen === genAtStart) { pending = false; await local.setPending(false); }
          retryIdx = 0;
          setStatus(pending ? 'pending' : 'idle');
          return result({ ok: true, unchanged: true, changes: p.changes });
        }
        // 올리기 직전 다시 확인: 그 사이 다른 기기·확장이 썼으면 받아 합친 뒤 올린다
        if (p.meta) {
          const again = await drive.getMeta(p.fileId);
          if (metaStamp(again) !== metaStamp(p.meta)) { st = { ...st, fileId: p.fileId }; continue; }
        }
        const file = toDriveFile(await local.read(), now());
        const meta = await drive.upload(p.fileId, file);
        const at = nowIso();
        await saveState({ fileId: meta.id, stamp: metaStamp(meta), lastSyncAt: at });
        retryIdx = 0;
        if (gen === genAtStart) { pending = false; await local.setPending(false); } else schedule(uploadDelayMs, 'auto');
        setStatus(pending ? 'pending' : 'idle');
        emit({ type: 'saved', at });
        await autoBackup(file);
        return result({ ok: true, uploaded: true, changes: p.changes });
      }
      throw new DriveError('conflict');
    } catch (e) {
      return handleError(e);
    }
  }

  function syncNow({ reason = 'auto' } = {}) {
    if (running) return running;
    running = doSync(reason).finally(() => { running = null; });
    return running;
  }

  return {
    status,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    async start() {
      const s = await local.readState();
      const { pending: p, ...rest } = s || {};
      st = { ...st, ...rest };
      pending = !!p;
      if (!st.connected) { setStatus('off'); return; }
      const wasEmpty = !hasData(await local.read());
      lastPulled = null;
      await syncNow({ reason: 'start' });
      if (wasEmpty && lastPulled && hasData(lastPulled)) emit({ type: 'restored', ...summarize(lastPulled) });
    },

    async connect() {
      try {
        await drive.requestToken({ consent: true });
        const meta = await drive.findDataFile();
        const mine = await local.read();
        const wasEmpty = !hasData(mine);
        let remote = null;
        if (meta) {
          const chk = checkDataFile(await drive.download(meta.id));
          if (chk.newer) throw new DriveError('newer');
          if (!chk.ok) throw new DriveError('parse');
          remote = chk.data;
        }
        if (remote && st.lastSyncAt == null && hasData(remote) && !wasEmpty) {
          // 고르기 전에 양쪽 자동 백업
          await local.snapshot('before-first-sync', toDriveFile(mine, now()));
          const today = dayStamp(now());
          try {
            const list = await drive.listBackups();
            if (!list.some((b) => b.name === backupName(today))) await drive.writeBackup(today, withoutSecrets(toDriveFile(remote, now())));
          } catch { /* 백업 실패는 연결을 막지 않음 */ }
          const choice = await choose({ local: summarize(mine), remote: summarize(remote) });
          if (!choice) { await drive.revoke(); setStatus('off'); return result({ cancelled: true }); }
          if (choice === 'remote') {
            const device = Object.fromEntries(DEVICE_SETTING_KEYS.filter((k) => mine.settings && k in mine.settings).map((k) => [k, mine.settings[k]]));
            await local.apply({ ...remote, settings: remote.settings ? { ...remote.settings, ...device } : mine.settings });
          } else if (choice === 'local') {
            await local.apply(prepareReplace(remote, mine, now()));
            pending = true;
            await local.setPending(true);
          }
        }
        await saveState({ connected: true, fileId: meta?.id || null, stamp: null });
        lastPulled = null;
        const res = await syncNow({ reason: 'button' });
        if (wasEmpty && lastPulled && hasData(lastPulled)) {
          const restored = summarize(lastPulled);
          emit({ type: 'restored', ...restored });
          return { ...res, restored };
        }
        return res;
      } catch (e) {
        return handleError(e);
      }
    },

    async disconnect({ wipeLocal = false } = {}) {
      cancelTimer();
      await drive.revoke();
      await saveState({ connected: false, fileId: null, stamp: null, lastSyncAt: null });
      if (wipeLocal) { await local.wipe(); pending = false; }
      setStatus('off');
    },

    notifyChange() {
      gen += 1;
      pending = true;
      if (!st.connected) return;
      if (!running) setStatus('pending');
      schedule(uploadDelayMs, 'auto');
    },

    syncNow,

    /** 메타데이터만 보고 바뀌었으면 받아 합침 */
    async check() {
      if (!st.connected || running || !isOnline() || !drive.hasToken() || !st.fileId) return false;
      try {
        const meta = await drive.getMeta(st.fileId);
        if (metaStamp(meta) === st.stamp) return false;
      } catch (e) {
        handleError(e);
        return false;
      }
      await syncNow({ reason: 'poll' });
      return true;
    },

    async flushNow() {
      if (!pending || !st.connected) return null;
      return syncNow({ reason: 'hidden' });
    },

    async listBackups() {
      await ensureToken(false);
      return drive.listBackups();
    },

    async restoreBackup(id) {
      try {
        await ensureToken(true);
        const cur = await local.read();
        await local.snapshot('before-restore', toDriveFile(cur, now()));
        const chk = checkDataFile(await drive.download(id));
        if (chk.newer) throw new DriveError('newer');
        if (!chk.ok) throw new DriveError('parse');
        const next = prepareReplace(cur, { ...chk.data, secrets: cur.secrets ?? null }, now());
        await local.apply(next);
        pending = true;
        await local.setPending(true);
        const res = await syncNow({ reason: 'button' });
        emit({ type: 'restored', ...summarize(next) });
        return res;
      } catch (e) {
        return handleError(e);
      }
    },

    async deleteDriveData() {
      await ensureToken(true);
      const n = await drive.deleteAppFiles();
      await this.disconnect({ wipeLocal: false });
      return n;
    },

    /** 'secrets-offer'에 답한 뒤 (쓰기든 아니든) 다시 묻지 않게 */
    async answerSecrets(updatedAt) {
      await saveState({ secretsSeen: updatedAt });
    },
  };
}
