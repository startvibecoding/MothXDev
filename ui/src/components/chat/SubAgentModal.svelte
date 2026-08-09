<script>
  import { markdownToHTML } from '../../lib/markdown.js';
  import { formatArgs, shortID } from '../../lib/format.js';
  import { t } from '../../lib/preferences.js';

  export let open = false;
  export let agents = [];
  export let selectedAgentID = '';
  export let messages = [];
  export let loading = false;
  export let error = '';
  export let codeBlockControls;
  export let onClose = () => {};
  export let onSelect = () => {};

  $: selectedAgent = agents.find((item) => item.id === selectedAgentID) || null;

  function stateClass(agent) {
    if (!agent) return 'done';
    if (agent.status === 'error' || agent.status === 'failed') return 'error';
    if (agent.status === 'running' || agent.status === 'ready') return 'running';
    return 'done';
  }

  function statusLabel(status) {
    if (status === 'running' || status === 'ready') return $t('common.running');
    if (status === 'error' || status === 'failed') return $t('common.failed');
    if (status === 'destroyed') return $t('chat.subagents.destroyed');
    return $t('common.completed');
  }
</script>

{#if open}
  <div class="subagent-overlay" role="dialog" aria-modal="true" aria-label={$t('chat.subagents.history')}>
    <div class="subagent-modal">
      <header>
        <div>
          <strong>{$t('chat.subagents.history')}</strong>
          <span>{$t('chat.subagents.subtitle', { count: agents.length })}</span>
        </div>
        <button type="button" class="ghost sm" on:click={onClose}>{$t('common.close')}</button>
      </header>
      <div class="subagent-modal-body">
        <aside class="subagent-list">
          {#each agents as agent}
            <button
              type="button"
              class:active={agent.id === selectedAgentID}
              on:click={() => onSelect(agent.id)}
            >
              <span class="dot {stateClass(agent)}"></span>
              <strong>{shortID(agent.id)}</strong>
              <em>{statusLabel(agent.status)}</em>
              {#if agent.messageCount}<small>{agent.messageCount}</small>{/if}
            </button>
          {/each}
        </aside>
        <section class="subagent-history">
          {#if selectedAgent?.error}
            <div class="subagent-error" role="status">
              <strong>{$t('chat.subagents.error')}</strong>
              <p>{selectedAgent.error}</p>
            </div>
          {/if}
          {#if loading}
            <p class="pending-text">{$t('chat.subagents.loading')}</p>
          {:else if error}
            <p class="error-text">{error}</p>
          {:else if messages.length === 0}
            <p class="pending-text">{$t('chat.subagents.empty')}</p>
          {:else}
            {#each messages as item}
              <article class="subagent-msg {item.role}">
                <div class="meta">
                  <strong>{item.role === 'assistant' ? 'assistant' : item.role}</strong>
                  {#if item.toolName}<span>{item.toolName}</span>{/if}
                </div>
                {#if item.role === 'assistant'}
                  <div class="markdown" use:codeBlockControls>{@html markdownToHTML(item.content || '')}</div>
                {:else if item.role === 'user'}
                  <p>{item.content}</p>
                {:else if item.role === 'toolCall'}
                  <div class="tool-call-body embedded">
                    <div class="tool-title">
                      <span class="dot running"></span>
                      <strong>{item.callView?.label || item.toolName}</strong>
                      {#if item.callView?.target}<span class="tool-target">{item.callView.target}</span>{/if}
                    </div>
                    {#if item.callView?.details?.length}
                      <div class="tool-call-tags">
                        {#each item.callView.details as detail}<span>{detail}</span>{/each}
                      </div>
                    {/if}
                    {#if item.callView?.kind === 'browser'}
                      <div class="browser-call">
                        <div class="find-row"><span>{$t('chat.tool.browser.action')}</span><code>{item.callView.action || $t('chat.tool.browser.missing')}</code></div>
                        {#if item.callView.url}<div class="find-row"><span>{$t('chat.tool.browser.url')}</span><code>{item.callView.url}</code></div>{/if}
                        {#if item.callView.selector}<div class="find-row"><span>{$t('chat.tool.browser.selectorLabel')}</span><code>{item.callView.selector}</code></div>{/if}
                      </div>
                    {:else if item.callView?.kind === 'skill-ref'}
                      <div class="skill-ref-call">
                        <div class="find-row"><span>{$t('chat.tool.skillRef.skillLabel')}</span><code>{item.callView.skill || $t('chat.tool.skillRef.missing')}</code></div>
                        <div class="find-row"><span>{$t('chat.tool.skillRef.refLabel')}</span><code>{item.callView.ref || $t('chat.tool.skillRef.missing')}</code></div>
                      </div>
                    {:else if item.callView?.kind === 'workflow-lint'}
                      <div class="workflow-lint-call">
                        <div class="write-call-head"><strong>{$t('chat.tool.workflowLint.source')}</strong><span>{$t('chat.tool.write.summary', { lines: item.callView.lines, chars: item.callView.chars })}</span></div>
                        <pre class:empty={item.callView.source === ''}>{item.callView.source || $t('chat.tool.workflowLint.missing')}</pre>
                      </div>
                    {:else if item.callView?.kind === 'subagent-task'}
                      <div class="subagent-call"><span>{$t('chat.tool.subagent.task')}</span><p>{item.callView.task || item.callView.target}</p></div>
                    {:else if item.callView?.kind === 'subagent-handle'}
                      <div class="subagent-call compact"><div class="find-row"><span>{$t('chat.tool.subagent.handle')}</span><code>{item.callView.handle || $t('chat.tool.subagent.handleMissing')}</code></div></div>
                    {/if}
                  </div>
                {:else if item.role === 'toolResult'}
                  <div class="tool-mini"><span class="dot {item.isError ? 'error' : 'done'}"></span><strong>{item.toolName}</strong><span>{item.summary}</span></div>
                {:else if item.role === 'status'}
                  <div class="tool-mini"><span class="dot {item.isError ? 'error' : 'done'}"></span><strong>{statusLabel(item.content)}</strong>{#if item.summary}<span>{item.summary}</span>{/if}</div>
                {:else}
                  <pre>{item.content || formatArgs(item.arguments)}</pre>
                {/if}
              </article>
            {/each}
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}
