import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalSessionID, shouldAdoptApprovalSession, approvalRequestOwnership, applyApprovalRequestToRuntime, approvalHistoryFromRunEvents, createApprovalManager } from './approval.js';

test('approval request establishes a newly streamed session before transcript chunks', () => {
  const approval = { approvalId: 'approval-1', sessionId: 'new-session' };

  assert.equal(shouldAdoptApprovalSession('', approval), true);
  assert.equal(approvalSessionID(approval, ''), 'new-session');
});

test('approval response targets its originating session rather than selected state', () => {
  const approval = { approvalId: 'approval-1', sessionId: 'origin-session' };

  assert.equal(approvalSessionID(approval, 'other-selected-session'), 'origin-session');
  assert.equal(shouldAdoptApprovalSession('other-selected-session', approval), false);
});


test('approval falls back to the current session for compatible legacy frames', () => {
  assert.equal(approvalSessionID({ approvalId: 'approval-1' }, 'existing-session'), 'existing-session');
  assert.equal(shouldAdoptApprovalSession('', { approvalId: 'approval-1' }), false);
});

test('late approval from an old streamed session does not contaminate current runtime', () => {
  const currentRuntime = {
    sessionId: 'current-session',
    pendingApprovals: [{ approvalId: 'current-approval', sessionId: 'current-session' }]
  };
  const lateApproval = { approvalId: 'old-approval', sessionId: 'old-session' };

  assert.deepEqual(approvalRequestOwnership('current-session', lateApproval), {
    sessionID: 'old-session', adopt: false, belongs: false
  });
  assert.deepEqual(applyApprovalRequestToRuntime(currentRuntime, 'current-session', lateApproval), currentRuntime);
  assert.equal(approvalSessionID(lateApproval, 'current-session'), 'old-session');
});

test('current session approval is visible and response routing remains with its source session', () => {
  const approval = { approvalId: 'current-approval', sessionId: 'current-session' };
  const runtime = applyApprovalRequestToRuntime({ sessionId: 'current-session', pendingApprovals: [] }, 'current-session', approval);

  assert.deepEqual(runtime.pendingApprovals, [approval]);
  assert.equal(approvalSessionID(runtime.pendingApprovals[0], 'different-selected-session'), 'current-session');
});

test('approval manager synchronizes selection and routes resolution to the originating session', async () => {
  let currentSession = 'session-a';
  let runtime = { pendingApprovals: [
    { approvalId: 'a1', sessionId: 'session-a' },
    { approvalId: 'a2', sessionId: 'session-a' }
  ] };
  let selectedID = '';
  let selected = null;
  let open = false;
  let submitting = false;
  const calls = [];
  const manager = createApprovalManager({
    getCurrentSession: () => currentSession,
    getRuntime: () => runtime,
    getSelectedID: () => selectedID,
    setSelected: (id, approval) => { selectedID = id; selected = approval; },
    setOpen: (value) => { open = value; },
    setSubmitting: (value) => { submitting = value; },
    postJSON: async (url, body) => { calls.push(['post', url, body]); return { approvalId: 'a1', action: body.action }; },
    recordResolution: (resolution, id) => calls.push(['record', resolution, id]),
    applyViewReducer: (id, reducer) => calls.push(['reduce', id, reducer({ runtime }).view]),
    reduceResolved: (view, item) => ({ ...view, runtime: { ...view.runtime, pendingApprovals: view.runtime.pendingApprovals.filter((approval) => approval.approvalId !== item.approvalId) } }),
    setError: (error) => calls.push(['error', error])
  });

  manager.syncPending();
  assert.equal(selectedID, 'a1');
  manager.request(runtime.pendingApprovals[1]);
  assert.equal(selectedID, 'a2');
  assert.equal(open, true);
  await manager.respond({ approvalId: 'a1', sessionId: 'session-a' }, 'approve_once');
  assert.equal(submitting, false);
  assert.deepEqual(calls[0], ['post', '/api/sessions/session-a/approvals/a1', { action: 'approve_once' }]);
  assert.equal(calls.some(([name]) => name === 'record' && name !== 'record'), false);

  currentSession = 'session-b';
  manager.resolved({ approvalId: 'a2', sessionId: 'session-a' });
  assert.equal(selectedID, '');
  assert.equal(selected, null);
});
test('approval audit history is reconstructed from persisted session run events', () => {
  const events = [
    { eventType: 'finished', data: {} },
    { eventType: 'approval_resolved', data: { resolution: { approvalId: 'older', action: 'deny_once', timestamp: '2026-07-18T00:00:00Z' } } },
    { eventType: 'approval_resolved', data: { resolution: { approvalId: 'newer', action: 'approve_once', timestamp: '2026-07-18T01:00:00Z' } } }
  ];

  assert.deepEqual(approvalHistoryFromRunEvents(events).map((item) => item.approvalId), ['newer', 'older']);
});
