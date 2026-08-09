<script>
  import { shortID } from '../../lib/format.js';
  import { t } from '../../lib/preferences.js';

  export let msg;

  function statusLabel(status) {
    switch (status) {
      case 'done': return $t('chat.plan.done');
      case 'running': return $t('chat.plan.running');
      case 'failed': return $t('chat.plan.failed');
      default: return $t('chat.plan.pending');
    }
  }
</script>

<article class="msg plan-card">
  <div class="meta">
    <strong>{$t('chat.plan')}</strong>
    {#if msg.toolCallId}<span>{shortID(msg.toolCallId)}</span>{/if}
  </div>
  <section class="todo-plan">
    {#if msg.plan.title}
      <h3>{msg.plan.title}</h3>
    {/if}
    <ol>
      {#each msg.plan.steps as step}
        <li class:done={step.status === 'done'} class:running={step.status === 'running'} class:failed={step.status === 'failed'}>
          <span class="todo-mark" aria-hidden="true"></span>
          <span class="todo-title">{step.title}</span>
          <em>{statusLabel(step.status)}</em>
        </li>
      {/each}
    </ol>
    {#if msg.plan.note}
      <p>{msg.plan.note}</p>
    {/if}
  </section>
</article>
