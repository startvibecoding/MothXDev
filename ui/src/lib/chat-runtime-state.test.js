import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionRuntimeManager, enabledCapabilities } from './chat-runtime-state.js';

function harness(overrides = {}) {
  let currentSession = 'session-a';
  let runtime = { mode: 'yolo', capabilities: { browser: { enabled: false } } };
  let tools = { browser: false, webSearch: true };
  const calls = [];
  const manager = createSessionRuntimeManager({
    getCurrentSession: () => currentSession,
    getRuntime: () => runtime,
    setRuntime: (next) => { runtime = next; calls.push(['runtime', next]); },
    getSessionRuntime: async () => runtime,
    patchSessionRuntime: async (_id, patch) => ({
      ...runtime,
      ...patch,
      capabilities: {
        ...runtime.capabilities,
        ...Object.fromEntries(Object.entries(patch.capabilities || {}).map(([key, enabled]) => [key, { enabled }]))
      }
    }),
    getSessionTools: () => tools,
    setSessionTools: (id, next) => { tools = next; calls.push(['tools', id, next]); },
    persist: (id) => calls.push(['persist', id]),
    upsertSession: (session) => calls.push(['upsert', session]),
    refreshSessions: async () => calls.push(['refresh']),
    setUpdating: (value) => calls.push(['updating', value]),
    setError: (error) => calls.push(['error', error.message]),
    ...overrides
  });
  return { manager, calls, get runtime() { return runtime; }, get tools() { return tools; }, switchSession: (id) => { currentSession = id; } };
}

test('enabledCapabilities projects server capability snapshots to booleans', () => {
  assert.deepEqual(enabledCapabilities({ capabilities: { browser: { enabled: true }, delegate: { enabled: 0 }, empty: null } }), {
    browser: true,
    delegate: false,
    empty: false
  });
});

test('runtime manager ignores stale loads after session switches', async () => {
  let resolve;
  const state = harness({ getSessionRuntime: () => new Promise((r) => { resolve = r; }) });
  const loading = state.manager.load('session-a');
  state.switchSession('session-b');
  resolve({ mode: 'plan', capabilities: { browser: { enabled: true } } });
  assert.deepEqual(await loading, { mode: 'plan', capabilities: { browser: { enabled: true } } });
  assert.equal(state.runtime.mode, 'yolo');
  assert.deepEqual(state.calls.filter((call) => call[0] === 'runtime'), []);
});

test('runtime manager applies authoritative updates and restores on failure', async () => {
  const state = harness();
  const updated = await state.manager.update({ mode: 'plan' });
  assert.equal(updated.mode, 'plan');
  assert.equal(state.runtime.mode, 'plan');
  assert.deepEqual(state.calls.filter((call) => call[0] === 'updating').map((call) => call[1]), [true, false]);
  assert.ok(state.calls.some((call) => call[0] === 'persist' && call[1] === 'session-a'));

  const failure = new Error('patch failed');
  const failed = harness({ patchSessionRuntime: async () => { throw failure; } });
  assert.equal(await failed.manager.update({ mode: 'agent' }), null);
  assert.equal(failed.runtime.mode, 'yolo');
  assert.deepEqual(failed.calls.filter((call) => call[0] === 'error'), [['error', 'patch failed']]);
});

test('runtime manager updates capabilities and supports new-session mode', async () => {
  const state = harness();
  await state.manager.updateCapability('browser', true);
  assert.equal(state.tools.browser, true);
  assert.equal(state.runtime.capabilities.browser.enabled, true);

  const fresh = harness();
  fresh.switchSession('');
  let newMode = '';
  await fresh.manager.setMode('plan', (mode) => { newMode = mode; });
  assert.equal(newMode, 'plan');
  assert.equal(fresh.runtime.mode, 'yolo');
});
