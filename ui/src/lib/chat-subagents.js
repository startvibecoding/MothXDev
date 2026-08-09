import { mergeMessageLists, mergeSubAgents } from './chat-helpers.js';

// Coordinates sub-agent list refreshes and modal transcript loading independently
// from the Chat component lifecycle. All mutable view state is exposed through
// callbacks so this module remains straightforward to exercise without a DOM.
export function createSubAgentManager({
  getCurrentSession,
  getAgents,
  setAgents,
  getTranscripts,
  fetchAgents,
  fetchMessages,
  normalizeMessage,
  onModalStateChange = () => {}
}) {
  let refreshTimer = 0;
  let messageRequest = 0;
  let modal = {
    open: false,
    selectedAgentID: '',
    messages: [],
    loading: false,
    error: ''
  };

  function publish(patch) {
    modal = { ...modal, ...patch };
    onModalStateChange(modal);
  }

  async function loadMessages(agentID) {
    const sessionID = getCurrentSession();
    if (!sessionID || !agentID) {
      publish({ messages: [], loading: false, error: '' });
      return;
    }
    const request = ++messageRequest;
    publish({ loading: true, error: '' });
    try {
      const messages = await fetchMessages(sessionID, agentID);
      if (request !== messageRequest || sessionID !== getCurrentSession() || agentID !== modal.selectedAgentID) return;
      const normalized = (messages || []).map(normalizeMessage).filter(Boolean);
      publish({ messages: mergeMessageLists(normalized, getTranscripts()[agentID] || []), loading: false });
    } catch (error) {
      if (request !== messageRequest || sessionID !== getCurrentSession() || agentID !== modal.selectedAgentID) return;
      publish({
        messages: getTranscripts()[agentID] || [],
        loading: false,
        error: error instanceof Error ? error.message : String(error || '')
      });
    }
  }

  async function loadAgents(sessionID) {
    if (!sessionID) {
      setAgents([]);
      return;
    }
    const fetched = await fetchAgents(sessionID);
    if (sessionID !== getCurrentSession()) return;
    const agents = mergeSubAgents(getAgents(), fetched || []);
    setAgents(agents);
    if (!modal.open) return;
    const selectedAgentID = modal.selectedAgentID || agents[0]?.id || '';
    if (selectedAgentID !== modal.selectedAgentID) publish({ selectedAgentID });
    if (selectedAgentID) await loadMessages(selectedAgentID);
  }

  function scheduleRefresh(delay = 250) {
    const sessionID = getCurrentSession();
    if (!sessionID) return;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = 0;
      if (sessionID === getCurrentSession()) void loadAgents(sessionID).catch(() => {});
    }, delay);
  }

  function open(agentID = '') {
    const selectedAgentID = agentID || modal.selectedAgentID || getAgents()[0]?.id || '';
    publish({ open: true, selectedAgentID });
    const sessionID = getCurrentSession();
    if (sessionID) void loadAgents(sessionID).catch(() => {});
    if (selectedAgentID) void loadMessages(selectedAgentID).catch(() => {});
  }

  function close() {
    messageRequest += 1;
    publish({ open: false, loading: false, error: '' });
  }

  function select(agentID) {
    messageRequest += 1;
    publish({
      selectedAgentID: agentID,
      messages: getTranscripts()[agentID] || [],
      loading: false,
      error: ''
    });
    void loadMessages(agentID).catch(() => {});
  }

  function handleEffects(effects = {}) {
    if (effects.subAgentRefresh) scheduleRefresh();
    if (modal.open && modal.selectedAgentID && effects.subAgentTranscriptAgent === modal.selectedAgentID) {
      publish({ messages: getTranscripts()[modal.selectedAgentID] || [] });
    }
  }

  function reset() {
    messageRequest += 1;
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = 0;
    modal = { open: false, selectedAgentID: '', messages: [], loading: false, error: '' };
    onModalStateChange(modal);
  }

  function destroy() {
    reset();
  }

  return { loadAgents, loadMessages, scheduleRefresh, open, close, select, handleEffects, reset, destroy };
}
