// Runtime helpers for Chat run submission, cancellation, completion waiting,
// and Responses API polling. The UI supplies state and side-effect callbacks so
// this module remains independent from Svelte component lifecycle and stores.
export function createOptimisticRunEvent(sessionID, { model = 'default', mode = '', workDir = '', now = Date.now() } = {}) {
  const timestamp = new Date(now).toISOString();
  return {
    id: `local-run-${now}`,
    runId: `local_${now}`,
    sessionId: sessionID || '',
    eventType: 'started',
    source: 'webui',
    status: 'running',
    model: model || 'default',
    mode,
    timestamp,
    data: { workDir, optimistic: true }
  };
}

export function finishOptimisticRunEvents(runEvents, eventID, status, error = '', now = Date.now()) {
  const index = (runEvents || []).findIndex((item) => item.id === eventID);
  if (index < 0) return runEvents;
  const next = [...runEvents];
  next[index] = {
    ...next[index],
    eventType: status === 'failed' ? 'failed' : status === 'canceled' ? 'canceled' : 'finished',
    status,
    timestamp: new Date(now).toISOString(),
    data: { ...(next[index].data || {}), ...(error ? { error } : {}) }
  };
  return next;
}

function errorMessage(error) {
  return String(error?.message || error || '').trim();
}

export function createSessionRunManager({
  getCurrentSession,
  getSessionState,
  getRuntime,
  setRuntime,
  persist,
  applyViewReducer,
  registerCompletion,
  markCompletion,
  clearCompletion,
  abortCompletion,
  updateOptimisticID,
  upsertSession,
  buildSessionInfo,
  refreshSessions,
  refreshStats,
  loadMessages,
  loadSubAgents,
  loadRuntime,
  setSessionCreated,
  getStreamHadError,
  reduceError,
  setError,
  setNotice,
  translate,
  setStopSubmitting,
  cancelResponsesRun,
  postJSON,
  getSessionRuntime,
  submit = submitSessionRun,
  wait = waitForRunCompletion,
  cancel = cancelSessionRun
}) {
  async function start({ sessionID, payload, creatingExplicitSession = false, firstMessage = '', event = {} }) {
    const controller = new AbortController();
    registerCompletion(sessionID, controller);
    const optimisticEvent = createOptimisticRunEvent(sessionID, event);
    updateOptimisticID(sessionID, optimisticEvent.id);
    applyViewReducer(sessionID, (view) => ({
      view: { ...view, runEvents: [...view.runEvents.filter((item) => item.id !== optimisticEvent.id), optimisticEvent] }
    }));
    persist(sessionID);

    try {
      await submit({ sessionID, payload, signal: controller.signal });
      markCompletion(sessionID, 'running');
      if (creatingExplicitSession) {
        upsertSession(buildSessionInfo(sessionID, firstMessage, { running: true }));
        refreshSessions().catch(() => {});
      }
      applyViewReducer(sessionID, (view) => ({
        view: { ...view, messages: [...view.messages, { role: 'assistant', content: '' }] },
        effects: { forceScroll: true }
      }));
      await wait(sessionID, controller.signal, getSessionState);
      const failed = getStreamHadError(sessionID);
      const finalStatus = failed ? 'failed' : 'completed';
      finishEvent(sessionID, optimisticEvent.id, finalStatus, failed ? getSessionState(sessionID).lastError : '');
      markCompletion(sessionID, finalStatus, failed ? getSessionState(sessionID).lastError : '');
      setSessionCreated(true);
    } catch (error) {
      const canceled = error?.name === 'AbortError';
      finishEvent(sessionID, optimisticEvent.id, canceled ? 'canceled' : 'failed', canceled ? '' : errorMessage(error));
      if (!canceled) applyViewReducer(sessionID, (view) => reduceError(view, errorMessage(error)));
      markCompletion(sessionID, canceled ? 'canceled' : 'failed', canceled ? '' : error);
      if (sessionID === getCurrentSession()) {
        if (canceled) setNotice(translate('chat.notice.stopped'));
        else setError(error);
      }
    } finally {
      clearCompletion(sessionID, controller);
      try { await refreshSessions(); } catch { /* opportunistic */ }
      try { await refreshStats(); } catch { /* opportunistic */ }
      if (sessionID === getCurrentSession()) {
        try { await loadMessages(sessionID); } catch { /* opportunistic */ }
        try { await loadSubAgents(sessionID); } catch { /* opportunistic */ }
      }
      updateOptimisticID(sessionID, '');
    }
  }

  function finishEvent(sessionID, eventID, status, error = '') {
    applyViewReducer(sessionID, (view) => ({
      view: { ...view, runEvents: finishOptimisticRunEvents(view.runEvents, eventID, status, error) }
    }));
    upsertSession({ id: sessionID, active: true, running: false });
  }

  async function stop(sessionID = getCurrentSession()) {
    if (!sessionID) return;
    const runtime = getRuntime() || {};
    const responsesRun = runtime.responsesRun;
    const activeRun = runtime.activeRun;
    setStopSubmitting(true);
    markCompletion(sessionID, 'cancel_requested');
    if (sessionID === getCurrentSession() && (activeRun || responsesRun)) {
      const next = {
        ...runtime,
        ...(activeRun
          ? { activeRun: { ...activeRun, status: 'cancelling' } }
          : { responsesRun: { ...responsesRun, state: 'cancelling', cancelRequested: true } })
      };
      setRuntime(next);
      persist(sessionID);
    }
    try {
      await cancel({ sessionID, responsesRun, activeRun, cancelResponsesRun, postJSON });
      abortCompletion(sessionID);
      setNotice(translate('chat.notice.stopped'));
      const snapshot = await getSessionRuntime(sessionID);
      if (sessionID === getCurrentSession()) {
        setRuntime(snapshot);
        persist(sessionID);
      }
    } catch (error) {
      setError(error);
      if (error?.message?.includes('no active run')) {
        markCompletion(sessionID, 'failed', error);
        if (sessionID === getCurrentSession()) await loadRuntime(sessionID);
      }
    } finally {
      setStopSubmitting(false);
    }
  }

  return { start, stop };
}

