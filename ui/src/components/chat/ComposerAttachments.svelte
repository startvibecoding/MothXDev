<script>
  import { t } from '../../lib/preferences.js';
  import { formatImageSize } from '../../lib/chat-helpers.js';

  export let images = [];
  export let enabled = false;
  export let apiEnabled = true;
  export let busy = false;
  export let showPreviews = true;
  export let showControl = true;
  export let onSelect = () => {};
  export let onRemove = () => {};

  let input;

  export function clearInput() {
    if (input) input.value = '';
  }
</script>

{#if showPreviews && images.length > 0}
  <div class="image-preview-row">
    {#each images as image, idx}
      <div class="image-preview">
        <img src={image.dataUrl} alt={image.name} />
        <span title={image.name}>{image.name}</span>
        <em>{formatImageSize(image.size)}</em>
        <button type="button" aria-label={$t('chat.removeImage')} on:click={() => onRemove(idx)}>×</button>
      </div>
    {/each}
  </div>
{/if}

{#if showControl}
  <input
    bind:this={input}
    class="file-input"
    type="file"
    accept="image/png,image/jpeg,image/gif,image/webp"
    multiple
    on:change={onSelect}
  />
  {#if enabled}
    <button
      type="button"
      class="icon-btn"
      disabled={!apiEnabled || busy}
      title={$t('chat.uploadImage')}
      aria-label={$t('chat.uploadImage')}
      on:click={() => input?.click()}
    >
      📎
    </button>
  {/if}
{/if}
