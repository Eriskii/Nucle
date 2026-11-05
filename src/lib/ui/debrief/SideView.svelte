<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { BurstReport } from '#lib/game/debrief.ts';
	import { DELIVERY, flightFor, type DeliveryKind } from '#lib/game/delivery.ts';
	import { peakWindMs, type Precip } from '#lib/game/effects.ts';
	import { WEAPON_FACTS } from '#lib/game/weaponfacts.ts';
	import { BlastEngine } from './blastEngine.ts';
	import { momentAt, sceneFor, type Trail } from './blastState.ts';
	import type { Fmt } from './fmt.ts';
	import { Governor } from './gl.ts';
	import WeaponView from './WeaponView.svelte';

	export interface Stage {
		id: string;
		title: string;
		body: string;
	}

	export interface SideText {
		stages: Stage[];
		delivery: Record<DeliveryKind, Stage[]>;
		fuze: Stage;
		fuzeSurface: Stage;
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
		flightLine: (alt: string, speed: string) => string;
		tracking: string;
		trackingGeneric: string;
		enlarged: string;
		raised: string;
		illustrative: string;
		liveNote: string;
	}

	interface Props {
		r: BurstReport;
		F: Fmt;
		text: SideText;
		precip: Precip;
		/** 1 for the chart theme, which shows the scene as a period print. */
		grade: number;
	}

	let { r, F, text, precip, grade }: Props = $props();

	const E_KM = 6371;
	const T_MIN = -3;
	const T_MAX = Math.log10(3600);
	/** Share of the slider given to the time before detonation. */
	const PRE = 0.3;

	let width = $state(820);
	let u = $state(0.13);
	let playing = $state(false);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let live = $state(true);
	let raf = 0;
	let last = 0;
	let churn = 40;
	let engine: BlastEngine | null = null;
	let visible = true;
	let observer: IntersectionObserver | null = null;
	const governor = new Governor(30, 0.45);
	const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	const id = $derived(r.burst.weapon.id);
	const delivery = $derived(DELIVERY[id]);
	const flight = $derived(flightFor(id, r.burst.hobM));

	/** Slider position to seconds from detonation. Before zero it runs evenly; after, each stretch is ten times longer. */
	const toT = (v: number) => {
		if (v < PRE) return -flight.durationS * Math.pow(1 - v / PRE, 1.35);
		const f = (v - PRE) / (1 - PRE);
		return Math.pow(10, T_MIN + f * (T_MAX - T_MIN));
	};
	const fromT = (s: number) => {
		if (s < 0) return PRE * (1 - Math.pow(-s / flight.durationS, 1 / 1.35));
		return PRE + ((Math.log10(Math.max(s, 1e-3)) - T_MIN) / (T_MAX - T_MIN)) * (1 - PRE);
	};
	const t = $derived(toT(u));
	const before = $derived(u < PRE);
	const now = $derived(flight.at(Math.min(t, 0)));
	const m = $derived(momentAt(r, t));

	const H = $derived(width < 620 ? 460 : 560);
	const RULERS = 104;
	const groundY = $derived(H - RULERS);
	const hobKm = $derived(r.burst.hobM / 1000);
	const cloudTopKm = $derived(r.cloud.centreKm + r.cloud.halfThicknessKm);
	const reach = $derived(Math.max(r.rings.psi1, r.rings.thermal, r.rings.radiation, r.cloud.radiusKm, r.fireballKm, 0.05) * 1.1);
	const ppkBase = $derived(Math.min((width / 2 - 14) / reach, (groundY - 26) / Math.max(cloudTopKm * 1.08, hobKm * 1.1)));

	// One scale for both axes, always. The camera backs off to keep the weapon or the drifting cap in frame.
	const camera = $derived.by(() => {
		let ppk = ppkBase;
		let centre = width / 2;
		if (before) {
			const altKm = now.altM / 1000;
			ppk = Math.min(ppk, (groundY - 34) / Math.max(altKm * 1.12, 0.01));
			const x = Math.abs(now.xM) / 1000;
			if (x > 0) ppk = Math.min(ppk, (width / 2 - 60) / x);
		} else {
			const span = m.capDrift + m.capR * 1.25;
			const room = width * 0.46;
			if (span * ppk > room) {
				const shift = Math.min(width * 0.26, span * ppk - room);
				centre = width / 2 - shift;
				ppk = Math.min(ppk, (width - centre - 16) / span);
			}
		}
		return { ppk, centre };
	});
	const ppk = $derived(camera.ppk);
	const centre = $derived(camera.centre);

	const X = (km: number) => centre + km * ppk;
	const drop = (km: number) => (km * km) / (2 * E_KM);
	const Y = (alt: number, km = 0) => groundY - (alt - drop(km)) * ppk;
	const viewKm = $derived(Math.max(centre, width - centre) / ppk);

	const groundPath = $derived.by(() => {
		let d = '';
		for (let i = 0; i <= 80; i++) {
			const km = -viewKm + (2 * viewKm * i) / 80;
			d += `${i ? 'L' : 'M'}${X(km).toFixed(1)} ${Y(0, km).toFixed(1)}`;
		}
		return d;
	});

	// ---- before detonation --------------------------------------------------------------------
	const carried = $derived(delivery.kind === 'gravity' || delivery.kind === 'retarded');
	const released = $derived(before && carried && t >= -flight.releaseS);
	const wx = $derived(now.xM / 1000);
	const walt = $derived(now.altM / 1000);
	/** The aircraft flies on after release, level, at its own speed. */
	const craft = $derived.by(() => {
		if (!carried || !before) return null;
		const relX = flight.at(-flight.releaseS).xM / 1000;
		const startAlt = flight.at(-flight.durationS).altM / 1000;
		const x = t < -flight.releaseS ? wx : relX + ((t + flight.releaseS) * delivery.speedMs) / 1000;
		return { x, alt: startAlt };
	});

	const trail = $derived.by<Trail>(() => {
		if (!before) return { kind: 0, head: [0, 0], tail: [0, 0], width: 0 };
		const k = delivery.kind;
		if (craft && craft.alt > 6.5) {
			return { kind: 1, head: [craft.x, craft.alt], tail: [craft.x - 26, craft.alt], width: 0.012 };
		}
		if ((k === 'reentry' || k === 'rocket') && walt < 85) {
			const a = (now.diveDeg * Math.PI) / 180;
			const back = Math.min(40, (now.speedMs / 1000) * 3.5);
			return { kind: 2, head: [wx, walt], tail: [wx - Math.cos(a) * back, walt + Math.sin(a) * back], width: Math.max(0.012, walt * 0.0035) };
		}
		return { kind: 0, head: [0, 0], tail: [0, 0], width: 0 };
	});

	// What the tracking camera follows. A warhead inside a missile isn't public, so reentry shows a generic vehicle.
	const trackId = $derived(delivery.kind === 'reentry' ? 'w87' : id === 'w80' ? 'agm86' : id === 'w70' ? 'lance' : id);
	const trackFacts = $derived(
		id === 'w80'
			? { lengthM: 6.3, diameterM: 0.62, year: '', source: '', confidence: 'secondary' as const, outline: 'torpedo' as const }
			: id === 'w70'
				? { lengthM: 6.4, diameterM: 0.56, year: '', source: '', confidence: 'secondary' as const, outline: 'missile' as const }
				: WEAPON_FACTS[trackId]
	);
	const canTrack = $derived(!!trackFacts?.outline && delivery.kind !== 'unbuilt' && delivery.kind !== 'emplaced');
	const air = $derived(
		before
			? {
					altKm: walt,
					speedMs: now.speedMs,
					time: t,
					chute: flight.chuteS > 0 && t > -flight.chuteS ? Math.min(1, (t + flight.chuteS) / 1.4) : 0,
					plasma: delivery.kind === 'reentry' ? Math.max(0, Math.min(1, (85 - walt) / 30)) * Math.max(0.15, Math.min(1, walt / 14)) : 0,
					white: t > -0.25 ? (t + 0.25) / 0.25 : 0,
					diveDeg: now.diveDeg
				}
			: null
	);

	// ---- stages -------------------------------------------------------------------------------
	const preStages = $derived([...text.delivery[delivery.kind], r.burst.hobM === 0 ? text.fuzeSurface : text.fuze]);
	const stages = $derived([...preStages, ...text.stages]);
	const preTimes = $derived.by(() => {
		const count = preStages.length - 1;
		const out: number[] = [];
		if (carried) {
			out.push(-flight.durationS * 0.92, -flight.releaseS * 0.985);
			while (out.length < count) out.push(-flight.releaseS * 0.42);
		} else {
			for (let i = 0; i < count; i++) out.push(-flight.durationS * (0.94 - (0.72 * i) / Math.max(count, 1)));
		}
		out.push(-Math.min(0.7, flight.durationS * 0.1));
		return out;
	});
	const postTimes = $derived([r.thermalMaxS * 0.5, r.thermalMaxS * 7, Math.min(r.shock.length ? r.shock[r.shock.length - 1].s * 0.4 : 20, 45), 240, 1800]);
	const stageTimes = $derived([...preTimes, ...postTimes]);
	const stageIndex = $derived.by(() => {
		if (before) {
			let best = 0;
			for (let i = 1; i < preTimes.length; i++) {
				// A stage takes over a little before its marker, once it's nearer than the last one.
				if (t >= (preTimes[i] + preTimes[i - 1]) / 2) best = i;
			}
			return best;
		}
		const tMax = r.thermalMaxS;
		const end = r.shock.length ? r.shock[r.shock.length - 1].s : 30;
		const post = t < tMax * 2 ? 0 : t < tMax * 10 ? 1 : t < Math.min(end, 60) ? 2 : t < 900 || r.coupling <= 0 ? 3 : 4;
		return preStages.length + post;
	});
	const stage = $derived(stages[Math.min(stageIndex, stages.length - 1)]);
	const shockVisible = $derived(m.shockSlant > 0 && (m.psi >= 0.3 || m.shockKm === 0));

	const rulers = $derived(
		[
			{ id: 'psi20', label: text.rows.psi20, km: r.rings.psi20, color: 'var(--on-seq3)', blast: true },
			{ id: 'psi5', label: text.rows.psi5, km: r.rings.psi5, color: 'var(--on-seq2)', blast: true },
			{ id: 'psi1', label: text.rows.psi1, km: r.rings.psi1, color: 'var(--on-seq1)', blast: true },
			{ id: 'burns', label: text.rows.burns, km: r.rings.thermal, color: '#ff8a3c', blast: false },
			{ id: 'rad', label: text.rows.radiation, km: r.rings.radiation, color: '#58b4ee', blast: false }
		].filter((x) => x.km > 0)
	);

	const nice = (raw: number) => {
		const mag = Math.pow(10, Math.floor(Math.log10(raw)));
		return [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? raw;
	};
	const refs = $derived(
		[
			{ km: 8.85, label: text.refs.everest },
			{ km: 11, label: text.refs.jet },
			{ km: 50, label: text.refs.stratopause }
		].filter((x) => x.km * ppk > 26 && Y(x.km) > 14)
	);
	const altTicks = $derived.by(() => {
		const top = (groundY - 16) / ppk;
		const step = nice(top / 5);
		const out: number[] = [];
		for (let v = step; v < top; v += step) out.push(+v.toPrecision(6));
		return out;
	});
	const groundTicks = $derived.by(() => {
		const step = nice(viewKm / 3);
		const out: number[] = [];
		for (let v = step; v < viewKm * 0.96; v += step) if (X(-v) > 30) out.push(+v.toPrecision(6));
		return out;
	});

	// In the first moments everything is too small to see at true scale, so an inset magnifies it.
	const INSET_W = 210;
	const INSET_H = 150;
	const insetKm = $derived(Math.max(m.fireR * 1.25, hobKm * 1.15, Math.min(m.shockSlant, viewKm) * 1.15, 0.01));
	const insetPpk = $derived((INSET_W / 2 - 6) / insetKm);
	const showInset = $derived(!before && insetKm * ppk < 100 && t < 60);
	const inGround = INSET_H - 18;

	// ---- drawing ------------------------------------------------------------------------------
	function drawScene(interval: number) {
		if (!engine) return;
		if (interval > 0) governor.note(interval);
		const scene = sceneFor(r, t, churn, { width, height: H, ppk, centreX: centre, groundY: RULERS }, precip, grade, trail);
		engine.render(scene, governor.scale, Math.min(window.devicePixelRatio || 1, 1.5));
	}

	let dirty = true;
	function frame(ts: number) {
		raf = requestAnimationFrame(frame);
		const dt = (ts - last) / 1000;
		if (!visible || !engine) {
			last = ts;
			return;
		}
		// No more than one fresh picture per 33 ms, and none when the viewer asked for less motion and nothing moved.
		if (dt < 0.03) return;
		last = ts;
		if (playing) {
			// Real time is hopeless across seven decades, so the slider moves at a steady pace instead.
			u = Math.min(1, u + dt * 0.042);
			if (u >= 1) playing = false;
		}
		if (!reduced) churn += Math.min(dt, 0.1) * 1.3;
		if (reduced && !playing && !dirty) return;
		dirty = false;
		drawScene(Math.min(dt * 1000, 200));
	}
	$effect(() => {
		void [u, width, H, precip, grade];
		dirty = true;
	});

	function toggle() {
		playing = !playing;
		if (playing && u >= 0.999) u = 0;
	}
	function jump(i: number) {
		playing = false;
		u = fromT(stageTimes[i]);
	}

	onMount(() => {
		if (canvas) {
			try {
				engine = new BlastEngine(canvas);
				observer = new IntersectionObserver((entries) => (visible = entries[0].isIntersecting));
				observer.observe(canvas);
			} catch {
				engine = null;
				live = false;
			}
		} else live = false;
		last = performance.now();
		raf = requestAnimationFrame(frame);
	});
	onDestroy(() => {
		cancelAnimationFrame(raf);
		observer?.disconnect();
		engine?.destroy();
	});

	// A rough outline of the carrier: seen from the side, pointing right.
	const PLANE = 'M-16 0 L-10 -1.6 L9 -1.6 L14 0 L9 1.6 L-10 1.6 Z M-13 -1 L-17 -6 L-14 -6 L-9 -1 Z M-3 -1 L-7 -3 L3 -3 L4 -1 Z';
	const MISSILE = 'M-8 -1 L5 -1 L9 0 L5 1 L-8 1 Z M-7 -1 L-10 -3.4 L-8.6 -3.4 L-5 -1 Z M-3 1 L-1 3.6 L1 3.6 L0 1 Z';
</script>

<figure class="side" bind:clientWidth={width} class:live>
	<div class="stagebox" style:height={`${H}px`}>
		{#if live}
			<canvas bind:this={canvas} style:width={`${width}px`} style:height={`${H}px`} aria-label={text.desc}></canvas>
		{/if}
		<svg {width} height={H} class="over" aria-hidden={live}>
			{#if !live}
				<rect {width} height={H} class="plain-sky" />
				{#if m.capOpacity > 0}
					<rect x={X(m.capDrift - m.capR * 0.15)} y={Y(m.capAlt)} width={m.capR * 0.3 * ppk} height={Math.max(0, groundY - Y(m.capAlt))} class="plain-cloud" opacity={m.capOpacity * 0.7} />
					<ellipse cx={X(m.capDrift)} cy={Y(m.capAlt)} rx={m.capR * ppk} ry={m.capH * ppk} class="plain-cloud" opacity={m.capOpacity} />
				{/if}
				{#if !before && m.fireR > 0 && t < r.thermalMaxS * 60}
					<circle cx={X(0)} cy={Y(m.fireAlt)} r={Math.max(2, m.fireR * ppk)} class="plain-fire" />
				{/if}
				{#if shockVisible}<circle cx={X(0)} cy={Y(hobKm)} r={m.shockSlant * ppk} class="plain-shock" />{/if}
				<path d={`${groundPath}L${width} ${H}L0 ${H}Z`} class="plain-land" />
			{/if}

			{#each altTicks as a (a)}
				<line class="alt-line" x1={0} x2={width} y1={Y(a)} y2={Y(a)} />
				<text class="alt" x={6} y={Y(a) - 3}>{F.km(a)}</text>
			{/each}
			{#each refs as ref (ref.km)}
				<line class="ref-line" x1={width - 170} x2={width} y1={Y(ref.km)} y2={Y(ref.km)} />
				<text class="ref" x={width - 6} y={Y(ref.km) - 3} text-anchor="end">{ref.label}</text>
			{/each}

			{#if hobKm > 0 && hobKm * ppk > 10 && !before}
				<line class="hob" x1={X(0)} x2={X(0)} y1={Y(0)} y2={Y(hobKm)} />
				<text class="hob-label" x={X(0) - 6} y={(Y(0) + Y(hobKm)) / 2} text-anchor="end">{text.height} {F.km(hobKm)}</text>
			{/if}

			<!-- Where it's going to happen, marked before it does. -->
			{#if before && hobKm * ppk > 2}
				<line class="aim" x1={X(0)} x2={X(0)} y1={Y(0)} y2={Y(hobKm)} />
				<circle class="aim" cx={X(0)} cy={Y(hobKm)} r="4" />
			{/if}

			<line class="gz" x1={X(0)} x2={X(0)} y1={groundY} y2={H - 4} />

			<!-- Rulers under the ground: each range as a bar from ground zero, filling as the effect arrives. -->
			{#each rulers as row, i (row.id)}
				{@const y = groundY + 13 + i * 15}
				{@const reached = before ? 0 : row.blast ? Math.min(row.km, m.shockKm) : row.km}
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

			{#if shockVisible && m.shockKm > 0 && X(m.shockKm) < width}
				<line class="front" x1={X(m.shockKm)} x2={X(m.shockKm)} y1={Y(0, m.shockKm)} y2={Y(0, m.shockKm) - 22} />
			{/if}

			<!-- The aircraft and the weapon, far too small to see at this scale, shown as markers. -->
			{#if before && craft}
				{@const cx = Math.min(width - 24, Math.max(24, X(craft.x)))}
				<g class="mark" transform={`translate(${cx} ${Y(craft.alt)}) scale(1.5)`}><path d={PLANE} /></g>
				<text class="mark-t" x={cx} y={Y(craft.alt) - 15} text-anchor="middle">{delivery.carrier}</text>
			{/if}
			{#if before && (released || !carried) && delivery.kind !== 'unbuilt'}
				{#if delivery.kind === 'cruise' || delivery.kind === 'torpedo'}
					<g class="mark" transform={`translate(${Math.max(14, X(wx))} ${Y(walt) - 3}) scale(1.4)`}><path d={MISSILE} /></g>
				{:else}
					<circle class="mark" cx={X(wx)} cy={Y(walt)} r="3" />
				{/if}
				<text class="mark-t" x={Math.min(width - 60, Math.max(60, X(wx) + 8))} y={Y(walt) - 9}>{F.km(walt)}</text>
			{/if}

			<!-- The first second, magnified. -->
			{#if showInset}
				<g transform="translate(46 12)">
					<clipPath id={`in${r.index}`}><rect width={INSET_W} height={inGround} /></clipPath>
					<rect width={INSET_W} height={INSET_H} class="inset-bg" />
					<g clip-path={`url(#in${r.index})`}>
						{#if m.fireR > 0}
							<circle cx={INSET_W / 2} cy={inGround - m.fireAlt * insetPpk} r={Math.max(2, m.fireR * insetPpk)} class="inset-fire" />
						{/if}
						{#if shockVisible}
							<circle cx={INSET_W / 2} cy={inGround - hobKm * insetPpk} r={m.shockSlant * insetPpk} class="inset-shock" />
						{/if}
					</g>
					<rect y={inGround} width={INSET_W} height={INSET_H - inGround} class="inset-land" />
					<text class="alt in-text" x="5" y={INSET_H - 5}>{text.magnified(F.sig(insetPpk / ppk, 2))}</text>
					<text class="alt in-text" x={INSET_W - 5} y={INSET_H - 5} text-anchor="end">{F.km(insetKm * 2)}</text>
				</g>
			{/if}
		</svg>

		<!-- Alongside the weapon as it comes down. -->
		{#if live && canTrack && before && air && trackFacts && (released || !carried)}
			<div class="tracking">
				<WeaponView id={trackId} facts={trackFacts} height={width < 620 ? 96 : 148} {grade} {air} desc={text.tracking} />
				<span>{delivery.kind === 'reentry' ? text.trackingGeneric : text.tracking}</span>
			</div>
		{/if}
	</div>

	<div class="readout">
		<button type="button" class="dkey" onclick={toggle}>{playing ? text.pause : text.play}</button>
		<label class="scrub">
			<span>{text.time}</span>
			<input type="range" min="0" max="1" step="0.001" bind:value={u} oninput={() => (playing = false)} />
			<output>T{t < 0 ? '−' : '+'}{F.time(Math.abs(t))}</output>
		</label>
	</div>
	<div class="stages" role="group" aria-label={text.time}>
		{#each stages as s, i (s.id)}
			{#if i === preStages.length}<i class="zero" aria-hidden="true"></i>{/if}
			<button type="button" class="dkey" class:on={i === stageIndex} onclick={() => jump(i)} disabled={s.id === 'fallout' && r.coupling <= 0}>{s.title}</button>
		{/each}
	</div>
	<p class="caption" aria-live="polite">
		<b>{stage.title}.</b> {stage.body}
		{#if before && delivery.kind !== 'unbuilt' && delivery.kind !== 'emplaced'}
			{text.flightLine(F.km(walt), F.wind(now.speedMs))}
		{/if}
		{#if !before}
			{#if m.shockKm > 0 && m.psi > 0}
				{text.front(F.km(m.shockKm), F.psi(m.psi), F.wind(peakWindMs(m.psi)))}
			{:else if m.shockKm > 0}
				{text.pastFront}
			{/if}
			{#if m.capOpacity > 0.3}{text.cloudTop(F.km(m.capAlt + m.capH))}{/if}
		{/if}
	</p>
	<p class="scale-note">
		{text.scale}
		{#if before}{text.enlarged}{/if}
		{#if before && delivery.illustrative}{text.illustrative}{/if}
		{#if before && flight.raised}{text.raised}{/if}
		{#if live}{text.liveNote}{/if}
	</p>
</figure>

<style>
	.side {
		/* The scene is a photograph in every theme, so what's written on it stays light. */
		--on-seq1: #8d7a3a;
		--on-seq2: #d3a33c;
		--on-seq3: #ffd46e;
		margin: 0;
		min-width: 0;
	}
	.stagebox {
		position: relative;
		overflow: hidden;
		border: 1px solid var(--d-rule);
		background: #0a0f18;
	}
	canvas {
		position: absolute;
		inset: 0;
		display: block;
	}
	.over {
		position: absolute;
		inset: 0;
		display: block;
	}
	.plain-sky {
		fill: var(--sky-low);
	}
	.plain-land {
		fill: var(--land);
	}
	.plain-cloud {
		fill: var(--cloud-lo);
	}
	.plain-fire {
		fill: var(--fire-mid);
	}
	.plain-shock {
		fill: none;
		stroke: var(--shock);
	}
	.alt-line {
		stroke: rgba(255, 255, 255, 0.14);
		stroke-dasharray: 2 5;
	}
	.alt,
	.ref,
	.row,
	.dir,
	.hob-label,
	.mark-t {
		font: 10.5px var(--d-mono);
		fill: #f4efdd;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.55);
		stroke-width: 2.5px;
	}
	.ref-line {
		stroke: rgba(255, 255, 255, 0.4);
		stroke-dasharray: 5 4;
	}
	.gz {
		stroke: rgba(255, 255, 255, 0.35);
		stroke-dasharray: 2 3;
	}
	.hob {
		stroke: rgba(255, 255, 255, 0.55);
		stroke-dasharray: 3 3;
	}
	.aim {
		fill: none;
		stroke: #ff6a4a;
		stroke-dasharray: 3 3;
	}
	.front {
		stroke: #fff;
		stroke-width: 2;
	}
	.track {
		fill: rgba(255, 255, 255, 0.14);
	}
	.row.val {
		font-weight: 700;
	}
	.mark {
		fill: #10131a;
		stroke: #f4efdd;
		stroke-width: 0.8;
	}
	.mark-t {
		font-weight: 700;
	}
	.inset-bg {
		fill: rgba(70, 105, 155, 0.92);
		stroke: rgba(255, 255, 255, 0.7);
	}
	.inset-land {
		fill: #1b1810;
	}
	.inset-fire {
		fill: #fff0b8;
		filter: drop-shadow(0 0 6px #ffc24a);
	}
	.inset-shock {
		fill: none;
		stroke: #fff;
		stroke-width: 1.5;
	}
	.tracking {
		position: absolute;
		top: 10px;
		right: 10px;
		width: min(40%, 270px);
		border: 1px solid rgba(255, 255, 255, 0.6);
		background: #000;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
	}
	.tracking span {
		position: absolute;
		left: 6px;
		top: 4px;
		font: 10px var(--d-mono);
		color: #fff;
		text-shadow: 0 0 3px #000;
	}
	.readout {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 10px;
	}
	.scrub {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) 104px;
		flex: 1;
		align-items: center;
		gap: 10px;
		font: 13px var(--d-mono);
	}
	.scrub input {
		appearance: none;
		width: 100%;
		height: 38px;
		margin: 0;
		background: none;
		cursor: grab;
	}
	.scrub input::-webkit-slider-runnable-track {
		height: 12px;
		border-radius: 3px;
		background: var(--d-rule);
		box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.6);
	}
	.scrub input::-moz-range-track {
		height: 12px;
		border-radius: 3px;
		background: var(--d-rule);
		box-shadow: inset 0 2px 3px rgba(0, 0, 0, 0.6);
	}
	.scrub input::-webkit-slider-thumb {
		appearance: none;
		width: 24px;
		height: 32px;
		margin-top: -10px;
		border: 1px solid var(--d-fg);
		border-radius: 3px;
		background: linear-gradient(90deg, transparent 44%, var(--d-accent) 44% 56%, transparent 56%), linear-gradient(180deg, var(--d-key), var(--d-rule));
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 3px 0 var(--d-dim), 0 4px 5px rgba(0, 0, 0, 0.5);
	}
	.scrub input::-moz-range-thumb {
		box-sizing: border-box;
		width: 24px;
		height: 32px;
		border: 1px solid var(--d-fg);
		border-radius: 3px;
		background: linear-gradient(90deg, transparent 44%, var(--d-accent) 44% 56%, transparent 56%), linear-gradient(180deg, var(--d-key), var(--d-rule));
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 3px 0 var(--d-dim), 0 4px 5px rgba(0, 0, 0, 0.5);
	}
	.scrub output {
		font-weight: 700;
		text-align: right;
	}
	.stages {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
	}
	.zero {
		width: 2px;
		height: 24px;
		background: var(--d-accent);
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
