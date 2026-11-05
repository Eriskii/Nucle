<script lang="ts" module>
	export interface Series {
		id: string;
		label: string;
		color: string;
		points: [number, number][];
		dash?: string;
	}
	export interface Marker {
		x: number;
		label: string;
		color?: string;
	}
	export interface Dot {
		x: number;
		y: number;
		label?: string;
		color?: string;
	}
</script>

<script lang="ts">
	interface Props {
		series: Series[];
		xLabel: string;
		yLabel: string;
		xLog?: boolean;
		yLog?: boolean;
		xFmt?: (v: number) => string;
		yFmt?: (v: number) => string;
		xDomain?: [number, number];
		yDomain?: [number, number];
		markers?: Marker[];
		dots?: Dot[];
		height?: number;
		/** Fill under the line, for a single quantity that accumulates. */
		area?: boolean;
		desc: string;
	}

	let {
		series,
		xLabel,
		yLabel,
		xLog = false,
		yLog = false,
		xFmt = (v) => `${+v.toPrecision(3)}`,
		yFmt = (v) => `${+v.toPrecision(3)}`,
		xDomain,
		yDomain,
		markers = [],
		dots = [],
		height = 280,
		area = false,
		desc
	}: Props = $props();

	let width = $state(640);
	let hoverX = $state<number | null>(null);

	const M = { l: 58, r: 18, t: 26, b: 46 };
	const innerW = $derived(Math.max(60, width - M.l - M.r));
	const innerH = $derived(height - M.t - M.b);

	function extent(values: number[], log: boolean, pad: boolean): [number, number] {
		const v = values.filter((x) => Number.isFinite(x) && (!log || x > 0));
		if (!v.length) return log ? [1, 10] : [0, 1];
		let lo = Math.min(...v);
		let hi = Math.max(...v);
		if (lo === hi) {
			lo = log ? lo / 2 : lo - 1;
			hi = log ? hi * 2 : hi + 1;
		}
		if (!log && pad && lo >= 0) lo = 0;
		return [lo, hi];
	}

	const xs = $derived(extent([...series.flatMap((s) => s.points.map((p) => p[0])), ...markers.map((m) => m.x), ...dots.map((d) => d.x)], xLog, false));
	const ys = $derived(extent([...series.flatMap((s) => s.points.map((p) => p[1])), ...dots.map((d) => d.y)], yLog, true));
	const xd = $derived(xDomain ?? xs);
	const yd = $derived(yDomain ?? ys);

	const scale = (v: number, [a, b]: [number, number], log: boolean, size: number) => {
		const t = log ? (Math.log(Math.max(v, 1e-30)) - Math.log(a)) / (Math.log(b) - Math.log(a)) : (v - a) / (b - a);
		return t * size;
	};
	const X = (v: number) => M.l + scale(v, xd, xLog, innerW);
	const Y = (v: number) => M.t + innerH - scale(v, yd, yLog, innerH);
	const invX = (px: number) => {
		const t = (px - M.l) / innerW;
		return xLog ? xd[0] * Math.pow(xd[1] / xd[0], t) : xd[0] + t * (xd[1] - xd[0]);
	};

	function ticks([a, b]: [number, number], log: boolean, room: number): number[] {
		const most = Math.max(2, Math.floor(room));
		if (log) {
			const out: number[] = [];
			const lo = Math.floor(Math.log10(a));
			const hi = Math.ceil(Math.log10(b));
			const decades = hi - lo;
			const mult = decades <= most / 3 ? [1, 2, 5] : [1];
			const stride = Math.max(1, Math.ceil(decades / most));
			for (let e = lo; e <= hi; e += stride) for (const m of mult) out.push(m * Math.pow(10, e));
			return out.filter((v) => v >= a * 0.999 && v <= b * 1.001);
		}
		const raw = (b - a) / most;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
		const out: number[] = [];
		for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-6; v += step) out.push(+v.toPrecision(10));
		return out;
	}

	const xTicks = $derived(ticks(xd, xLog, innerW / 80));
	const yTicks = $derived(ticks(yd, yLog, innerH / 42));

	const inRange = (p: [number, number]) => p[0] >= xd[0] && p[0] <= xd[1] && Number.isFinite(p[1]) && (!yLog || p[1] > 0);
	const clampY = (y: number) => Math.min(M.t + innerH, Math.max(M.t, y));
	const path = (points: [number, number][]) => {
		let d = '';
		let pen = false;
		for (const p of points) {
			if (!inRange(p)) {
				pen = false;
				continue;
			}
			d += `${pen ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${clampY(Y(p[1])).toFixed(1)}`;
			pen = true;
		}
		return d;
	};

	/** Value of a series at x, interpolated in the plot's own scale. */
	function valueAt(s: Series, x: number): number | null {
		const pts = s.points;
		for (let i = 1; i < pts.length; i++) {
			const [x0, y0] = pts[i - 1];
			const [x1, y1] = pts[i];
			if (x >= x0 && x <= x1) {
				const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
				return y0 + t * (y1 - y0);
			}
		}
		return null;
	}

	const hoverRows = $derived(
		hoverX === null
			? []
			: series
					.map((s) => ({ s, y: valueAt(s, hoverX as number) }))
					.filter((r): r is { s: Series; y: number } => r.y !== null && Number.isFinite(r.y))
	);

	/** Markers that sit close together take separate rows, so their labels stay readable. */
	const markerRows = $derived.by(() => {
		const placed: { m: Marker; x: number; row: number; flip: boolean }[] = [];
		const visible = markers.filter((m) => m.x >= xd[0] && m.x <= xd[1]).sort((a, b) => a.x - b.x);
		for (const m of visible) {
			const x = X(m.x);
			let row = 0;
			while (placed.some((p) => p.row === row && Math.abs(p.x - x) < 112)) row++;
			placed.push({ m, x, row, flip: x > M.l + innerW - 110 });
		}
		return placed;
	});

	function onMove(e: PointerEvent) {
		const box = (e.currentTarget as SVGElement).getBoundingClientRect();
		const px = e.clientX - box.left;
		hoverX = px >= M.l && px <= M.l + innerW ? invX(px) : null;
	}
