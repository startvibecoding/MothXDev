import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSessionHistoryManager,
  createSessionSwitchManager,
  minLoadedMessageSeq,
  persistSessionView,
  restoreSessionView
} from './chat-session-state.js';

test('session view persistence preserves references and skips unchanged writes', () => {
  const messages = [{ id: 'm1' }];
  const runtime = { pendingApprovals: [{ approvalId: 'a1' }] };
  const state = {
    sessionId: 's1', messages, toolEvents: [], runEvents: [], capabilityEvents: [], runtime,
    pendingApprovals: runtime.pendingApprovals, cursor: { entrySeq: 1, runSeq: 2, capabilitySeq: 3 },
    historyLoaded: true, streamCompleted: false, streamUsesTranscript: true,
    optimisticRunEventID: 'optimistic', subAgents: [], subAgentTranscripts: {}, hostedItems: []
  };
  const view = {
    messages: state.messages, toolEvents: state.toolEvents, runEvents: state.runEvents,
    capabilityEvents: state.capabilityEvents, runtime: state.runtime, cursor: state.cursor,
    streamCompleted: false, streamUsesTranscript: true, optimisticRunEventID: 'optimistic',
    subAgents: state.subAgents, subAgentTranscripts: state.subAgentTranscripts, hostedItems: state.hostedItems
  };
  assert.equal(persistSessionView(state, 's1', view, 's1'), state);

  const updated = persistSessionView(state, 's1', { ...view, streamCompleted: true }, 's1');
  assert.notEqual(updated, state);
  assert.equal(updated.streamCompleted, true);
  assert.equal(updated.pendingApprovals, runtime.pendingApprovals);
});

test('session view restoration supplies safe defaults and session flags', () => {
  const restored = restoreSessionView({
    sessionId: 's1', historyLoaded: true, streamCompleted: true,
    messages: [{ id: 'm1' }], cursor: { entrySeq: 4, runSeq: 0, capabilitySeq: 0 }
  });
  assert.equal(restored.historyLoadedFor, 's1');
  assert.equal(restored.streamCompletedFor, 's1');
  assert.equal(restored.messages.length, 1);
  assert.deepEqual(restoreSessionView(null).cursor, { entrySeq: 0, runSeq: 0, capabilitySeq: 0 });
});

test('session switch manager restores cached views and coordinates session side effects', () => {
  const calls = [];
  const cached = { sessionId: 's2', historyLoaded: true, messages: [{ id: 'm2' }] };
  const manager = createSessionSwitchManager({
    initialSession: 's1',
    persist: (id) => calls.push(`persist:${id}`),
    stopObserver: (id) => calls.push(`stop:${id}`),
    stopRuntimePolling: () => calls.push('stop-polling'),
    resetHistory: () => calls.push('reset-history'),
    resetTransientView: () => calls.push('reset-transient'),
    resetNewSessionView: () => calls.push('reset-new'),
    getSessionState: (id) => id === 's2' ? cached : {},
    isRestorable: (state) => state.historyLoaded === true,
    restoreSession: (state) => { calls.push(`restore:${state.sessionId}`); return state.messages; },
    restoreHistory: (messages) => calls.push(`restore-history:${messages[0].id}`),
    setSessionCreated: (value) => calls.push(`created:${value}`),
    scrollToBottom: ({ force }) => calls.push(`scroll:${force}`),
    markHistoryReady: (id) => calls.push(`ready:${id}`),
    loadSession: (id) => calls.push(`load:${id}`)
  });

  assert.equal(manager.select('s1'), false);
  assert.equal(manager.select('s2'), true);
  assert.equal(manager.current(), 's2');
  assert.deepEqual(calls, [
    'persist:s1', 'stop:s1', 'stop-polling', 'reset-history', 'reset-transient',
    'restore:s2', 'restore-history:m2', 'created:true', 'scroll:true', 'ready:s2'
  ]);
});

test('session switch manager resets new sessions and falls back when cache restoration fails', () => {
  const calls = [];
  const manager = createSessionSwitchManager({
    initialSession: 's1',
    persist: (id) => calls.push(`persist:${id}`),
    stopObserver: (id) => calls.push(`stop:${id}`),
    stopRuntimePolling: () => calls.push('stop-polling'),
    resetHistory: () => calls.push('reset-history'),
    resetTransientView: () => calls.push('reset-transient'),
    resetNewSessionView: () => calls.push('reset-new'),
    getSessionState: () => ({ historyLoaded: true }),
    isRestorable: (state) => state.historyLoaded === true,
    restoreSession: () => { throw new Error('bad cache'); },
    restoreHistory: () => calls.push('restore-history'),
    setSessionCreated: () => calls.push('created'),
    scrollToBottom: () => calls.push('scroll'),
    markHistoryReady: () => calls.push('ready'),
    loadSession: (id) => calls.push(`load:${id}`),
    onRestoreError: (error, id) => calls.push(`error:${id}:${error.message}`)
  });

  manager.select('s2');
  manager.select('');
  assert.deepEqual(calls, [
    'persist:s1', 'stop:s1', 'stop-polling', 'reset-history', 'reset-transient',
    'error:s2:bad cache', 'load:s2',
    'persist:s2', 'stop:s2', 'stop-polling', 'reset-history', 'reset-transient', 'reset-new'
  ]);
});

