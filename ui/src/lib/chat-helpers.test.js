import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSessionEventSummary,
  buildSubAgentSummary,
  compactPath,
  formatCacheRate,
  formatCompactTokens,
  mergeMessageLists,
  mergeRunEvents,
  normalizeRunUsage,
  safeAttachmentURL
} from './chat-helpers.js';

test('safeAttachmentURL accepts public HTTPS URLs and rejects local/private targets', () => {
  assert.equal(safeAttachmentURL('https://example.com/file.png'), 'https://example.com/file.png');
  assert.equal(safeAttachmentURL('http://example.com/file.png'), '');
  assert.equal(safeAttachmentURL('https://localhost/file.png'), '');
  assert.equal(safeAttachmentURL('https://127.0.0.1/file.png'), '');
  assert.equal(safeAttachmentURL('https://10.0.0.1/file.png'), '');
  assert.equal(safeAttachmentURL('https://172.16.0.1/file.png'), '');
  assert.equal(safeAttachmentURL('https://192.168.1.1/file.png'), '');
});

test('mergeMessageLists upserts live messages without duplicating entries', () => {
  const merged = mergeMessageLists(
    [{ id: 'one', content: 'old' }],
    [{ id: 'one', content: 'new' }, { id: 'two', content: 'second' }]
  );
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === 'one').content, 'new');
});

test('run helpers normalize usage and merge lifecycle events', () => {
  assert.deepEqual(normalizeRunUsage({ prompt_tokens: 100, completion_tokens: 20, cache_read_tokens: 50 }), {
    promptTokens: 100,
    completionTokens: 20,
    totalTokens: 120,
    cacheReadTokens: 50,
    cacheWriteTokens: 0
  });
  const runs = mergeRunEvents([
    { runId: 'r1', eventType: 'started', status: 'running', timestamp: '2026-08-09T00:00:00Z' },
    { runId: 'r1', eventType: 'finished', status: 'completed', timestamp: '2026-08-09T00:01:00Z', data: { usage: { total_tokens: 120 } } }
  ]);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].status, 'completed');
  assert.equal(runs[0].usage.totalTokens, 120);
});

test('session event summary aggregates usage while preserving selected context', () => {
  const summary = buildSessionEventSummary([
    {
      runId: 'r1',
      eventType: 'finished',
      status: 'completed',
      model: 'model-a',
      timestamp: '2026-08-09T00:01:00Z',
      data: { workDir: '/repo', usage: { prompt_tokens: 100, completion_tokens: 20, cache_read_tokens: 40 } }
    },
    {
      runId: 'r2',
      eventType: 'finished',
      status: 'completed',
      model: 'model-b',
      timestamp: '2026-08-09T00:02:00Z',
      data: { workDir: '/other', usage: { total_tokens: 30 } }
    }
  ], [{ id: 'cap-1' }], '/repo', 'model-a');

  assert.equal(summary.visible, true);
  assert.equal(summary.runCount, 2);
  assert.equal(summary.capabilityCount, 1);
  assert.equal(summary.matchingRuns, 1);
  assert.equal(summary.model, 'model-a');
  assert.equal(summary.workDir, '/repo');
  assert.equal(summary.totalTokens, 150);
  assert.equal(summary.cacheReadTokens, 40);
});

test('sub-agent summary prioritizes running, then failed, then completed labels', () => {
  const translate = (key, params) => `${key}:${params.count}/${params.total}`;
  assert.deepEqual(buildSubAgentSummary([], translate), {
    visible: false,
    count: 0,
    running: 0,
    failed: 0,
    done: 0,
    label: 'chat.subagents.done:0/0'
  });
  assert.equal(buildSubAgentSummary([
    { id: 'done', status: 'done' },
    { id: 'failed', status: 'failed' },
    { id: 'running', status: 'ready' }
  ], translate).label, 'chat.subagents.running:1/3');
  assert.equal(buildSubAgentSummary([
    { id: 'done', status: 'done' },
    { id: 'failed', status: 'error' }
  ], translate).label, 'chat.subagents.failed:1/2');
});

test('format helpers preserve current compact display behavior', () => {
  assert.equal(formatCompactTokens(1_250), '1.3K');
  assert.equal(formatCompactTokens(12_500), '13K');
  assert.equal(formatCacheRate({ promptTokens: 100, cacheReadTokens: 25 }), '25%');
  assert.equal(compactPath('/home/user/project'), '.../user/project');
});