export function buildSessionRunPayload({ message, model, mode, tools = {}, skills = [], images = [] }) {
  return {
    message,
    model: model || 'default',
    mode,
    tools: Object.keys(tools || {}).filter((key) => tools[key]),
    skills,
    images: images.map((image) => image.dataUrl),
    transcript: true
  };
}

export async function submitSessionRun({ sessionID, payload, signal, fetcher = fetch }) {
  const response = await fetcher(`/api/sessions/${encodeURIComponent(sessionID)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal
  });
  if (!response.ok) {
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    throw new Error(data?.error?.message || data?.error || data?.message || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function cancelSessionRun({ sessionID, responsesRun, activeRun, cancelResponsesRun, postJSON }) {
  if (responsesRun && !activeRun) {
    return cancelResponsesRun(sessionID, responsesRun.localRunId);
  }
  return postJSON(`/api/sessions/${encodeURIComponent(sessionID)}/stop`, {});
}

export function waitForRunCompletion(sessionID, signal, getState, intervalMs = 250) {
  return new Promise((resolve) => {
    let timer = 0;
    const cleanup = () => {
      if (timer) clearInterval(timer);
      timer = 0;
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => finish();
    const isFinished = () => {
      const state = getState(sessionID);
      const status = state?.completion?.status;
      return Boolean(
        state?.streamCompleted
        || status === 'completed'
        || status === 'failed'
        || status === 'cancel_requested'
      );
    };

    if (signal?.aborted || isFinished()) {
      finish();
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setInterval(() => {
      if (signal?.aborted || isFinished()) finish();
    }, intervalMs);
  });
}

export function createResponsesRunPoller({
  getCurrentSession,
  getRuntime,
  setRuntime,
  persist,
  reconnect,
  getRun,
  loadRuntime,
  isActive
}) {
  let timer = 0;
  let reconnectKey = '';

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = 0;
    }
  }

  function updateRun(sessionID, run) {
    const current = getRuntime() || {};
    const next = {
      ...current,
      responsesRun: {
        ...current.responsesRun,
        localRunId: run.localRunId,
        responseId: run.responseId,
        state: run.state,
        cancelRequested: run.cancelRequested
      }
    };
    setRuntime(next);
    persist(sessionID);
  }

  function start(sessionID, localRunID) {
    if (!sessionID || !localRunID || timer) return;
    const key = `${sessionID}:${localRunID}`;
    if (reconnectKey !== key) {
      reconnectKey = key;
      reconnect(sessionID, localRunID)
        .then((result) => {
          const run = result?.run;
          if (sessionID !== getCurrentSession() || !run || run.localRunId !== localRunID) return;
          updateRun(sessionID, run);
        })
        .catch(() => {
          // Polling remains authoritative when reconnect cannot acquire the lock.
        });
    }

    const poll = async () => {
      if (sessionID !== getCurrentSession()) return;
      try {
        const run = await getRun(sessionID, localRunID);
        if (sessionID !== getCurrentSession()) return;
        if (run && run.localRunId === localRunID) updateRun(sessionID, run);
        if (!run || !isActive(run.state)) {
          stop();
          await loadRuntime(sessionID);
        }
      } catch {
        // Keep durable state visible; the next interval retries.
      }
    };
    void poll();
    timer = setInterval(poll, 1000);
  }

  return { start, stop };
}
