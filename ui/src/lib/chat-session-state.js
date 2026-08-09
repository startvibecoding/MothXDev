export const defaultSessionCursor = () => ({ entrySeq: 0, runSeq: 0, capabilitySeq: 0 });

export function persistSessionView(state, id, view, historyLoadedFor = '') {
  if (!id) return state;
  const historyLoaded = historyLoadedFor === id || state.historyLoaded;
  if (
    state.messages === view.messages &&
    state.toolEvents === view.toolEvents &&
    state.runEvents === view.runEvents &&
    state.capabilityEvents === view.capabilityEvents &&
    state.runtime === view.runtime &&
    state.cursor === view.cursor &&
    state.streamCompleted === view.streamCompleted &&
    state.subAgents === view.subAgents &&
    state.subAgentTranscripts === view.subAgentTranscripts &&
    state.hostedItems === view.hostedItems &&
    state.streamUsesTranscript === view.streamUsesTranscript &&
    state.optimisticRunEventID === view.optimisticRunEventID &&
    state.historyLoaded === historyLoaded
  ) {
    return state;
  }
  return {
    ...state,
    messages: view.messages,
    toolEvents: view.toolEvents,
    runEvents: view.runEvents,
    capabilityEvents: view.capabilityEvents,
    runtime: view.runtime,
    pendingApprovals: view.runtime?.pendingApprovals || [],
    cursor: view.cursor,
    historyLoaded,
    streamCompleted: view.streamCompleted,
    streamUsesTranscript: view.streamUsesTranscript,
    optimisticRunEventID: view.optimisticRunEventID,
    subAgents: view.subAgents,
    subAgentTranscripts: view.subAgentTranscripts,
    hostedItems: view.hostedItems
  };
}

export function restoreSessionView(state) {
  return {
    messages: state?.messages || [],
    toolEvents: state?.toolEvents || [],
    runEvents: state?.runEvents || [],
    capabilityEvents: state?.capabilityEvents || [],
    runtime: state?.runtime || null,
    cursor: state?.cursor || defaultSessionCursor(),
    historyLoadedFor: state?.historyLoaded ? state.sessionId : '',
    streamCompletedFor: state?.streamCompleted ? state.sessionId : '',
    streamUsesTranscript: Boolean(state?.streamUsesTranscript),
    optimisticRunEventID: state?.optimisticRunEventID || '',
    subAgents: state?.subAgents || [],
    subAgentTranscripts: state?.subAgentTranscripts || {},
    hostedItems: state?.hostedItems || []
  };
}

export function createSessionSwitchManager({
  initialSession = '',
  persist,
  stopObserver,
  stopRuntimePolling,
  resetHistory,
  resetTransientView,
  resetNewSessionView,
  getSessionState,
  isRestorable,
  restoreSession,
  restoreHistory,
  setSessionCreated,
  scrollToBottom,
  markHistoryReady,
  loadSession,
  onRestoreError
}) {
  let previousSession = initialSession;

  function select(nextSession = '') {
    if (nextSession === previousSession) return false;
    const previous = previousSession;

    if (previous) persist(previous);
    if (previous && previous !== nextSession) {
      stopObserver(previous);
      stopRuntimePolling();
    }
    resetHistory();
    resetTransientView();

    if (!nextSession) {
      resetNewSessionView();
    } else {
      const cached = getSessionState(nextSession);
      if (isRestorable(cached)) {
        try {
          const restoredMessages = restoreSession(cached);
          restoreHistory(restoredMessages);
          setSessionCreated(true);
          scrollToBottom({ force: true });
          markHistoryReady(nextSession);
        } catch (error) {
          onRestoreError?.(error, nextSession);
          loadSession(nextSession);
        }
      } else {
        loadSession(nextSession);
      }
    }

    previousSession = nextSession;
    return true;
  }

  return {
    select,
    current: () => previousSession
  };
}

export function minLoadedMessageSeq(list) {
  let min = null;
  for (const message of list || []) {
    const seq = Number(message?.seq || 0);
    if (seq > 0 && (min == null || seq < min)) min = seq;
  }
  return min;
}

