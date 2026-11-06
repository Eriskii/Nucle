<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import type { BurstReport } from '#lib/game/debrief.ts';
	import { EARTH_KM, LAYER_KM, horizonKm } from '#lib/game/effects.ts';
	import { EXO_FRAG } from './exoShader.ts';
	import type { Fmt } from './fmt.ts';
	import { compile, FULLSCREEN_VERT, Governor, noiseTexture, uniforms } from './gl.ts';

	export interface ExoStage {
		id: string;
		title: string;
		body: string;
	}
	export interface ExoText {
		stages: ExoStage[];
		play: string;
		pause: string;
		time: string;
		burst: string;
		layer: string;
		footprint: string;
		note: string;
		desc: string;
	}

	interface Props {
		r: BurstReport;
		F: Fmt;
		text: ExoText;
		grade: number;
	}

	let { r, F, text, grade }: Props = $props();

	const T_MIN = -6;
	const T_MAX = Math.log10(3600);
	const C_KMS = 299792;
	/** When each stage's marker sits, in seconds. */
	const STAGE_S = [2e-6, 3e-4, 0.05, 20, 600];

	let width = $state(820);
	let u = $state(0);
	let playing = $state(false);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let live = $state(true);
	let gl: WebGL2RenderingContext | null = null;
	let vao: WebGLVertexArrayObject | null = null;
	let set: ReturnType<typeof uniforms> | null = null;
	let raf = 0;
	let last = 0;
	let churn = 12;
	let visible = true;
	let observer: IntersectionObserver | null = null;
	const governor = new Governor(30, 0.5);
	const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

	const H = $derived(width < 620 ? 380 : 500);
	const hKm = $derived(r.burst.hobM / 1000);
	const horizon = $derived(horizonKm(hKm));
	const span = $derived(Math.max(horizon * 1.2, r.empKm * 1.1, 900));
	const t = $derived(Math.pow(10, T_MIN + u * (T_MAX - T_MIN)));
	const ppk = $derived(Math.min(width / 2 / span, (H * 0.58) / Math.max(hKm, 80)));
	const groundY = $derived(H * 0.2);
	const stageIndex = $derived.by(() => {
		let best = 0;
		for (let i = 1; i < STAGE_S.length; i++) if (t >= Math.sqrt(STAGE_S[i - 1] * STAGE_S[i])) best = i;
		return best;
	});
	const stage = $derived(text.stages[stageIndex]);

	/** Debris runs out at about 1000 km/s until the field and the thin air stop it. An illustration, scaled by yield. */
	const fireR = (s: number) => {
		const stop = 60 * Math.cbrt(r.burst.kt / 100);
		return Math.min(stop, 1000 * s) + Math.min(stop * 0.8, 6 * s);
	};

	function draw(dt: number) {
		if (!gl || !set || !canvas) return;
		if (dt > 0) governor.note(dt);
		const dpr = Math.min(window.devicePixelRatio || 1, 1.5) * governor.scale;
		const w = Math.max(2, Math.round(width * dpr));
		const h = Math.max(2, Math.round(H * dpr));
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		gl.viewport(0, 0, w, h);
		const s = t;
		const flash = Math.exp(-s / 0.002) * Math.min(1, s / 1e-6);
		const temp = Math.max(0, 1 - 0.14 * Math.log10(1 + s / 1e-4));
		const shell = Math.min(1, s / 0.003) * Math.exp(-s / 900);
		// X-rays reach the layer at light speed. It then glows for seconds, then fades over minutes as it spreads.
		const layerReach = Math.min(horizon, C_KMS * s);
		const layerGlow = Math.min(1, s / 1e-4) * (0.35 + 0.65 * Math.exp(-s / 3)) * Math.exp(-s / 300) * Math.min(1, 0.4 + 0.16 * Math.log10(Math.max(r.burst.kt, 1)));
		const heat = r.rings.thermal > 0 ? Math.min(1, s / 0.5) * Math.exp(-s / 120) : 0;
		const front = C_KMS * s;
		const aurora = Math.min(1, Math.max(0, Math.log10(s / 0.4)) / 1.4) * Math.exp(-s / 1100);
		set.i('uNoise', 0);
		set.f('uRes', w, h);
		set.f('uView', 1 / (ppk * dpr), groundY * dpr);
		set.f('uH', hKm);
		set.f('uLayerKm', Math.min(LAYER_KM, hKm));
		set.f('uFire', fireR(s), temp, shell, flash);
		set.f('uLayer', layerReach, layerGlow, heat, r.rings.thermal);
		set.f('uPulse', Math.min(front, r.empKm * 1.2), r.empKm, Math.exp(-s / 0.002));
		set.f('uAurora', aurora, Math.max(r.empKm * 0.55, 300));
		set.f('uChurn', churn);
		set.f('uGrade', grade);
		set.f('uFade', churn % 7);
		gl.bindVertexArray(vao);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	let dirty = true;
	function frame(ts: number) {
		raf = requestAnimationFrame(frame);
		const dt = (ts - last) / 1000;
		if (!visible || dt < 0.03) {
			if (!visible) last = ts;
			return;
		}
		last = ts;
		if (playing) {
			u = Math.min(1, u + dt * 0.05);
			if (u >= 1) playing = false;
		}
		if (!reduced) churn += Math.min(dt, 0.1) * 1.3;
		if (reduced && !playing && !dirty) return;
		dirty = false;
		draw(Math.min(dt * 1000, 200));
	}
	$effect(() => {
		void [u, width, H, grade];
		dirty = true;
	});

	onMount(() => {
		const context = canvas?.getContext('webgl2', { antialias: false, alpha: false }) ?? null;
		if (!context) {
			live = false;
			return;
		}
		try {
			gl = context;
			const program = compile(gl, FULLSCREEN_VERT, EXO_FRAG);
			gl.useProgram(program);
			set = uniforms(gl, program);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_3D, noiseTexture(gl, 48));
			vao = gl.createVertexArray();
		} catch {
			gl = null;
			live = false;
			return;
		}
		if (canvas) {
			observer = new IntersectionObserver((entries) => (visible = entries[0].isIntersecting));
			observer.observe(canvas);
		}
		last = performance.now();
		raf = requestAnimationFrame(frame);
	});
	onDestroy(() => {
		cancelAnimationFrame(raf);
		observer?.disconnect();
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
	});

	const jump = (i: number) => {
		playing = false;
		u = (Math.log10(STAGE_S[i]) - T_MIN) / (T_MAX - T_MIN);
	};
	const toggle = () => {
		playing = !playing;
		if (playing && u >= 0.999) u = 0;
	};
	const toY = (alt: number) => H - groundY - alt * ppk;
	const footX = $derived(Math.min(width / 2 - 8, r.empKm * ppk));
	const footDrop = $derived(EARTH_KM * (1 - Math.cos(r.empKm / EARTH_KM)) * ppk);
