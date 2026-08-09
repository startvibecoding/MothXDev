<script>
  import { onMount } from 'svelte';

  export let availableSkills = [];
  export let activeSkills = [];
  export let open = false;
  export let apiEnabled = true;
  export let busy = false;
  export let onToggle = () => {};
  export let onToggleSkill = () => {};
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

<div bind:this={picker} class="skill-picker" aria-label="Active skills">
  <button type="button" class="skill-picker-toggle" disabled={!apiEnabled || busy} on:click={onToggle} aria-expanded={open}>
    <span>Skills</span>
    <strong>{activeSkills.length ? `${activeSkills.length} active` : 'none active'}</strong>
    <span class="runtime-chevron">⌄</span>
  </button>
  {#if open}
    <div class="skill-picker-menu">
      <header><strong>Project skills</strong><span>{activeSkills.length} active · {availableSkills.length - activeSkills.length} pending</span></header>
      {#if availableSkills.length === 0}
        <p class="skill-picker-empty">No skills found in this project.</p>
      {:else}
        {#each availableSkills as skill}
          <label class:active={activeSkills.includes(skill.name)}>
            <input type="checkbox" checked={activeSkills.includes(skill.name)} disabled={busy} on:change={(event) => onToggleSkill(skill.name, event)} />
            <span class="skill-name">{skill.name}</span>
            <em>{activeSkills.includes(skill.name) ? 'active' : 'pending'}</em>
          </label>
        {/each}
      {/if}
    </div>
  {/if}
</div>
