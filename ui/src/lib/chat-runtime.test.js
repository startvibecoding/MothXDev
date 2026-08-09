import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSessionRunPayload,
  cancelSessionRun,
  createOptimisticRunEvent,
  createResponsesRunPoller,
  createSessionRunManager,
  finishOptimisticRunEvents,
  submitSessionRun,
  waitForRunCompletion
} from './chat-runtime.js';

function setup(overrides = {}) {
  let currentSession = 'session-a';
  let runtime = { responsesRun: { localRunId: 'run-a', state: 'running' } };
  const persisted = [];
  const loaded = [];
  const poller = createResponsesRunPoller({
    getCurrentSession: () => currentSession,
    getRuntime: () => runtime,
    setRuntime: (next) => { runtime = next; },
    persist: (id) => persisted.push(id),
    reconnect: async () => ({ run: { localRunId: 'run-a', responseId: 'response-a', state: 'running', cancelRequested: false } }),
    getRun: async () => ({ localRunId: 'run-a', responseId: 'response-a', state: 'completed', cancelRequested: false }),
    loadRuntime: async (id) => loaded.push(id),
    isActive: (state) => state === 'running',
    ...overrides
  });
  return {
    poller,
    get runtime() { return runtime; },
    persisted,
    loaded,
    switchSession(id) { currentSession = id; }
  };
}

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

test('optimistic run event helpers create and finish immutable lifecycle entries', () => {
  const started = createOptimisticRunEvent('session-a', {
    model: 'model-a',
    mode: 'plan',
    workDir: '/repo',
    now: 1000
  });
  assert.deepEqual(started, {
    id: 'local-run-1000',
    runId: 'local_1000',
    sessionId: 'session-a',
    eventType: 'started',
    source: 'webui',
    status: 'running',
    model: 'model-a',
    mode: 'plan',
    timestamp: '1970-01-01T00:00:01.000Z',
    data: { workDir: '/repo', optimistic: true }
  });

  const original = [started];
  const finished = finishOptimisticRunEvents(original, started.id, 'failed', 'broken', 2000);
  assert.notEqual(finished, original);
  assert.equal(original[0].status, 'running');
  assert.deepEqual(finished[0], {
    ...started,
    eventType: 'failed',
    status: 'failed',
    timestamp: '1970-01-01T00:00:02.000Z',
    data: { workDir: '/repo', optimistic: true, error: 'broken' }
  });
  assert.equal(finishOptimisticRunEvents(original, 'missing', 'completed'), original);
});

function setupRunManager(overrides = {}) {
  let currentSession = 'session-a';
  let runtime = null;
  let view = { messages: [{ role: 'user', content: 'hello' }], runEvents: [] };
  const state = { completion: null, lastError: '' };
  const calls = [];
  const manager = createSessionRunManager({
    getCurrentSession: () => currentSession,
    getSessionState: () => state,
    getRuntime: () => runtime,
    setRuntime: (next) => { runtime = next; calls.push(['runtime', next]); },
    persist: (id) => calls.push(['persist', id]),
    applyViewReducer: (id, reduce) => {
      const result = reduce(view);
      view = result.view;
      calls.push(['view', id, result.effects || {}]);
      return result;
    },
    stopObserver: () => {},
    registerCompletion: (id, controller) => { state.completion = { status: 'starting', controller }; calls.push(['register', id]); },
    markCompletion: (id, status, error = '') => { state.completion = { ...state.completion, status }; state.lastError = error?.message || error || state.lastError; calls.push(['mark', id, status]); },
    clearCompletion: (id, controller) => { if (state.completion?.controller === controller) state.completion = null; calls.push(['clear', id]); },
    abortCompletion: (id) => { state.completion?.controller?.abort(); calls.push(['abort', id]); },
    updateOptimisticID: (id, eventID) => calls.push(['optimistic', id, eventID]),
    upsertSession: (session) => calls.push(['upsert', session]),
    buildSessionInfo: (id, message, extra) => ({ id, preview: message, ...extra }),
    refreshSessions: async () => { calls.push(['refreshSessions']); },
    refreshStats: async () => { calls.push(['refreshStats']); },
    loadMessages: async (id) => { calls.push(['loadMessages', id]); },
    loadSubAgents: async (id) => { calls.push(['loadSubAgents', id]); },
    loadRuntime: async (id) => { calls.push(['loadRuntime', id]); },
    setSessionCreated: (created) => calls.push(['created', created]),
    getStreamHadError: () => false,
    reduceError: (current, message) => ({ view: { ...current, messages: [...current.messages, { role: 'assistant', content: message, error: true }] } }),
    setError: (error) => calls.push(['error', error.message]),
    setNotice: (notice) => calls.push(['notice', notice]),
    translate: (key) => key,
    setStopSubmitting: (value) => calls.push(['stopping', value]),
    cancelResponsesRun: async () => {},
    postJSON: async () => {},
    getSessionRuntime: async () => ({ mode: 'yolo' }),
    submit: async () => { calls.push(['submit']); },
    wait: async () => { calls.push(['wait']); },
    cancel: async () => { calls.push(['cancel']); },
    ...overrides
  });
  return {
    manager,
    calls,
    state,
    get view() { return view; },
    get runtime() { return runtime; },
    setRuntime(next) { runtime = next; },
    switchSession(id) { currentSession = id; }
  };
}

