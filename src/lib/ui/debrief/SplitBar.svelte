<script lang="ts">
	export interface Segment {
		label: string;
		value: number;
		color: string;
		/** Shown beside the label instead of the percentage. */
		text?: string;
	}

	interface Props {
		segments: Segment[];
		fmtShare: (share: number) => string;
		desc: string;
	}

	let { segments, fmtShare, desc }: Props = $props();
	const total = $derived(segments.reduce((sum, s) => sum + s.value, 0));
	const visible = $derived(segments.filter((s) => s.value > 0));
</script>

<figure class="split">
	<div class="bar" role="img" aria-label={desc}>
		{#each visible as s (s.label)}
			<span style:flex-grow={s.value} style:background={s.color} title={`${s.label}: ${fmtShare(s.value / total)}`}></span>
		{/each}
	</div>
	<ul class="legend">
		{#each segments as s (s.label)}
			<li class:none={s.value <= 0}>
				<i style:background={s.color}></i>
				<span>{s.label}</span>
				<b>{s.text ?? fmtShare(total > 0 ? s.value / total : 0)}</b>
			</li>
		{/each}
	</ul>
</figure>

<style>
	.split {
		margin: 0;
	}
	.bar {
		display: flex;
		gap: 2px;
		height: 26px;
	}
	.bar span {
		min-width: 3px;
		flex-basis: 0;
		transition: flex-grow 200ms;
	}
	.bar span:first-child {
		border-radius: 4px 0 0 4px;
	}
	.bar span:last-child {
		border-radius: 0 4px 4px 0;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		margin: 8px 0 0;
		padding: 0;
		list-style: none;
		font: 13px var(--d-mono);
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.legend .none {
		opacity: 0.5;
	}
	.legend i {
		flex: none;
		width: 10px;
		height: 10px;
	}
</style>
