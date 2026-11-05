<script lang="ts">
	import type { BurstReport } from '#lib/game/debrief.ts';
	import { LAYER_KM } from '#lib/game/effects.ts';
	import type { Fmt } from './fmt.ts';

	interface Props {
		r: BurstReport;
		F: Fmt;
		labels: {
			heights: string;
			heat: string;
			range: string;
			neutrons: string;
			hard: string;
			soft: string;
			layer: string;
			burst: string;
			burn: string;
			readout: (km: string, cal: string) => string;
			desc: string;
		};
	}

	let { r, F, labels }: Props = $props();
	let width = $state(820);
	let hover = $state<number | null>(null);

	// One mean free path straight down, from NIST XCOM and the 14 MeV cross-section of nitrogen, in a standard atmosphere.
	const STOPS = $derived([
		{ km: 100, label: labels.soft, css: 'xray' },
		{ km: 60, label: labels.hard, css: 'xray' },
		{ km: 30, label: labels.neutrons, css: 'neutron' }
	]);

	const H = 240;
	const PAD = { top: 26, bottom: 34, left: 12, right: 12 };
	const narrow = $derived(width < 620);
	const columnW = $derived(narrow ? width : Math.round(width * 0.42));
	const curveX = $derived(narrow ? 0 : columnW);
	const curveW = $derived(narrow ? width : width - columnW);

	const TOP_KM = 130;
	const altY = (km: number) => PAD.top + (1 - km / TOP_KM) * (H - PAD.top - PAD.bottom);
	const burstKm = $derived(r.burst.hobM / 1000);
	const burstY = $derived(altY(Math.min(burstKm, TOP_KM - 6)));

	const LOG_LO = -3;
	const LOG_HI = 4;
	const plotL = 46;
	const curveXAt = (km: number) => plotL + (km / 1600) * (curveW - plotL - PAD.right);
	const curveYAt = (cal: number) => {
		const v = Math.max(LOG_LO, Math.min(LOG_HI, Math.log10(Math.max(cal, 1e-6))));
		return PAD.top + (1 - (v - LOG_LO) / (LOG_HI - LOG_LO)) * (H - PAD.top - PAD.bottom);
	};
	const path = $derived(r.exoHeat.filter((p) => p.cal >= 10 ** LOG_LO).map((p, i) => `${i ? 'L' : 'M'}${curveXAt(p.km).toFixed(1)} ${curveYAt(p.cal).toFixed(1)}`).join(''));
	const hovered = $derived(hover === null ? null : r.exoHeat[hover]);

	function move(e: PointerEvent) {
		const box = (e.currentTarget as SVGElement).getBoundingClientRect();
		const km = ((e.clientX - box.left - plotL) / (curveW - plotL - PAD.right)) * 1600;
		hover = Math.max(0, Math.min(r.exoHeat.length - 1, Math.round((km / 1600) * (r.exoHeat.length - 1))));
	}
</script>

<figure class="coupling" class:narrow bind:clientWidth={width}>
	<svg width={columnW} height={H} role="img" aria-label={labels.desc}>
		<text x={PAD.left} y="16" class="head">{labels.heights}</text>
		<rect x={PAD.left} y={altY(TOP_KM)} width="26" height={altY(0) - altY(TOP_KM)} class="air" />
		<line x1={PAD.left} x2={columnW - PAD.right} y1={altY(0)} y2={altY(0)} class="ground" />
		{#each STOPS as s (s.km)}
			<rect x={PAD.left} y={altY(s.km) - 3} width="26" height="6" rx="2" class={s.css} />
			<text x={PAD.left + 34} y={altY(s.km) + 4}>{s.label}</text>
		{/each}
		<line x1={PAD.left} x2={columnW - PAD.right} y1={altY(LAYER_KM)} y2={altY(LAYER_KM)} class="layer" />
		<text x={PAD.left + 34} y={altY(LAYER_KM) - 5} class="b">{labels.layer}</text>
		<circle cx={PAD.left + 13} cy={burstY} r="6" class="point" />
		<text x={columnW - PAD.right} y={burstY + 4} text-anchor="end" class="b">{labels.burst}: {F.km(burstKm)}{burstKm > TOP_KM - 6 ? ' ↑' : ''}</text>
	</svg>

	<svg
		width={curveW}
		height={H}
		role="img"
		aria-label={labels.heat}
		onpointermove={move}
		onpointerleave={() => (hover = null)}
	>
		<text x={plotL} y="16" class="head">{labels.heat}</text>
		{#each [0.01, 1, 100] as tick (tick)}
			<line x1={plotL} x2={curveW - PAD.right} y1={curveYAt(tick)} y2={curveYAt(tick)} class="grid" />
			<text x={plotL - 6} y={curveYAt(tick) + 4} text-anchor="end" class="dim">{tick}</text>
		{/each}
		<line x1={plotL} x2={curveW - PAD.right} y1={curveYAt(r.burnCal)} y2={curveYAt(r.burnCal)} class="burn" />
		<text x={curveW - PAD.right} y={curveYAt(r.burnCal) - 5} text-anchor="end" class="dim">{labels.burn}</text>
		<path d={path} class="curve" />
		{#each [0, 800, 1600] as km (km)}
			<text x={curveXAt(km)} y={H - 16} text-anchor={km === 0 ? 'start' : km === 1600 ? 'end' : 'middle'} class="dim">{F.km(km)}</text>
		{/each}
		<text x={curveXAt(800)} y={H - 2} text-anchor="middle" class="dim">{labels.range}</text>
		{#if hovered}
			<line x1={curveXAt(hovered.km)} x2={curveXAt(hovered.km)} y1={PAD.top} y2={H - PAD.bottom} class="grid" />
			<circle cx={curveXAt(hovered.km)} cy={curveYAt(hovered.cal)} r="4" class="dot" />
			<text x={curveW - PAD.right} y={PAD.top + 12} text-anchor="end" class="b">{labels.readout(F.km(hovered.km), hovered.cal.toPrecision(2))}</text>
		{/if}
	</svg>
</figure>

<style>
	.coupling {
		display: flex;
		margin: 12px 0;
		min-width: 0;
		border: 1px solid var(--d-rule);
		background: var(--d-surface);
	}
	.coupling.narrow {
		flex-direction: column;
	}
	svg {
		display: block;
		flex: none;
	}
	text {
		font: 12px var(--d-mono);
		fill: var(--d-fg);
	}
	.head,
	.b {
		font-weight: 700;
	}
	.dim {
		fill: var(--d-dim);
	}
	.air {
		fill: var(--sky-top);
		stroke: var(--d-rule);
	}
	.ground {
		stroke: var(--d-fg);
	}
	.xray {
		fill: var(--c-blast);
	}
	.neutron {
		fill: var(--c-radiation);
	}
	.layer {
		stroke: var(--c-burns);
		stroke-width: 2;
		stroke-dasharray: 6 4;
	}
	.point {
		fill: var(--fire-core);
		stroke: var(--d-accent);
		stroke-width: 2;
	}
	.grid {
		stroke: var(--d-rule);
	}
	.burn {
		stroke: var(--d-dim);
		stroke-dasharray: 3 3;
	}
	.curve {
		fill: none;
		stroke: var(--c-burns);
		stroke-width: 2;
	}
	.dot {
		fill: var(--c-burns);
		stroke: var(--d-surface);
		stroke-width: 2;
	}
</style>
