<script>
  import { onMount } from 'svelte';
  import { t } from '../../lib/preferences.js';

  export let options = [];
  export let selected = '';
  export let label = '';
  export let open = false;
  export let apiEnabled = true;
  export let onToggle = () => {};
  export let onSelect = () => {};
  export let onClose = () => {};

  let picker;

  onMount(() => {
    const handleOutsidePointer = (event) => {
      if (open && picker && !picker.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  });
</script>

<div bind:this={picker} class="model-picker" aria-label={$t('chat.selectModel')}>
  <button
    type="button"
    class="model-picker-toggle"
    class:open
    disabled={!apiEnabled || options.length === 0}
    aria-expanded={open}
    on:click={onToggle}
  >
    <span>{label}</span>
    <span class="model-picker-chevron" aria-hidden="true">⌄</span>
  </button>
  {#if open}
    <div class="model-picker-menu" role="listbox">
      {#each options as model}
        <button
          type="button"
          class:active={selected === model.id}
          role="option"
          aria-selected={selected === model.id}
          on:click={() => onSelect(model.id)}
        >{model.id}</button>
      {/each}
    </div>
  {/if}
</div>
