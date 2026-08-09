<script>
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { readSSE, postJSON } from '../lib/api.js';
  import { approvalSessionID, approvalHistoryFromRunEvents, createApprovalManager } from '../lib/approval.js';
  import {
    sessions,
    capabilities,
    upsertSession,
    currentSession,
    selectedModel,
    models,
    features,
    setError,
    setNotice,
    clearBanners,
    refreshSessions,
    refreshStatsSummary,
    resetSelectedModelToDefault,
    getSessionMessagesLatest,
    getSessionMessagesBefore,
    getSessionToolResult,
    getSessionSubAgents,
    getSessionSubAgentMessages,
    getSessionRunEvents,
    getSessionCapabilityEvents,
    getSessionRuntime,
    patchSessionRuntime,
    cancelResponsesRun,
    getResponsesRun,
    reconnectResponsesRun,
    sessionRuntime,
    runEvents,
    runsConnected,
    activeApproval,
    sessionToolOptions,
    sessionToolsFor,
    setSessionTools,
    moveSessionTools
  } from '../lib/stores.js';
  import {
    normalizeSessionMessage,
    viewFromSessionState,
    sessionStateWithView,
    reduceRunEvent,
    reduceStreamError,
    reduceApprovalResolved,
    supportsAttachmentDownload,
    maxSeq
  } from '../lib/session-view.js';
  import {
    sessionRunStates,
    ensureSessionState,
    getSessionState,
    updateSessionState,
    isCompletionActive,
    isActiveRunStatus,
    registerCompletion,
    markCompletion,
    clearCompletion,
    abortCompletion,
    registerObserver,
    clearObserver,
    stopObserver
  } from '../lib/session-runs.js';
  import Composer from '../components/chat/Composer.svelte';
  import ChatTranscript from '../components/chat/ChatTranscript.svelte';
  import ApprovalCenter from '../components/chat/ApprovalCenter.svelte';
  import SubAgentModal from '../components/chat/SubAgentModal.svelte';
  import DirBrowser from '../components/DirBrowser.svelte';
  import MCPConfigEditor from '../components/MCPConfigEditor.svelte';
  import { t } from '../lib/preferences.js';
  import {
    safeAttachmentURL,
    formatCompactTokens,
    formatCacheRate,
    isCronRun,
    cronRunName,
    formatEventTime,
    normalizeToolResultDetail,
    buildSessionEventSummary,
    buildSubAgentSummary
  } from '../lib/chat-helpers.js';
  import {
    buildSessionRunPayload,
    createResponsesRunPoller,
    createSessionRunManager
  } from '../lib/chat-runtime.js';
  import { createSessionRuntimeManager } from '../lib/chat-runtime-state.js';
  import { createSessionStreamManager } from '../lib/chat-session-stream.js';
  import { createSubAgentManager } from '../lib/chat-subagents.js';
  import {
    createSessionHistoryManager,
    createSessionSwitchManager,
    persistSessionView,
    restoreSessionView
  } from '../lib/chat-session-state.js';

  let prompt = '';
  let availableSkills = [];
  let activeSkills = [];
  let showSkillPicker = false;
  let showToolMenu = false;
  let loadedSkillsKey = '';
  let messages = [];
  let loadingHistory = false;
  // Scroll-top auto-load gating is managed by chat-session-state.js so only
  // user scrolls that enter the top zone after initial positioning load history.
  let busy = false;
  let chatEvents = [];
  let sessionRunEvents = [];
  let sessionCapabilityEvents = [];
  let workDir = '';
  let sessionCreated = false;
  let showBrowser = false;
  let imageUploads = [];
  let chatScroll;
  let shouldFollowOutput = true;
  let scrollFrame = 0;
  let streamUsesTranscript = false;
  let streamHadError = false;
  let sessionHistoryLoadedFor = '';
  let sessionStreamCompletedFor = '';
  let sessionStreamCursor = { entrySeq: 0, runSeq: 0, capabilitySeq: 0 };
  let optimisticRunEventID = '';
  let sessionToolKey = '__new__';
  let sessionTools = sessionToolsFor({}, sessionToolKey);
  let subAgents = [];
  let subAgentTranscripts = {};
  let hostedItems = [];
  let showSubAgentModal = false;
  let selectedSubAgentID = '';
  let subAgentModalMessages = [];
  let subAgentModalLoading = false;
  let subAgentModalError = '';
  let sessionRuntimeValue = null;
  let newSessionMode = 'yolo';
  let runtimeUpdating = false;
  let approvalHistory = [];
  let runEventCursor = 0;
  let composer;
  let showRuntimePanel = false;
  let showModelPicker = false;
  let showApprovalCenter = false;
  let showMCPConfig = false;
  let selectedApprovalID = '';
  let approvalSubmitting = false;
  let stopSubmitting = false;
  let runtimePoller;
  let runtimeManager;
  let sessionHistoryManager;
  let sessionSwitchManager;
  let sessionStreamManager;
  let subAgentManager;
  let approvalManager;
  $: activeSession = ($sessions || []).find((item) => item?.id === $currentSession);
  $: channelBadge = activeSession?.channelLabel || $t('sessions.local');

  const suggestions = [
    'chat.suggestion.projectSummary',
    'chat.suggestion.reviewChanges',
    'chat.suggestion.addTests',
    'chat.suggestion.fixTests',
    'chat.suggestion.refactor',
    'chat.suggestion.configAudit',
    'chat.suggestion.readme',
    'chat.suggestion.multiAgent'
  ];

  // webSearch is MothX's configured local search capability. Provider-native
  // hosted tools are intentionally not listed here because they are enabled by
  // their provider/API rather than a WebUI session switch.
  const toolToggles = [
    { key: 'webSearch', label: 'web_search' },
    { key: 'browser', label: 'browser' },
    { key: 'a2aMaster', label: 'a2aMaster' },
    { key: 'delegate', label: 'delegate' },
    { key: 'multiAgent', label: 'multi-agent' },
    { key: 'workflows', label: 'workflow' }
  ];

  function attachmentDownloadURL(attachment) {
    if (!attachment || attachment.kind !== 'file' || !attachment.providerRef || !$currentSession) return '';
    if (!supportsAttachmentDownload($capabilities)) return '';
    return `/api/attachments/${encodeURIComponent(attachment.providerRef)}?session_id=${encodeURIComponent($currentSession)}`;
  }

  // Reset or load state when the selected session changes.
  onMount(() => {
    if ($currentSession) {
      loadSessionMessages($currentSession);
    }
    loadSkills();
  });
  onDestroy(() => {
    for (const state of Object.values(get(sessionRunStates))) {
      state.observer?.controller?.abort();
      // Runs are persistent; do not abort on component destroy. completion is left intact.;
    }
    runtimePoller?.stop();
    subAgentManager?.destroy();
  });

  $: sessionSwitchManager.select($currentSession);

  function persistLocalSessionState(id) {
    if (!id) return;
    updateSessionState(id, (state) => persistSessionView(state, id, {
      ...currentView(),
      streamCompleted: sessionStreamCompletedFor === id,
      streamUsesTranscript,
      optimisticRunEventID
    }, sessionHistoryLoadedFor));
  }

  function restoreLocalSessionState(state) {
    const restored = restoreSessionView(state);
    messages = restored.messages;
    chatEvents = restored.toolEvents;
    sessionRunEvents = restored.runEvents;
    sessionCapabilityEvents = restored.capabilityEvents;
    sessionRuntimeValue = restored.runtime;
    sessionRuntime.set(restored.runtime);
    sessionStreamCursor = restored.cursor;
    sessionHistoryLoadedFor = restored.historyLoadedFor;
    sessionStreamCompletedFor = restored.streamCompletedFor;
    streamUsesTranscript = restored.streamUsesTranscript;
    optimisticRunEventID = restored.optimisticRunEventID;
    subAgents = restored.subAgents;
    subAgentTranscripts = restored.subAgentTranscripts;
    hostedItems = restored.hostedItems;
    approvalHistory = approvalHistoryFromRunEvents(sessionRunEvents);
    return messages;
  }

  // --- Session view state ---
  // The visible session renders from component locals; background sessions
  // update their own entry in sessionRunStates directly. Both paths share the
  // same pure reducers from lib/session-view.js — no projection swapping.

  function currentView() {
    return {
      messages,
      toolEvents: chatEvents,
      runEvents: sessionRunEvents,
      capabilityEvents: sessionCapabilityEvents,
      runtime: sessionRuntimeValue,
      cursor: sessionStreamCursor,
      streamCompleted: Boolean($currentSession) && sessionStreamCompletedFor === $currentSession,
      subAgents,
      subAgentTranscripts,
      hostedItems
    };
  }

  function applyView(view) {
    // Assign only changed references — Svelte invalidates on every
    // assignment, so no-op replay frames must not touch the view.
    if (messages !== view.messages) messages = view.messages;
    if (chatEvents !== view.toolEvents) chatEvents = view.toolEvents;
    if (sessionRunEvents !== view.runEvents) sessionRunEvents = view.runEvents;
    if (sessionCapabilityEvents !== view.capabilityEvents) sessionCapabilityEvents = view.capabilityEvents;
    if (sessionRuntimeValue !== view.runtime) {
      sessionRuntimeValue = view.runtime;
      sessionRuntime.set(view.runtime);
    }
    if (sessionStreamCursor !== view.cursor) sessionStreamCursor = view.cursor;
    sessionStreamCompletedFor = view.streamCompleted ? $currentSession : '';
    if (subAgents !== view.subAgents) subAgents = view.subAgents;
    if (subAgentTranscripts !== view.subAgentTranscripts) subAgentTranscripts = view.subAgentTranscripts;
    if (hostedItems !== view.hostedItems) hostedItems = view.hostedItems;
    approvalHistory = approvalHistoryFromRunEvents(sessionRunEvents);
    persistLocalSessionState($currentSession);
  }

  // applySessionViewReducer runs a pure view reducer for session `id`.
  // For the visible session it applies the result to the component view and
  // optionally scrolls; for background sessions it writes straight into
  // sessionRunStates without touching the DOM or scroll position.
  function applySessionViewReducer(id, reduce, { scroll = false } = {}) {
    if (!id || typeof reduce !== 'function') return { effects: {} };
    if (id === $currentSession) {
      const previousMessages = messages;
      const { view, effects = {} } = reduce(currentView());
      applyView(view);
      if (effects.forceScroll) scrollChatToBottom({ force: true });
      else if ((scroll || effects.scroll) && view.messages !== previousMessages) scrollChatToBottom();
      return { effects };
    }
    let effects = {};
    updateSessionState(id, (state) => {
      const result = reduce(viewFromSessionState(state));
      effects = result.effects || {};
      return sessionStateWithView(state, result.view);
    });
    return { effects };
  }

  sessionHistoryManager = createSessionHistoryManager({
    getCurrentSession: () => $currentSession,
    getSessionState,
    getMessages: () => messages,
    setMessages: (next) => { messages = next; },
    clearToolEvents: () => { chatEvents = []; },
    loadEvents: loadSessionEvents,
    loadRuntime: loadSessionRuntime,
    updateCursor: updateSessionStreamCursorFromState,
    markHistoryLoaded: (id) => { sessionHistoryLoadedFor = id; },
    persist: persistLocalSessionState,
    normalizeMessage: (message) => normalizeSessionMessage(message, $t),
    getLatest: getSessionMessagesLatest,
    getBefore: getSessionMessagesBefore,
    scrollToBottom: scrollChatToBottom,
    getScrollElement: () => chatScroll,
    afterDOMUpdate: tick,
    setSessionCreated: (created) => { sessionCreated = created; },
    onStateChange: (state) => {
      loadingHistory = state.loading;
    }
  });

  sessionSwitchManager = createSessionSwitchManager({
    initialSession: $currentSession,
    persist: persistLocalSessionState,
    stopObserver,
    stopRuntimePolling: () => runtimePoller?.stop(),
    resetHistory: () => {
      sessionHistoryLoadedFor = '';
      sessionHistoryManager.reset();
    },
    resetTransientView: () => {
      subAgents = [];
      subAgentTranscripts = {};
      subAgentManager.reset();
      activeApproval.set(null);
      selectedApprovalID = '';
    },
    resetNewSessionView: () => {
      sessionCreated = false;
      workDir = '';
      messages = [];
      chatEvents = [];
      sessionRunEvents = [];
      sessionCapabilityEvents = [];
      resetSelectedModelToDefault();
      shouldFollowOutput = true;
    },
    getSessionState,
    isRestorable: (state) => state.historyLoaded || isCompletionActive(state),
    restoreSession: restoreLocalSessionState,
    restoreHistory: (restoredMessages) => sessionHistoryManager.restore(restoredMessages),
    setSessionCreated: (created) => { sessionCreated = created; },
    scrollToBottom: scrollChatToBottom,
    markHistoryReady: (id) => sessionHistoryManager.markReadyWhenScrolled(id),
    loadSession: loadSessionMessages,
    onRestoreError: (error) => {
      console.warn('Failed to restore cached session state, loading from server:', error);
    }
  });

  function loadSessionMessages(id) {
    return sessionHistoryManager.loadSession(id);
  }

  function isOlderThanLoadedHistory(id, seq) {
    return sessionHistoryManager.isOlderThanLoadedHistory(id, seq, sessionHistoryLoadedFor);
  }

  runtimePoller = createResponsesRunPoller({
    getCurrentSession: () => $currentSession,
    getRuntime: () => sessionRuntimeValue,
    setRuntime: (snapshot) => {
      sessionRuntimeValue = snapshot;
      sessionRuntime.set(snapshot);
    },
    persist: persistLocalSessionState,
    reconnect: reconnectResponsesRun,
    getRun: getResponsesRun,
    loadRuntime: loadSessionRuntime,
    isActive: isActiveRunStatus
  });

  subAgentManager = createSubAgentManager({
    getCurrentSession: () => $currentSession,
    getAgents: () => subAgents,
    setAgents: (next) => { subAgents = next; },
    getTranscripts: () => subAgentTranscripts,
    fetchAgents: getSessionSubAgents,
    fetchMessages: getSessionSubAgentMessages,
    normalizeMessage: (message) => normalizeSessionMessage(message, $t),
    onModalStateChange: (state) => {
      showSubAgentModal = state.open;
      selectedSubAgentID = state.selectedAgentID;
      subAgentModalMessages = state.messages;
      subAgentModalLoading = state.loading;
      subAgentModalError = state.error;
    }
  });

  runtimeManager = createSessionRuntimeManager({
    getCurrentSession: () => $currentSession,
    getRuntime: () => sessionRuntimeValue,
    setRuntime: (snapshot) => {
      sessionRuntimeValue = snapshot;
      sessionRuntime.set(snapshot);
    },
    getSessionRuntime,
    patchSessionRuntime,
    getSessionTools: () => sessionTools,
    setSessionTools,
    persist: persistLocalSessionState,
    upsertSession,
    refreshSessions,
    setUpdating: (updating) => { runtimeUpdating = updating; },
    setError
  });

  sessionRunManager = createSessionRunManager({
    getCurrentSession: () => $currentSession,
    getSessionState,
    getRuntime: () => sessionRuntimeValue,
    setRuntime: (snapshot) => {
      sessionRuntimeValue = snapshot;
      sessionRuntime.set(snapshot);
    },
    persist: persistLocalSessionState,
    applyViewReducer: applySessionViewReducer,
    registerCompletion,
    markCompletion,
    clearCompletion,
    abortCompletion,
    updateOptimisticID: (sessionID, id) => {
      updateSessionState(sessionID, (state) => ({ ...state, optimisticRunEventID: id }));
      if (sessionID === $currentSession) optimisticRunEventID = id;
    },
    upsertSession,
    buildSessionInfo: buildOptimisticSessionInfo,
    refreshSessions,
    refreshStats: refreshStatsSummary,
    loadMessages: loadSessionMessages,
    loadSubAgents,
    loadRuntime: loadSessionRuntime,
    setSessionCreated: (created) => { sessionCreated = created; },
    getStreamHadError: (sessionID) => sessionID === $currentSession && streamHadError,
    reduceError: (view, message) => reduceStreamError(view, message, $t),
    setError,
    setNotice,
    translate: (key) => $t(key),
    setStopSubmitting: (submitting) => { stopSubmitting = submitting; },
    cancelResponsesRun,
    postJSON,
    getSessionRuntime
  });

  approvalManager = createApprovalManager({
    getCurrentSession: () => $currentSession,
    getRuntime: () => sessionRuntimeValue,
    getSelectedID: () => selectedApprovalID,
    setSelected: (id, approval) => {
      selectedApprovalID = id;
      activeApproval.set(approval);
    },
    setOpen: (open) => { showApprovalCenter = open; },
    setSubmitting: (submitting) => { approvalSubmitting = submitting; },
    postJSON,
    recordResolution: recordApprovalResolution,
    applyViewReducer: applySessionViewReducer,
    reduceResolved: reduceApprovalResolved,
    setError
  });

  sessionStreamManager = createSessionStreamManager({
    readSSE,
    getCurrentSession: () => $currentSession,
    getSessionState,
    getFallbackCursor: () => sessionStreamCursor,
    registerObserver,
    clearObserver,
    applyReducer: applySessionViewReducer,
    isCompletionActive,
    isOlderThanLoadedHistory,
    translate: (key, params) => $t(key, params),
    setError,
    markStreamError: () => { streamHadError = true; },
    onDone: (id) => {
      refreshSessions().catch(() => {});
      loadSessionMessages(id).catch(() => {});
      loadSubAgents(id).catch(() => {});
      refreshStatsSummary().catch(() => {});
    },
    onSubAgentEffects: handleSubAgentEffects,
    onApprovalRequest: (item) => {
      approvalManager.request(item);
    },
    recordApprovalResolution,
    onApprovalResolved: (item) => {
      approvalManager.resolved(item);
    }
  });

  $: selectedRunState = $currentSession ? $sessionRunStates[$currentSession] : null;
  // busy reflects runs started by this page (completion) as well as runs
  // observed after a page refresh via the runtime snapshot (activeRun).
  $: busy = isCompletionActive(selectedRunState)
    || isActiveRunStatus(selectedRunState?.runtime?.activeRun?.status)
    || isActiveRunStatus(sessionRuntimeValue?.activeRun?.status)
    || isActiveRunStatus(sessionRuntimeValue?.responsesRun?.state);
  $: {
    const responseRun = sessionRuntimeValue?.responsesRun;
    if (responseRun && isActiveRunStatus(responseRun.state)) {
      startResponsesRunPolling($currentSession, responseRun.localRunId);
    } else {
      runtimePoller?.stop();
    }
  }
  $: runtimeMode = sessionRuntimeValue?.mode || activeSession?.mode || (!$currentSession ? newSessionMode : 'yolo');
  $: pendingApprovalCount = (sessionRuntimeValue?.pendingApprovals || []).length;
  $: {
    approvalManager?.syncPending();
  }
  $: selectedApproval = (sessionRuntimeValue?.pendingApprovals || []).find((approval) => approval.approvalId === selectedApprovalID) || $activeApproval || null;
  $: runtimeActiveRun = sessionRuntimeValue?.activeRun || (
    sessionRuntimeValue?.responsesRun
      ? {
          runId: sessionRuntimeValue.responsesRun.localRunId,
          status: sessionRuntimeValue.responsesRun.state,
          responses: true
        }
      : null
  );
  $: sessionToolKey = $currentSession || '__new__';
  $: sessionTools = sessionToolsFor($sessionToolOptions, sessionToolKey, activeSession || $features);
  $: availableToolToggles = toolToggles.filter((item) => isToolToggleVisible(item, $features));
  $: visibleSessionTools = filterHiddenSessionTools(sessionTools, $features);
  $: sessionEventSummary = buildSessionEventSummary(sessionRunEvents, sessionCapabilityEvents, activeSessionWorkDir, $selectedModel);
  $: subAgentSummary = buildSubAgentSummary(subAgents, $t);
  $: modelOptions = $models;
  $: activeModel = modelOptions.find((m) => m.id === $selectedModel);
  $: selectedModelSupportsImages = (activeModel?.input || []).includes('image');
  $: apiEnabled = $features.api;
  $: skillNames = activeSkills;
  $: skillsWorkDir = activeSessionWorkDir || workDir.trim();
  $: skillsContextKey = `${$currentSession || ''}:${skillsWorkDir}`;
  $: if (apiEnabled && skillsContextKey && skillsContextKey !== loadedSkillsKey) {
    loadedSkillsKey = skillsContextKey;
    loadSkills();
  }
  $: isNewSession = !$currentSession && !sessionCreated;
  $: activeToolCount = availableToolToggles.filter(i => sessionTools[i.key]).length;
  $: activeSessionWorkDir = activeSession?.workDir || workDir.trim();
  $: if ($currentSession && activeSession?.workDir && workDir !== activeSession.workDir) {
    workDir = activeSession.workDir;
  }
  $: if (!selectedModelSupportsImages && imageUploads.length > 0) {
    clearImages();
  }
  $: {
    // runEvents is capped (trimmed) in stores.js, so track a monotonic wsSeq
    // cursor instead of an array index — trimmed events must not stall processing.
    const pendingEvents = $runEvents.filter((item) => Number(item?.wsSeq || 0) > runEventCursor);
    if (pendingEvents.length > 0) {
      runEventCursor = Number(pendingEvents[pendingEvents.length - 1].wsSeq) || runEventCursor;
      for (const item of pendingEvents) {
        if (item?.type !== 'session_event' || !item.sessionId) continue;
        const eventName = item.event || item.stream || '';
        if (!eventName) continue;
        // WebSocket replay encodes persisted lifecycle events using their
        // concrete names (started/finished/failed/canceled), while live
        // broker events use the generic run_event name. Normalize both forms
        // before handing them to the session reducer.
        const normalizedEvent = ['started', 'finished', 'failed', 'canceled'].includes(eventName)
          ? 'run_event'
          : eventName;
        sessionStreamManager.handleEvent(item.sessionId, {
          event: normalizedEvent,
          data: JSON.stringify(item.data ?? item)
        });
      }
    }
  }
  $: {
    const tailID = $currentSession;
    // The SSE tail is a fallback when the runs WebSocket is unavailable. It
    // must cover runs initiated in this page too: otherwise a failed socket
    // leaves the active response without any live updates until final refresh.
    const localRunActive = isCompletionActive($sessionRunStates[tailID]);
    const serverRunActive = Boolean(
      activeSession?.running
      || isActiveRunStatus($sessionRunStates[tailID]?.runtime?.activeRun?.status)
      || isActiveRunStatus(sessionRuntimeValue?.activeRun?.status)
    );
    const shouldTail = Boolean(
      tailID
      && !$runsConnected
      && (localRunActive || serverRunActive)
      && sessionStreamCompletedFor !== tailID
    );
    if (shouldTail) {
      sessionStreamManager.start(tailID);
    } else if (!shouldTail && tailID) {
      stopObserver(tailID);
    }
  }

  function pick(text) {
    if (busy) return;
    prompt = text;
    sendPrompt();
  }

  function handleKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendPrompt();
    }
  }

  async function loadSkills() {
    if (!apiEnabled) return;
    try {
      const params = new URLSearchParams();
      if ($currentSession) params.set('sessionId', $currentSession);
      else if (activeSessionWorkDir || workDir.trim()) params.set('workDir', activeSessionWorkDir || workDir.trim());
      const data = await fetch(`/api/skillhub/installed?${params}`).then((r) => r.ok ? r.json() : null);
      availableSkills = (data?.installed || []).filter((item) => item?.name).map((item) => ({ name: item.name, description: item.name, active: Boolean(item.active) }));
      const serverActive = data?.session?.activeSkills;
      activeSkills = Array.isArray(serverActive) ? serverActive : availableSkills.filter((item) => item.active).map((item) => item.name);
    } catch { availableSkills = []; }
  }

  async function toggleSkill(name, event) {
    const next = event.currentTarget.checked ? [...activeSkills, name] : activeSkills.filter((item) => item !== name);
    activeSkills = [...new Set(next)];
    if (!$currentSession) return;
    try {
      await postJSON('/api/skillhub/set-active', { sessionId: $currentSession, names: activeSkills });
    } catch (err) { setError(err); await loadSkills(); }
  }

  async function sendPrompt() {
    const outgoing = prompt.trim();
    const outgoingImages = imageUploads;
    if ((!outgoing && outgoingImages.length === 0) || !apiEnabled) return;
    if (outgoingImages.length > 0 && !selectedModelSupportsImages) {
      setError($t('chat.error.modelNoImages'));
      return;
    }
    const creatingSession = isNewSession;
    if (creatingSession && !workDir.trim()) {
      setError($t('chat.error.needWorkDir'));
      return;
    }

    const sessionID = $currentSession || newWebUISessionID();
    const creatingExplicitSession = !$currentSession;
    const existingState = getSessionState(sessionID);
    if (
      isCompletionActive(existingState)
      || isActiveRunStatus(existingState.runtime?.activeRun?.status)
      || isActiveRunStatus(existingState.runtime?.responsesRun?.state)
      || isActiveRunStatus(sessionRuntimeValue?.activeRun?.status)
      || isActiveRunStatus(sessionRuntimeValue?.responsesRun?.state)
    ) {
      setError('This session already has an active run.');
      return;
    }
    if (creatingExplicitSession) {
      ensureSessionState(sessionID);
      moveSessionTools('__new__', sessionID);
      currentSession.set(sessionID);
    }
    stopObserver(sessionID);
    sessionStreamCompletedFor = '';
    chatEvents = [];
    streamUsesTranscript = false;
    streamHadError = false;

    messages = [...messages, { role: 'user', content: outgoing, images: outgoingImages }];
    if (creatingExplicitSession) {
      upsertSession(buildOptimisticSessionInfo(sessionID, outgoing));
      refreshSessions().catch(() => {});
    }
    scrollChatToBottom({ force: true });
    prompt = '';
    imageUploads = [];
    composer?.clearImageInput();

    const payload = buildSessionRunPayload({
      message: outgoing,
      model: $selectedModel,
      mode: creatingSession ? newSessionMode : undefined,
      tools: visibleSessionTools,
      skills: activeSkills,
      images: outgoingImages
    });
    await sessionRunManager.start({
      sessionID,
      payload,
      creatingExplicitSession,
      firstMessage: outgoing,
      event: {
        model: $selectedModel || 'default',
        mode: activeSession?.mode || '',
        workDir: creatingSession ? workDir.trim() : activeSessionWorkDir
      }
    });
  }

  function newWebUISessionID() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `webui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function buildOptimisticSessionInfo(id, firstMessage = '', overrides = {}) {
    const now = new Date().toISOString();
    const cwd = workDir.trim() || activeSessionWorkDir || '';
    return {
      id,
      workDir: cwd,
      mode: overrides.mode || newSessionMode || runtimeMode || 'yolo',
      active: true,
      running: false,
      lastUsed: now,
      messageCount: Math.max(1, messages.length || 1),
      preview: firstMessage,
      title: firstMessage,
      ...overrides
    };
  }

  async function stop() {
    if (!$currentSession || stopSubmitting) return;
    await sessionRunManager.stop($currentSession);
  }

  function resetSession() {
    resetSelectedModelToDefault();
    newSessionMode = 'yolo';
    currentSession.set('');
  }

  function handleChatScroll() {
    if (!chatScroll) return;
    shouldFollowOutput = isChatNearBottom();
    // Scroll to top: load more history. Edge-triggered: only a user scroll
    // that moves from outside into the top zone counts; programmatic scroll
    // resets (refresh, session switch, message reload after a run) fire
    // scroll events too and must not start a load cascade.
    const top = chatScroll.scrollTop;
    sessionHistoryManager.handleScroll(top);
  }

  function isChatNearBottom() {
    if (!chatScroll) return true;
    const distance = chatScroll.scrollHeight - chatScroll.scrollTop - chatScroll.clientHeight;
    return distance < 96;
  }

  async function scrollChatToBottom({ force = false } = {}) {
    if (!chatScroll) return;
    if (!force && !shouldFollowOutput) return;
    await tick();
    if (!chatScroll) return;
    if (scrollFrame) cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (!chatScroll) return;
      if (!force && !shouldFollowOutput) return;
      chatScroll.scrollTop = chatScroll.scrollHeight;
      shouldFollowOutput = true;
    });
  }

  async function updateToolOption(key, event) {
    const targetSession = $currentSession;
    const previousTools = sessionTools;
    const nextTools = filterHiddenSessionTools({
      ...sessionTools,
      [key]: Boolean(event.currentTarget.checked)
    }, $features);
    setSessionTools(sessionToolKey, nextTools);
    if (!targetSession) return;
    const updated = await runtimeManager.updateCapability(key, Boolean(event.currentTarget.checked), {
      filterTools: (tools) => filterHiddenSessionTools(tools, $features)
    });
    if (updated && targetSession === $currentSession) await loadSessionEvents(targetSession);
    if (!updated) setSessionTools(targetSession, previousTools);
  }

  function isWebSearchAvailable(featureState = {}) {
    // /api/status is the effective runtime configuration. Capabilities only
    // describes what the server can support and remains available even when
    // the configured local web_search service is disabled.
    return featureState.webSearch === true;
  }

  function isToolToggleVisible(item, featureState = {}) {
    if (item?.key === 'webSearch') return isWebSearchAvailable(featureState);
    if (item?.key === 'a2aMaster') return featureState.a2aMaster === true;
    return true;
  }

  function filterHiddenSessionTools(tools = {}, featureState = {}) {
    return {
      ...tools,
      webSearch: isWebSearchAvailable(featureState) && tools.webSearch === true,
      a2aMaster: featureState.a2aMaster === true && tools.a2aMaster === true
    };
  }

  function onDirSelect(e) {
    workDir = e.detail.path;
    showBrowser = false;
  }

  async function chooseWorkDir() {
    const desktop = globalThis.__MOTHX_DESKTOP__;
    if (!desktop?.chooseDirectory) {
      showBrowser = true;
      return;
    }
    try {
      const selected = await desktop.chooseDirectory(workDir.trim());
      if (selected) workDir = selected;
    } catch (err) {
      setError(err);
    }
  }

  async function handleImageSelect(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    if (!selectedModelSupportsImages) {
      setError($t('chat.error.modelNoImages'));
      event.target.value = '';
      return;
    }
    try {
      const next = await Promise.all(files.map(readImageFile));
      imageUploads = [...imageUploads, ...next].slice(0, 6);
    } catch (err) {
      setError(err);
    } finally {
      event.target.value = '';
    }
  }

  function readImageFile(file) {
    if (!file.type.startsWith('image/')) {
      throw new Error($t('chat.error.unsupportedFileType', { name: file.name }));
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: String(reader.result || '')
      });
      reader.onerror = () => reject(new Error($t('chat.error.imageReadFailed', { name: file.name })));
      reader.readAsDataURL(file);
    });
  }

  function removeImage(index) {
    imageUploads = imageUploads.filter((_, i) => i !== index);
  }

  function clearImages() {
    imageUploads = [];
    composer?.clearImageInput();
  }

  function recordApprovalResolution(resolution, sessionID) {
    if (!resolution?.approvalId || !sessionID) return;
    const id = `approval-resolution-${resolution.approvalId}-${resolution.status || 'resolved'}`;
    applySessionViewReducer(sessionID, (view) => ({
      view: reduceRunEvent(view, {
        id,
        sessionId: sessionID,
        eventType: 'approval_resolved',
        status: resolution.status || 'resolved',
        timestamp: resolution.timestamp || new Date().toISOString(),
        data: { resolution }
      })
    }));
  }

  function selectApproval(approvalID) {
    approvalManager.select(approvalID);
  }

  async function respondApproval(approval, action) {
    await approvalManager.respond(approval, action);
  }

  async function loadSessionRuntime(id) {
    await runtimeManager.load(id);
  }

  function startResponsesRunPolling(sessionID, localRunID) {
    runtimePoller?.start(sessionID, localRunID);
  }

  async function updateRuntime(patch) {
    return runtimeManager.update(patch);
  }

  async function setMode(mode) {
    return runtimeManager.setMode(mode, (nextMode) => { newSessionMode = nextMode; });
  }

  async function loadSessionEvents(id) {
    if (!id) {
      sessionRunEvents = [];
      sessionCapabilityEvents = [];
      approvalHistory = [];
      return;
    }
    try {
      const [runs, caps] = await Promise.all([
        getSessionRunEvents(id),
        getSessionCapabilityEvents(id)
      ]);
      if (id !== $currentSession) return;
      sessionRunEvents = runs || [];
      approvalHistory = approvalHistoryFromRunEvents(sessionRunEvents);
      sessionCapabilityEvents = caps || [];
    } catch {
      if (id !== $currentSession) return;
      sessionRunEvents = [];
      sessionCapabilityEvents = [];
      approvalHistory = [];
    }
  }

  function loadSubAgents(id) {
    return subAgentManager.loadAgents(id);
  }

  function openSubAgentModal(agentID = '') {
    subAgentManager.open(agentID);
  }

  function closeSubAgentModal() {
    subAgentManager.close();
  }

  function selectSubAgent(agentID) {
    subAgentManager.select(agentID);
  }

  function updateSessionStreamCursorFromState() {
    sessionStreamCursor = {
      entrySeq: maxSeq(messages),
      runSeq: maxSeq(sessionRunEvents),
      capabilitySeq: maxSeq(sessionCapabilityEvents)
    };
  }

  // handleSubAgentEffects applies view-only side effects reported by reducers
  // (sub-agent list refresh, open modal sync). Visible session only.
  function handleSubAgentEffects(effects = {}) {
    subAgentManager.handleEffects(effects);
  }

  function selectModel(modelID) {
    $selectedModel = modelID;
    showModelPicker = false;
  }

  // Derived (not a template function call): Svelte cannot see reactive
  // reads inside function bodies, so {modelLabel()} in the template would be
  // evaluated once at mount and never update.
  $: currentModelLabel =
    (modelOptions.find((model) => model.id === $selectedModel)?.name ||
      modelOptions.find((model) => model.id === $selectedModel)?.id) ||
    $t('chat.defaultModel');
  function sessionRunStateClass(run) {
    if (!run) return 'done';
    if (run.status === 'failed' || run.eventType === 'failed') return 'error';
    if (run.status === 'running' || run.eventType === 'started') return 'running';
    return 'done';
  }

  function sessionRunLabel(run) {
    if (!run) return $t('chat.sessionEvents.idle');
    if (run.status === 'running' || run.eventType === 'started') return $t('common.running');
    if (run.status === 'failed' || run.eventType === 'failed') return $t('common.failed');
    if (run.status === 'canceled' || run.eventType === 'canceled') return $t('chat.sessionEvents.canceled');
    return $t('common.completed');
  }

  function sessionEventTooltip(summary) {
    if (!summary) return '';
    const parts = [];
    if (isCronRun(summary.lastRun)) {
      parts.push($t('chat.sessionEvents.cron'));
      if (cronRunName(summary.lastRun)) parts.push(cronRunName(summary.lastRun));
    }
    if (summary.workDir) parts.push(summary.workDir);
    if (summary.model) parts.push(summary.model);
    parts.push(`${formatCompactTokens(summary.totalTokens)} tokens`);
    parts.push(`cache ${formatCacheRate(summary)}`);
    if (summary.lastRun?.timestamp) parts.push(formatEventTime(summary.lastRun.timestamp));
    return parts.join(' · ');
  }

  async function loadToolResultDetail(msg, event) {
    if (!event.currentTarget.open || !msg.hasDetail || msg.detailLoaded || msg.detailLoading) return;
    if (!$currentSession || !msg.toolCallId) return;
    msg.detailLoading = true;
    msg.detailError = '';
    messages = messages;
    try {
      const detail = await getSessionToolResult($currentSession, msg.toolCallId);
      msg.detail = normalizeToolResultDetail(detail);
      msg.detailLoaded = true;
    } catch (err) {
      msg.detailError = err instanceof Error ? err.message : String(err || $t('chat.tool.detailLoadFailed'));
    } finally {
      msg.detailLoading = false;
      messages = messages;
    }
  }

  function codeBlockControls(node) {
    const handleClick = (event) => { void copyCodeBlock(event); };
    node.addEventListener('click', handleClick);
    node.addEventListener('toggle', updateCodeBlockToggle);
    return {
      destroy() {
        node.removeEventListener('click', handleClick);
        node.removeEventListener('toggle', updateCodeBlockToggle);
      }
    };
  }

  async function copyCodeBlock(event) {
    const button = event.target.closest('.code-copy');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const code = button.closest('.code-block')?.querySelector('code')?.textContent || '';
    if (!code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = code;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
      }
      button.textContent = 'Copied';
      button.classList.add('copied');
      window.setTimeout(() => {
        button.textContent = 'Copy';
        button.classList.remove('copied');
      }, 1600);
    } catch {
      button.textContent = 'Failed';
      window.setTimeout(() => { button.textContent = 'Copy'; }, 1600);
    }
  }

  function updateCodeBlockToggle(event) {
    const block = event.target.closest('.code-block');
    if (!block) return;
    const toggle = block.querySelector('.code-block-toggle');
    if (toggle) toggle.textContent = block.open ? toggle.dataset.collapse : toggle.dataset.expand;
  }
</script>

<section class="chat-view">
  {#if subAgentSummary.visible}
    <button type="button" class="subagent-strip" on:click={() => openSubAgentModal()}>
      <span class="dot {subAgentSummary.failed > 0 ? 'error' : subAgentSummary.running > 0 ? 'running' : 'done'}"></span>
      <strong>{$t('chat.subagents.title')}</strong>
      <span>{subAgentSummary.label}</span>
      <em>{$t('chat.subagents.open')}</em>
    </button>
  {/if}
  <div class="chat-scroll" bind:this={chatScroll} on:scroll={handleChatScroll}>
    {#if loadingHistory}
      <div class="chat-history-loading">{$t('common.loading')}</div>
    {/if}
    {#if messages.length === 0 && !busy}
      <div class="welcome">
        <h2>{$t('chat.welcome')}</h2>
        <div class="suggestions">
          {#each suggestions as key}
            <button
              type="button"
              class="chip"
              disabled={!apiEnabled || (isNewSession && !workDir.trim())}
              on:click={() => pick($t(key))}
            >
              {$t(key)}
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <ChatTranscript
        {messages}
        sessionID={$currentSession}
        {busy}
        {hostedItems}
        sessionEventSummary={sessionEventSummary}
        {codeBlockControls}
        onImageLoad={scrollChatToBottom}
        safeURL={safeAttachmentURL}
        downloadURL={attachmentDownloadURL}
        onToolToggle={loadToolResultDetail}
        {sessionEventTooltip}
        {sessionRunStateClass}
        {sessionRunLabel}
      />
    {/if}
  </div>

  <Composer
    bind:this={composer}
    {prompt}
    {imageUploads}
    {busy}
    {apiEnabled}
    {isNewSession}
    {workDir}
    currentSession={$currentSession}
    {activeSessionWorkDir}
    {selectedModelSupportsImages}
    {modelOptions}
    selectedModel={$selectedModel}
    {currentModelLabel}
    {showModelPicker}
    {runtimeMode}
    {pendingApprovalCount}
    {runtimeActiveRun}
    {showRuntimePanel}
    {runtimeUpdating}
    {availableSkills}
    {activeSkills}
    {showSkillPicker}
    {availableToolToggles}
    {sessionTools}
    {activeToolCount}
    {showToolMenu}
    stopSubmitting={stopSubmitting}
    onPromptChange={(value) => (prompt = value)}
    onKeydown={handleKeydown}
    onSend={sendPrompt}
    onStop={stop}
    onImageSelect={handleImageSelect}
    onRemoveImage={removeImage}
    onToggleModel={() => (showModelPicker = !showModelPicker)}
    onSelectModel={selectModel}
    onSetMode={setMode}
    onToggleRuntime={() => (showRuntimePanel = !showRuntimePanel)}
    onReviewApprovals={() => (showApprovalCenter = true)}
    onToggleSkills={() => (showSkillPicker = !showSkillPicker)}
    onToggleSkill={toggleSkill}
    onToggleTools={() => (showToolMenu = !showToolMenu)}
    onUpdateTool={updateToolOption}
    onOpenMCP={() => (showMCPConfig = true)}
    onChooseWorkDir={chooseWorkDir}
    onResetSession={resetSession}
    onCloseRuntime={() => (showRuntimePanel = false)}
    onCloseModelPicker={() => (showModelPicker = false)}
    onCloseSkillPicker={() => (showSkillPicker = false)}
    onCloseToolMenu={() => (showToolMenu = false)}
  />
</section>


<ApprovalCenter
  open={showApprovalCenter}
  pendingApprovals={sessionRuntimeValue?.pendingApprovals || []}
  {selectedApproval}
  {selectedApprovalID}
  {approvalHistory}
  {runtimeMode}
  submitting={approvalSubmitting}
  onClose={() => (showApprovalCenter = false)}
  onSelect={selectApproval}
  onRespond={respondApproval}
/>

{#if showMCPConfig && $currentSession}
  <div class="mcp-session-overlay" role="dialog" aria-modal="true" aria-label={$t('chat.mcp.sessionTitle')}>
    <div class="mcp-session-dialog">
      <div class="mcp-session-head">
        <div><strong>{$t('chat.mcp.sessionTitle')}</strong><span>{$t('chat.mcp.sessionHint')}</span></div>
        <button type="button" class="ghost sm" on:click={() => (showMCPConfig = false)}>{$t('common.close')}</button>
      </div>
      {#key $currentSession}
        <MCPConfigEditor
          endpoint={`/api/sessions/${encodeURIComponent($currentSession)}/mcp`}
          title={$t('chat.mcp.projectTitle')}
          hint={$t('chat.mcp.projectHint', { workDir: activeSession?.workDir || '' })}
        />
      {/key}
    </div>
  </div>
{/if}

<DirBrowser bind:open={showBrowser} on:select={onDirSelect} on:close={() => (showBrowser = false)} />

<SubAgentModal
  open={showSubAgentModal}
  agents={subAgents}
  selectedAgentID={selectedSubAgentID}
  messages={subAgentModalMessages}
  loading={subAgentModalLoading}
  error={subAgentModalError}
  {codeBlockControls}
  onClose={closeSubAgentModal}
  onSelect={selectSubAgent}
/>
