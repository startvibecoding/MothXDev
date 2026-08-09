<script>
  import { t } from '../../lib/preferences.js';
  import { shortID } from '../../lib/format.js';

  export let sessionID = '';
  export let workDir = '';
  export let onReset = () => {};
</script>

{#if sessionID}
  <div class="composer-session-info">
    <span class="session-badge">{$t('chat.session')}</span>
    <span class="session-id">{shortID(sessionID)}</span>
    {#if workDir}<span class="session-dir">{workDir}</span>{/if}
    <button type="button" class="ghost sm" on:click={onReset}>{$t('chat.newSession')}</button>
  </div>
{/if}
