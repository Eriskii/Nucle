<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { LOOKS } from '#lib/game/weaponlooks.ts';
	import type { WeaponFacts } from '#lib/game/weaponfacts.ts';
	import { WeaponEngine, type WeaponPose } from './weaponEngine.ts';

	interface Props {
		id: string;
		facts: WeaponFacts;
		height?: number;
		grade: number;
		/** Set by the tracking camera. Without it, this is a turntable the viewer can drag. */
		air?: { altKm: number; speedMs: number; time: number; chute: number; plasma: number; white: number; diveDeg: number } | null;
		dragLabel?: string;
		desc: string;
		onunavailable?: () => void;
	}

	let { id, facts, height = 300, grade, air = null, dragLabel = '', desc, onunavailable }: Props = $props();

	let canvas = $state<HTMLCanvasElement | null>(null);
	let width = $state(600);
	let engine: WeaponEngine | null = null;
	let yaw = $state(0.72);
	let pitch = $state(0.12);
	let raf = 0;
	let spinning = true;
	let visible = true;
	let observer: IntersectionObserver | null = null;
	let last = 0;
	const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const DPR = () => Math.min(window.devicePixelRatio || 1, air ? 1 : 1.5);

	const length = $derived(facts.lengthM ?? 1);
	const look = $derived(LOOKS[id]);
	/** Far enough back to fit the length across the frame and the diameter up it. The lens has a focal length of 2.4. */
	const framing = $derived(Math.max((0.74 * 2.4 * height) / Math.max(width, 1), ((facts.diameterM ?? 0.3) / length) * 2.4 * 0.95 + 0.7));

	function draw() {
		if (!engine) return;
		const a = air;
		const pose: WeaponPose = a
			? {
					// Seen from alongside and a little below, nose to the right, tilted along its path.
					yaw: 0.22 + Math.sin(a.time * 0.15) * 0.03,
					pitch: -0.08,
					distance: a.chute > 0 ? framing + a.chute * 6 : framing,
					aim: a.chute > 0 ? 0.5 + a.chute * 1.5 : 0.5,
					roll: (-a.diveDeg * Math.PI) / 180,
					flight: 1,
					altKm: a.altKm,
					speedMs: a.speedMs,
					time: a.time,
					chute: a.chute,
					plasma: a.plasma,
					white: a.white,
					grade
				}
			: {
					yaw,
					pitch,
					roll: 0,
					distance: framing,
					aim: 0.5,
					flight: 0,
					altKm: 0,
					speedMs: 0,
					time: 0,
					chute: 0,
					plasma: 0,
					white: 0,
					grade
				};
		engine.render(pose, width, height, DPR(), length);
	}

	function loop(now: number) {
		raf = requestAnimationFrame(loop);
		if (!visible || air) return;
		const dt = Math.min(0.05, (now - last) / 1000);
		last = now;
		if (spinning && !reduced) {
			yaw += dt * 0.22;
			draw();
		}
	}

	onMount(() => {
		if (!canvas || !look) return;
		try {
			engine = new WeaponEngine(canvas);
			engine.setLook(look, length, facts.diameterM ?? 0.3);
		} catch {
			engine = null;
			onunavailable?.();
			return;
		}
		observer = new IntersectionObserver((entries) => (visible = entries[0].isIntersecting));
		observer.observe(canvas);
		last = performance.now();
		draw();
		raf = requestAnimationFrame(loop);
	});
	onDestroy(() => {
		cancelAnimationFrame(raf);
		observer?.disconnect();
		engine?.destroy();
	});

	$effect(() => {
		// A tracking camera repaints when the flight moves on. A turntable, when resized or dragged.
		void [air, width, height, yaw, pitch, grade];
		draw();
	});

	let dragging = false;
	function down(e: PointerEvent) {
		if (air) return;
		dragging = true;
		spinning = false;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function move(e: PointerEvent) {
		if (!dragging) return;
		yaw -= e.movementX * 0.008;
		pitch = Math.max(-0.5, Math.min(0.9, pitch + e.movementY * 0.006));
	}
	function up() {
		dragging = false;
	}
</script>

<figure class="wv" class:air bind:clientWidth={width} style:height={`${height}px`}>
	<canvas bind:this={canvas} style:width={`${width}px`} style:height={`${height}px`} aria-label={desc} onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}></canvas>
	{#if dragLabel && !air}<span class="hint">{dragLabel}</span>{/if}
</figure>

<style>
	.wv {
		position: relative;
		margin: 0;
		min-width: 0;
		overflow: hidden;
		background: #050506;
	}
	canvas {
		display: block;
		cursor: grab;
		touch-action: pan-y;
	}
	.wv.air canvas {
		cursor: default;
	}
	.hint {
		position: absolute;
		left: 8px;
		bottom: 6px;
		font: 11px var(--d-mono);
		color: #cfd2c8;
		pointer-events: none;
	}
</style>
