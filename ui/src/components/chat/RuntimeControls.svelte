<script>
  import { onMount } from 'svelte';

  export let mode = 'yolo';
  export let pendingApprovalCount = 0;
  export let activeRun = null;
  export let open = false;
  export let updating = false;
  export let busy = false;
  export let onToggle = () => {};
  export let onSetMode = () => {};
  export let onReviewApprovals = () => {};
  export let onClose = () => {};

  let controls;

  onMount(() => {
    const handleOutsidePointer = (event) => {
      if (open && controls && !controls.contains(event.target)) onClose();
    };
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  });
</script>

<div bind:this={controls} class="runtime-controls" aria-label="Session runtime controls">
  <button
    type="button"
    class:open
    class="runtime-toggle"
    aria-expanded={open}
    aria-controls="session-runtime-panel"
    on:click={onToggle}
  >
    <span class="runtime-label">Mode</span>
    <strong>{mode}</strong>
    <span class="runtime-chevron" aria-hidden="true">⌄</span>
    {#if pendingApprovalCount}<span class="runtime-badge">{pendingApprovalCount}</span>{/if}
  </button>
  {#if open}
    <section id="session-runtime-panel" class="runtime-panel">
      <header>
        <strong>Session runtime</strong>
        {#if activeRun}<span class="dot running"></span><span>{activeRun.status}</span>{/if}
      </header>
      <p class="runtime-hint">plan is read-only planning, agent requests approval for guarded actions, and yolo runs automatically.</p>
      <div class="mode-switcher" role="group" aria-label="Agent mode">
        {#each ['plan', 'agent', 'yolo'] as runtimeMode}
          <button type="button" class:active={mode === runtimeMode} disabled={updating || busy} on:click={() => onSetMode(runtimeMode)}>{runtimeMode}</button>
        {/each}
      </div>
      {#if pendingApprovalCount}
        <div class="approval-summary"><strong>{pendingApprovalCount} pending approval{pendingApprovalCount === 1 ? '' : 's'}</strong><button type="button" class="ghost sm" on:click={onReviewApprovals}>Review approvals</button></div>
      {/if}
    </section>
  {/if}
</div>
