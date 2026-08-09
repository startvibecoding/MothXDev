<script>
  import { onMount } from 'svelte';
  import { t } from '../../lib/preferences.js';

  export let availableToolToggles = [];
  export let sessionTools = {};
  export let activeToolCount = 0;
  export let open = false;
  export let apiEnabled = true;
  export let busy = false;
  export let onToggle = () => {};
  export let onUpdateTool = () => {};
  export let onClose = () => {};

  let menu;

  onMount(() => {
    const handleOutsidePointer = (event) => {
      if (open && menu && !menu.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  });
</script>

<div bind:this={menu} class="tool-menu" aria-label={$t('chat.tools')}>
  <button type="button" class="tool-menu-toggle" class:open disabled={!apiEnabled || busy} on:click={onToggle} aria-expanded={open}>
    <span class="tool-menu-label">Tools</span><strong>{activeToolCount}</strong><span class="runtime-chevron">⌄</span>
  </button>
  {#if open}
    <div class="tool-menu-popover">
      <header><strong>{$t('chat.tools')}</strong><span>{$t('chat.toolHint')}</span></header>
      {#each availableToolToggles as item}
        <label class="tool-menu-item" class:active={sessionTools[item.key]} title={$t(`chat.toolToggle.${item.key}`)}>
          <input type="checkbox" checked={sessionTools[item.key]} disabled={!apiEnabled || busy} on:change={(event) => onUpdateTool(item.key, event)} />
          <span class="tool-item-name">{item.label}</span><em>{sessionTools[item.key] ? 'on' : 'off'}</em>
        </label>
      {/each}
    </div>
  {/if}
</div>
