import { approvalSessionID } from './approval.js';
import { eventBelongsToSession } from './session-runs.js';
import {
  reduceApprovalRequest,
  reduceApprovalResolved,
  reduceCapabilityEvent,
  reduceRunEvent,
  reduceRuntimeSnapshot,
  reduceStreamDone,
  reduceStreamError,
  reduceToolStatusEvent,
  reduceTranscriptEvent
} from './session-view.js';

function parseJSON(data) {
  try {
    return typeof data === 'string' ? JSON.parse(data) : data;
  } catch {
    return null;
  }
}

function streamErrorMessage(response, text) {
  const data = parseJSON(text);
  return data?.error?.message || data?.error || data?.message || `${response.status} ${response.statusText}`;
}

export function sessionStreamURL(sessionID, cursor = {}) {
  const params = new URLSearchParams();
  if (cursor.entrySeq > 0) params.set('after_entry_seq', String(cursor.entrySeq));
  if (cursor.runSeq > 0) params.set('after_run_seq', String(cursor.runSeq));
  if (cursor.capabilitySeq > 0) params.set('after_capability_seq', String(cursor.capabilitySeq));
  const query = params.toString();
  const path = `/api/sessions/${encodeURIComponent(sessionID)}/stream`;
  return query ? `${path}?${query}` : path;
}

export function createSessionStreamManager({
  fetcher = fetch,
  readSSE,
  getCurrentSession,
  getSessionState,
  getFallbackCursor,
  registerObserver,
  clearObserver,
  applyReducer,
  isCompletionActive,
  isOlderThanLoadedHistory,
  translate = (key) => key,
  setError,
  markStreamError,
  onDone,
  onSubAgentEffects,
  onApprovalRequest,
  recordApprovalResolution,
  onApprovalResolved,
  now = () => Date.now()
}) {
  function handleEvent(id, event) {
    if (!id || event.data === '[DONE]') return;
    const visible = id === getCurrentSession();

    if (event.event === 'status') {
      const item = parseJSON(event.data);
      if (item?.message) {
        const entry = {
          id: `stream-status-${now()}`,
          sessionId: id,
          eventType: 'status',
          status: 'running',
          timestamp: new Date(now()).toISOString(),
          data: { message: item.message }
        };
        applyReducer(id, (view) => ({ view: reduceRunEvent(view, entry) }));
      }
      return;
    }
    if (event.event === 'done') {
      applyReducer(id, (view) => ({ view: reduceStreamDone(view) }));
      if (visible) onDone?.(id);
      return;
    }
    if (event.event === 'heartbeat') return;
    if (event.event === 'error') {
      if (visible && isCompletionActive(getSessionState(id))) markStreamError?.();
      const item = parseJSON(event.data);
      const message = item?.error || event.data;
      applyReducer(id, (view) => reduceStreamError(view, message, translate));
      if (visible) setError?.(message);
      return;
    }
    if (event.event === 'transcript') {
      const item = parseJSON(event.data);
      if (!item || !eventBelongsToSession(id, item)) return;
      const seq = Number(item?.message?.seq || 0);
      if (seq > 0 && isOlderThanLoadedHistory(id, seq)) return;
      const { effects } = applyReducer(id, (view) => reduceTranscriptEvent(view, item, translate), { scroll: true });
      if (visible) onSubAgentEffects?.(effects);
      return;
    }
    if (event.event === 'run_event' || ['started', 'finished', 'failed', 'canceled'].includes(event.event)) {
      const item = parseJSON(event.data);
      if (!item || !eventBelongsToSession(id, item)) return;
      applyReducer(id, (view) => ({ view: reduceRunEvent(view, item) }));
      if ((item.status === 'failed' || item.eventType === 'failed') && item.data?.error) {
        if (visible && isCompletionActive(getSessionState(id))) markStreamError?.();
        applyReducer(id, (view) => reduceStreamError(view, item.data.error, translate));
      }
      return;
    }
    if (event.event === 'runtime_event') {
      const snapshot = parseJSON(event.data);
      if (!snapshot || !eventBelongsToSession(id, snapshot)) return;
      applyReducer(id, (view) => ({ view: reduceRuntimeSnapshot(view, snapshot) }));
      return;
    }
    if (event.event === 'approval_request') {
      const item = parseJSON(event.data);
      if (!item?.approvalId || !eventBelongsToSession(id, item)) return;
      const { effects } = applyReducer(id, (view) => {
        const result = reduceApprovalRequest(view, item, id);
        return { view: result.view, effects: { applies: result.applies } };
      });
      if (visible && effects?.applies) onApprovalRequest?.(item, effects);
      return;
    }
    if (event.event === 'approval_resolved') {
      const item = parseJSON(event.data);
      if (!item) return;
      const resolvedSessionID = approvalSessionID(item, id);
      if (resolvedSessionID) {
        recordApprovalResolution?.(item, resolvedSessionID);
        applyReducer(resolvedSessionID, (view) => ({ view: reduceApprovalResolved(view, item) }));
      }
      if (visible && resolvedSessionID === id) onApprovalResolved?.(item);
      return;
    }
    if (event.event === 'tool_event') {
      const item = parseJSON(event.data);
      if (!item || !eventBelongsToSession(id, item)) return;
      const { effects } = applyReducer(id, (view) => reduceToolStatusEvent(view, item, translate), { scroll: true });
      if (visible) onSubAgentEffects?.(effects);
      return;
    }
    if (event.event === 'capability_event') {
      const item = parseJSON(event.data);
      if (!item || !eventBelongsToSession(id, item)) return;
      applyReducer(id, (view) => ({ view: reduceCapabilityEvent(view, item) }));
    }
  }

  async function consume(id, cursor, abort) {
    try {
      const response = await fetcher(sessionStreamURL(id, cursor), { signal: abort.signal });
      if (!response.ok || !response.body) {
        const text = await response.text();
        throw new Error(streamErrorMessage(response, text));
      }
      await readSSE(response.body, (event) => handleEvent(id, event));
    } catch (error) {
      if (error?.name !== 'AbortError') setError?.(error);
    }
  }

  function start(id) {
    if (!id) return;
    const state = getSessionState(id);
    if (state.observer?.controller) return;
    const cursor = { ...(state.cursor || getFallbackCursor()) };
    const abort = new AbortController();
    registerObserver(id, abort);
    consume(id, cursor, abort).finally(() => clearObserver(id, abort));
  }

  return { start, consume, handleEvent };
}
