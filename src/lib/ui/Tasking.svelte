<script lang="ts">
	import type { Placement } from '#lib/game/scenario.ts';
	import type { Weapon } from '#lib/game/weapons.ts';

	interface Props {
		arsenal: Weapon[];
		placements: Placement[];
		selected: number | null;
		nameOf: (w: Weapon) => string;
		yieldOf: (w: Weapon) => string;
		onselect: (slot: number) => void;
		/** A click of the knob's detent, for the sound. */
		onturn: () => void;
		label: string;
	}

	let { arsenal, placements, selected, nameOf, yieldOf, onselect, onturn, label }: Props = $props();

	// The tube holds two columns of five, the most a day's arsenal can need.
	const SLOTS = 10;
	const ARC = 135;
	const count = $derived(arsenal.length);
	const angleOf = (slot: number, n: number) => (n > 1 ? -ARC + (slot / (n - 1)) * ARC * 2 : 0);
	const angle = $derived(angleOf(selected ?? 0, count));
	const flutes = Array.from({ length: 24 }, (_, i) => i * 15);

	const point = (deg: number, r: number) => {
		const a = ((deg - 90) * Math.PI) / 180;
		return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
	};

	function turnTo(slot: number) {
		const next = Math.max(0, Math.min(count - 1, slot));
		if (next === selected) return;
		onselect(next);
		onturn();
	}

	let grabbed = false;
	let moved = false;

	function slotAt(e: PointerEvent) {
		const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
		const deg = (Math.atan2(e.clientX - box.left - box.width / 2, box.top + box.height / 2 - e.clientY) * 180) / Math.PI;
		return Math.round(((Math.max(-ARC, Math.min(ARC, deg)) + ARC) / (ARC * 2)) * (count - 1));
	}

	function down(e: PointerEvent) {
		grabbed = true;
		moved = false;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function move(e: PointerEvent) {
		if (!grabbed || count < 2) return;
		const slot = slotAt(e);
		if (slot !== (selected ?? 0)) {
			moved = true;
			turnTo(slot);
		}
	}

	/** A click without a drag steps to the next position, wrapping at the end stop. */
	function up() {
		if (grabbed && !moved && count > 1) turnTo(((selected ?? -1) + 1) % count);
		grabbed = false;
	}

	function key(e: KeyboardEvent) {
		const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
		if (!step) return;
		e.preventDefault();
		turnTo((selected ?? (step > 0 ? -1 : 0)) + step);
	}
</script>

<div class="tasking">
	<div class="tube">
		{#each Array(SLOTS) as _, i (i)}
			{@const w = arsenal[i]}
			{#if w}
				<button type="button" class="row warhead" class:on={selected === i} aria-pressed={selected === i} title={nameOf(w)} onclick={() => onselect(i)}>
					<span class="no">{String(i + 1).padStart(2, '0')}</span>
					<span class="nm">{nameOf(w)}</span>
					<span class="yd">{yieldOf(w)}</span>
					<span class="set" aria-label={placements.some((p) => p.slot === i) ? 'placed' : undefined}>{placements.some((p) => p.slot === i) ? '■' : ''}</span>
				</button>
			{:else}
				<span class="row empty" aria-hidden="true"><span class="no">{String(i + 1).padStart(2, '0')}</span><span class="nm">· · ·</span></span>
			{/if}
		{/each}
	</div>

	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class="knob"
		role="slider"
		tabindex="0"
		aria-label={label}
		aria-valuemin="1"
		aria-valuemax={count}
		aria-valuenow={(selected ?? 0) + 1}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={() => (grabbed = false)}
		onkeydown={key}
	>
		<svg viewBox="0 0 100 100" aria-hidden="true">
			<defs>
				<radialGradient id="cap" cx="0.38" cy="0.3" r="0.8">
					<stop offset="0" stop-color="#8b9299" />
					<stop offset="0.55" stop-color="#4b5158" />
					<stop offset="1" stop-color="#23272b" />
				</radialGradient>
			</defs>
			{#each arsenal as _, i (i)}
				{@const a = angleOf(i, count)}
				{@const [x1, y1] = point(a, 37)}
				{@const [x2, y2] = point(a, 41)}
				{@const [tx, ty] = point(a, 46)}
				<line {x1} {y1} {x2} {y2} class="mark" />
				<text x={tx} y={ty + 2.6} text-anchor="middle" class="digit">{i + 1}</text>
			{/each}
			<circle cx="51" cy="53" r="31" class="drop" />
			<g class="turn" style:transform={`rotate(${angle}deg)`}>
				<circle cx="50" cy="50" r="31" class="skirt" />
				{#each flutes as f (f)}
					<line x1="50" y1="19.5" x2="50" y2="24" class="flute" transform={`rotate(${f} 50 50)`} />
				{/each}
				<circle cx="50" cy="50" r="24" fill="url(#cap)" class="capring" />
				<path d="M50 21v19" class="pointer" />
			</g>
		</svg>
	</div>
</div>

<style>
	.tasking {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 92px;
		align-items: center;
		gap: 10px;
	}
	/* A small tabular tube, like the one beside SAGE's situation display. */
	.tube {
		display: grid;
		grid-template-rows: repeat(5, 19px);
		grid-template-columns: 1fr 1fr;
		grid-auto-flow: column;
		column-gap: 8px;
		padding: 7px 9px;
		border-radius: 9px;
		background:
			repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 3px),
			radial-gradient(ellipse at 50% 45%, #25210d, #100e05 80%);
		box-shadow: inset 0 2px 8px #000, inset 0 0 18px rgba(240, 220, 120, 0.05), 0 0 0 3px #30353a, 0 0 0 4px #15181b, 0 1px 0 4px rgba(255, 255, 255, 0.16);
	}
	.row {
		appearance: none;
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		height: 19px;
		padding: 0 3px;
		border: 0;
		border-radius: 1px;
		font: 12px var(--crt);
		letter-spacing: 0;
		text-align: left;
		color: #efe189;
		text-shadow: 0 0 5px rgba(255, 235, 140, 0.55);
		background: none;
		cursor: pointer;
	}
	.row:hover {
		background: rgba(243, 229, 138, 0.1);
	}
	.row.on {
		color: #17150a;
		text-shadow: none;
		background: #f3e58a;
		box-shadow: 0 0 8px rgba(243, 229, 138, 0.55);
	}
	.row:focus-visible,
	.knob:focus-visible {
		outline: 2px solid #f3e58a;
		outline-offset: 1px;
	}
	.no {
		flex: none;
		opacity: 0.6;
	}
	.nm {
		flex: 1;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: clip;
	}
	.yd {
		flex: none;
		font-size: 11px;
	}
	.set {
		flex: none;
		width: 8px;
		font-size: 9px;
	}
	.empty {
		color: rgba(243, 229, 138, 0.2);
		text-shadow: none;
		cursor: default;
	}
	.knob {
		width: 92px;
		height: 92px;
		cursor: grab;
		touch-action: none;
		border-radius: 50%;
	}
	.knob:active {
		cursor: grabbing;
	}
	svg {
		display: block;
		overflow: visible;
	}
	.mark {
		stroke: var(--text);
		stroke-width: 1.2;
	}
	.digit {
		font: 9px var(--engraved);
		fill: var(--text);
	}
	.drop {
		fill: rgba(0, 0, 0, 0.5);
	}
	.turn {
		transform-origin: 50px 50px;
		transition: transform 110ms ease-out;
	}
	.skirt {
		fill: #2b2f34;
		stroke: #0e1012;
	}
	.flute {
		stroke: #6d747b;
		stroke-width: 1.4;
	}
	.capring {
		stroke: #101214;
	}
	.pointer {
		stroke: #f4f5ef;
		stroke-width: 2.6;
		stroke-linecap: round;
	}
	@media (max-width: 500px) {
		.tasking {
			grid-template-columns: minmax(0, 1fr) 78px;
			gap: 6px;
		}
		.tube {
			column-gap: 4px;
			padding: 7px 5px;
		}
		.row {
			gap: 3px;
			padding: 0 2px;
			font-size: 11px;
		}
		.no {
			display: none;
		}
		.yd {
			font-size: 10px;
		}
		.knob {
			width: 78px;
			height: 78px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.turn {
			transition: none;
		}
	}
</style>
