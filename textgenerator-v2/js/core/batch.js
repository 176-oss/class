// 일괄 초안 실행기. 순수 모듈 (sleep 주입 가능).
// 하나씩 차례로 실행하고, 사이에 간격을 둔다. 멈춘 뒤 이어서 하면 남은 것부터.

const STOP_KINDS = new Set(['quota-day', 'key']);

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {{ targets: string[], run: (id: string) => Promise<any>, intervalMs?: number,
 *           sleep?: (ms: number) => Promise<void>, onProgress?: (state) => void }} opts
 *  run 이 'skipped' 를 돌려주면 건너뜀으로 센다.
 *  run 이 quota-day(또는 key) AiError 를 던지면 자동으로 멈추고 state.stopReason 에 적는다.
 *  그 기록은 실패로 세지 않고, 이어서 하면 그 기록부터 다시 한다.
 */
export function createBatch({ targets = [], run, intervalMs = 5000, sleep = defaultSleep, onProgress } = {}) {
  const ids = [...targets];
  const state = {
    total: ids.length,
    done: 0,
    failed: [],
    skipped: 0,
    running: false,
    stoppedAt: null,
    stopReason: null,
    stopMessage: '',
    current: null,
    next: 0,
    finished: ids.length === 0,
  };
  let stopRequested = false;
  let wake = null;
  let loop = null;

  const notify = () => {
    if (typeof onProgress === 'function') {
      try { onProgress({ ...state, failed: [...state.failed] }); } catch { /* 화면 쪽 오류는 무시 */ }
    }
  };

  function pause(ms) {
    if (!ms || ms <= 0) return Promise.resolve();
    return Promise.race([
      Promise.resolve(sleep(ms)),
      new Promise((resolve) => { wake = resolve; }),
    ]).finally(() => { wake = null; });
  }

  async function runLoop() {
    state.running = true;
    state.stoppedAt = null;
    notify();
    let first = true;
    while (state.next < ids.length) {
      if (!first) {
        await pause(intervalMs);
      }
      if (stopRequested) break;
      first = false;
      const id = ids[state.next];
      state.current = id;
      notify();
      try {
        const r = await run(id);
        if (r === 'skipped') state.skipped += 1;
        else state.done += 1;
        state.next += 1;
      } catch (err) {
        const kind = err && err.kind;
        if (STOP_KINDS.has(kind)) {
          state.stopReason = kind;
          state.stopMessage = err.userMessage || err.message || '';
          stopRequested = true;
          state.current = null;
          break; // 이 기록은 다음에 다시
        }
        state.failed.push({ id, message: (err && (err.userMessage || err.message)) || String(err) });
        state.next += 1;
      }
      state.current = null;
      notify();
      if (stopRequested) break;
    }
    state.running = false;
    state.current = null;
    if (state.next >= ids.length) {
      state.finished = true;
      state.stoppedAt = null;
    } else {
      state.stoppedAt = state.next;
    }
    notify();
  }

  function startLoop() {
    if (state.running && loop) {
      // 멈추는 중이면 그 실행이 끝난 뒤 남은 것부터 다시
      if (stopRequested) return loop.then(() => startLoop());
      return loop;
    }
    if (state.finished) return Promise.resolve();
    stopRequested = false;
    loop = runLoop().finally(() => { loop = null; });
    return loop;
  }

  return {
    state,
    start() {
      return startLoop();
    },
    stop() {
      stopRequested = true;
      if (wake) wake();
      return loop || Promise.resolve();
    },
    resume() {
      state.stopReason = null;
      state.stopMessage = '';
      return startLoop();
    },
  };
}

/**
 * 일괄 대상 고르기. done 은 언제나 뺀다.
 *  selected: selectedIds 에 든 기록 (기록 순서 유지)
 *  unwritten: draft 와 final 이 모두 빈 기록 중 memo 가 있는 것
 */
export function pickBatchTargets(records, { mode = 'unwritten', selectedIds = [] } = {}) {
  const list = Array.isArray(records) ? records : [];
  const filled = (v) => typeof v === 'string' && v.trim() !== '';
  const notDone = list.filter((r) => r && r.status !== 'done');
  if (mode === 'selected') {
    const set = new Set(selectedIds);
    return notDone.filter((r) => set.has(r.id)).map((r) => r.id);
  }
  return notDone
    .filter((r) => !filled(r.draft) && !filled(r.final) && filled(r.memo))
    .map((r) => r.id);
}
