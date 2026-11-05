<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { BurstReport } from '#lib/game/debrief.ts';
	import { peakWindMs, psiProfile } from '#lib/game/effects.ts';
	import type { Fmt } from './fmt.ts';

	export interface SideText {
		stages: { id: string; title: string; body: string }[];
		play: string;
		pause: string;
		time: string;
		scale: string;
		height: string;
		downwind: string;
		upwind: string;
		front: (km: string, psi: string, wind: string) => string;
		pastFront: string;
		cloudTop: (km: string) => string;
		refs: { everest: string; jet: string; stratopause: string };
		rows: { psi20: string; psi5: string; psi1: string; burns: string; radiation: string };
		magnified: (x: string) => string;
		desc: string;
	}

	interface Props {
		r: BurstReport;
		F: Fmt;
		text: SideText;
	}

	let { r, F, text }: Props = $props();

	const E_KM = 6371;
	// Fits G&D Table 2.12 for 1 Mt: 6 of about 12 miles at 1.1 min, 10 at 2.5 min. Used at every yield, an estimate.
	const RISE_S = 90;
	const T_MIN = -3;
	const T_MAX = Math.log10(3600);

	let width = $state(820);
	let logT = $state(1);
	let playing = $state(false);
	let raf = 0;
	let last = 0;

	const t = $derived(Math.pow(10, logT));
	const H = $derived(width < 620 ? 440 : 520);
	const RULERS = 104;
	const groundY = $derived(H - RULERS);
	const hobKm = $derived(r.burst.hobM / 1000);
	const cloudTopKm = $derived(r.cloud.centreKm + r.cloud.halfThicknessKm);
	const reach = $derived(Math.max(r.rings.psi1, r.rings.thermal, r.rings.radiation, r.cloud.radiusKm, r.fireballKm, 0.05) * 1.1);
	// One scale for both axes, so the picture has the true shape.
	const ppk = $derived(Math.min((width / 2 - 14) / reach, (groundY - 26) / Math.max(cloudTopKm * 1.08, hobKm * 1.1)));
	const X = (km: number) => width / 2 + km * ppk;
	const drop = (km: number) => (km * km) / (2 * E_KM);
	const Y = (alt: number, km = 0) => groundY - (alt - drop(km)) * ppk;
	const viewKm = $derived((width / 2) / ppk);

	const groundPath = $derived.by(() => {
		let d = '';
		for (let i = 0; i <= 80; i++) {
			const km = -viewKm + (2 * viewKm * i) / 80;
			d += `${i ? 'L' : 'M'}${X(km).toFixed(1)} ${Y(0, km).toFixed(1)}`;
		}
		return d;
	});
	const landPath = $derived(`${groundPath}L${width} ${H}L0 ${H}Z`);

	// ---- time ---------------------------------------------------------------------------------
	const tMax = $derived(r.thermalMaxS);
	const tForm = $derived(tMax * 10);
	const pulse = $derived(Math.min(1, (t / tMax) * Math.exp(1 - t / tMax)));
	const flash = $derived(Math.max(0, pulse - 0.1));
	const rise = $derived(1 - Math.exp(-t / RISE_S));

	const fireR = $derived(r.fireballKm * Math.min(1, Math.pow(t / tForm, 0.4)));
	const fireAlt = $derived(hobKm + Math.max(0, r.cloud.centreKm - hobKm) * rise);
	const fireOpacity = $derived(t < tForm ? 1 : Math.max(0, 1 - (t - tForm) / (tForm * 6 + 4)));

	const shockKm = $derived.by(() => {
		const s = r.shock;
		if (!s.length || t < s[0].s) return 0;
		for (let i = 1; i < s.length; i++) {
			if (t <= s[i].s) return s[i - 1].km + ((t - s[i - 1].s) / Math.max(s[i].s - s[i - 1].s, 1e-9)) * (s[i].km - s[i - 1].km);
		}
		// Past the table the front carries on at the speed of sound.
		return s[s.length - 1].km + 0.34 * (t - s[s.length - 1].s);
	});
	/** Slant radius of the front. Before it touches ground it scales from the first touch. */
	const shockSlant = $derived.by(() => {
		const s = r.shock;
		if (!s.length) return 0;
		if (t < s[0].s) return Math.hypot(s[0].km, hobKm) * Math.pow(t / s[0].s, 0.4);
		return Math.hypot(shockKm, hobKm);
	});
	const psiNow = $derived(shockKm > 0 ? psiProfile(r.burst.kt, r.burst.hobM)(shockKm) : 0);
	const shockVisible = $derived(shockSlant > 0 && (psiNow >= 0.3 || shockKm === 0));

	const capOpacity = $derived(Math.min(1, Math.max(0, (t - tForm * 0.4) / (tForm * 2 + 0.5))));
	const capAlt = $derived(hobKm + Math.max(0.01, r.cloud.centreKm - hobKm) * rise);
	const capR = $derived(Math.max(r.fireballKm * 0.9, r.cloud.radiusKm * Math.pow(rise, 0.7)));
	const capH = $derived(Math.max(r.fireballKm * 0.7, r.cloud.halfThicknessKm * Math.pow(rise, 0.6)));
	const capDrift = $derived((r.winds.cap * 1.609344 * Math.max(0, t - 60)) / 3600);
	// The stem thins out once the cloud has stopped rising.
	const stemOpacity = $derived((0.3 + 0.7 * r.coupling) * Math.max(0.25, 1 - Math.max(0, t - 600) / 2400));
	const stemPath = $derived.by(() => {
		const base = capR * 0.28;
		const neck = capR * 0.16;
		const top = capAlt - capH * 0.6;
		const bottomKm = 0;
		const topKm = capDrift;
		const xb = X(bottomKm);
		const xt = X(topKm);
		const yb = Y(0);
		const yt = Y(top);
		const ym = (yb + yt) / 2;
		return `M${xb - base * ppk} ${yb} C${xb - neck * ppk} ${ym} ${xt - neck * ppk} ${ym} ${xt - neck * 1.4 * ppk} ${yt} L${xt + neck * 1.4 * ppk} ${yt} C${xt + neck * ppk} ${ym} ${xb + neck * ppk} ${ym} ${xb + base * ppk} ${yb}Z`;
	});
	// Lobes around the cap, fixed once so the cloud doesn't shimmer as time moves.
	const LOBES = [
		[-0.82, 0.05, 0.34],
		[-0.55, 0.5, 0.42],
		[-0.18, 0.74, 0.46],
		[0.2, 0.72, 0.45],
		[0.58, 0.48, 0.42],
		[0.84, 0.03, 0.33],
		[-0.48, -0.25, 0.38],
		[0, -0.3, 0.42],
		[0.48, -0.25, 0.38]
	];

	// Illustrative fall of debris: it lands downwind of where it left the cloud.
	const hash = (n: number) => {
		let h = Math.imul(n + 1, 0x9e3779b1);
		h = Math.imul(h ^ (h >>> 15), 0x85ebca77);
		return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
	};
	const seeds = Array.from({ length: 160 }, (_, i) => ({ u: hash(i * 3), v: hash(i * 3 + 1), w: hash(i * 3 + 2) }));
	const particles = $derived.by(() => {
		if (r.exo || r.coupling <= 0 || t < 90) return [];
		const out: { x: number; y: number }[] = [];
		const speed = (r.winds.cap * 1.609344) / 3600;
		const count = Math.round(seeds.length * Math.min(1, 0.25 + r.coupling));
		for (let i = 0; i < count; i++) {
			const s = seeds[i];
			const released = 60 + s.u * 2400;
			if (t < released) continue;
			// Heavy grit falls in minutes, fine dust takes far longer. Lower air moves slower than the cap.
			const fall = capAlt * ((t - released) / (500 + s.v * s.v * 4500));
			const alt = capAlt + (s.w - 0.5) * capH - fall;
			if (alt < 0) continue;
			const km = speed * released + (s.w - 0.5) * capR * 1.7 + speed * (t - released) * 0.6;
			out.push({ x: X(km), y: Y(alt, km) });
		}
		return out;
	});

	const stageIndex = $derived.by(() => {
		if (t < tMax * 2) return 0;
		if (t < tForm) return 1;
		const end = r.shock.length ? r.shock[r.shock.length - 1].s : 30;
		if (t < Math.min(end, 60)) return 2;
		if (t < 900 || r.coupling <= 0) return 3;
		return 4;
	});
	const stage = $derived(text.stages[Math.min(stageIndex, text.stages.length - 1)]);
	const stageTimes = $derived([tMax * 0.5, tForm * 0.7, Math.min(r.shock.length ? r.shock[r.shock.length - 1].s * 0.4 : 20, 45), 240, 1800]);

	const rulers = $derived(
		[
			{ id: 'psi20', label: text.rows.psi20, km: r.rings.psi20, color: 'var(--seq3)', blast: true },
			{ id: 'psi5', label: text.rows.psi5, km: r.rings.psi5, color: 'var(--seq2)', blast: true },
			{ id: 'psi1', label: text.rows.psi1, km: r.rings.psi1, color: 'var(--seq1)', blast: true },
			{ id: 'burns', label: text.rows.burns, km: r.rings.thermal, color: 'var(--c-burns)', blast: false },
			{ id: 'rad', label: text.rows.radiation, km: r.rings.radiation, color: 'var(--c-radiation)', blast: false }
		].filter((x) => x.km > 0)
	);

	const refs = $derived(
		[
			{ km: 8.85, label: text.refs.everest },
			{ km: 11, label: text.refs.jet },
			{ km: 50, label: text.refs.stratopause }
		].filter((x) => x.km * ppk > 26 && Y(x.km) > 14)
	);

	const altTicks = $derived.by(() => {
		const top = (groundY - 16) / ppk;
		const raw = top / 5;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
		const out: number[] = [];
		for (let v = step; v < top; v += step) out.push(+v.toPrecision(6));
		return out;
	});
	const groundTicks = $derived.by(() => {
		const raw = viewKm / 3;
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
		const out: number[] = [];
		for (let v = step; v < viewKm * 0.96; v += step) out.push(+v.toPrecision(6));
		return out;
	});

	// In the first moments everything is too small to see at true scale, so an inset magnifies it.
	const INSET_W = 210;
	const INSET_H = 150;
	const insetKm = $derived(Math.max(fireR * 1.25, hobKm * 1.15, Math.min(shockSlant, viewKm) * 1.15, 0.01));
	const insetPpk = $derived((INSET_W / 2 - 6) / insetKm);
	const showInset = $derived(insetKm * ppk < 100 && t < 60);
	const insetZoom = $derived(insetPpk / ppk);
	const inGround = INSET_H - 18;

	function frame(now: number) {
		if (!playing) return;
		logT = Math.min(T_MAX, logT + ((now - last) / 1000) * 0.42);
		last = now;
		if (logT >= T_MAX) {
			playing = false;
			return;
		}
		raf = requestAnimationFrame(frame);
	}
	function toggle() {
		playing = !playing;
		if (playing) {
			if (logT >= T_MAX - 0.01) logT = T_MIN;
			last = performance.now();
			raf = requestAnimationFrame(frame);
		} else cancelAnimationFrame(raf);
	}
	function jump(i: number) {
		playing = false;
		cancelAnimationFrame(raf);
		logT = Math.log10(Math.max(0.001, stageTimes[i]));
	}
	onDestroy(() => cancelAnimationFrame(raf));

	const uid = $derived(`sv${r.index}`);
