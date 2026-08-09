import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionStreamManager, sessionStreamURL } from './chat-session-stream.js';

function emptyView() {
  return {
    messages: [],
    toolEvents: [],
    runEvents: [],
    capabilityEvents: [],
    runtime: null,
    cursor: { entrySeq: 0, runSeq: 0, capabilitySeq: 0 },
    streamCompleted: false,
    subAgents: [],
    subAgentTranscripts: {},
    hostedItems: []
  };
}

function setup(overrides = {}) {
  let currentSession = 'session-a';
  let view = emptyView();
  const calls = [];
  const state = { cursor: { entrySeq: 2, runSeq: 3, capabilitySeq: 4 } };
  const manager = createSessionStreamManager({
    fetcher: async () => ({ ok: true, body: {} }),
    readSSE: async () => {},
    getCurrentSession: () => currentSession,
    getSessionState: () => state,
    getFallbackCursor: () => ({ entrySeq: 0, runSeq: 0, capabilitySeq: 0 }),
    registerObserver: (id, controller) => {
      state.observer = { controller };
      calls.push(['register', id, controller]);
    },
    clearObserver: (id, controller) => {
      if (state.observer?.controller === controller) state.observer = null;
      calls.push(['clear', id, controller]);
    },
    applyReducer: (id, reducer, options) => {
      const result = reducer(view);
      view = result.view;
      calls.push(['reduce', id, options]);
      return result;
    },
    isCompletionActive: () => true,
    isOlderThanLoadedHistory: () => false,
    translate: (key) => key,
    setError: (error) => calls.push(['error', String(error?.message || error)]),
    markStreamError: () => calls.push(['stream-error']),
    onDone: (id) => calls.push(['done', id]),
    onSubAgentEffects: (effects) => calls.push(['effects', effects]),
    onApprovalRequest: (item) => calls.push(['approval-request', item.approvalId]),
    recordApprovalResolution: (item, id) => calls.push(['approval-record', item.approvalId, id]),
    onApprovalResolved: (item) => calls.push(['approval-resolved', item.approvalId]),
    now: () => 1000,
    ...overrides
  });
  return {
    manager,
    calls,
    state,
    get view() { return view; },
    switchSession(id) { currentSession = id; }
  };
}

const wait = () => new Promise((resolve) => setTimeout(resolve, 0));

test('sessionStreamURL encodes the session and non-zero cursors', () => {
  assert.equal(
    sessionStreamURL('a/b', { entrySeq: 2, runSeq: 0, capabilitySeq: 4 }),
    '/api/sessions/a%2Fb/stream?after_entry_seq=2&after_capability_seq=4'
  );
  assert.equal(sessionStreamURL('plain'), '/api/sessions/plain/stream');
});

test('stream manager registers one observer and consumes SSE with its cursor', async () => {
  let request;
  const state = setup({
    fetcher: async (url, options) => {
      request = { url, options };
      return { ok: true, body: { stream: true } };
    },
    readSSE: async (body, onEvent) => {
      assert.deepEqual(body, { stream: true });
      onEvent({ event: 'done', data: '{}' });
    }
  });

  state.manager.start('session-a');
  state.manager.start('session-a');
  await wait();

  assert.equal(request.url, '/api/sessions/session-a/stream?after_entry_seq=2&after_run_seq=3&after_capability_seq=4');
  assert.equal(request.options.signal instanceof AbortSignal, true);
  assert.equal(state.calls.filter(([name]) => name === 'register').length, 1);
  assert.equal(state.calls.filter(([name]) => name === 'clear').length, 1);
  assert.equal(state.view.streamCompleted, true);
  assert.deepEqual(state.calls.find(([name]) => name === 'done'), ['done', 'session-a']);
});

test('stream manager reports structured HTTP errors but ignores aborts', async () => {
  const state = setup({
    fetcher: async () => ({
      ok: false,
      body: null,
      status: 409,
      statusText: 'Conflict',
      text: async () => '{"error":{"message":"already running"}}'
    })
  });
  await state.manager.consume('session-a', {}, new AbortController());
  assert.deepEqual(state.calls.find(([name]) => name === 'error'), ['error', 'already running']);

  const aborted = setup({
    fetcher: async () => { throw new DOMException('stopped', 'AbortError'); }
  });
  await aborted.manager.consume('session-a', {}, new AbortController());
  assert.equal(aborted.calls.some(([name]) => name === 'error'), false);
});

test('stream manager reduces visible transcript and filters wrong-session or old frames', () => {
  const state = setup({ isOlderThanLoadedHistory: (_id, seq) => seq < 5 });
  state.manager.handleEvent('session-a', {
    event: 'transcript',
    data: JSON.stringify({ sessionId: 'session-a', type: 'message', message: { id: 'm1', seq: 5, role: 'assistant', content: 'hello' } })
  });
  state.manager.handleEvent('session-a', {
    event: 'transcript',
    data: JSON.stringify({ sessionId: 'session-b', type: 'message', message: { id: 'm2', seq: 6, role: 'assistant', content: 'wrong' } })
  });
  state.manager.handleEvent('session-a', {
    event: 'transcript',
    data: JSON.stringify({ sessionId: 'session-a', type: 'message', message: { id: 'm3', seq: 4, role: 'assistant', content: 'old' } })
  });

  assert.deepEqual(state.view.messages.map((message) => message.content), ['hello']);
  assert.equal(state.calls.filter(([name]) => name === 'effects').length, 1);
});

test('stream manager scopes errors and approval UI effects to the visible session', () => {
  const state = setup();
  state.manager.handleEvent('session-a', { event: 'error', data: '{"error":"failed"}' });
  state.manager.handleEvent('session-a', { event: 'approval_request', data: '{"approvalId":"approve-1","sessionId":"session-a"}' });
  state.manager.handleEvent('session-a', { event: 'approval_resolved', data: '{"approvalId":"approve-1","sessionId":"session-a"}' });

  assert.equal(state.calls.some(([name]) => name === 'stream-error'), true);
  assert.deepEqual(state.calls.find(([name]) => name === 'error'), ['error', 'failed']);
  assert.deepEqual(state.calls.find(([name]) => name === 'approval-request'), ['approval-request', 'approve-1']);
  assert.deepEqual(state.calls.find(([name]) => name === 'approval-record'), ['approval-record', 'approve-1', 'session-a']);
  assert.deepEqual(state.calls.find(([name]) => name === 'approval-resolved'), ['approval-resolved', 'approve-1']);

  const background = setup();
  background.switchSession('session-b');
  background.manager.handleEvent('session-a', { event: 'error', data: 'background failed' });
  background.manager.handleEvent('session-a', { event: 'approval_request', data: '{"approvalId":"approve-2","sessionId":"session-a"}' });
  assert.equal(background.calls.some(([name]) => name === 'stream-error' || name === 'error' || name === 'approval-request'), false);
});