test('session run manager coordinates successful optimistic submission and refresh', async () => {
  const harness = setupRunManager();
  await harness.manager.start({
    sessionID: 'session-a',
    payload: { message: 'hello' },
    creatingExplicitSession: true,
    firstMessage: 'hello',
    event: { model: 'model-a', workDir: '/repo', now: 1000 }
  });

  assert.deepEqual(harness.view.messages.at(-1), { role: 'assistant', content: '' });
  assert.equal(harness.view.runEvents[0].status, 'completed');
  assert.equal(harness.state.completion, null);
  assert.ok(harness.calls.some((call) => call[0] === 'upsert' && call[1].running === true));
  assert.ok(harness.calls.some((call) => call[0] === 'upsert' && call[1].running === false));
  assert.deepEqual(harness.calls.filter((call) => call[0] === 'optimistic').map((call) => call[2]), ['local-run-1000', '']);
  assert.ok(harness.calls.some((call) => call[0] === 'loadMessages'));
  assert.ok(harness.calls.some((call) => call[0] === 'loadSubAgents'));
});

test('session run manager records failed submission without leaking the completion', async () => {
  const failure = new Error('submission failed');
  const harness = setupRunManager({ submit: async () => { throw failure; } });
  await harness.manager.start({ sessionID: 'session-a', payload: {}, event: { now: 1000 } });

  assert.equal(harness.view.runEvents[0].status, 'failed');
  assert.equal(harness.view.runEvents[0].data.error, 'submission failed');
  assert.deepEqual(harness.view.messages.at(-1), { role: 'assistant', content: 'submission failed', error: true });
  assert.equal(harness.state.completion, null);
  assert.ok(harness.calls.some((call) => call[0] === 'error' && call[1] === 'submission failed'));
});

test('session run manager exposes cancelling runtime and reloads the final snapshot', async () => {
  const harness = setupRunManager();
  harness.setRuntime({ activeRun: { runId: 'run-a', status: 'running' } });
  await harness.manager.stop('session-a');

  assert.deepEqual(harness.calls.filter((call) => call[0] === 'stopping'), [['stopping', true], ['stopping', false]]);
  assert.ok(harness.calls.some((call) => call[0] === 'runtime' && call[1].activeRun.status === 'cancelling'));
  assert.ok(harness.calls.some((call) => call[0] === 'abort'));
  assert.deepEqual(harness.runtime, { mode: 'yolo' });
  assert.ok(harness.calls.some((call) => call[0] === 'notice' && call[1] === 'chat.notice.stopped'));
});
test('buildSessionRunPayload normalizes defaults and enabled inputs', () => {
  assert.deepEqual(buildSessionRunPayload({
    message: 'hello',
    model: '',
    mode: undefined,
    tools: { browser: true, delegate: false },
    skills: ['review'],
    images: [{ dataUrl: 'data:image/png;base64,abc' }]
  }), {
    message: 'hello',
    model: 'default',
    mode: undefined,
    tools: ['browser'],
    skills: ['review'],
    images: ['data:image/png;base64,abc'],
    transcript: true
  });
});

