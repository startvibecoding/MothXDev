<script>
  import { highlightedCodeToHTML } from '../../lib/markdown.js';
  import { buildToolCallView } from '../../lib/session-view.js';
  import { t } from '../../lib/preferences.js';

  export let open = false;
  export let pendingApprovals = [];
  export let selectedApproval = null;
  export let selectedApprovalID = '';
  export let approvalHistory = [];
  export let runtimeMode = 'yolo';
  export let submitting = false;
  export let onClose = () => {};
  export let onSelect = () => {};
  export let onRespond = () => {};

  $: visibleApproval = selectedApproval || pendingApprovals.find((approval) => approval.approvalId === selectedApprovalID) || null;
  $: approvalToolView = buildApprovalToolView(visibleApproval);

  function buildApprovalToolView(approval) {
    const tool = approval?.tool || {};
    return buildToolCallView(tool.name || '', tool.args || tool.details || {}, '', $t);
  }

  function bashCommand(approval) {
    const args = approval?.tool?.args || {};
    return approval?.tool?.details?.command || args.command || args.cmd || '';
  }

  function bashWorkDir(approval) {
    return approval?.tool?.details?.workDir || approval?.context?.workDir || '';
  }
</script>

{#if open}
  <div class="subagent-overlay" role="dialog" aria-modal="true" aria-label="Approval center">
    <div class="subagent-modal approval-center">
      <header>
        <div>
          <strong>Approval center</strong>
          <span>{pendingApprovals.length} pending · {approvalHistory.length} recorded for this session</span>
        </div>
        <button type="button" class="ghost sm" on:click={onClose}>Close</button>
      </header>
      <div class="approval-list" aria-live="polite">
        {#if visibleApproval}
          <article class="approval-card" aria-labelledby="approval-title-{visibleApproval.approvalId}">
            <div class="approval-card-head">
              <div class="approval-title-group">
                <div class="approval-kicker"><span class="approval-risk {visibleApproval.risk || 'medium'}">{visibleApproval.risk || 'medium'} risk</span><span>{visibleApproval.mode || runtimeMode} mode</span></div>
                <strong id="approval-title-{visibleApproval.approvalId}">{visibleApproval.summary || visibleApproval.tool?.name}</strong>
                <p>{visibleApproval.reason || 'This action requires confirmation.'}</p>
              </div>
              {#if pendingApprovals.length > 1}
                <label class="approval-picker">Request
                  <select aria-label="Select pending approval" value={selectedApprovalID} on:change={(event) => onSelect(event.currentTarget.value)}>
                    {#each pendingApprovals as approval}<option value={approval.approvalId}>{approval.summary || approval.tool?.name}</option>{/each}
                  </select>
                </label>
              {/if}
            </div>
            {#if visibleApproval.tool?.name === 'bash'}
              <div class="approval-bash tool-call-body embedded">
                <div class="tool-title">
                  <span class="dot running"></span>
                  <strong>Bash</strong>
                  {#if bashWorkDir(visibleApproval)}<span class="tool-target">{bashWorkDir(visibleApproval)}</span>{/if}
                </div>
                <div class="bash-block">
                  <span>command</span>
                  <pre>{bashCommand(visibleApproval)}</pre>
                </div>
              </div>
            {:else}
              <div class="approval-tool tool-call-body embedded">
                <div class="tool-title">
                  <span class="dot running"></span>
                  <strong>{approvalToolView.label || visibleApproval.tool?.label || visibleApproval.tool?.name}</strong>
                  {#if approvalToolView.target}<span class="tool-target">{approvalToolView.target}</span>{/if}
                </div>
                {#if approvalToolView.details?.length}
                  <div class="tool-call-tags">
                    {#each approvalToolView.details as detail}<span>{detail}</span>{/each}
                  </div>
                {/if}
                {#if approvalToolView.kind === 'edit' && approvalToolView.edits?.length}
                  <div class="edit-call">
                    {#each approvalToolView.edits as edit}
                      <section class="edit-block">
                        <div class="edit-block-head"><strong>{$t('chat.tool.edit.editNumber', { number: edit.index })}</strong><span>{$t('chat.tool.edit.lineChange', { old: edit.oldLines, next: edit.newLines })}</span></div>
                        <div class="edit-columns"><div class="edit-pane old"><span>{$t('chat.tool.edit.oldText')}</span><pre class:empty={edit.oldText === ''}><code>{@html edit.oldText ? highlightedCodeToHTML(edit.oldText, approvalToolView.target) : $t('chat.tool.edit.empty')}</code></pre></div><div class="edit-pane new"><span>{$t('chat.tool.edit.newText')}</span><pre class:empty={edit.newText === ''}><code>{@html edit.newText ? highlightedCodeToHTML(edit.newText, approvalToolView.target) : $t('chat.tool.edit.empty')}</code></pre></div></div>
                      </section>
                    {/each}
                  </div>
                {:else if approvalToolView.kind === 'write'}
                  <div class="write-call"><div class="write-call-head"><strong>{$t('chat.tool.write.preview')}</strong><span>{$t('chat.tool.write.summary', { lines: approvalToolView.lines, chars: approvalToolView.chars })}</span></div><span>{$t('chat.tool.write.content')}</span><pre class:empty={approvalToolView.content === ''}>{approvalToolView.content || $t('chat.tool.edit.empty')}</pre></div>
                {:else if approvalToolView.kind === 'insert'}
                  <div class="write-call"><div class="write-call-head"><strong>{$t('chat.tool.insert.preview')}</strong><span>{$t('chat.tool.insert.summary', { lines: approvalToolView.lines, chars: approvalToolView.chars })}</span></div><span>{$t('chat.tool.insert.content')}</span><pre class:empty={approvalToolView.content === ''}>{approvalToolView.content || $t('chat.tool.edit.empty')}</pre></div>
                {:else if approvalToolView.kind === 'find'}
                  <div class="find-call"><div class="find-row"><span>{$t('chat.tool.find.pattern')}</span><code>{approvalToolView.pattern || $t('chat.tool.find.missing')}</code></div><div class="find-row"><span>{$t('chat.tool.find.searchPath')}</span><code>{approvalToolView.path}</code></div></div>
                {:else if approvalToolView.kind === 'browser'}
                  <div class="browser-call"><div class="find-row"><span>{$t('chat.tool.browser.action')}</span><code>{approvalToolView.action || $t('chat.tool.browser.missing')}</code></div>{#if approvalToolView.url}<div class="find-row"><span>{$t('chat.tool.browser.url')}</span><code>{approvalToolView.url}</code></div>{/if}{#if approvalToolView.selector}<div class="find-row"><span>{$t('chat.tool.browser.selectorLabel')}</span><code>{approvalToolView.selector}</code></div>{/if}</div>
                {:else if approvalToolView.kind === 'skill-ref'}
                  <div class="skill-ref-call"><div class="find-row"><span>{$t('chat.tool.skillRef.skillLabel')}</span><code>{approvalToolView.skill || $t('chat.tool.skillRef.missing')}</code></div><div class="find-row"><span>{$t('chat.tool.skillRef.refLabel')}</span><code>{approvalToolView.ref || $t('chat.tool.skillRef.missing')}</code></div></div>
                {:else}
                  <div class="approval-tool-summary"><span>{visibleApproval.tool?.details?.path || visibleApproval.context?.workDir || 'This action requires permission.'}</span></div>
                {/if}
              </div>
            {/if}
            <div class="approval-actions">
              <button class="primary" disabled={submitting} on:click={() => onRespond(visibleApproval, 'approve_once')}>Approve once</button>
              <button class="ghost approval-deny" disabled={submitting} on:click={() => onRespond(visibleApproval, 'deny_once')}>Deny</button>
              {#if visibleApproval.actions?.includes('remember_command')}<span class="approval-action-divider"></span><button class="ghost sm" disabled={submitting} on:click={() => onRespond(visibleApproval, 'remember_command')}>Always allow command</button><button class="ghost sm" disabled={submitting} on:click={() => onRespond(visibleApproval, 'remember_prefix')}>Always allow prefix</button>{/if}
              {#if visibleApproval.actions?.includes('allow_edit_path')}<button class="ghost sm" disabled={submitting} on:click={() => onRespond(visibleApproval, 'allow_edit_path')}>Allow this path</button>{/if}
            </div>
            <details class="approval-raw"><summary>Request JSON</summary><pre>{JSON.stringify(visibleApproval, null, 2)}</pre></details>
          </article>
        {:else}
          <div class="approval-empty"><strong>No pending approvals</strong><span>New approval requests will appear here.</span></div>
        {/if}
        {#if approvalHistory.length}
          <section class="approval-history" aria-label="Session approval history">
            <div class="approval-history-head"><h4>Session audit history</h4><span>{approvalHistory.length} decisions</span></div>
            <div class="approval-history-list">
              {#each approvalHistory as item}
                <article class="approval-history-item">
                  <strong>{item.action === 'deny_once' ? 'Denied' : 'Approved'}</strong>
                  <span>{item.message || item.action}</span>
                </article>
              {/each}
            </div>
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}
