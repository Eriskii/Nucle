<script lang="ts">
	export interface StripRow {
		label: string;
		value: number;
		/** Published range, drawn as a line through the point. */
		low?: number;
		high?: number;
		text: string;
		you?: boolean;
	}

	interface Props {
		rows: StripRow[];
		fmtTick: (v: number) => string;
		desc: string;
	}

	let { rows, fmtTick, desc }: Props = $props();
	let width = $state(640);
	const ROW = 34;
	const compact = $derived(width < 560);
	const labelW = $derived(compact ? 0 : Math.min(320, width * 0.36));
	const valueW = $derived(compact ? 0 : 118);

	const sorted = $derived([...rows].sort((a, b) => a.value - b.value));
	const lo = $derived(Math.floor(Math.log10(Math.max(1e-3, Math.min(...rows.map((r) => r.low ?? r.value).filter((v) => v > 0))))));
	const hi = $derived(Math.ceil(Math.log10(Math.max(...rows.map((r) => r.high ?? r.value)))));
	const X = (v: number) => labelW + 8 + ((Math.log10(Math.max(v, 1e-9)) - lo) / Math.max(1, hi - lo)) * (width - labelW - valueW - 24);
	const decades = $derived.by(() => {
		const stride = Math.max(1, Math.ceil((hi - lo) / Math.max(2, (width - labelW - valueW) / 70)));
		const out: number[] = [];
		for (let e = lo; e <= hi; e += stride) out.push(Math.pow(10, e));
		return out;
	});
	const rowH = $derived(compact ? 50 : ROW);
	const height = $derived(sorted.length * rowH + 26);
</script>

<figure class="strip" bind:clientWidth={width}>
	<svg {width} {height} role="img" aria-label={desc}>
		{#each decades as d (d)}
			<line class="grid" x1={X(d)} x2={X(d)} y1={0} y2={height - 22} />
			<text class="tick" x={X(d)} y={height - 7} text-anchor="middle">{fmtTick(d)}</text>
		{/each}
		{#each sorted as r, i (r.label)}
			{@const y = i * rowH + (compact ? 36 : rowH / 2)}
			{#if compact}
				<text class="name" class:you={r.you} x={0} y={y - 16}>{r.label} · {r.text}</text>
			{:else}
				<text class="name" class:you={r.you} x={labelW} y={y + 4} text-anchor="end">{r.label}</text>
				<text class="val" class:you={r.you} x={width} y={y + 4} text-anchor="end">{r.text}</text>
			{/if}
			{#if r.low !== undefined && r.high !== undefined}
				<line class="range" class:you={r.you} x1={X(r.low)} x2={X(r.high)} y1={y} y2={y} />
			{/if}
			<circle cx={X(r.value)} cy={y} r={r.you ? 8 : 6} class="pt" class:you={r.you} />
		{/each}
	</svg>
</figure>

<style>
	.strip {
		margin: 0;
		min-width: 0;
	}
	svg {
		display: block;
	}
	.grid {
		stroke: var(--d-rule);
	}
	.tick {
		font-size: 11px;
		fill: var(--d-dim);
		font-family: var(--d-mono);
	}
	.name,
	.val {
		font-size: 12.5px;
		fill: var(--d-fg);
		font-family: var(--d-mono);
	}
	.you {
		font-weight: 700;
	}
	.range {
		stroke: var(--d-dim);
		stroke-width: 2;
		stroke-linecap: round;
	}
	.range.you {
		stroke: var(--d-accent);
	}
	.pt {
		fill: var(--d-dim);
		stroke: var(--d-surface);
		stroke-width: 2;
	}
	.pt.you {
		fill: var(--d-accent);
	}
</style>
