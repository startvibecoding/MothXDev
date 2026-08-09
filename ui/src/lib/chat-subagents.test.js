import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubAgentManager } from './chat-subagents.js';

const wait = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

function setup(overrides = {}) {
  let currentSession = 'session-a';
  let agents = [{ id: 'agent-a', status: 'running' }];
  let transcripts = { 'agent-a': [{ role: 'assistant', content: 'live' }] };
  const modalStates = [];
  const manager = createSubAgentManager({
    getCurrentSession: () => currentSession,
    getAgents: () => agents,
    setAgents: (next) => { agents = next; },
    getTranscripts: () => transcripts,
    fetchAgents: async () => [{ id: 'agent-a', status: 'completed' }],
    fetchMessages: async () => [{ role: 'user', content: 'stored' }],
    normalizeMessage: (message) => message,
    onModalStateChange: (state) => modalStates.push(structuredClone(state)),
    ...overrides
  });
  return {
    manager,
    modalStates,
    get agents() { return agents; },
    setTranscripts(next) { transcripts = next; },
    switchSession(id) { currentSession = id; }
  };
}

test('sub-agent manager merges fetched agents and modal transcript history', async () => {
  const state = setup();
  state.manager.open('agent-a');
  await wait();

  assert.equal(state.agents[0].status, 'completed');
  assert.deepEqual(state.modalStates.at(-1), {
    open: true,
    selectedAgentID: 'agent-a',
    messages: [
      { role: 'user', content: 'stored' },
      { role: 'assistant', content: 'live' }
    ],
    loading: false,
    error: ''
  });
  state.manager.destroy();
});

test('sub-agent manager ignores stale message results after selection changes', async () => {
  const resolvers = new Map();
  const state = setup({
    fetchMessages: (_sessionID, agentID) => new Promise((resolve) => resolvers.set(agentID, resolve))
  });

  state.manager.select('agent-a');
  state.manager.select('agent-b');
  resolvers.get('agent-a')([{ role: 'assistant', content: 'stale' }]);
  resolvers.get('agent-b')([{ role: 'assistant', content: 'current' }]);
  await wait();

  assert.equal(state.modalStates.at(-1).selectedAgentID, 'agent-b');
  assert.deepEqual(state.modalStates.at(-1).messages, [{ role: 'assistant', content: 'current' }]);
  state.manager.destroy();
});

test('sub-agent manager debounces refreshes and applies live transcript effects', async () => {
  let fetchCount = 0;
  const state = setup({
    fetchAgents: async () => {
      fetchCount += 1;
      return [];
    }
  });
  state.manager.open('agent-a');
  await wait();
  fetchCount = 0;
  state.manager.scheduleRefresh(5);
  state.manager.scheduleRefresh(5);
  await wait(15);
  assert.equal(fetchCount, 1);

  state.setTranscripts({ 'agent-a': [{ role: 'assistant', content: 'new live output' }] });
  state.manager.handleEffects({ subAgentTranscriptAgent: 'agent-a' });
  assert.deepEqual(state.modalStates.at(-1).messages, [{ role: 'assistant', content: 'new live output' }]);
  state.manager.destroy();
});

test('sub-agent manager discards agent responses after the session changes', async () => {
  let resolveAgents;
  const state = setup({
    fetchAgents: () => new Promise((resolve) => { resolveAgents = resolve; })
  });
  const loading = state.manager.loadAgents('session-a');
  state.switchSession('session-b');
  resolveAgents([{ id: 'late-agent' }]);
  await loading;
  assert.deepEqual(state.agents, [{ id: 'agent-a', status: 'running' }]);
  state.manager.destroy();
});
