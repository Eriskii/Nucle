<script lang="ts">
	import type { DistanceBin } from '#lib/game/debrief.ts';
	import type { Fmt } from './fmt.ts';

	interface Props {
		bins: DistanceBin[];
		F: Fmt;
		labels: { pop: string; deaths: string; x: string; y: string };
		desc: string;
	}

	let { bins, F, labels, desc }: Props = $props();
	let width = $state(640);
	let hover = $state<number | null>(null);
	const height = 240;
	const M = { l: 58, r: 14, t: 28, b: 44 };
	const innerW = $derived(Math.max(60, width - M.l - M.r));
	const innerH = height - M.t - M.b;
	const peak = $derived(Math.max(1, ...bins.map((b) => b.pop)));
	const barW = $derived(innerW / bins.length);
	const Y = (v: number) => M.t + innerH - (v / peak) * innerH;
	const xTicks = $derived(bins.filter((_, i) => i % 6 === 0));
	const hovered = $derived(hover === null ? null : bins[hover]);
</script>

<figure class="dist" bind:clientWidth={width}>
	<svg {width} {height} role="img" aria-label={desc}>
		{#each [0.5, 1] as f (f)}
			<line class="grid" x1={M.l} x2={M.l + innerW} y1={Y(peak * f)} y2={Y(peak * f)} />
			<text class="tick" x={M.l - 6} y={Y(peak * f) + 4} text-anchor="end">{F.count(peak * f)}</text>
		{/each}
		{#each bins as b, i (b.fromKm)}
			{@const x = M.l + i * barW + 1}
			{@const w = Math.max(1, barW - 2)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g onpointerenter={() => (hover = i)} onpointerleave={() => (hover = null)}>
				<rect x={x - 1} y={M.t} width={barW} height={innerH} fill="transparent" />
				{#if b.pop > 0}
					<rect {x} y={Y(b.pop)} width={w} height={M.t + innerH - Y(b.pop)} rx="1" class="pop" />
				{/if}
				{#if b.deaths > 0}
					<rect {x} y={Y(b.deaths)} width={w} height={M.t + innerH - Y(b.deaths)} rx="1" class="dead" />
				{/if}
			</g>
		{/each}
		<line class="axis" x1={M.l} x2={M.l + innerW} y1={M.t + innerH} y2={M.t + innerH} />
		{#each xTicks as b (b.fromKm)}
			<text class="tick" x={M.l + (b.fromKm / bins[bins.length - 1].toKm) * innerW} y={M.t + innerH + 15} text-anchor="middle">{F.km(b.fromKm)}</text>
		{/each}
		<text class="label" x={M.l + innerW / 2} y={height - 6} text-anchor="middle">{labels.x}</text>
		<text class="label" x={8} y={14}>{labels.y}</text>
	</svg>
	{#if hovered && hover !== null}
		<div class="tip" style:left={`${Math.min(M.l + hover * barW + 8, width - 190)}px`}>
			<b>{F.km(hovered.fromKm)} – {F.km(hovered.toKm)}</b>
			<span>{labels.pop}: {F.count(hovered.pop)}</span>
			<span>{labels.deaths}: {F.count(hovered.deaths)}</span>
		</div>
	{/if}
	<ul class="legend">
		<li><i class="pop-key"></i>{labels.pop}</li>
		<li><i class="dead-key"></i>{labels.deaths}</li>
	</ul>
</figure>

<style>
	.dist {
		position: relative;
		margin: 0;
		min-width: 0;
	}
	svg {
		display: block;
	}
	.grid {
		stroke: var(--d-rule);
	}
	.axis {
		stroke: var(--d-dim);
	}
	.tick {
		font-size: 11px;
		fill: var(--d-dim);
		font-family: var(--d-mono);
	}
	.label {
		font-size: 12px;
		fill: var(--d-fg);
		font-family: var(--d-mono);
	}
	.pop {
		fill: var(--d-fg);
		opacity: 0.28;
	}
	.dead {
		fill: var(--d-accent);
	}
	.tip {
		position: absolute;
		top: 30px;
		display: flex;
		flex-direction: column;
		width: 180px;
		padding: 6px 8px;
		pointer-events: none;
		font: 11px/1.35 var(--d-mono);
		color: var(--d-fg);
		background: var(--d-surface);
		border: 1px solid var(--d-dim);
	}
	.legend {
		display: flex;
		gap: 18px;
		margin: 2px 0 0;
		padding: 0;
		list-style: none;
		font: 12px var(--d-mono);
	}
	.legend i {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 6px;
	}
	.pop-key {
		background: var(--d-fg);
		opacity: 0.35;
	}
	.dead-key {
		background: var(--d-accent);
	}
</style>