test('submitSessionRun sends the run request and returns decoded JSON', async () => {
  let request;
  const result = await submitSessionRun({
    sessionID: 'session/a',
    payload: { message: 'hello' },
    signal: new AbortController().signal,
    fetcher: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ accepted: true }) };
    }
  });

  assert.equal(request.url, '/api/sessions/session%2Fa/runs');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), { message: 'hello' });
  assert.deepEqual(result, { accepted: true });
});

test('submitSessionRun extracts structured and plain HTTP errors', async () => {
  await assert.rejects(
    submitSessionRun({
      sessionID: 'a',
      payload: {},
      fetcher: async () => ({ ok: false, status: 409, statusText: 'Conflict', text: async () => '{"error":{"message":"already running"}}' })
    }),
    /already running/
  );
  await assert.rejects(
    submitSessionRun({
      sessionID: 'a',
      payload: {},
      fetcher: async () => ({ ok: false, status: 500, statusText: 'Broken', text: async () => 'not json' })
    }),
    /500 Broken/
  );
});

test('cancelSessionRun selects Responses cancellation only without an active agent run', async () => {
  const calls = [];
  const dependencies = {
    cancelResponsesRun: async (...args) => calls.push(['responses', ...args]),
    postJSON: async (...args) => calls.push(['session', ...args])
  };
  await cancelSessionRun({ sessionID: 'a/b', responsesRun: { localRunId: 'run-1' }, activeRun: null, ...dependencies });
  await cancelSessionRun({ sessionID: 'a/b', responsesRun: { localRunId: 'run-1' }, activeRun: { runId: 'agent-1' }, ...dependencies });

  assert.deepEqual(calls, [
    ['responses', 'a/b', 'run-1'],
    ['session', '/api/sessions/a%2Fb/stop', {}]
  ]);
});

test('waitForRunCompletion resolves for terminal state and abort', async () => {
  let state = { completion: { status: 'running' }, streamCompleted: false };
  const completed = waitForRunCompletion('a', null, () => state, 5);
  setTimeout(() => { state = { ...state, streamCompleted: true }; }, 5);
  await completed;

  const controller = new AbortController();
  const aborted = waitForRunCompletion('a', controller.signal, () => ({ completion: { status: 'running' } }), 1000);
  controller.abort();
  await aborted;
});

test('responses poller merges reconnect and terminal run state then reloads runtime', async () => {
  const state = setup();
  state.poller.start('session-a', 'run-a');
  await wait();
  state.poller.stop();

  assert.equal(state.runtime.responsesRun.responseId, 'response-a');
  assert.equal(state.runtime.responsesRun.state, 'completed');
  assert.deepEqual(state.persisted, ['session-a', 'session-a']);
  assert.deepEqual(state.loaded, ['session-a']);
});

test('responses poller ignores late results after the selected session changes', async () => {
  let resolveRun;
  const state = setup({
    reconnect: async () => ({ run: null }),
    getRun: () => new Promise((resolve) => { resolveRun = resolve; })
  });
  state.poller.start('session-a', 'run-a');
  await wait(0);
  state.switchSession('session-b');
  resolveRun({ localRunId: 'run-a', responseId: 'late', state: 'completed' });
  await wait();
  state.poller.stop();

  assert.equal(state.runtime.responsesRun.responseId, undefined);
  assert.deepEqual(state.persisted, []);
  assert.deepEqual(state.loaded, []);
});

test('responses poller starts only once until stopped', async () => {
  let calls = 0;
  const state = setup({
    reconnect: async () => ({ run: null }),
    getRun: async () => {
      calls += 1;
      return { localRunId: 'run-a', state: 'running' };
    }
  });
  state.poller.start('session-a', 'run-a');
  state.poller.start('session-a', 'run-a');
  await wait();
  state.poller.stop();
  assert.equal(calls, 1);
});
