// Session runtime state manager for Chat. It owns runtime snapshot loading,
// PATCH updates, mode selection, and capability-to-tool synchronization while
// leaving Svelte stores and view state under caller control.

function enabledCapabilities(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot?.capabilities || {}).map(([key, state]) => [key, Boolean(state?.enabled)])
  );
}

export function createSessionRuntimeManager({
  getCurrentSession,
  getRuntime,
  setRuntime,
  getSessionRuntime,
  patchSessionRuntime,
  getSessionTools,
  setSessionTools,
  persist,
  upsertSession,
  refreshSessions,
  setUpdating,
  setError
}) {
  let updating = false;

  function applySnapshot(sessionID, snapshot) {
    if (sessionID !== getCurrentSession()) return false;
    setRuntime(snapshot);
    setSessionTools(sessionID, {
      ...(getSessionTools() || {}),
      ...enabledCapabilities(snapshot)
    });
    return true;
  }

  async function load(sessionID) {
    if (!sessionID) {
      setRuntime(null);
      return null;
    }
    try {
      const snapshot = await getSessionRuntime(sessionID);
      applySnapshot(sessionID, snapshot);
      return snapshot;
    } catch (error) {
      if (sessionID === getCurrentSession()) setError(error);
      return null;
    }
  }

  async function update(patch) {
    const sessionID = getCurrentSession();
    if (!sessionID || updating) return null;
    const previous = getRuntime();
    updating = true;
    setUpdating(true);
    try {
      const snapshot = await patchSessionRuntime(sessionID, patch);
      if (applySnapshot(sessionID, snapshot)) persist(sessionID);
      // The PATCH response is authoritative; refreshing the session list is
      // opportunistic and must not extend the controls' disabled period.
      upsertSession({ id: sessionID, mode: snapshot?.mode });
      void refreshSessions().catch(() => {});
      return snapshot;
    } catch (error) {
      if (sessionID === getCurrentSession()) {
        setRuntime(previous);
        setError(error);
      }
      return null;
    } finally {
      updating = false;
      setUpdating(false);
    }
  }

  async function setMode(mode, newSessionMode) {
    if (!getCurrentSession()) {
      newSessionMode(mode);
      return null;
    }
    return update({ mode });
  }

  async function updateCapability(key, enabled, { filterTools = (tools) => tools } = {}) {
    const sessionID = getCurrentSession();
    const previousTools = getSessionTools() || {};
    const nextTools = filterTools({ ...previousTools, [key]: Boolean(enabled) });
    setSessionTools(sessionID || '__new__', nextTools);
    if (!sessionID) return null;
    try {
      const snapshot = await update({ capabilities: { [key]: Boolean(enabled) } });
      if (!snapshot) setSessionTools(sessionID, previousTools);
      return snapshot;
    } catch (error) {
      setSessionTools(sessionID, previousTools);
      throw error;
    }
  }

  return { load, update, setMode, updateCapability, enabledCapabilities };
}

export { enabledCapabilities };