export function createSessionHistoryManager({
  getCurrentSession,
  getSessionState,
  getMessages,
  setMessages,
  clearToolEvents,
  loadEvents,
  loadRuntime,
  updateCursor,
  markHistoryLoaded,
  persist,
  normalizeMessage,
  getLatest,
  getBefore,
  scrollToBottom,
  getScrollElement,
  afterDOMUpdate,
  setSessionCreated,
  onStateChange,
  scheduleFrame = (callback) => requestAnimationFrame(callback)
}) {
  let state = {
    earliestSeq: null,
    hasMore: false,
    loading: false,
    autoLoadReady: false,
    lastScrollTop: -1
  };

  function update(patch) {
    state = { ...state, ...patch };
    onStateChange?.(state);
    return state;
  }

  function reset() {
    update({ earliestSeq: null, hasMore: false, loading: false, autoLoadReady: false, lastScrollTop: -1 });
  }

  function restore(messages) {
    const earliestSeq = minLoadedMessageSeq(messages);
    update({ earliestSeq, hasMore: earliestSeq != null, loading: false, autoLoadReady: false, lastScrollTop: -1 });
  }

  function markReadyWhenScrolled(id) {
    scheduleFrame(() => {
      scheduleFrame(() => {
        if (id === getCurrentSession()) update({ autoLoadReady: true });
      });
    });
  }

  async function loadSession(id) {
    update({ autoLoadReady: false });
    try {
      const { messages, hasMore } = await getLatest(id, 50);
      if (id !== getCurrentSession()) return;
      const normalized = (messages || []).map(normalizeMessage).filter(Boolean);
      setMessages(normalized);
      update({
        earliestSeq: messages?.length > 0 ? messages[0].seq : null,
        hasMore: messages?.length > 0 ? hasMore : false
      });
      clearToolEvents();
      await loadEvents(id);
      await loadRuntime(id);
      markHistoryLoaded(id);
      updateCursor();
      persist(id);
      scrollToBottom({ force: true });
      markReadyWhenScrolled(id);
    } catch {
      if (id !== getCurrentSession()) return;
      markHistoryLoaded(id);
      updateCursor();
      persist(id);
    }
    setSessionCreated(true);
  }

  function isOlderThanLoadedHistory(id, seq, historyLoadedFor) {
    if (id === getCurrentSession()) {
      return historyLoadedFor === id && state.earliestSeq != null && seq < state.earliestSeq;
    }
    const session = getSessionState(id);
    if (!session?.historyLoaded) return false;
    const min = minLoadedMessageSeq(session.messages);
    return min != null && seq < min;
  }

  async function loadMore() {
    if (state.loading || !state.hasMore || state.earliestSeq == null) return;
    const sessionID = getCurrentSession();
    if (!sessionID) return;
    update({ loading: true });
    try {
      const { messages: older, hasMore } = await getBefore(sessionID, state.earliestSeq, 50);
      if (sessionID !== getCurrentSession()) return;
      if (older.length === 0) {
        update({ hasMore: false });
        return;
      }
      const scroll = getScrollElement();
      const beforeScrollHeight = scroll?.scrollHeight || 0;
      const beforeScrollTop = scroll?.scrollTop || 0;
      const normalized = older.map(normalizeMessage).filter(Boolean);
      const current = getMessages();
      const known = new Set(current.map((message) => message.id).filter(Boolean));
      const fresh = normalized.filter((message) => !message.id || !known.has(message.id));
      update({ earliestSeq: older[0].seq, hasMore });
      if (fresh.length > 0) {
        setMessages([...fresh, ...current]);
        await afterDOMUpdate();
        const currentScroll = getScrollElement();
        if (currentScroll) {
          currentScroll.scrollTop = currentScroll.scrollHeight - beforeScrollHeight + beforeScrollTop;
          update({ lastScrollTop: currentScroll.scrollTop });
        }
      }
    } catch {
      // History pagination is opportunistic; retain the current view on failure.
    } finally {
      update({ loading: false });
    }
  }

  function handleScroll(top) {
    const enteredTopZone = top < 80 && state.lastScrollTop >= 80;
    update({ lastScrollTop: top });
    if (state.autoLoadReady && enteredTopZone && state.hasMore && !state.loading) loadMore();
  }

  return { reset, restore, loadSession, loadMore, handleScroll, isOlderThanLoadedHistory, markReadyWhenScrolled };
}