test('minLoadedMessageSeq ignores missing and non-positive sequence values', () => {
  assert.equal(minLoadedMessageSeq([{ seq: 8 }, { seq: 0 }, {}, { seq: 3 }]), 3);
  assert.equal(minLoadedMessageSeq([{ seq: 0 }, {}]), null);
});

function historyHarness(overrides = {}) {
  let currentSession = 's1';
  let messages = [];
  let created = false;
  let state;
  const calls = [];
  const frames = [];
  const scroll = { scrollHeight: 500, scrollTop: 40 };
  const manager = createSessionHistoryManager({
    getCurrentSession: () => currentSession,
    getSessionState: () => ({ historyLoaded: true, messages: [{ seq: 2 }] }),
    getMessages: () => messages,
    setMessages: (next) => { messages = next; },
    clearToolEvents: () => calls.push('clear-tools'),
    loadEvents: async () => calls.push('events'),
    loadRuntime: async () => calls.push('runtime'),
    updateCursor: () => calls.push('cursor'),
    markHistoryLoaded: () => calls.push('loaded'),
    persist: () => calls.push('persist'),
    normalizeMessage: (message) => ({ ...message, normalized: true }),
    getLatest: async () => ({ messages: [{ id: 'm5', seq: 5 }], hasMore: true }),
    getBefore: async () => ({ messages: [{ id: 'm3', seq: 3 }, { id: 'm5', seq: 5 }], hasMore: false }),
    scrollToBottom: () => calls.push('scroll'),
    getScrollElement: () => scroll,
    afterDOMUpdate: async () => { scroll.scrollHeight = 700; },
    setSessionCreated: (value) => { created = value; },
    onStateChange: (next) => { state = next; },
    scheduleFrame: (callback) => frames.push(callback),
    ...overrides
  });
  return {
    manager, calls, frames, scroll,
    get messages() { return messages; },
    set messages(value) { messages = value; },
    get state() { return state; },
    get created() { return created; },
    setCurrentSession(value) { currentSession = value; }
  };
}

test('history manager loads latest messages and enables auto-load after scrolling settles', async () => {
  const harness = historyHarness();
  await harness.manager.loadSession('s1');
  assert.deepEqual(harness.messages, [{ id: 'm5', seq: 5, normalized: true }]);
  assert.deepEqual(harness.calls, ['clear-tools', 'events', 'runtime', 'loaded', 'cursor', 'persist', 'scroll']);
  assert.equal(harness.state.earliestSeq, 5);
  assert.equal(harness.state.hasMore, true);
  assert.equal(harness.created, true);
  assert.equal(harness.frames.length, 1);
  harness.frames.shift()();
  harness.frames.shift()();
  assert.equal(harness.state.autoLoadReady, true);
});

test('history manager ignores stale latest responses', async () => {
  let resolveLatest;
  const harness = historyHarness({
    getLatest: () => new Promise((resolve) => { resolveLatest = resolve; })
  });
  const pending = harness.manager.loadSession('s1');
  harness.setCurrentSession('s2');
  resolveLatest({ messages: [{ id: 'stale', seq: 9 }], hasMore: false });
  await pending;
  assert.deepEqual(harness.messages, []);
  assert.equal(harness.created, false);
});

test('history pagination deduplicates replayed messages and preserves scroll offset', async () => {
  const harness = historyHarness();
  harness.messages = [{ id: 'm5', seq: 5 }];
  harness.manager.restore(harness.messages);
  await harness.manager.loadMore();
  assert.deepEqual(harness.messages.map((message) => message.id), ['m3', 'm5']);
  assert.equal(harness.state.earliestSeq, 3);
  assert.equal(harness.state.hasMore, false);
  assert.equal(harness.state.loading, false);
  assert.equal(harness.scroll.scrollTop, 240);
});

test('history scroll loading is edge-triggered and old replay filtering is session-aware', async () => {
  let beforeCalls = 0;
  const harness = historyHarness({
    getBefore: async () => { beforeCalls += 1; return { messages: [], hasMore: false }; }
  });
  harness.manager.restore([{ seq: 5 }]);
  harness.manager.markReadyWhenScrolled('s1');
  harness.frames.shift()();
  harness.frames.shift()();
  harness.manager.handleScroll(100);
  harness.manager.handleScroll(40);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(beforeCalls, 1);
  assert.equal(harness.manager.isOlderThanLoadedHistory('s1', 4, 's1'), true);
  assert.equal(harness.manager.isOlderThanLoadedHistory('background', 1, 's1'), true);
  assert.equal(harness.manager.isOlderThanLoadedHistory('background', 3, 's1'), false);
});
