<script lang="ts">
	import type { BurstReport } from '#lib/game/debrief.ts';
	import { EARTH_KM } from '#lib/game/effects.ts';
	import type { Fmt } from './fmt.ts';

	interface Props {
		r: BurstReport;
		F: Fmt;
		labels: { burst: string; horizon: string; footprint: string; desc: string };
	}

	let { r, F, labels }: Props = $props();
	let width = $state(820);

	const h = $derived(r.burst.hobM / 1000);
	const horizonAngle = $derived(Math.acos(EARTH_KM / (EARTH_KM + h)));
	const horizonKm = $derived(horizonAngle * EARTH_KM);
	// Fits the horizon and the burst, so a higher burst visibly sees further.
	const ppk = $derived(Math.min((width / 2 - 20) / (Math.sin(horizonAngle) * EARTH_KM * 1.12), 200 / h));
	const height = $derived(h * ppk + 104);
	const cx = $derived(width / 2);
	const groundTop = $derived(height - 60);
	const cy = $derived(groundTop + EARTH_KM * ppk);
	const P = (angle: number, alt = 0): [number, number] => [
		cx + Math.sin(angle) * (EARTH_KM + alt) * ppk,
		cy - Math.cos(angle) * (EARTH_KM + alt) * ppk
	];
	const arc = (from: number, to: number) => {
		let d = '';
		for (let i = 0; i <= 60; i++) {
			const [x, y] = P(from + ((to - from) * i) / 60);
			d += `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
		}
		return d;
	};
	const footAngle = $derived(r.empKm / EARTH_KM);
	const burst = $derived(P(0, h));
	const left = $derived(P(-horizonAngle));
	const right = $derived(P(horizonAngle));
</script>

<figure class="exo" bind:clientWidth={width}>
	<svg {width} {height} role="img" aria-label={labels.desc}>
		<path d={`${arc(-Math.PI / 2.2, Math.PI / 2.2)}L${width} ${height}L0 ${height}Z`} class="earth" />
		<path d={`M${left[0]} ${left[1]}L${burst[0]} ${burst[1]}L${right[0]} ${right[1]}`} class="sight" />
		<path d={arc(-footAngle, footAngle)} class="foot" />
		<circle cx={burst[0]} cy={burst[1]} r="6" class="point" />
		<line x1={burst[0]} x2={cx} y1={burst[1]} y2={groundTop} class="drop" />
		<text x={burst[0] + 12} y={burst[1] + 4}>{labels.burst}: {F.km(h)}</text>
		<text x={right[0] - 4} y={right[1] - 12} text-anchor="end">{labels.horizon}: {F.km(horizonKm)}</text>
		<text x={cx} y={groundTop + 24} text-anchor="middle" class="b">{labels.footprint}: {F.km(r.empKm)}</text>
	</svg>
</figure>

<style>
	.exo {
		margin: 0;
		min-width: 0;
	}
	svg {
		display: block;
		border: 1px solid var(--d-rule);
		background: var(--sky-top);
	}
	.earth {
		fill: var(--land);
		stroke: var(--d-fg);
	}
	.sight {
		fill: var(--c-radiation);
		fill-opacity: 0.12;
		stroke: var(--c-radiation);
		stroke-dasharray: 5 4;
	}
	.foot {
		fill: none;
		stroke: var(--d-accent);
		stroke-width: 4;
	}
	.point {
		fill: var(--fire-core);
		stroke: var(--d-accent);
		stroke-width: 2;
	}
	.drop {
		stroke: var(--d-dim);
		stroke-dasharray: 2 3;
	}
	text {
		font: 12px var(--d-mono);
		fill: var(--d-fg);
		paint-order: stroke;
		stroke: var(--d-surface);
		stroke-width: 3px;
	}
	.b {
		font-weight: 700;
	}
</style>
