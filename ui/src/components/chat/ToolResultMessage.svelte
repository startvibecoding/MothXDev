<script>
  import { markdownToHTML } from '../../lib/markdown.js';
  import { t } from '../../lib/preferences.js';

  export let msg;
  export let onToggle = () => {};
  export let codeBlockControls;
  export let onImageLoad = () => {};
</script>

<article class="msg tool-result">
  <details on:toggle={(event) => onToggle(msg, event)}>
    <summary>
      <span class="dot {msg.isError ? 'error' : 'done'}"></span>
      <strong>{msg.toolName}</strong>
      <span>{msg.isError ? $t('common.failed') : $t('common.completed')}</span>
      <em>{msg.summary}</em>
    </summary>
    {#if msg.detailLoading}
      <p class="pending-text">{$t('chat.loadingToolResult')}</p>
    {:else if msg.detailError}
      <p class="error-text">{msg.detailError}</p>
    {:else if msg.detailLoaded}
      {#if msg.detail?.kind === 'browser' && msg.detail.browserResult}
        <div class="browser-result">
          <div class="browser-result-head">
            <strong>{msg.detail.browserResult.status}</strong>
            {#if msg.detail.browserResult.title}<span>{msg.detail.browserResult.title}</span>{/if}
          </div>
          {#if msg.detail.browserResult.url}<code>{msg.detail.browserResult.url}</code>{/if}
          {#if !msg.detail.browserResult.title && !msg.detail.browserResult.url && msg.detail.browserResult.content}<pre>{msg.detail.browserResult.content}</pre>{/if}
        </div>
      {:else if msg.detail?.kind === 'subagent' && msg.detail.subAgentResult}
        <div class="subagent-result">
          {#if msg.detail.subAgentResult.handle}<div><span>{$t('chat.tool.subagent.handle')}</span><code>{msg.detail.subAgentResult.handle}</code></div>{/if}
          {#if msg.detail.subAgentResult.status}<div><span>{$t('chat.tool.subagent.statusLabel')}</span><strong>{msg.detail.subAgentResult.status}</strong></div>{/if}
          {#if msg.detail.subAgentResult.duration}<div><span>{$t('chat.tool.subagent.duration')}</span><code>{msg.detail.subAgentResult.duration}</code></div>{/if}
          {#if msg.detail.subAgentResult.tool_calls !== undefined}<div><span>{$t('chat.tool.subagent.toolCalls')}</span><code>{msg.detail.subAgentResult.tool_calls}</code></div>{/if}
          {#if msg.detail.subAgentResult.error}<p class="error-text">{msg.detail.subAgentResult.error}</p>{/if}
          {#if msg.detail.subAgentResult.result || msg.detail.subAgentResult.last_response || msg.detail.subAgentResult.partial_result}<pre>{msg.detail.subAgentResult.result || msg.detail.subAgentResult.last_response || msg.detail.subAgentResult.partial_result}</pre>{/if}
        </div>
      {:else if msg.detail?.kind === 'skill-ref' && msg.detail.content}
        <div class="skill-ref-result"><div class="markdown" use:codeBlockControls>{@html markdownToHTML(msg.detail.content)}</div></div>
      {:else if msg.detail?.kind === 'workflow-lint' && msg.detail.workflowLintResult}
        <div class="workflow-lint-result">
          <div class="workflow-lint-head">
            <strong class:failed={!msg.detail.workflowLintResult.valid}>{msg.detail.workflowLintResult.valid ? $t('chat.tool.workflowLint.valid') : $t('chat.tool.workflowLint.invalid')}</strong>
            {#if msg.detail.workflowLintResult.status}<span>{msg.detail.workflowLintResult.status}</span>{/if}
          </div>
          {#if msg.detail.workflowLintResult.error}<p class="error-text">{msg.detail.workflowLintResult.error}</p>{/if}
          {#if msg.detail.workflowLintResult.tasks.length}<section><strong>{$t('chat.tool.workflowLint.tasks')}</strong><div class="workflow-chip-row">{#each msg.detail.workflowLintResult.tasks as task}<code>{task}</code>{/each}</div></section>{/if}
          {#if msg.detail.workflowLintResult.results.length}<section><strong>{$t('chat.tool.workflowLint.results')}</strong><div class="workflow-chip-row">{#each msg.detail.workflowLintResult.results as result}<code>{result}</code>{/each}</div></section>{/if}
        </div>
      {:else if msg.detail?.kind === 'bash' && msg.detail.bashResult}
        <div class="bash-result">
          <div class="bash-meta">
            {#if msg.detail.bashResult.runtime}<span>{msg.detail.bashResult.runtime}</span>{/if}
            {#if msg.detail.bashResult.cwd}<span>{msg.detail.bashResult.cwd}</span>{/if}
            {#if msg.detail.bashResult.exitCode}<strong class:failed={msg.detail.bashResult.exitCode !== '0'}>exit {msg.detail.bashResult.exitCode}</strong>{/if}
          </div>
          {#if msg.detail.bashResult.prefix}<p class="bash-note">{msg.detail.bashResult.prefix}</p>{/if}
          {#if msg.detail.bashResult.command}<div class="bash-block"><span>command</span><pre>{msg.detail.bashResult.command}</pre></div>{/if}
          {#if msg.detail.bashResult.stdout}<div class="bash-block"><span>stdout</span><pre class:empty={msg.detail.bashResult.stdout === '(no output)'}>{msg.detail.bashResult.stdout}</pre></div>{/if}
          {#if msg.detail.bashResult.stderr}<div class="bash-block"><span>stderr</span><pre class:empty={msg.detail.bashResult.stderr === '(no output)'}>{msg.detail.bashResult.stderr}</pre></div>{/if}
          {#if msg.detail.bashResult.note}<p class="bash-note">{msg.detail.bashResult.note}</p>{/if}
        </div>
      {:else if msg.detail?.kind === 'read' && msg.detail.readLines?.length}
        <div class="read-result">{#each msg.detail.readLines as line}<div class="code-line"><span>{line.number}</span><code>{line.text}</code></div>{/each}</div>
      {:else if msg.detail?.kind === 'ls' && msg.detail.lsEntries?.length}
        <div class="ls-result">{#each msg.detail.lsEntries as entry}<div class="ls-entry {entry.type}"><span>{entry.type === 'dir' ? 'dir' : 'file'}</span><strong>{entry.name}</strong>{#if entry.size}<em>{entry.size}</em>{/if}</div>{/each}</div>
      {:else if msg.detail?.kind === 'grep' && msg.detail.grepMatches?.matches?.length}
        <div class="grep-result">
          {#each msg.detail.grepMatches.matches as match}<div class="grep-match"><div><strong>{match.path}</strong><span>:{match.line}</span></div><code>{match.text}</code></div>{/each}
          {#if msg.detail.grepMatches.note}<p>{msg.detail.grepMatches.note}</p>{/if}
        </div>
      {:else if msg.detail?.content}
        <pre>{msg.detail.content}</pre>
      {/if}
      {#if msg.detail?.images?.length}
        <div class="msg-images">{#each msg.detail.images as image}<img src={image.dataUrl} alt={image.name} on:load={onImageLoad} />{/each}</div>
      {/if}
    {/if}
  </details>
</article>
