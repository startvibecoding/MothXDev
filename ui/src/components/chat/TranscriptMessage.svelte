<script>
  import { markdownToHTML } from '../../lib/markdown.js';
  import { shortID } from '../../lib/format.js';
  import { t } from '../../lib/preferences.js';

  export let msg;
  export let sessionID = '';
  export let isLast = false;
  export let busy = false;
  export let codeBlockControls;
  export let onImageLoad = () => {};
  export let safeURL = () => '';
  export let downloadURL = () => '';
</script>

{#if msg.role === 'user'}
  <article class="msg user">
    <div class="meta">
      <strong>{$t('chat.you')}</strong>
      <span>{shortID(sessionID)}</span>
    </div>
    <p>{msg.content}</p>
    {#if msg.images?.length}
      <div class="msg-images">
        {#each msg.images as image}
          <img src={image.dataUrl} alt={image.name} on:load={onImageLoad} />
        {/each}
      </div>
    {/if}
  </article>
{:else if msg.role === 'assistant'}
  <article class="msg assistant" class:error={msg.isError}>
    <div class="meta">
      <strong>MothX</strong>
      <span>{msg.isError ? $t('common.failed') : busy && isLast ? $t('chat.generating') : $t('common.completed')}</span>
    </div>
    {#if msg.content}
      <div class="markdown" use:codeBlockControls>{@html markdownToHTML(msg.content)}</div>
    {:else if busy && isLast}
      <p class="pending-text">{$t('chat.waitingModel')}</p>
    {/if}
    {#if msg.attachments?.length}
      <div class="response-attachments" aria-label={$t('chat.attachments')}>
        {#each msg.attachments as attachment}
          {@const publicURL = safeURL(attachment.url)}
          {@const fileURL = downloadURL(attachment)}
          {#if publicURL}
            <a href={publicURL} target="_blank" rel="noreferrer" class="response-attachment">
              {#if attachment.kind === 'image'}
                <img class="response-attachment-preview" src={publicURL} alt={attachment.name || attachment.kind} loading="lazy" />
              {/if}
              <span>{attachment.name || attachment.kind}</span>
              <span class="response-attachment-kind">{attachment.kind}</span>
            </a>
          {:else if fileURL}
            <a href={fileURL} download class="response-attachment">
              {#if attachment.mediaType?.startsWith('image/')}
                <img class="response-attachment-preview" src={fileURL} alt={attachment.name || attachment.kind} loading="lazy" />
              {/if}
              <span>{attachment.name || attachment.kind}</span>
              <span class="response-attachment-kind">{attachment.providerRef}</span>
            </a>
          {:else}
            <span class="response-attachment">
              <span>{attachment.name || attachment.kind}</span>
              <span class="response-attachment-kind">{attachment.providerRef}</span>
            </span>
          {/if}
        {/each}
      </div>
    {/if}
  </article>
{/if}
