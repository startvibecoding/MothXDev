<script>
  import PlanMessage from './PlanMessage.svelte';
  import ToolCallMessage from './ToolCallMessage.svelte';
  import ToolResultMessage from './ToolResultMessage.svelte';
  import TranscriptMessage from './TranscriptMessage.svelte';
  import { t } from '../../lib/preferences.js';
  import { compactPath, cronRunName, formatCacheRate, formatCompactTokens, formatEventTime, isCronRun } from '../../lib/chat-helpers.js';

  export let messages = [];
  export let sessionID = '';
  export let busy = false;
  export let hostedItems = [];
  export let sessionEventSummary = { visible: false };
  export let codeBlockControls;
  export let onImageLoad = () => {};
  export let safeURL = () => '';
  export let downloadURL = () => '';
  export let onToolToggle = () => {};
  export let sessionEventTooltip = () => '';
  export let sessionRunStateClass = () => 'done';
  export let sessionRunLabel = () => '';
</script>

<div class="transcript">
  {#each messages as msg, idx}
    {#if msg.role === 'user' || msg.role === 'assistant'}
      <TranscriptMessage
        {msg}
        {sessionID}
        isLast={idx === messages.length - 1}
        {busy}
        {codeBlockControls}
        onImageLoad={onImageLoad}
        safeURL={safeURL}
        downloadURL={downloadURL}
      />
    {:else if msg.role === 'plan'}
      <PlanMessage {msg} />
    {:else if msg.role === 'toolCall'}
      <ToolCallMessage {msg} />
    {:else if msg.role === 'toolResult'}
      <ToolResultMessage {msg} onToggle={onToolToggle} {codeBlockControls} onImageLoad={onImageLoad} />
    {/if}
  {/each}
  {#if hostedItems.length}
    <div class="hosted-items" aria-label={$t('chat.hostedActivity')} aria-live="polite">
      {#each hostedItems as item}
        <span class="hosted-item-status">
          <span>{item.type || 'hosted'}</span>
          <span class="hosted-item-state">{item.status || 'updated'}</span>
        </span>
      {/each}
    </div>
  {/if}
  {#if sessionEventSummary.visible}
    <aside class="session-event-strip" title={sessionEventTooltip(sessionEventSummary)}>
      <span class="dot {sessionRunStateClass(sessionEventSummary.lastRun)}"></span>
      <strong>{sessionRunLabel(sessionEventSummary.lastRun)}</strong>
      {#if isCronRun(sessionEventSummary.lastRun)}
        <span class="event-kind cron">{$t('chat.sessionEvents.cron')}</span>
        {#if cronRunName(sessionEventSummary.lastRun)}<span>{cronRunName(sessionEventSummary.lastRun)}</span>{/if}
      {/if}
      {#if sessionEventSummary.workDir}<span class="path">{compactPath(sessionEventSummary.workDir)}</span>{/if}
      {#if sessionEventSummary.model}<span>{sessionEventSummary.model}</span>{/if}
      <span class="metric">{$t('chat.sessionEvents.tokens', { tokens: formatCompactTokens(sessionEventSummary.totalTokens) })}</span>
      <span class="metric">{$t('chat.sessionEvents.cache', { rate: formatCacheRate(sessionEventSummary) })}</span>
      {#if sessionEventSummary.capabilityCount > 0}
        <span>{$t('chat.sessionEvents.capabilities', { count: sessionEventSummary.capabilityCount })}</span>
      {/if}
    </aside>
  {/if}
</div>
