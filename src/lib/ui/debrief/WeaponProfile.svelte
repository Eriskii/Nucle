<script lang="ts">
	import type { OutlineKind, WeaponFacts } from '#lib/game/weaponfacts.ts';
	import type { Fmt } from './fmt.ts';

	interface Props {
		facts: WeaponFacts;
		F: Fmt;
		labels: { person: string; desc: string };
	}

	let { facts, F, labels }: Props = $props();
	let width = $state(600);
	const height = 170;
	const PERSON_M = 1.75;

	const L = $derived(facts.lengthM ?? 1);
	const D = $derived(facts.diameterM ?? 0.3);
	const ppm = $derived(Math.min((width - 90) / (L + PERSON_M + 0.6), 110 / Math.max(D, PERSON_M)));
	const baseY = height - 34;
	const x0 = $derived(50 + PERSON_M * 0.5 * ppm);
	const midY = $derived(baseY - (D / 2) * ppm);

	/**
	 * Half-diameter along the body, as a share of the diameter, from nose (0) to tail (1). A schematic of the
	 * public outline only, traced by eye from photographs: proportions are right, details are not.
	 */
	const OUTLINES: Record<OutlineKind, [number, number][]> = {
		shell: [[0, 0.1], [0.08, 0.38], [0.22, 0.5], [0.45, 0.5], [0.62, 0.34], [0.72, 0.14], [1, 0.12]],
		warhead: [[0, 0.12], [0.1, 0.3], [0.3, 0.46], [0.5, 0.5], [0.95, 0.5], [1, 0.42]],
		gun: [[0, 0.32], [0.05, 0.46], [0.12, 0.5], [0.7, 0.5], [0.78, 0.46], [1, 0.46]],
		fat: [[0, 0.12], [0.06, 0.36], [0.2, 0.5], [0.42, 0.5], [0.62, 0.36], [0.72, 0.28], [1, 0.28]],
		slim: [[0, 0.02], [0.14, 0.36], [0.24, 0.5], [0.82, 0.5], [0.92, 0.3], [1, 0.3]],
		cone: [[0, 0.02], [0.06, 0.07], [1, 0.5]],
		missile: [[0, 0.03], [0.05, 0.3], [0.09, 0.5], [1, 0.5]],
		device: [[0, 0.32], [0.04, 0.5], [0.9, 0.5], [1, 0.34]],
		torpedo: [[0, 0.1], [0.04, 0.38], [0.1, 0.5], [0.86, 0.5], [0.97, 0.22], [1, 0.1]],
		heavy: [[0, 0.1], [0.08, 0.36], [0.2, 0.5], [0.72, 0.5], [0.88, 0.34], [1, 0.3]]
	};
	const FINNED = new Set<OutlineKind>(['slim', 'gun', 'fat', 'shell', 'heavy']);

	const body = $derived.by(() => {
		const pts = OUTLINES[facts.outline ?? 'warhead'];
		const px = (t: number) => x0 + PERSON_M * 0.5 * ppm + 22 + t * L * ppm;
		const top = pts.map(([t, h]) => `${px(t).toFixed(1)} ${(midY - h * D * ppm).toFixed(1)}`);
		const low = [...pts].reverse().map(([t, h]) => `${px(t).toFixed(1)} ${(midY + h * D * ppm).toFixed(1)}`);
		return { path: `M${top.join('L')}L${low.join('L')}Z`, left: px(0), right: px(1) };
	});
	const fins = $derived.by(() => {
		if (!FINNED.has(facts.outline ?? 'warhead')) return '';
		const r = body.right;
		const span = D * ppm * 0.5;
		const chord = Math.min(L * ppm * 0.14, span * 1.6);
		return `M${r - chord} ${midY - span * 0.35}L${r} ${midY - span}L${r} ${midY + span}L${r - chord} ${midY + span * 0.35}Z`;
	});
	const h = $derived(PERSON_M * ppm);
</script>

<figure class="profile" bind:clientWidth={width}>
	<svg {width} {height} role="img" aria-label={labels.desc}>
		<line class="floor" x1={8} x2={width - 8} y1={baseY} y2={baseY} />
		<!-- A person, 1.75 m tall. -->
		<g class="person">
			<circle cx={x0} cy={baseY - h * 0.92} r={h * 0.08} />
			<path d={`M${x0 - h * 0.12} ${baseY - h * 0.8}h${h * 0.24}l${h * 0.03} ${h * 0.34}h${-h * 0.05}l${-h * 0.01} ${h * 0.46}h${-h * 0.08}l${-h * 0.01} ${-h * 0.4}l${-h * 0.01} ${h * 0.4}h${-h * 0.08}l${-h * 0.01} ${-h * 0.46}h${-h * 0.05}z`} />
		</g>
		<text x={x0} y={baseY + 14} text-anchor="middle">{labels.person}</text>

		{#if fins}<path d={fins} class="fin" />{/if}
		<path d={body.path} class="body" />

		<!-- Length and diameter. -->
		<line class="dim" x1={body.left} x2={body.right} y1={baseY + 9} y2={baseY + 9} />
		<line class="dim" x1={body.left} x2={body.left} y1={baseY + 4} y2={baseY + 14} />
		<line class="dim" x1={body.right} x2={body.right} y1={baseY + 4} y2={baseY + 14} />
		<text class="b" x={(body.left + body.right) / 2} y={baseY + 25} text-anchor="middle">{F.metres(L)}</text>
		<text class="b" x={Math.min(body.right + 8, width - 40)} y={midY + 4}>⌀ {F.metres(D)}</text>
	</svg>
</figure>

<style>
	.profile {
		margin: 0;
		min-width: 0;
	}
	svg {
		display: block;
	}
	.floor {
		stroke: var(--d-rule);
	}
	.person {
		fill: var(--d-fg);
	}
	.body {
		fill: var(--d-fg);
		fill-opacity: 0.22;
		stroke: var(--d-fg);
		stroke-width: 1.5;
		stroke-linejoin: round;
	}
	.fin {
		fill: var(--d-fg);
		fill-opacity: 0.12;
		stroke: var(--d-fg);
	}
	.dim {
		stroke: var(--d-dim);
	}
	text {
		font: 11px var(--d-mono);
		fill: var(--d-dim);
	}
	.b {
		fill: var(--d-fg);
		font-weight: 700;
	}
</style>
