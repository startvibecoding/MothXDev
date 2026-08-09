<script>
  import { t } from '../../lib/preferences.js';
  import { compactWorkDir } from '../../lib/chat-helpers.js';
  import ComposerAttachments from './ComposerAttachments.svelte';
  import ModelPicker from './ModelPicker.svelte';
  import SessionSummary from './SessionSummary.svelte';
  import RuntimeControls from './RuntimeControls.svelte';
  import SkillPicker from './SkillPicker.svelte';
  import ToolMenu from './ToolMenu.svelte';

  export let prompt = '';
  export let imageUploads = [];
  export let busy = false;
  export let apiEnabled = true;
  export let isNewSession = false;
  export let workDir = '';
  export let currentSession = '';
  export let activeSessionWorkDir = '';
  export let selectedModelSupportsImages = false;
  export let modelOptions = [];
  export let selectedModel = '';
  export let currentModelLabel = '';
  export let showModelPicker = false;
  export let runtimeMode = 'yolo';
  export let pendingApprovalCount = 0;
  export let runtimeActiveRun = null;
  export let showRuntimePanel = false;
  export let runtimeUpdating = false;
  export let availableSkills = [];
  export let activeSkills = [];
  export let showSkillPicker = false;
  export let availableToolToggles = [];
  export let sessionTools = {};
  export let activeToolCount = 0;
  export let showToolMenu = false;
  export let onPromptChange = () => {};
  export let onKeydown = () => {};
  export let onSend = () => {};
  export let onStop = () => {};
  export let stopSubmitting = false;
  export let onImageSelect = () => {};
  export let onRemoveImage = () => {};
  export let onToggleModel = () => {};
  export let onSelectModel = () => {};
  export let onSetMode = () => {};
  export let onToggleRuntime = () => {};
  export let onReviewApprovals = () => {};
  export let onToggleSkills = () => {};
  export let onToggleSkill = () => {};
  export let onToggleTools = () => {};
  export let onUpdateTool = () => {};
  export let onOpenMCP = () => {};
  export let onChooseWorkDir = () => {};
  export let onResetSession = () => {};
  export let onCloseRuntime = () => {};
  export let onCloseModelPicker = () => {};
  export let onCloseSkillPicker = () => {};
  export let onCloseToolMenu = () => {};

  let attachments;

  export function clearImageInput() {
    attachments?.clearInput();
  }
</script>

<div class="composer">
  <div class="composer-card">
    <div class="composer-row">
      <ComposerAttachments
        images={imageUploads}
        showControl={false}
        onRemove={onRemoveImage}
      />
      <textarea
        value={prompt}
        on:input={(event) => onPromptChange(event.currentTarget.value)}
        on:keydown={onKeydown}
        placeholder={!apiEnabled ? $t('chat.apiDisabled') : busy ? $t('chat.runningPlaceholder') : (isNewSession && !workDir.trim()) ? $t('chat.error.needWorkDir') : $t('chat.messagePlaceholder')}
        disabled={!apiEnabled}
        rows="1"
      ></textarea>
    </div>
    <div class="composer-bar">
      <div class="left">
        <ComposerAttachments
          bind:this={attachments}
          images={[]}
          enabled={selectedModelSupportsImages}
          showPreviews={false}
          {apiEnabled}
          {busy}
          onSelect={onImageSelect}
          onRemove={onRemoveImage}
        />
        <ModelPicker
          options={modelOptions}
          selected={selectedModel}
          label={currentModelLabel}
          open={showModelPicker}
          {apiEnabled}
          onToggle={onToggleModel}
          onSelect={onSelectModel}
          onClose={onCloseModelPicker}
        />
        <RuntimeControls
          mode={runtimeMode}
          {pendingApprovalCount}
          activeRun={runtimeActiveRun}
          open={showRuntimePanel}
          updating={runtimeUpdating}
          {busy}
          onToggle={onToggleRuntime}
          onSetMode={onSetMode}
          {onReviewApprovals}
          onClose={onCloseRuntime}
        />
        <SkillPicker
          {availableSkills}
          {activeSkills}
          open={showSkillPicker}
          {apiEnabled}
          {busy}
          onToggle={onToggleSkills}
          onToggleSkill={onToggleSkill}
          onClose={onCloseSkillPicker}
        />
        <ToolMenu
          {availableToolToggles}
          {sessionTools}
          {activeToolCount}
          open={showToolMenu}
          {apiEnabled}
          {busy}
          onToggle={onToggleTools}
          onUpdateTool={onUpdateTool}
          onClose={onCloseToolMenu}
        />
        {#if currentSession}
          <button type="button" class="tool-menu-toggle mcp-config-toggle" disabled={!apiEnabled || busy} on:click={onOpenMCP}><span class="tool-menu-label">MCP</span></button>
        {/if}
        {#if isNewSession}
          <button type="button" class="workdir-pill" class:has-dir={Boolean(workDir.trim())} disabled={!apiEnabled || busy} on:click={onChooseWorkDir} title={workDir || $t('chat.selectWorkDir')}>
            <span class="workdir-icon">📁</span><span class="workdir-text">{workDir ? compactWorkDir(workDir) : $t('chat.selectWorkDir')}</span>
          </button>
        {/if}
      </div>
      <div class="right">
        {#if busy}
          <button type="button" class="stop-btn" disabled={stopSubmitting} on:click={onStop} title={stopSubmitting ? 'Stopping…' : $t('common.stop')} aria-label={stopSubmitting ? 'Stopping…' : $t('common.stop')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        {/if}
        <button type="button" class="send-btn primary" disabled={busy || (!prompt.trim() && imageUploads.length === 0) || !apiEnabled || (isNewSession && !workDir.trim())} on:click={onSend} title={busy ? $t('chat.sending') : $t('chat.send')} aria-label={busy ? $t('chat.sending') : $t('chat.send')}>
          {#if busy}<span class="spinner sm"></span>{:else}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>{/if}
        </button>
      </div>
    </div>
  </div>
  <SessionSummary sessionID={currentSession} workDir={activeSessionWorkDir} onReset={onResetSession} />
</div>
