<script lang="ts">
	import type { BurstReport } from '#lib/game/debrief.ts';
	import type { Fmt } from './fmt.ts';

	interface Props {
		r: BurstReport;
		F: Fmt;
		labels: { gz: string; wind: string; blast: string; desc: string };
	}

	let { r, F, labels }: Props = $props();
	let width = $state(820);

	// Darkest contour is the most intense, so the fill steps with the number.
	const FILL: Record<number, string> = { 1: 'var(--seq1)', 10: 'var(--seq2)', 100: 'var(--seq3)', 1000: 'var(--seq4)' };
	const rows = $derived(r.falloutRows.filter((row) => row.band.runs.length));
	const down = $derived(Math.max(0.1, ...rows.map((row) => row.band.length)));
	const up = $derived(Math.max(r.rings.psi5, ...rows.map((row) => row.band.upwind), down * 0.04));
	const half = $derived(Math.max(r.rings.psi5, ...rows.map((row) => row.band.width / 2), 0.05));
	const ppk = $derived(Math.min((width - 40) / (down + up), 170 / half));
	const height = $derived(Math.max(170, 2 * half * ppk + 62));
	const X = (km: number) => 20 + (km + up) * ppk;
	const midY = $derived(height / 2);
	const shape = (run: [number, number][]) => {
		const top = run.map(([x, h]) => `${X(x).toFixed(1)} ${(midY - h * ppk).toFixed(1)}`);
		const low = [...run].reverse().map(([x, h]) => `${X(x).toFixed(1)} ${(midY + h * ppk).toFixed(1)}`);
		return `M${top.join('L')}L${low.join('L')}Z`;
	};
	const barKm = $derived.by(() => {
		const raw = (width / 5) / ppk;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		return [1, 2, 5, 10].map((m) => m * mag).reverse().find((s) => s <= raw) ?? mag;
	});
	/** Each contour's label hangs from its far tip, on its own row so they can't collide. */
	const tipLabels = $derived.by(() => {
		const out: { x: number; text: string; row: number }[] = [];
		for (const row of [...rows].sort((a, b) => b.band.length - a.band.length)) {
			const x = X(row.band.length);
			out.push({ x, text: F.rate(row.rate), row: out.length });
		}
		return out;
	});
</script>

<figure class="plan" bind:clientWidth={width}>
	<svg {width} {height} role="img" aria-label={labels.desc}>
		{#each [...rows].sort((a, b) => a.rate - b.rate) as row (row.rate)}
			{#each row.band.runs as run, i (i)}
				<path d={shape(run)} style:fill={FILL[row.rate]} />
			{/each}
		{/each}
		{#if r.rings.psi5 > 0}
			<circle cx={X(0)} cy={midY} r={r.rings.psi5 * ppk} class="blast" />
		{/if}
		<circle cx={X(0)} cy={midY} r="3" class="gz" />
		<text x={Math.max(X(0), 4)} y={midY - Math.max(r.rings.psi5 * ppk, 3) - 5} text-anchor={X(0) < 90 ? 'start' : 'middle'}>{labels.gz} · {labels.blast}</text>
		{#each tipLabels as l (l.text)}
			<line x1={l.x} x2={l.x} y1={midY} y2={height - 28 - l.row * 12} class="tip" />
			<text x={Math.min(l.x, width - 4)} y={height - 22 - l.row * 12} text-anchor="end">{l.text}</text>
		{/each}
		<line x1={14} x2={14 + barKm * ppk} y1={height - 8} y2={height - 8} class="bar" />
		<text x={18 + barKm * ppk} y={height - 4}>{F.km(barKm)}</text>
		<text x={width - 6} y={14} text-anchor="end">{labels.wind} →</text>
	</svg>
</figure>

<style>
	.plan {
		margin: 0;
		min-width: 0;
	}
	svg {
		display: block;
		border: 1px solid var(--d-rule);
		background: var(--land);
	}
	.blast {
		fill: none;
		stroke: var(--d-fg);
		stroke-width: 1.5;
		stroke-dasharray: 3 2;
	}
	.gz {
		fill: var(--d-fg);
	}
	.tip {
		stroke: var(--d-dim);
		stroke-width: 1;
	}
	.bar {
		stroke: var(--d-fg);
		stroke-width: 2;
	}
	text {
		font: 11px var(--d-mono);
		fill: var(--d-fg);
		paint-order: stroke;
		stroke: var(--land);
		stroke-width: 3px;
	}
</style>
