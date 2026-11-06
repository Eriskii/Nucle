<script lang="ts">
	import { fmtWind, type Lang } from '#lib/game/i18n.ts';

	interface Props {
		lang: Lang;
		/** Total of every warhead placed, in kilotons. */
		totalKt: number;
		windBearing: number;
		windKmh: number;
		/** Share of saturation at this spot, on puzzles with real weather. */
		humidity: number | null;
	}

	let { lang, totalKt, windBearing, windKmh, humidity }: Props = $props();

	const ru = $derived(lang === 'ru');

	// The meter reads seven decades, 1 kt to 10 Gt. With nothing placed the needle lies on its stop.
	const SWEEP = 56;
	const DECADES = 7;
	const STOP = -SWEEP - 8;
	const angleOf = (kt: number) => -SWEEP + (Math.log10(kt) / DECADES) * SWEEP * 2;
	const needle = $derived(totalKt >= 1 ? Math.min(angleOf(totalKt), SWEEP + 5) : totalKt > 0 ? -SWEEP : STOP);
	const ticks = Array.from({ length: DECADES * 2 + 1 }, (_, i) => i / 2);
	const point = (deg: number, r: number) => {
		const a = ((deg - 90) * Math.PI) / 180;
		return [56 + r * Math.cos(a), 66 + r * Math.sin(a)];
	};
	const scale = $derived([
		{ decade: 0, text: ru ? '1 КТ' : '1 KT' },
		{ decade: 3, text: ru ? '1 МТ' : '1 MT' },
		{ decade: 6, text: ru ? '1 ГТ' : '1 GT' }
	]);
	const compass = Array.from({ length: 24 }, (_, i) => i * 15);
</script>

<svg class="meter" viewBox="0 0 112 88" role="img" aria-label={ru ? 'Суммарная мощность' : 'Total yield allocated'}>
	<rect x="1" y="1" width="110" height="86" rx="5" class="case" />
	<rect x="6" y="6" width="100" height="62" rx="3" class="face" />
	{#each ticks as d (d)}
		{@const major = Number.isInteger(d)}
		{@const a = -SWEEP + (d / DECADES) * SWEEP * 2}
		{@const [x1, y1] = point(a, 46)}
		{@const [x2, y2] = point(a, major ? 39 : 42)}
		<line {x1} {y1} {x2} {y2} class="tick" class:major />
	{/each}
	{#each scale as s (s.decade)}
		{@const [x, y] = point(-SWEEP + (s.decade / DECADES) * SWEEP * 2, 31)}
		<text {x} y={y + 2} text-anchor="middle" class="scale">{s.text}</text>
	{/each}
	<g class="needle" style:transform={`rotate(${needle}deg)`}>
		<line x1="56" y1="66" x2="56" y2="19" />
	</g>
	<rect x="6" y="62" width="100" height="6" class="shade" />
	<path d="M8 8h96v12c-30 7-66 7-96 0z" class="gloss" />
	<circle cx="56" cy="66" r="4.5" class="hub" />
	<text x="56" y="80" text-anchor="middle" class="plate-text">{ru ? 'СУММА МОЩНОСТИ' : 'TOTAL YIELD'}</text>
</svg>

<svg class="wind" viewBox="0 0 96 112" role="img" aria-label={ru ? 'Ветер' : 'Wind'}>
	<circle cx="48" cy="48" r="46" class="case" />
	<circle cx="48" cy="48" r="39" class="face" />
	{#each compass as a (a)}
		<line x1="48" y1="11" x2="48" y2={a % 90 === 0 ? 18 : a % 45 === 0 ? 15 : 13} class="tick" class:major={a % 45 === 0} transform={`rotate(${a} 48 48)`} />
	{/each}
	<text x="48" y="27" text-anchor="middle" class="scale">{ru ? 'С' : 'N'}</text>
	<g transform={`rotate(${windBearing} 48 48)`}>
		<path d="M48 16l5 32h-10z" class="arrow" />
		<path d="M48 76l3-28h-6z" class="tail" />
	</g>
	<circle cx="48" cy="48" r="4" class="hub" />
	<path d="M16 34a34 34 0 0 1 64 0c-20-8-44-8-64 0z" class="gloss" />
	<rect x="6" y="96" width="84" height="15" rx="2" class="well" />
	<text x="48" y="107" text-anchor="middle" class="well-text">{fmtWind(windKmh, lang)}{humidity === null ? '' : ` ${Math.round(humidity * 100)}%`}</text>
</svg>

<style>
	svg {
		display: block;
		flex: none;
		overflow: visible;
	}
	.meter {
		width: 112px;
	}
	.wind {
		width: 96px;
	}
	text {
		font-family: var(--crt);
	}
	.case {
		fill: var(--gauge-case);
		stroke: var(--gauge-rim);
		stroke-width: 2;
		filter: drop-shadow(0 3px 3px var(--gauge-drop));
	}
	.face {
		fill: var(--gauge-face);
		stroke: var(--gauge-rim);
	}
	.tick {
		stroke: var(--gauge-ink);
		stroke-width: 0.9;
	}
	.tick.major {
		stroke-width: 1.8;
	}
	.scale {
		font-size: 7.5px;
		font-weight: 700;
		fill: var(--gauge-ink);
	}
	.needle {
		transform-origin: 56px 66px;
		transition: transform 280ms ease-out;
	}
	.needle line {
		stroke: var(--gauge-needle);
		stroke-width: 1.8;
		stroke-linecap: round;
	}
	.shade {
		fill: var(--gauge-case);
	}
	.hub {
		fill: var(--gauge-hub);
		stroke: var(--gauge-rim);
	}
	.plate-text {
		font: 7.5px var(--engraved);
		letter-spacing: 0.09em;
		fill: var(--gauge-plate-ink);
	}
	.gloss {
		fill: #fff;
		opacity: 0.09;
		pointer-events: none;
	}
	.arrow {
		fill: var(--gauge-needle);
	}
	.tail {
		fill: var(--gauge-ink);
		opacity: 0.55;
	}
	.well {
		fill: var(--well-face);
		stroke: var(--gauge-rim);
	}
	.well-text {
		font-size: 10px;
		fill: var(--well-ink);
	}
	@media (prefers-reduced-motion: reduce) {
		.needle {
			transition: none;
		}
	}
	@media (max-height: 800px) {
		.wind {
			display: none;
		}
	}
	@media (max-height: 660px), (max-width: 900px) {
		.meter,
		.wind {
			display: none;
		}
	}
</style>
