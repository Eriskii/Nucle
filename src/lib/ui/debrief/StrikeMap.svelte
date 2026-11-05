<script lang="ts">
	import type { DebriefData } from '#lib/game/debrief.ts';
	import type { TheatreMeta } from '#lib/game/data.ts';
	import { Projection, destination } from '#lib/game/projection.ts';
	import type { Scenario } from '#lib/game/scenario.ts';
	import type { PopGrid } from '#lib/game/sim.ts';
	import type { Theme } from '#lib/ui/themes.ts';
	import type { Fmt } from './fmt.ts';

	export type MapMode = 'before' | 'deaths' | 'structures' | 'fallout';

	interface Props {
		data: DebriefData;
		scenario: Scenario;
		meta: TheatreMeta;
		grid: PopGrid;
		theme: Theme;
		F: Fmt;
		/** Burst to emphasise, or null for all. */
		focus?: number | null;
		labels: {
			modes: Record<MapMode, string>;
			keys: Record<MapMode, [string, string]>;
			whole: string;
			strike: string;
			people: string;
			killed: string;
			structuresGone: string;
			rate: string;
			desc: string;
		};
	}

	let { data, scenario, meta, grid, theme, F, focus = null, labels }: Props = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let width = $state(820);
	let mode = $state<MapMode>('deaths');
	let fitStrike = $state(true);
	let tip = $state<{ x: number; y: number; cell: number } | null>(null);

	const height = $derived(Math.min(width * 0.72, 620));
	const proj = $derived(new Projection(scenario.theatre.lat, scenario.theatre.lon));

	/** Centre and half-width of the view in projected km. */
	const view = $derived.by(() => {
		const R = scenario.theatre.radiusKm;
		if (!fitStrike) return { cx: 0, cy: 0, half: R };
		const pts = data.bursts.flatMap((b) => {
			const [x, y] = proj.forward(b.burst.lat, b.burst.lon);
			const reach = b.exo ? Math.min(b.empKm, R) : Math.max(b.rings.psi1, b.rings.thermal, b.maxDeathKm * 0.5, R * 0.03);
			const out = [
				[x - reach, y - reach],
				[x + reach, y + reach]
			];
			const plume = b.falloutRows.find((f) => f.rate === 10)?.band.length ?? 0;
			if (plume > 0) {
				const a = (scenario.weather.windBearing * Math.PI) / 180;
				out.push([x + Math.sin(a) * plume, y + Math.cos(a) * plume]);
			}
			return out;
		});
		const xs = pts.map((p) => p[0]);
		const ys = pts.map((p) => p[1]);
		const lox = Math.min(...xs);
		const hix = Math.max(...xs);
		const loy = Math.min(...ys);
		const hiy = Math.max(...ys);
		const aspect = width / height;
		const half = Math.min(R, Math.max((hiy - loy) / 2, (hix - lox) / 2 / aspect, R * 0.04) * 1.15);
		return { cx: (lox + hix) / 2, cy: (loy + hiy) / 2, half };
	});
	const ppk = $derived(height / (2 * view.half));
	const toPx = (x: number, y: number): [number, number] => [width / 2 + (x - view.cx) * ppk, height / 2 - (y - view.cy) * ppk];

	const cellPx = $derived(Float32Array.from({ length: grid.n * 2 }, (_, k) => {
		const i = k >> 1;
		const [x, y] = proj.forward(grid.lat[i], grid.lon[i]);
		const [px, py] = toPx(x, y);
		return k % 2 ? py : px;
	}));

	function draw() {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		const c = canvas.getContext('2d');
		if (!c) return;
		c.setTransform(dpr, 0, 0, dpr, 0, 0);
		const css = getComputedStyle(canvas);
		const surface = css.getPropertyValue('--map-bg').trim() || '#000';
		const fg = css.getPropertyValue('--d-fg').trim();
		const hot = css.getPropertyValue('--d-accent').trim();
		c.fillStyle = surface;
		c.fillRect(0, 0, width, height);

		// Water and coast first, so people sit on top of them.
		const line = (sets: number[][], style: string, w: number) => {
			c.strokeStyle = style;
			c.lineWidth = w;
			c.beginPath();
			for (const flat of sets) {
				for (let i = 0; i < flat.length; i += 2) {
					const [x, y] = proj.forward(flat[i + 1], flat[i]);
					const [px, py] = toPx(x, y);
					if (i === 0) c.moveTo(px, py);
					else c.lineTo(px, py);
				}
			}
			c.stroke();
		};
		line(meta.rivers, theme.river, 0.8);
		line(meta.lakes, theme.lake, 0.8);
		line(meta.borders, theme.border, 0.8);
		line(meta.coast, theme.coast, 1.2);

		// People. Size by population is hard to read at this density, so size is the cell and alpha is the population.
		const size = Math.max(1.4, grid.cellKm * ppk);
		// Cells span equal degrees, so at this latitude they're taller than the width cellKm gives.
		const tall = Math.max(1.4, (grid.cellKm / Math.max(0.2, Math.cos((scenario.theatre.lat * Math.PI) / 180))) * ppk);
		const maxPop = Math.max(1, ...Array.from({ length: Math.min(grid.n, 400) }, (_, i) => grid.pop[i]));
		const lift = (p: number) => 0.14 + 0.86 * Math.min(1, Math.sqrt(p / maxPop) * 1.2);
		for (let i = 0; i < grid.n; i++) {
			const px = cellPx[i * 2];
			const py = cellPx[i * 2 + 1];
			if (px < -size || py < -size || px > width + size || py > height + size) continue;
			const pop = grid.pop[i];
			if (pop <= 0 && mode !== 'structures') continue;
			let share = 0;
			if (mode === 'deaths') share = data.cellFatal[i];
			else if (mode === 'structures') share = 1 - data.cellStand[i];
			else if (mode === 'fallout') share = data.cellRate[i] > 0 ? Math.min(1, Math.log10(data.cellRate[i] + 1) / 3) : 0;
			// Everyone untouched stays quiet in the damage views, so the damage is what reads first.
			const quiet = mode === 'before' ? 1 : 0.38;
			c.globalAlpha = lift(mode === 'structures' ? grid.structures[i] * 2 : pop) * quiet;
			c.fillStyle = share > 0.005 ? hot : `rgb(${theme.dot})`;
			if (share > 0.005) c.globalAlpha = 0.35 + 0.65 * share;
			// Snapped to whole pixels, so neighbours neither overlap nor leave a seam.
			const x0 = Math.round(px - size / 2);
			const y0 = Math.round(py - tall / 2);
			c.fillRect(x0, y0, Math.max(1, Math.round(px + size / 2) - x0), Math.max(1, Math.round(py + tall / 2) - y0));
		}
		c.globalAlpha = 1;

		// The rings and plumes as they were planned, with the focused weapon on top.
		c.font = `700 12px ${css.getPropertyValue('--d-mono')}`;
		c.textAlign = 'center';
		for (const b of data.bursts) {
			const dim = focus !== null && focus !== b.index;
			c.globalAlpha = dim ? 0.3 : 1;
			const [x, y] = proj.forward(b.burst.lat, b.burst.lon);
			const [px, py] = toPx(x, y);
			c.strokeStyle = fg;
			c.lineWidth = 1;
			if (mode === 'before') continue;
			if (b.exo) {
				c.setLineDash([6, 4]);
				c.beginPath();
				c.arc(px, py, b.empKm * ppk, 0, Math.PI * 2);
				c.stroke();
				c.setLineDash([]);
			} else {
				for (const ring of [b.rings.psi5, b.rings.psi1]) {
					c.setLineDash(ring === b.rings.psi1 ? [3, 3] : []);
					c.beginPath();
					c.arc(px, py, ring * ppk, 0, Math.PI * 2);
					c.stroke();
				}
				c.setLineDash([]);
				const band = b.falloutRows.find((f) => f.rate === 10)?.band;
				if (band && (mode === 'fallout' || mode === 'deaths')) {
					const bearing = scenario.weather.windBearing;
					c.beginPath();
					for (const run of band.runs) {
						const side = (sign: number, pts: [number, number][]) => {
							pts.forEach(([along, half], i) => {
								const [la, lo] = destination(b.burst.lat, b.burst.lon, bearing, Math.abs(along));
								const start = along >= 0 ? [la, lo] : destination(b.burst.lat, b.burst.lon, bearing + 180, -along);
								const [la2, lo2] = destination(start[0], start[1], bearing + 90 * sign, half);
								const [qx, qy] = proj.forward(la2, lo2);
								const [sx, sy] = toPx(qx, qy);
								if (i === 0 && sign > 0) c.moveTo(sx, sy);
								else c.lineTo(sx, sy);
							});
						};
						side(1, run);
						side(-1, [...run].reverse());
						c.closePath();
					}
					c.stroke();
				}
			}
		}
		c.globalAlpha = 1;
		for (const b of data.bursts) {
			if (mode === 'before') continue;
			const dim = focus !== null && focus !== b.index;
			c.globalAlpha = dim ? 0.45 : 1;
			const [x, y] = proj.forward(b.burst.lat, b.burst.lon);
			const [px, py] = toPx(x, y);
			c.fillStyle = surface;
			c.strokeStyle = fg;
			c.lineWidth = 1.5;
			c.beginPath();
			c.arc(px, py, 10, 0, Math.PI * 2);
			c.fill();
			c.stroke();
			c.fillStyle = fg;
			c.fillText(`${b.index + 1}`, px, py + 4);
		}
		c.globalAlpha = 1;
	}

	$effect(() => {
		// Redraw on any input the picture depends on.
		void [mode, fitStrike, width, height, focus, data, theme, cellPx, canvas];
		draw();
	});

	function onMove(e: PointerEvent) {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const x = e.clientX - box.left;
		const y = e.clientY - box.top;
		let best = -1;
		let bestD = Math.max(8, grid.cellKm * ppk) ** 2;
		for (let i = 0; i < grid.n; i++) {
			const dx = cellPx[i * 2] - x;
			const dy = cellPx[i * 2 + 1] - y;
			const d = dx * dx + dy * dy;
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		tip = best >= 0 ? { x, y, cell: best } : null;
	}

	const MODES: MapMode[] = ['before', 'deaths', 'structures', 'fallout'];
</script>

<figure class="map" bind:clientWidth={width}>
	<div class="tools">
		{#each MODES as m (m)}
			<button type="button" class="dkey" class:on={mode === m} onclick={() => (mode = m)}>{labels.modes[m]}</button>
		{/each}
		<span class="sep"></span>
		<button type="button" class="dkey" class:on={fitStrike} onclick={() => (fitStrike = !fitStrike)}>{fitStrike ? labels.strike : labels.whole}</button>
	</div>
	<div class="frame" style:height={`${height}px`}>
		<canvas bind:this={canvas} style:width={`${width}px`} style:height={`${height}px`} aria-label={labels.desc} onpointermove={onMove} onpointerleave={() => (tip = null)}></canvas>
		{#if tip}
			{@const i = tip.cell}
			<div class="tip" style:left={`${Math.min(tip.x + 12, width - 190)}px`} style:top={`${Math.min(tip.y + 12, height - 90)}px`}>
				<span>{labels.people}: <b>{F.count(grid.pop[i])}</b></span>
				<span>{labels.killed}: <b>{F.count(grid.pop[i] * data.cellFatal[i])}</b> ({F.pct(data.cellFatal[i])})</span>
				<span>{labels.structuresGone}: <b>{F.pct(1 - data.cellStand[i])}</b></span>
				{#if data.cellRate[i] > 0}<span>{labels.rate}: <b>{F.rate(data.cellRate[i])}</b></span>{/if}
			</div>
		{/if}
	</div>
	<div class="key">
		<span><i style:background={`rgb(${theme.dot})`}></i>{labels.keys[mode][0]}</span>
		{#if labels.keys[mode][1]}<span><i class="hot"></i>{labels.keys[mode][1]}</span>{/if}
	</div>
</figure>

<style>
	.map {
		margin: 0;
		min-width: 0;
	}
	.tools {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.sep {
		flex: 1;
	}
	.frame {
		position: relative;
		overflow: hidden;
		border: 1px solid var(--d-rule);
	}
	canvas {
		display: block;
		touch-action: pan-y;
	}
	.tip {
		position: absolute;
		display: flex;
		flex-direction: column;
		width: 180px;
		padding: 6px 8px;
		pointer-events: none;
		font: 11px/1.4 var(--d-mono);
		color: var(--d-fg);
		background: var(--d-surface);
		border: 1px solid var(--d-dim);
	}
	.key {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 18px;
		margin-top: 6px;
		font: 12px var(--d-mono);
	}
	.key i {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 6px;
	}
	.hot {
		background: var(--d-accent);
	}
</style>
