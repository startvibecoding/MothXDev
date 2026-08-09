<script>
  import { highlightedCodeToHTML } from '../../lib/markdown.js';
  import { shortID, formatArgs } from '../../lib/format.js';
  import { t } from '../../lib/preferences.js';

  export let msg;
</script>

<article class="msg tool-call">
  <div class="meta">
    <strong>{$t('chat.toolCall')}</strong>
    <span>{msg.toolName}</span>
  </div>
  <div class="tool-call-body">
    <div class="tool-title">
      <span class="dot running"></span>
      <strong>{msg.callView?.label || msg.toolName}</strong>
      {#if msg.callView?.target}
        <span class="tool-target">{msg.callView.target}</span>
      {/if}
      {#if msg.toolCallId}<em>{shortID(msg.toolCallId)}</em>{/if}
    </div>
    {#if msg.callView?.details?.length}
      <div class="tool-call-tags">
        {#each msg.callView.details as item}
          <span>{item}</span>
        {/each}
      </div>
    {/if}
    {#if msg.callView?.kind === 'edit' && msg.callView.edits?.length}
      <div class="edit-call">
        {#each msg.callView.edits as edit}
          <section class="edit-block">
            <div class="edit-block-head">
              <strong>{$t('chat.tool.edit.editNumber', { number: edit.index })}</strong>
              <span>{$t('chat.tool.edit.lineChange', { old: edit.oldLines, next: edit.newLines })}</span>
            </div>
            <div class="edit-columns">
              <div class="edit-pane old">
                <span>{$t('chat.tool.edit.oldText')}</span>
                <pre class:empty={edit.oldText === ''}><code>{@html edit.oldText ? highlightedCodeToHTML(edit.oldText, msg.callView.target) : $t('chat.tool.edit.empty')}</code></pre>
              </div>
              <div class="edit-pane new">
                <span>{$t('chat.tool.edit.newText')}</span>
                <pre class:empty={edit.newText === ''}><code>{@html edit.newText ? highlightedCodeToHTML(edit.newText, msg.callView.target) : $t('chat.tool.edit.empty')}</code></pre>
              </div>
            </div>
          </section>
        {/each}
      </div>
    {:else if msg.callView?.kind === 'write'}
      <div class="write-call">
        <div class="write-call-head">
          <strong>{$t('chat.tool.write.preview')}</strong>
          <span>{$t('chat.tool.write.summary', { lines: msg.callView.lines, chars: msg.callView.chars })}</span>
        </div>
        <span>{$t('chat.tool.write.content')}</span>
        <pre class:empty={msg.callView.content === ''}>{msg.callView.content || $t('chat.tool.edit.empty')}</pre>
      </div>
    {:else if msg.callView?.kind === 'insert'}
      <div class="write-call">
        <div class="write-call-head">
          <strong>{$t('chat.tool.insert.preview')}</strong>
          <span>{$t('chat.tool.insert.summary', { lines: msg.callView.lines, chars: msg.callView.chars })}</span>
        </div>
        <span>{$t('chat.tool.insert.content')}</span>
        <pre class:empty={msg.callView.content === ''}>{msg.callView.content || $t('chat.tool.edit.empty')}</pre>
      </div>
    {:else if msg.callView?.kind === 'find'}
      <div class="find-call">
        <div class="find-row">
          <span>{$t('chat.tool.find.pattern')}</span>
          <code>{msg.callView.pattern || $t('chat.tool.find.missing')}</code>
        </div>
        <div class="find-row">
          <span>{$t('chat.tool.find.searchPath')}</span>
          <code>{msg.callView.path}</code>
        </div>
        {#if msg.callView.maxDepth !== ''}
          <div class="find-row">
            <span>{$t('chat.tool.find.depth')}</span>
            <code>{msg.callView.maxDepth}</code>
          </div>
        {/if}
        {#if msg.callView.maxResults !== ''}
          <div class="find-row">
            <span>{$t('chat.tool.find.resultLimit')}</span>
          <code>{msg.callView.maxResults}</code>
        </div>
      {/if}
      </div>
    {:else if msg.callView?.kind === 'browser'}
      <div class="browser-call">
        <div class="find-row">
          <span>{$t('chat.tool.browser.action')}</span>
          <code>{msg.callView.action || $t('chat.tool.browser.missing')}</code>
        </div>
        {#if msg.callView.url}
          <div class="find-row">
            <span>{$t('chat.tool.browser.url')}</span>
            <code>{msg.callView.url}</code>
          </div>
        {/if}
        {#if msg.callView.selector}
          <div class="find-row">
            <span>{$t('chat.tool.browser.selectorLabel')}</span>
            <code>{msg.callView.selector}</code>
          </div>
        {/if}
        {#if msg.callView.value}
          <div class="find-row">
            <span>{$t('chat.tool.browser.value')}</span>
            <code>{msg.callView.value}</code>
          </div>
        {/if}
        {#if msg.callView.expression}
          <div class="find-row">
            <span>{$t('chat.tool.browser.expression')}</span>
            <code>{msg.callView.expression}</code>
          </div>
        {/if}
      </div>
    {:else if msg.callView?.kind === 'skill-ref'}
      <div class="skill-ref-call">
        <div class="find-row">
          <span>{$t('chat.tool.skillRef.skillLabel')}</span>
          <code>{msg.callView.skill || $t('chat.tool.skillRef.missing')}</code>
        </div>
        <div class="find-row">
          <span>{$t('chat.tool.skillRef.refLabel')}</span>
          <code>{msg.callView.ref || $t('chat.tool.skillRef.missing')}</code>
        </div>
      </div>
    {:else if msg.callView?.kind === 'workflow-lint'}
      <div class="workflow-lint-call">
        <div class="write-call-head">
          <strong>{$t('chat.tool.workflowLint.source')}</strong>
          <span>{$t('chat.tool.write.summary', { lines: msg.callView.lines, chars: msg.callView.chars })}</span>
        </div>
        <pre class:empty={msg.callView.source === ''}>{msg.callView.source || $t('chat.tool.workflowLint.missing')}</pre>
      </div>
    {:else if msg.callView?.kind === 'subagent-task'}
      <div class="subagent-call">
        <span>{$t('chat.tool.subagent.task')}</span>
        <p>{msg.callView.task || msg.callView.target}</p>
      </div>
    {:else if msg.callView?.kind === 'subagent-handle'}
      <div class="subagent-call compact">
        <div class="find-row">
          <span>{$t('chat.tool.subagent.handle')}</span>
          <code>{msg.callView.handle || $t('chat.tool.subagent.handleMissing')}</code>
        </div>
        {#if msg.callView.message}
          <div class="find-row">
            <span>{$t('chat.tool.subagent.message')}</span>
            <code>{msg.callView.message}</code>
          </div>
        {/if}
      </div>
    {/if}
    {#if msg.callView?.kind !== 'generic' && msg.arguments}
      <details class="tool-raw">
        <summary>{$t('chat.argsJson')}</summary>
        <pre>{formatArgs(msg.arguments)}</pre>
      </details>
    {:else if msg.arguments}
      <pre>{formatArgs(msg.arguments)}</pre>
    {:else if msg.invalidArguments}
      <pre>{msg.invalidArguments}</pre>
    {/if}
  </div>
</article>