</script>

<figure class="side" bind:clientWidth={width}>
	<svg {width} height={H} role="img" aria-label={text.desc}>
		<defs>
			<linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="var(--sky-top)" />
				<stop offset="1" stop-color="var(--sky-low)" />
			</linearGradient>
			<radialGradient id={`${uid}-fire`}>
				<stop offset="0" stop-color="var(--fire-core)" />
				<stop offset="0.55" stop-color="var(--fire-mid)" />
				<stop offset="1" stop-color="var(--fire-edge)" />
			</radialGradient>
			<linearGradient id={`${uid}-cloud`} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="var(--cloud-hi)" />
				<stop offset="1" stop-color="var(--cloud-lo)" />
			</linearGradient>
			<linearGradient id={`${uid}-stem`} x1="0" y1="0" x2="0" y2="1">
				<stop offset="0" stop-color="var(--cloud-lo)" />
				<stop offset="1" stop-color="var(--dust)" />
			</linearGradient>
			<clipPath id={`${uid}-air`}>
				<path d={`${groundPath}L${width} 0L0 0Z`} />
			</clipPath>
		</defs>

		<rect {width} height={groundY + 40} fill={`url(#${uid}-sky)`} />

		<!-- Altitude scale and things to compare against. -->
		{#each altTicks as a (a)}
			<line class="alt-line" x1={0} x2={width} y1={Y(a)} y2={Y(a)} />
			<text class="alt" x={6} y={Y(a) - 3}>{F.km(a)}</text>
		{/each}
		{#each refs as ref (ref.km)}
			<line class="ref-line" x1={width - 170} x2={width} y1={Y(ref.km)} y2={Y(ref.km)} />
			<text class="ref" x={width - 6} y={Y(ref.km) - 3} text-anchor="end">{ref.label}</text>
		{/each}

		<g clip-path={`url(#${uid}-air)`}>
			<!-- Heat reaches the burn radius at the speed of light, while the fireball radiates. -->
			{#if pulse > 0.03 && r.rings.thermal > 0}
				<path
					d={`M${X(0)} ${Y(hobKm)} L${X(-r.rings.thermal)} ${Y(0, r.rings.thermal)} L${X(r.rings.thermal)} ${Y(0, r.rings.thermal)}Z`}
					fill="var(--c-burns)"
					opacity={pulse * 0.28}
				/>
			{/if}

			<!-- Mushroom cloud, drifting downwind to the right. -->
			{#if capOpacity > 0}
				<g opacity={capOpacity}>
					<path d={stemPath} fill={`url(#${uid}-stem)`} opacity={stemOpacity} />
					{#each LOBES as [lx, ly, lr], i (i)}
						<ellipse
							cx={X(capDrift + lx * capR * 0.8)}
							cy={Y(capAlt + ly * capH)}
							rx={Math.max(1.5, lr * capR * ppk)}
							ry={Math.max(1.5, lr * capH * 1.15 * ppk)}
							fill={`url(#${uid}-cloud)`}
						/>
					{/each}
				</g>
			{/if}

			<!-- Debris coming down: illustrative, not one particle per anything. -->
			{#each particles as p, i (i)}
				<circle cx={p.x} cy={p.y} r="1.5" class="fall" />
			{/each}

			<!-- Fireball -->
			{#if fireOpacity > 0}
				<circle cx={X(0)} cy={Y(fireAlt)} r={Math.max(2, fireR * ppk)} fill={`url(#${uid}-fire)`} opacity={fireOpacity} />
			{/if}

			<!-- Shock: the incident front from the burst, and its reflection off the ground. -->
			{#if shockVisible}
				<circle cx={X(0)} cy={Y(hobKm)} r={shockSlant * ppk} class="shock" />
				{#if hobKm > 0 && shockKm > 0}
					<circle cx={X(0)} cy={Y(-hobKm)} r={shockSlant * ppk} class="shock reflected" />
				{/if}
			{/if}
		</g>

		<!-- Height of burst -->
		{#if hobKm > 0 && hobKm * ppk > 10}
			<line class="hob" x1={X(0)} x2={X(0)} y1={Y(0)} y2={Y(hobKm)} />
			<text class="hob-label" x={X(0) - 6} y={(Y(0) + Y(hobKm)) / 2} text-anchor="end">{text.height} {F.km(hobKm)}</text>
		{/if}

		<path d={landPath} class="land" />
		<path d={groundPath} class="ground" />
		<line class="gz" x1={X(0)} x2={X(0)} y1={groundY} y2={H - 4} />

		<!-- Rulers under the ground: each range as a bar from ground zero, filling as the effect arrives. -->
		{#each rulers as row, i (row.id)}
			{@const y = groundY + 13 + i * 15}
			{@const reached = row.blast ? Math.min(row.km, shockKm) : pulse > 0.01 || t > tMax ? row.km : 0}
			<rect class="track" x={X(0)} y={y - 5} width={Math.max(1, row.km * ppk)} height="9" rx="2" />
			{#if reached > 0}
				<rect x={X(0)} y={y - 5} width={Math.max(1, reached * ppk)} height="9" rx="2" fill={row.color} />
			{/if}
			<text class="row" x={Math.max(X(0) - 8, 0)} y={y + 3} text-anchor="end">{row.label}</text>
			<text class="row val" x={Math.min(X(row.km) + 6, width - 56)} y={y + 3}>{F.km(row.km)}</text>
		{/each}

		{#each groundTicks as g (g)}
			<text class="alt" x={X(-g)} y={H - 6} text-anchor="middle">{F.km(g)}</text>
		{/each}
		<text class="dir" x={8} y={groundY - 5}>← {text.upwind}</text>
		<text class="dir" x={width - 8} y={groundY - 5} text-anchor="end">{text.downwind} →</text>

		<!-- Label on the front along the ground. -->
		{#if shockKm > 0 && shockVisible && X(shockKm) < width}
			<line class="front" x1={X(shockKm)} x2={X(shockKm)} y1={Y(0, shockKm)} y2={Y(0, shockKm) - 26} />
		{/if}

		<!-- The whole sky brightens at the flash. -->
		{#if flash > 0}
			<rect {width} height={groundY} class="flash" opacity={flash * 0.5} />
		{/if}

		{#if showInset}
			<g transform="translate(46 12)">
				<clipPath id={`${uid}-in`}><rect width={INSET_W} height={inGround} /></clipPath>
				<rect width={INSET_W} height={INSET_H} class="inset" />
				<g clip-path={`url(#${uid}-in)`}>
					<rect width={INSET_W} height={inGround} fill={`url(#${uid}-sky)`} />
					<circle cx={INSET_W / 2} cy={inGround - fireAlt * insetPpk} r={Math.max(2, fireR * insetPpk)} fill={`url(#${uid}-fire)`} opacity={fireOpacity} />
					{#if shockVisible}
						<circle cx={INSET_W / 2} cy={inGround - hobKm * insetPpk} r={shockSlant * insetPpk} class="shock" />
					{/if}
				</g>
				<rect y={inGround} width={INSET_W} height={INSET_H - inGround} class="in-land" />
				<line x1="0" x2={INSET_W} y1={inGround} y2={inGround} class="ground" />
				<text class="alt in-text" x="5" y={INSET_H - 5}>{text.magnified(F.sig(insetZoom, 2))}</text>
				<text class="alt in-text" x={INSET_W - 5} y={INSET_H - 5} text-anchor="end">{F.km(insetKm * 2)}</text>
			</g>
		{/if}
	</svg>

	<div class="readout">
		<button type="button" class="dkey" onclick={toggle}>{playing ? text.pause : text.play}</button>
		<label class="scrub">
			<span>{text.time}</span>
			<input type="range" min={T_MIN} max={T_MAX} step="0.005" bind:value={logT} oninput={() => (playing = false)} />
			<output>T+{F.time(t)}</output>
		</label>
	</div>
	<div class="stages" role="group" aria-label={text.time}>
		{#each text.stages as s, i (s.id)}
			<button type="button" class="dkey" class:on={i === stageIndex} onclick={() => jump(i)} disabled={s.id === 'fallout' && r.coupling <= 0}>{s.title}</button>
		{/each}
	</div>
	<p class="caption" aria-live="polite">
		<b>{stage.title}.</b> {stage.body}
		{#if shockKm > 0 && psiNow > 0}
			{text.front(F.km(shockKm), F.psi(psiNow), F.wind(peakWindMs(psiNow)))}
		{:else if shockKm > 0}
			{text.pastFront}
		{/if}
		{#if capOpacity > 0.3}{text.cloudTop(F.km(capAlt + capH))}{/if}
	</p>
	<p class="scale-note">{text.scale}</p>
</figure>

<style>
	.side {
		margin: 0;
		min-width: 0;
	}
	svg {
		display: block;
		border: 1px solid var(--d-rule);
		background: var(--d-surface);
	}
	.alt-line {
		stroke: var(--d-rule);
		stroke-dasharray: 2 5;
	}
	.alt {
		font: 10.5px var(--d-mono);
		fill: var(--d-dim);
	}
	.ref-line {
		stroke: var(--d-dim);
		stroke-dasharray: 5 4;
	}
	.ref {
		font: 10.5px var(--d-mono);
		fill: var(--d-fg);
	}
	.land {
		fill: var(--land);
	}
	.ground {
		fill: none;
		stroke: var(--d-fg);
		stroke-width: 1.5;
	}
	.gz {
		stroke: var(--d-dim);
		stroke-dasharray: 2 3;
	}
	.hob {
		stroke: var(--d-fg);
		stroke-dasharray: 3 3;
	}
	.hob-label {
		font: 11px var(--d-mono);
		fill: var(--d-fg);
		paint-order: stroke;
		stroke: var(--d-surface);
		stroke-width: 3px;
	}
	.shock {
		fill: none;
		stroke: var(--shock);
		stroke-width: 2;
	}
	.shock.reflected {
		stroke-width: 1;
		opacity: 0.55;
		stroke-dasharray: 5 4;
	}
	.front {
		stroke: var(--shock);
		stroke-width: 2;
	}
	.fall {
		fill: var(--c-fallout);
		opacity: 0.8;
	}
	.flash {
		fill: var(--flash);
		pointer-events: none;
	}
	.inset {
		fill: none;
		stroke: var(--d-dim);
	}
	.in-land {
		fill: var(--land);
	}
	.in-text {
		fill: var(--d-fg);
	}
	.track {
		fill: var(--d-rule);
	}
	.row {
		font: 10.5px var(--d-mono);
		fill: var(--d-fg);
	}
	.row.val {
		fill: var(--d-fg);
		font-weight: 700;
		paint-order: stroke;
		stroke: var(--land);
		stroke-width: 3px;
	}
	.dir {
		font: 10.5px var(--d-mono);
		fill: var(--d-fg);
		paint-order: stroke;
		stroke: var(--d-surface);
		stroke-width: 3px;
	}
	.readout {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
	}
	.scrub {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 96px;
		flex: 1;
		align-items: center;
		gap: 10px;
		font: 13px var(--d-mono);
	}
	.scrub input {
		width: 100%;
		accent-color: var(--d-accent);
	}
	.scrub output {
		font-weight: 700;
		text-align: right;
	}
	.stages {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 8px;
	}
	.caption {
		min-height: 5.4em;
		margin: 10px 0 0;
	}
	.scale-note {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--d-dim);
	}
</style>