</script>

<figure class="plot" bind:clientWidth={width}>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<svg {width} {height} role="img" aria-label={desc} onpointermove={onMove} onpointerleave={() => (hoverX = null)}>
		{#each yTicks as v (v)}
			<line class="grid" x1={M.l} x2={M.l + innerW} y1={Y(v)} y2={Y(v)} />
			<text class="tick" x={M.l - 6} y={Y(v) + 4} text-anchor="end">{yFmt(v)}</text>
		{/each}
		{#each xTicks as v (v)}
			<line class="grid faint" x1={X(v)} x2={X(v)} y1={M.t} y2={M.t + innerH} />
			<text class="tick" x={X(v)} y={M.t + innerH + 16} text-anchor="middle">{xFmt(v)}</text>
		{/each}
		<line class="axis" x1={M.l} x2={M.l + innerW} y1={M.t + innerH} y2={M.t + innerH} />
		<text class="label" x={M.l + innerW / 2} y={height - 6} text-anchor="middle">{xLabel}</text>
		<text class="label" x={M.l - 50} y={M.t - 12}>{yLabel}</text>

		{#each markerRows as { m, x, row, flip } (m.label + m.x)}
			<line class="marker" x1={x} x2={x} y1={M.t} y2={M.t + innerH} style:stroke={m.color ?? 'var(--d-fg)'} />
			<text class="mark-label" x={flip ? x - 4 : x + 4} y={M.t + 11 + row * 13} text-anchor={flip ? 'end' : 'start'}>{m.label}</text>
		{/each}

		{#if area}
			{#each series as s (s.id)}
				{@const line = path(s.points)}
				{#if line}
					<path d={`${line}L${X(s.points[s.points.length - 1][0])} ${M.t + innerH}L${X(s.points[0][0])} ${M.t + innerH}Z`} style:fill={s.color} opacity="0.16" />
				{/if}
			{/each}
		{/if}
		{#each series as s (s.id)}
			<path class="line" d={path(s.points)} style:stroke={s.color} stroke-dasharray={s.dash} />
		{/each}
		{#each dots as d (`${d.x}|${d.y}`)}
			{#if d.x >= xd[0] && d.x <= xd[1]}
				<circle class="dot" cx={X(d.x)} cy={clampY(Y(d.y))} r="5" style:fill={d.color ?? 'var(--d-accent)'} />
				{#if d.label}
					<text class="mark-label" x={Math.min(X(d.x) + 9, M.l + innerW - 4)} y={clampY(Y(d.y)) - 8} text-anchor={X(d.x) > M.l + innerW - 110 ? 'end' : 'start'}>{d.label}</text>
				{/if}
			{/if}
		{/each}

		{#if hoverX !== null}
			<line class="cross" x1={X(hoverX)} x2={X(hoverX)} y1={M.t} y2={M.t + innerH} />
			{#each hoverRows as r (r.s.id)}
				{#if Number.isFinite(Y(r.y))}
					<circle class="dot" cx={X(hoverX)} cy={clampY(Y(r.y))} r="4" style:fill={r.s.color} />
				{/if}
			{/each}
		{/if}
	</svg>
	{#if hoverX !== null && hoverRows.length}
		<div class="tip" style:left={`${Math.min(X(hoverX) + 10, width - 190)}px`} style:top={`${M.t + 4}px`}>
			<b>{xLabel}: {xFmt(hoverX)}</b>
			{#each hoverRows as r (r.s.id)}
				<span><i style:background={r.s.color}></i>{series.length > 1 ? `${r.s.label}: ` : ''}{yFmt(r.y)}</span>
			{/each}
		</div>
	{/if}
	{#if series.length > 1}
		<ul class="legend">
			{#each series as s (s.id)}
				<li><i style:background={s.color}></i>{s.label}</li>
			{/each}
		</ul>
	{/if}
</figure>

<style>
	.plot {
		position: relative;
		margin: 0;
		min-width: 0;
		width: 100%;
	}
	svg {
		display: block;
		touch-action: pan-y;
	}
	.grid {
		stroke: var(--d-rule);
		stroke-width: 1;
	}
	.grid.faint {
		opacity: 0.45;
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
	.mark-label {
		font-size: 11px;
		fill: var(--d-fg);
		font-family: var(--d-mono);
		paint-order: stroke;
		stroke: var(--d-surface);
		stroke-width: 3px;
	}
	.line {
		fill: none;
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.marker {
		stroke-width: 1;
		stroke-dasharray: 3 3;
	}
	.cross {
		stroke: var(--d-fg);
		stroke-width: 1;
		opacity: 0.5;
	}
	.dot {
		stroke: var(--d-surface);
		stroke-width: 2;
	}
	.tip {
		position: absolute;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 2px;
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
		flex-wrap: wrap;
		gap: 2px 14px;
		margin: 2px 0 6px;
		padding: 0 0 0 58px;
		list-style: none;
		font: 12px var(--d-mono);
	}
	.legend i {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 6px;
	}
	.tip i {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin-right: 5px;
	}
</style>