</script>

{#if live}
	<figure class="exo-live" bind:clientWidth={width}>
		<div class="stagebox" style:height={`${H}px`}>
			<canvas bind:this={canvas} style:width={`${width}px`} style:height={`${H}px`} aria-label={text.desc}></canvas>
			<svg {width} height={H} aria-hidden="true">
				<circle cx={width / 2} cy={toY(hKm)} r="3" class="pt" />
				<text x={width / 2 + 9} y={toY(hKm) + 4}>{text.burst}: {F.km(hKm)}</text>
				{#if hKm > 90}
					<text x={width / 2 + 9} y={toY(Math.min(LAYER_KM, hKm)) - 5}>{text.layer}</text>
				{/if}
				<text x={width / 2} y={Math.min(H - 8, toY(0) + footDrop + 18)} text-anchor="middle">{text.footprint}: {F.km(r.empKm)}</text>
				<line x1={width / 2 - footX} x2={width / 2 + footX} y1={Math.min(H - 22, toY(0) + footDrop + 6)} y2={Math.min(H - 22, toY(0) + footDrop + 6)} class="span" />
			</svg>
		</div>
		<div class="readout">
			<button type="button" class="dkey" onclick={toggle}>{playing ? text.pause : text.play}</button>
			<label class="scrub">
				<span>{text.time}</span>
				<input type="range" min="0" max="1" step="0.001" bind:value={u} oninput={() => (playing = false)} />
				<output>T+{t < 1e-3 ? `${Math.round(t * 1e6)} µs` : F.time(t)}</output>
			</label>
		</div>
		<div class="stages" role="group" aria-label={text.time}>
			{#each text.stages as s, i (s.id)}
				<button type="button" class="dkey" class:on={i === stageIndex} onclick={() => jump(i)}>{s.title}</button>
			{/each}
		</div>
		<p class="caption" aria-live="polite"><b>{stage.title}.</b> {stage.body}</p>
		<p class="note">{text.note}</p>
	</figure>
{/if}

<style>
	.exo-live {
		margin: 12px 0;
		min-width: 0;
	}
	.stagebox {
		position: relative;
		overflow: hidden;
		background: #02030a;
	}
	canvas,
	svg {
		position: absolute;
		inset: 0;
		display: block;
	}
	svg {
		pointer-events: none;
	}
	text {
		font: 12px var(--d-mono);
		fill: #f0efe2;
		paint-order: stroke;
		stroke: rgba(0, 0, 0, 0.7);
		stroke-width: 3px;
	}
	.pt {
		fill: none;
		stroke: #fff;
	}
	.span {
		stroke: rgba(240, 240, 226, 0.6);
		stroke-dasharray: 4 4;
	}
	.readout {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 12px;
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
		background: repeating-linear-gradient(90deg, var(--d-dim) 0 1px, transparent 1px 5%) 0 50% / 100% 11px no-repeat;
		cursor: grab;
	}
	.scrub input::-webkit-slider-runnable-track {
		height: 2px;
		background: var(--d-fg);
	}
	.scrub input::-moz-range-track {
		height: 2px;
		background: var(--d-fg);
	}
	.scrub input::-webkit-slider-thumb {
		appearance: none;
		width: 18px;
		height: 30px;
		margin-top: -14px;
		background: linear-gradient(90deg, transparent 44%, var(--d-accent) 44% 56%, transparent 56%), var(--d-key);
		clip-path: polygon(0 0, 100% 0, 100% 72%, 50% 100%, 0 72%);
		box-shadow: inset 0 0 0 1px var(--d-fg);
	}
	.scrub input::-moz-range-thumb {
		box-sizing: border-box;
		width: 18px;
		height: 30px;
		border: 1px solid var(--d-fg);
		border-radius: 0;
		background: linear-gradient(90deg, transparent 44%, var(--d-accent) 44% 56%, transparent 56%), var(--d-key);
		clip-path: polygon(0 0, 100% 0, 100% 72%, 50% 100%, 0 72%);
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
		margin: 10px 0 6px;
	}
	.note {
		font-size: 12.5px;
		color: var(--d-soft);
	}
</style>
