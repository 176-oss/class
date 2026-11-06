import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBatch, pickBatchTargets } from '../js/core/batch.js';
import { AiError } from '../js/core/gemini.js';

function recorder() {
  const sleeps = [];
  const sleep = async (ms) => { sleeps.push(ms); };
  return { sleeps, sleep };
}

test('batch: 순서대로 하나씩, 사이에 간격', async () => {
  const order = [];
  let active = 0;
  let maxActive = 0;
  const { sleeps, sleep } = recorder();
  const progress = [];
  const b = createBatch({
    targets: ['a', 'b', 'c'],
    intervalMs: 5000,
    sleep,
    onProgress: (s) => progress.push(s.done),
    run: async (id) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 2));
      order.push(id);
      active -= 1;
    },
  });
  await b.start();
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(maxActive, 1);
  assert.deepEqual(sleeps, [5000, 5000], '사이에만 간격 (마지막 뒤에는 없음)');
  assert.equal(b.state.total, 3);
  assert.equal(b.state.done, 3);
  assert.equal(b.state.running, false);
  assert.equal(b.state.finished, true);
  assert.equal(b.state.stoppedAt, null);
  assert.ok(progress.includes(3));
});

test('batch: stop 후 resume 은 남은 것부터', async () => {
  const order = [];
  let b;
  b = createBatch({
    targets: ['a', 'b', 'c', 'd'],
    intervalMs: 10,
    sleep: async () => {},
    run: async (id) => {
      order.push(id);
      if (id === 'b') b.stop();
    },
  });
  await b.start();
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(b.state.running, false);
  assert.equal(b.state.stoppedAt, 2);
  assert.equal(b.state.done, 2);
  await b.resume();
  assert.deepEqual(order, ['a', 'b', 'c', 'd'], '같은 것을 다시 하지 않음');
  assert.equal(b.state.done, 4);
  assert.equal(b.state.finished, true);
});

test('batch: 간격 기다리는 중에 stop 하면 바로 멈춤', async () => {
  const order = [];
  const b = createBatch({
    targets: ['a', 'b'],
    intervalMs: 60000,
    sleep: (ms) => new Promise((r) => { setTimeout(r, ms).unref(); }),
    run: async (id) => { order.push(id); },
  });
  const p = b.start();
  await new Promise((r) => setTimeout(r, 5));
  const t0 = Date.now();
  b.stop();
  await p;
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(order, ['a']);
  assert.equal(b.state.stoppedAt, 1);
});

test('batch: 실패는 기록하고 계속', async () => {
  const b = createBatch({
    targets: ['a', 'b', 'c'],
    intervalMs: 0,
    sleep: async () => {},
    run: async (id) => {
      if (id === 'b') throw new AiError('parse', 'bad json');
      if (id === 'c') return 'skipped';
    },
  });
  await b.start();
  assert.equal(b.state.done, 1);
  assert.equal(b.state.skipped, 1);
  assert.deepEqual(b.state.failed, [{ id: 'b', message: 'AI 답을 읽지 못했어요. 다시 눌러 주세요.' }]);
  assert.equal(b.state.finished, true);
});

test('batch: quota-day 면 자동으로 멈추고 이어서 하면 그 기록부터', async () => {
  const order = [];
  let quotaLeft = 0;
  const b = createBatch({
    targets: ['a', 'b', 'c'],
    intervalMs: 0,
    sleep: async () => {},
    run: async (id) => {
      order.push(id);
      if (id === 'b' && quotaLeft === 0) throw new AiError('quota-day', 'PerDay');
    },
  });
  await b.start();
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(b.state.stopReason, 'quota-day');
  assert.match(b.state.stopMessage, /내일/);
  assert.equal(b.state.stoppedAt, 1);
  assert.equal(b.state.failed.length, 0);
  assert.equal(b.state.running, false);
  quotaLeft = 10;
  await b.resume();
  assert.deepEqual(order, ['a', 'b', 'b', 'c']);
  assert.equal(b.state.stopReason, null);
  assert.equal(b.state.done, 3);
});

test('pickBatchTargets: done 제외, unwritten 과 selected', () => {
  const records = [
    { id: '1', status: 'memo', memo: '메모', draft: '', final: '' },
    { id: '2', status: 'done', memo: '메모', draft: '', final: '최종' },
    { id: '3', status: 'draft', memo: '메모', draft: '초안', final: '' },
    { id: '4', status: 'empty', memo: '', draft: '', final: '' },
    { id: '5', status: 'draft', memo: '메모', draft: '', final: '최종' },
    { id: '6', status: 'memo', memo: '다른 메모', draft: ' ', final: '' },
    { id: '7', status: 'done', memo: '메모', draft: '', final: '' },
  ];
  assert.deepEqual(pickBatchTargets(records, { mode: 'unwritten' }), ['1', '6']);
  assert.deepEqual(pickBatchTargets(records, { mode: 'selected', selectedIds: ['2', '3', '4', '7', 'x'] }), ['3', '4']);
  assert.deepEqual(pickBatchTargets([], { mode: 'unwritten' }), []);
});
