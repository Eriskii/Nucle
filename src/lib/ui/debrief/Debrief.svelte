<script lang="ts">
	import { onMount } from 'svelte';
	import type { TheatreMeta } from '#lib/game/data.ts';
	import { analyze, CAUSES, placeLimitKm, type Cause } from '#lib/game/debrief.ts';
	import type { Difficulty } from '#lib/game/difficulty.ts';
	import { fatalityFromFallout, fatalityFromPsi, structureLossFromPsi } from '#lib/game/effects.ts';
	import { DIFFICULTY_RU, THEATRE_RU, WEAPON_NAME_RU, placeName as localPlace, type Lang } from '#lib/game/i18n.ts';
	import {
		checksFor,
		fmtScore,
		OBJECTIVE_TITLE,
		objectiveText,
		SCORE_UNIT,
		toBurst,
		type Outcome,
		type Placement,
		type Scenario
	} from '#lib/game/scenario.ts';
	import { distanceKm, type PopGrid, type Sim } from '#lib/game/sim.ts';
	import type { Theme } from '#lib/ui/themes.ts';
	import BurstPanel from './BurstPanel.svelte';
	import { formatter } from './fmt.ts';
	import LogStrip from './LogStrip.svelte';
	import Plot from './Plot.svelte';
	import SplitBar from './SplitBar.svelte';
	import StrikeMap from './StrikeMap.svelte';
	import { TEXT } from './translations.ts';

	interface Props {
		scenario: Scenario;
		sim: Sim;
		outcome: Outcome;
		meta: TheatreMeta;
		grid: PopGrid;
		theme: Theme;
		lang: Lang;
		difficulty: Difficulty | null;
		solution: Placement[];
		onclose: () => void;
	}

	let { scenario, sim, outcome, meta, grid, theme, lang, difficulty, solution, onclose }: Props = $props();

	const t = $derived(TEXT[lang]);
	const F = $derived(formatter(lang));
	const d = $derived(analyze(scenario, sim, outcome, meta));

	let active = $state(0);
	let root = $state<HTMLDivElement | null>(null);
	let closeKey = $state<HTMLButtonElement | null>(null);

	const ru = $derived(lang === 'ru');
	const theatreName = $derived(ru ? THEATRE_RU[scenario.theatre.id] : scenario.theatre.name);
	const weaponName = (id: string, name: string) => (ru ? (WEAPON_NAME_RU[id] ?? name) : name);
	const placeName = (p: { name: string; ru?: string }) => localPlace(p, lang);
	const COLOR: Record<Cause, string> = {
		blast: 'var(--c-blast)',
		burns: 'var(--c-burns)',
		radiation: 'var(--c-radiation)',
		fallout: 'var(--c-fallout)'
	};
	const NAV = ['summary', 'map', 'weapons', 'score', 'how', 'missing', 'sources'] as const;

	const anyDead = $derived(d.deaths >= 1);
	const causeSegments = $derived(CAUSES.map((c) => ({ label: t.summary.causes[c], value: d.causes[c], color: COLOR[c] })));
	const SEQ = ['var(--seq0)', 'var(--seq1)', 'var(--seq2)', 'var(--seq3)', 'var(--seq4)'];
	const fateSegments = $derived(
		d.bands.map((b, i) => ({
			label:
				i === 0
					? t.summary.fateNone
					: i === d.bands.length - 1
						? t.summary.fateAll
						: t.summary.fateBand(`${Math.round(b.from * 100)}`, `${Math.round(b.to * 100)}%`),
			value: b.pop,
			color: SEQ[i],
			text: F.count(b.pop)
		}))
	);
	const range = (lo: number, hi: number) => `${F.short(lo)}–${F.short(hi)}`;
	const deathRows = $derived([
		...(anyDead ? [{ label: t.summary.scaleYou, value: d.deaths, text: F.count(d.deaths), you: true }] : []),
		{ label: t.summary.scaleRows.hiroshima, value: Math.sqrt(90e3 * 166e3), low: 90e3, high: 166e3, text: range(90e3, 166e3) },
		{ label: t.summary.scaleRows.nagasaki, value: Math.sqrt(60e3 * 80e3), low: 60e3, high: 80e3, text: range(60e3, 80e3) },
		{ label: t.summary.scaleRows.tokyo, value: Math.sqrt(90e3 * 200e3), low: 90e3, high: 200e3, text: range(90e3, 200e3) },
		{ label: t.summary.scaleRows.otaCity, value: Math.sqrt(220e3 * 2.5e6), low: 220e3, high: 2.5e6, text: range(220e3, 2.5e6) },
		{ label: t.summary.scaleRows.otaLarge, value: Math.sqrt(70e6 * 160e6), low: 70e6, high: 160e6, text: range(70e6, 160e6) },
		{ label: t.summary.scaleRows.wwii, value: Math.sqrt(60e6 * 85e6), low: 60e6, high: 85e6, text: range(60e6, 85e6) }
	]);
	const yieldRows = $derived(
		[
			{ label: t.summary.yieldRows.you, value: d.yieldKt, you: true },
			{ label: t.summary.yieldRows.hiroshima, value: 15 },
			{ label: t.summary.yieldRows.nagasaki, value: 21 },
			{ label: t.summary.yieldRows.wwii, value: 3000 },
			{ label: t.summary.yieldRows.bravo, value: 15000 },
			{ label: t.summary.yieldRows.tsar, value: 50000 },
			{ label: t.summary.yieldRows.tests, value: 440000 }
		].map((r) => ({ ...r, text: F.kt(r.value) }))
	);
	const places = $derived(d.places.filter((p) => p.deaths >= 1 || p.peakPsi >= 1 || p.rate >= 1).slice(0, 16));

	const S = $derived(t.score);
	const checks = $derived(checksFor(scenario, outcome.bursts, outcome.tally, lang));
	const score = (v: number) => fmtScore(scenario, v, lang);
	// An economy day's goal is damage, though its score is yield. Counterforce has targets instead of a number.
	const goalText = $derived(scenario.kind === 'economy' ? F.count(scenario.goal) : scenario.kind === 'counterforce' ? S.goalTargets : score(scenario.goal));
	const ratingAt = $derived(Math.max(0, Math.min(130, outcome.rating)));
	const RANK_BANDS = [0, 60, 75, 90, 100, 110, 130];
	const solverBursts = $derived(solution.map((p) => toBurst(scenario, p)));
	const unusedBySolver = $derived(scenario.arsenal.length - solution.length);
	const DIFF_WEIGHT = [0.5, 0.2, 0.2, 0.1];
	const diffRows = $derived(
		difficulty
			? [
					{ label: S.difficultyRows.plans, share: 1 - difficulty.planPass, weight: DIFF_WEIGHT[0] },
					{ label: S.difficultyRows.progress, share: 1 - difficulty.planProgress, weight: DIFF_WEIGHT[1] },
					{ label: S.difficultyRows.tolerance, share: 1 - difficulty.tolerance, weight: DIFF_WEIGHT[2] },
					{ label: S.difficultyRows.conditions, share: Math.min(1, difficulty.conditions / 3), weight: DIFF_WEIGHT[3] }
				]
			: []
	);

	const H = $derived(t.how);
	const sweep = (lo: number, hi: number, fn: (x: number) => number, log = false, n = 80): [number, number][] =>
		Array.from({ length: n + 1 }, (_, i) => {
			const x = log ? lo * Math.pow(hi / lo, i / n) : lo + ((hi - lo) * i) / n;
			return [x, fn(x)];
		});
	const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
	const pressureX = (v: number) => F.sig(F.pressureValue(v), 2);
	const grades: Record<string, string> = { published: 'pub', estimate: 'est', choice: 'cho' };

	function go(id: string) {
		root?.querySelector(`#d-${id}`)?.scrollIntoView({ block: 'start' });
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose();
	}

	onMount(() => {
		closeKey?.focus();
	});
</script>

<svelte:window onkeydown={onKey} />

<div class="debrief" data-theme={theme.id} bind:this={root} role="dialog" aria-modal="true" aria-label={t.title}>
	<header class="top">
		<strong>{t.title}</strong>
		<nav>
			{#each NAV as id (id)}
				<button type="button" onclick={() => go(id)}>{t.nav[id]}</button>
			{/each}
		</nav>
		<button type="button" class="dkey close" bind:this={closeKey} onclick={onclose}>{t.close}</button>
	</header>

	<div class="page">
		<p class="note">{t.modelNote}</p>

		<section id="d-summary">
			<h2>{t.summary.head}</h2>
			<p class="lead">
				{t.summary.lead(d.bursts.length, F.kt(d.yieldKt), F.sig(d.hiroshimas, 3), theatreName)}
				{anyDead ? t.summary.leadDead(F.count(d.deaths), F.pct(d.deaths / Math.max(d.mapPop, 1))) : t.summary.leadNone}
			</p>
			<div class="tiles">
				<div class="hero"><b>{F.count(d.deaths)}</b><span>{t.summary.tiles.deaths}</span></div>
				<div><b>{F.count(d.mapPop)}</b><span>{t.summary.tiles.mapPop}</span></div>
				<div><b>{F.count(d.structures)}</b><span>{t.summary.tiles.structures}</span></div>
				<div><b>{F.kt(d.yieldKt)}</b><span>{t.summary.tiles.yield} · {F.pct(d.fissionKt / Math.max(d.yieldKt, 1e-6))} {t.summary.tiles.fission}</span></div>
				<div><b>{F.count(outcome.tally.falloutPop)}</b><span>{t.summary.tiles.fallout}</span></div>
				{#if outcome.tally.empPop > 0}<div><b>{F.count(outcome.tally.empPop)}</b><span>{t.summary.tiles.blackout}</span></div>{/if}
			</div>

			{#if anyDead}
				<h3>{t.summary.causesHead}</h3>
				<p>{t.summary.causesBody}</p>
				<SplitBar segments={causeSegments} fmtShare={F.pct} desc={t.summary.causesHead} />
				<dl class="defs">
					{#each CAUSES as c (c)}
						<div><dt><i style:background={COLOR[c]}></i>{t.summary.causes[c]}</dt><dd>{t.summary.causeDefs[c]}</dd></div>
					{/each}
				</dl>

				<h3>{t.summary.fatesHead}</h3>
				<p>{t.summary.fatesBody}</p>
				<SplitBar segments={fateSegments} fmtShare={F.pct} desc={t.summary.fatesHead} />
			{/if}

			<h3>{t.summary.scaleHead}</h3>
			<p>{t.summary.scaleBody}</p>
			<LogStrip rows={deathRows} fmtTick={F.short} desc={t.summary.scaleHead} />

			<h3>{t.summary.yieldHead}</h3>
			<LogStrip rows={yieldRows} fmtTick={F.kt} desc={t.summary.yieldHead} />
			<p class="small">{t.sources.scaleNote}</p>

			{#if d.ota.fatal + d.ota.injured >= 1}
				<h3>{t.summary.otaHead}</h3>
				<p>{t.summary.otaBody(F.count(d.ota.fatal), F.count(d.ota.injured), F.count(d.deaths))}</p>
			{/if}

			<h3>{t.summary.tableHead}</h3>
			<p>{t.summary.tableBody}</p>
			<div class="scroll">
				<table class="dt">
					<thead>
						<tr>
							<th>{t.summary.cols.n}</th><th>{t.summary.cols.weapon}</th><th>{t.summary.cols.yield}</th><th>{t.summary.cols.height}</th>
							<th class="n">{t.summary.cols.share}</th><th class="n">{t.summary.cols.alone}</th><th class="n">{t.summary.cols.adds}</th>
						</tr>
					</thead>
					<tbody>
						{#each d.bursts as r (r.index)}
							<tr>
								<td>{r.index + 1}</td>
								<td><button type="button" class="link" onclick={() => { active = r.index; go('weapons'); }}>{weaponName(r.burst.weapon.id, r.burst.weapon.name)}</button></td>
								<td class="nw">{F.kt(r.burst.kt)}</td>
								<td class="nw">{F.km(r.burst.hobM / 1000)}</td>
								<td class="n">{F.count(r.deaths)}</td>
								<td class="n">{F.count(r.soloDeaths)}</td>
								<td class="n">{F.count(r.marginalDeaths)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if d.overlapDeaths >= 1 && d.bursts.length > 1}<p class="small">{t.summary.overlap(F.count(d.overlapDeaths))}</p>{/if}
		</section>

		<section id="d-map">
			<h2>{t.map.head}</h2>
			<p>{t.map.body}</p>
			<StrikeMap data={d} {scenario} {meta} {grid} {theme} {F} labels={t.map} />
			<h3>{t.map.placesHead}</h3>
			{#if places.length}
				<p>{t.map.placesBody(F.km(placeLimitKm(grid.cellKm)))}</p>
				<div class="scroll">
					<table class="dt">
						<thead>
							<tr>
								<th>{t.map.cols.place}</th><th class="n">{t.map.cols.people}</th><th class="n">{t.map.cols.dead}</th><th class="n">{t.map.cols.share}</th>
								<th class="n">{t.map.cols.psi}</th><th class="n">{t.map.cols.rate}</th><th class="n">{t.map.cols.near}</th>
							</tr>
						</thead>
						<tbody>
							{#each places as p (p.name + p.kind)}
								<tr>
									<td>{placeName(p)}</td>
									<td class="n">{p.kind === 'city' ? F.count(p.pop) : '·'}</td>
									<td class="n">{p.kind === 'city' ? F.count(p.deaths) : '·'}</td>
									<td class="n">{p.kind === 'city' && p.pop > 0 ? F.pct(p.deaths / p.pop) : '·'}</td>
									<td class="n">{p.peakPsi > 0 ? F.psi(p.peakPsi) : '·'}</td>
									<td class="n">{p.rate >= 0.1 ? F.rate(p.rate) : '·'}</td>
									<td class="n">{F.km(p.nearestKm)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p>{t.map.noPlaces}</p>
			{/if}
			<h3>{t.map.cellsHead}</h3>
			<p>{t.map.cells(F.full(grid.n), F.km(grid.cellKm), F.count(d.mapPop))}</p>
		</section>

		<section id="d-weapons">
			<h2>{t.weapon.head}</h2>
			<p>{t.weapon.body}</p>
			<div class="tabs" role="tablist">
				{#each d.bursts as r (r.index)}
					<button type="button" role="tab" class="dkey" class:on={active === r.index} aria-selected={active === r.index} onclick={() => (active = r.index)}>
						{t.weapon.tab(r.index + 1, weaponName(r.burst.weapon.id, r.burst.weapon.name))}
					</button>
				{/each}
			</div>
			{#key active}
				<BurstPanel r={d.bursts[active]} {F} {t} {placeName} precip={sim.weather.precip} grade={theme.id === 'paper' ? 1 : 0} />
			{/key}
		</section>

		<section id="d-score">
			<h2>{S.head}</h2>
			<p><b>{OBJECTIVE_TITLE[lang][scenario.kind]}.</b> {objectiveText(scenario, lang)}</p>
			<p class="verdict" class:bad={!outcome.passed}>{outcome.passed ? S.passed : S.failed}</p>
			<h3>{S.checks}</h3>
			<ul class="checks">
				{#each checks as c (c.label)}
					<li class:bad={!c.ok}><span>{c.ok ? '✓' : '✗'}</span> <b>{c.label}</b> {c.detail}</li>
				{/each}
			</ul>
			<p class="formula">
				{#if !outcome.passed}
					{S.formulaFail}
				{:else if outcome.lowerIsBetter}
					{S.formulaLow(score(outcome.value), score(scenario.par), F.count(scenario.slack), `${outcome.rating}`)}
				{:else}
					{S.formulaHigh(score(outcome.value), score(scenario.par), `${outcome.rating}`)}
				{/if}
			</p>
			<p>{S.parBody(goalText, `${score(scenario.par)} ${SCORE_UNIT[lang][scenario.kind]}`)}</p>
			<h3>{S.rankHead}</h3>
			<div class="ranks">
				{#each RANK_BANDS.slice(1) as hi, i (hi)}
					{@const lo = RANK_BANDS[i]}
					<div style:flex-grow={hi - lo} class:here={outcome.passed && ratingAt >= lo && ratingAt < hi} style:--step={0.08 + i * 0.06}>
						<span>{S.ranks[i + 1]}</span>
					</div>
				{/each}
				<i class="pin" style:left={`${(ratingAt / 130) * 100}%`}><b>{S.yours}: {outcome.rating}</b></i>
			</div>

			<h3>{S.solverHead}</h3>
			<p>{S.solverBody}</p>
			<div class="scroll">
				<table class="dt">
					<thead><tr><th>{S.solverCols.weapon}</th><th>{S.solverCols.yield}</th><th>{S.solverCols.height}</th><th class="n">{S.solverCols.dist}</th></tr></thead>
					<tbody>
						{#each solverBursts as b, i (i)}
							<tr>
								<td>{weaponName(b.weapon.id, b.weapon.name)}</td>
								<td class="nw">{F.kt(b.kt)}</td>
								<td class="nw">{F.km(b.hobM / 1000)}</td>
								<td class="n">{F.km(distanceKm(b.lat, b.lon, scenario.theatre.lat, scenario.theatre.lon))}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if unusedBySolver > 0}<p class="small">{S.solverNone}</p>{/if}

			{#if difficulty}
				<h3>{S.difficultyHead}</h3>
				<p>{S.difficultyBody(`${difficulty.score}`, ru ? DIFFICULTY_RU[difficulty.label] : difficulty.label)}</p>
				<div class="diff">
					{#each diffRows as row (row.label)}
						<div class="diff-row">
							<span>{row.label} · {S.difficultyWeight(pctFmt(row.weight))}</span>
							<div class="track" style:width={`${row.weight * 100 * 1.9}%`}><i style:width={`${row.share * 100}%`}></i></div>
							<b>+{Math.round(row.share * row.weight * 100)}</b>
						</div>
					{/each}
				</div>
			{/if}
			<p class="small">{S.boardNote}</p>
		</section>

		<section id="d-how">
			<h2>{H.head}</h2>
			<p>{H.body}</p>
			<ol class="pipeline">
				{#each H.steps as [name, body] (name)}
					<li><b>{name}</b><span>{body}</span></li>
				{/each}
			</ol>

			{#if d.worked}
				{@const w = d.worked}
				<h3>{H.workedHead}</h3>
				<p>{H.workedBody(F.sig(w.lat, 4), F.sig(w.lon, 4), F.full(w.pop))}</p>
				<div class="scroll">
					<table class="dt">
						<thead>
							<tr>
								<th>{H.workedCols.weapon}</th><th class="n">{H.workedCols.dist}</th><th class="n">{H.workedCols.psi}</th><th class="n">{H.workedCols.blast}</th>
								<th class="n">{H.workedCols.burns}</th><th class="n">{H.workedCols.rad}</th><th class="n">{H.workedCols.survive}</th>
							</tr>
						</thead>
						<tbody>
							{#each w.steps as s (s.index)}
								<tr>
									<td>{s.index + 1}. {weaponName(d.bursts[s.index].burst.weapon.id, d.bursts[s.index].burst.weapon.name)}</td>
									<td class="n">{F.km(s.km)}</td>
									<td class="n">{s.psi > 0 ? F.psi(s.psi) : '·'}</td>
									<td class="n">{F.pct(s.blast)}</td>
									<td class="n">{F.pct(s.burns)}</td>
									<td class="n">{F.pct(s.radiation)}</td>
									<td class="n"><b>{F.pct(s.survive)}</b></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<dl class="chain">
					<div><dt>{H.workedChain.direct}</dt><dd>{F.pct(w.direct)}</dd></div>
					<div><dt>{H.workedChain.dose}</dt><dd>{F.dose(w.dose)}</dd></div>
					<div><dt>{H.workedChain.falloutFatal}</dt><dd>{F.pct(w.falloutFatal)}</dd></div>
					<div><dt>{H.workedChain.fatal}</dt><dd>{F.pct(w.fatal)}</dd></div>
					<div class="total"><dt>{H.workedChain.deaths}</dt><dd>{F.full(w.deaths)}</dd></div>
					<div><dt>{H.workedChain.standing}</dt><dd>{F.pct(w.standing)}</dd></div>
				</dl>
				<p class="small">{H.workedNote}</p>
			{/if}

			<h3>{H.curvesHead}</h3>
			<p>{H.curvesBody}</p>
			<div class="triple">
				<div>
					<h4>{H.curves.blastTitle}</h4>
					<Plot series={[{ id: 'b', label: H.curves.share, color: 'var(--c-blast)', points: sweep(1, 60, fatalityFromPsi, true) }]} xLog xLabel={`${H.curves.psi}, ${F.pressureUnit}`} yLabel={H.curves.share} xFmt={pressureX} yFmt={pctFmt} yDomain={[0, 1]} height={210} desc={H.curves.blastTitle} />
				</div>
				<div>
					<h4>{H.curves.structTitle}</h4>
					<Plot series={[{ id: 's', label: H.curves.share, color: 'var(--c-blast)', points: sweep(1, 20, structureLossFromPsi, true) }]} xLog xLabel={`${H.curves.psi}, ${F.pressureUnit}`} yLabel={H.curves.share} xFmt={pressureX} yFmt={pctFmt} yDomain={[0, 1]} height={210} desc={H.curves.structTitle} />
				</div>
				<div>
					<h4>{H.curves.doseTitle}</h4>
					<Plot series={[{ id: 'd', label: H.curves.share, color: 'var(--c-fallout)', points: sweep(100, 1200, fatalityFromFallout) }]} xLabel={H.curves.dose} yLabel={H.curves.share} xFmt={F.dose} yFmt={pctFmt} yDomain={[0, 1]} height={210} desc={H.curves.doseTitle} />
				</div>
			</div>

			<h3>{H.sourcedHead}</h3>
			<div class="scroll">
				<table class="dt">
					<tbody>
						{#each H.sourced as [what, where, grade] (what)}
							<tr><td>{what}</td><td>{where}</td><td class="nw"><span class={`chip ${grades[grade]}`}>{H.grades[grade as keyof typeof H.grades]}</span></td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>

		<section id="d-missing">
			<h2>{t.missing.head}</h2>
			<p>{t.missing.body}</p>
			<dl class="missing">
				{#each t.missing.items as [name, body] (name)}
					<div><dt>{name}</dt><dd>{body}</dd></div>
				{/each}
			</dl>
		</section>

		<section id="d-sources">
			<h2>{t.sources.head}</h2>
			<p>{t.sources.body}</p>
			<ul class="sources">
				{#each t.sources.list as [name, url] (name)}
					<li>{#if url}<a href={url} target="_blank" rel="noreferrer">{name}</a>{:else}{name}{/if}</li>
				{/each}
			</ul>
		</section>
		<p class="end"><button type="button" class="dkey" onclick={onclose}>{t.close}</button></p>
	</div>
</div>

<style>
	.debrief {
		/* SAGE: a phosphor display, the room's own colour. */
		--d-bg: #0d0c06;
		--d-surface: #14120a;
		--d-fg: #f1e8b8;
		--d-soft: #cfc592;
		--d-dim: #a59c68;
		--d-rule: rgba(243, 229, 138, 0.2);
		--d-accent: #ff7a4a;
		--d-mono: 'Overpass Mono', ui-monospace, monospace;
		--d-head: 'Routed Gothic', 'Overpass Mono', sans-serif;
		--d-key: #25220f;
		--c-blast: #a579d4;
		--c-burns: #de6a14;
		--c-radiation: #3a96d0;
		--c-fallout: #78a028;
		--seq0: #3a341a;
		--seq1: #6e5c1e;
		--seq2: #b48a2a;
		--seq3: #efb440;
		--seq4: #fff0c4;
		--sky-top: #070b14;
		--sky-low: #18222f;
		--land: #1d190e;
		--fire-core: #fffde8;
		--fire-mid: #ffc24a;
		--fire-edge: rgba(255, 90, 30, 0.2);
		--cloud-hi: #cdbda4;
		--cloud-lo: #705c4a;
		--dust: #4a3a2c;
		--shock: #eaf4ff;
		--flash: #fff8e0;
		--map-bg: #0c0b05;
		position: fixed;
		inset: 0;
		z-index: 20;
		overflow-y: auto;
		overscroll-behavior: contain;
		background: var(--d-bg);
		color: var(--d-fg);
		font: 15px/1.6 var(--d-mono);
	}
	/* PVO: a green display and Soviet draughting type. */
	.debrief[data-theme='pvo'] {
		--d-bg: #070d07;
		--d-surface: #0b140b;
		--d-fg: #d9f0bc;
		--d-soft: #b7d29a;
		--d-dim: #8fac78;
		--d-rule: rgba(166, 232, 108, 0.22);
		--d-accent: #ff8a2a;
		--d-mono: 'PT Mono', ui-monospace, monospace;
		--d-head: 'Open GOST Type B', 'PT Mono', sans-serif;
		--d-key: #142212;
		--c-burns: #de7014;
		--c-fallout: #9c9a20;
		--seq0: #1c2c18;
		--seq1: #3f6230;
		--seq2: #7da848;
		--seq3: #c4dc62;
		--seq4: #f2ffc4;
		--sky-top: #050d08;
		--sky-low: #122218;
		--land: #10170b;
		--cloud-hi: #bcc2a0;
		--cloud-lo: #5f6a4a;
		--dust: #3c422c;
		--shock: #e6ffd0;
		--map-bg: #07100a;
	}
	/* Chart: a typed report on the planner's table, with a hand-lettered title. */
	.debrief[data-theme='paper'] {
		--d-bg: #e6dcc0;
		--d-surface: #f1e9d3;
		--d-fg: #2b261c;
		--d-soft: #463e2f;
		--d-dim: #6b604a;
		--d-rule: rgba(90, 70, 40, 0.28);
		--d-accent: #a01d16;
		--d-mono: 'Courier Prime', 'Courier New', monospace;
		--d-head: 'Architects Daughter', cursive;
		--d-key: #f3ecd8;
		--c-blast: #7a4aa0;
		--c-burns: #c8551a;
		--c-radiation: #1f6ea8;
		--c-fallout: #5b7a1f;
		--seq0: #ede1c2;
		--seq1: #e0c398;
		--seq2: #cf9353;
		--seq3: #b0562a;
		--seq4: #6e1f10;
		--sky-top: #f1e9d3;
		--sky-low: #e9dfc3;
		--land: #dccfa9;
		--fire-core: #fff3c4;
		--fire-mid: #e8943a;
		--fire-edge: rgba(170, 40, 20, 0.35);
		--cloud-hi: #b9ad92;
		--cloud-lo: #7d7059;
		--dust: #8d7f62;
		--shock: #a01d16;
		--flash: #ffffff;
		--map-bg: #efe6cf;
	}
	.top {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 18px;
		padding: 8px 16px;
		background: var(--d-surface);
		border-bottom: 1px solid var(--d-dim);
	}
	.top strong {
		font: 700 21px var(--d-head);
		letter-spacing: 0.04em;
	}
	.top nav {
		display: flex;
		flex: 1;
		flex-wrap: wrap;
		gap: 2px 12px;
	}
	.top nav button,
	.link {
		appearance: none;
		padding: 2px 0;
		border: 0;
		background: none;
		color: var(--d-fg);
		font: 13.5px var(--d-mono);
		text-decoration: underline;
		text-decoration-color: var(--d-dim);
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.link {
		text-align: left;
	}
	.top nav::-webkit-scrollbar {
		display: none;
	}
	.page {
		max-width: 1080px;
		margin: 0 auto;
		padding: 18px 16px 60px;
	}
	.page > section {
		padding-top: 34px;
		scroll-margin-top: 44px;
	}
	.debrief :global(.dkey) {
		appearance: none;
		min-height: 38px;
		margin-bottom: 4px;
		padding: 6px 13px;
		border: 1px solid var(--d-dim);
		border-radius: 3px;
		background: linear-gradient(180deg, rgba(255, 255, 255, 0.1), rgba(0, 0, 0, 0.14)), var(--d-key);
		color: var(--d-fg);
		font: 13px var(--d-mono);
		cursor: pointer;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -2px 0 rgba(0, 0, 0, 0.2), 0 3px 0 var(--d-dim), 0 5px 5px rgba(0, 0, 0, 0.3);
	}
	.debrief :global(.dkey:hover:not(:disabled)) {
		border-color: var(--d-fg);
	}
	.debrief :global(.dkey:active:not(:disabled)) {
		transform: translateY(3px);
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.45);
	}
	.debrief :global(.dkey:disabled) {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.debrief :global(.dkey.on) {
		background: var(--d-accent);
		border-color: var(--d-accent);
		color: var(--d-bg);
		font-weight: 700;
	}
	.debrief :global(h2) {
		margin: 0 0 10px;
		font: 700 29px/1.2 var(--d-head);
		letter-spacing: 0.02em;
		border-bottom: 2px solid var(--d-fg);
		padding-bottom: 5px;
	}
	.debrief :global(h3) {
		margin: 28px 0 8px;
		font: 700 20px/1.25 var(--d-head);
		letter-spacing: 0.02em;
	}
	.debrief :global(h4) {
		margin: 12px 0 6px;
		font: 700 14.5px/1.3 var(--d-mono);
	}
	.debrief :global(p) {
		margin: 0 0 10px;
		max-width: 76ch;
	}
	.debrief :global(a) {
		color: inherit;
	}
	.debrief :global(table.dt) {
		width: 100%;
		border-collapse: collapse;
		font-size: 13.5px;
		line-height: 1.4;
	}
	.debrief :global(.dt th) {
		padding: 5px 8px;
		text-align: left;
		vertical-align: bottom;
		font-weight: 700;
		font-size: 12px;
		color: var(--d-soft);
		border-bottom: 1px solid var(--d-dim);
	}
	.debrief :global(.dt td) {
		padding: 6px 8px;
		vertical-align: top;
		border-bottom: 1px solid var(--d-rule);
	}
	.debrief :global(.dt .n) {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.debrief :global(.dt .nw) {
		white-space: nowrap;
	}
	.scroll {
		overflow-x: auto;
	}
	.note {
		padding: 9px 12px;
		border-left: 3px solid var(--d-accent);
		background: var(--d-surface);
		font-size: 13.5px;
		max-width: none;
	}
	.lead {
		font-size: 19px;
		line-height: 1.45;
		max-width: 62ch;
	}
	.small {
		font-size: 13.5px;
		color: var(--d-soft);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 10px;
		margin: 14px 0;
	}
	.tiles div {
		display: flex;
		flex-direction: column;
		padding: 10px 12px;
		background: var(--d-surface);
		border: 1px solid var(--d-rule);
	}
	.tiles b {
		font: 700 26px/1.15 var(--d-head);
	}
	.tiles span {
		font-size: 12.5px;
		line-height: 1.35;
		color: var(--d-soft);
	}
	.tiles .hero {
		border-color: var(--d-accent);
	}
	.tiles .hero b {
		color: var(--d-accent);
	}
	.defs {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
		gap: 10px 24px;
		margin: 14px 0 0;
	}
	.defs dt {
		font-weight: 700;
	}
	.defs dt i {
		display: inline-block;
		width: 10px;
		height: 10px;
		margin-right: 7px;
	}
	.defs dd {
		margin: 2px 0 0;
		font-size: 13.5px;
		color: var(--d-soft);
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 10px 0 14px;
	}
	.verdict {
		font-weight: 700;
		font-size: 17px;
	}
	.verdict.bad,
	.checks .bad {
		color: var(--d-accent);
	}
	.checks {
		margin: 0 0 10px;
		padding: 0;
		list-style: none;
		font-size: 14px;
	}
	.checks span {
		display: inline-block;
		width: 16px;
		font-weight: 700;
	}
	.formula {
		padding: 9px 12px;
		background: var(--d-surface);
		border: 1px solid var(--d-rule);
		font-weight: 700;
		max-width: none;
	}
	.ranks {
		position: relative;
		display: flex;
		gap: 2px;
		margin: 34px 0 14px;
	}
	.ranks div {
		flex-basis: 0;
		min-width: 0;
		padding: 8px 2px;
		overflow: hidden;
		text-align: center;
		white-space: nowrap;
		font-size: 11.5px;
		background: color-mix(in srgb, var(--d-fg) calc(var(--step) * 100%), transparent);
	}
	.ranks .here {
		font-weight: 700;
		outline: 2px solid var(--d-accent);
		outline-offset: -2px;
	}
	.pin {
		position: absolute;
		top: -26px;
		bottom: 0;
		width: 2px;
		background: var(--d-accent);
		font-style: normal;
		pointer-events: none;
	}
	.pin b {
		position: absolute;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		white-space: nowrap;
		font-size: 12px;
	}
	.diff {
		display: grid;
		gap: 8px;
		margin-bottom: 10px;
	}
	.diff-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 38px;
		align-items: center;
		gap: 10px;
		font-size: 13px;
	}
	.diff-row b {
		text-align: right;
	}
	.diff .track {
		height: 12px;
		max-width: 100%;
		background: var(--d-rule);
	}
	.diff .track i {
		display: block;
		height: 100%;
		background: var(--d-fg);
	}
	.pipeline {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 170px), 1fr));
		gap: 22px 24px;
		margin: 14px 0;
		padding: 0;
		list-style: none;
		counter-reset: step;
	}
	.pipeline li {
		position: relative;
		display: flex;
		flex-direction: column;
		padding: 10px 12px;
		background: var(--d-surface);
		border: 1px solid var(--d-dim);
		font-size: 13px;
		line-height: 1.4;
		counter-increment: step;
	}
	.pipeline li b {
		font: 700 16px var(--d-head);
		margin-bottom: 4px;
	}
	.pipeline li b::before {
		content: counter(step) '. ';
	}
	.pipeline li:not(:last-child)::after {
		content: '→';
		position: absolute;
		top: 50%;
		right: -20px;
		transform: translateY(-50%);
		color: var(--d-accent);
		font-weight: 700;
	}
	.chain {
		margin: 12px 0 8px;
		font-size: 14px;
	}
	.chain div {
		display: flex;
		justify-content: space-between;
		gap: 18px;
		padding: 4px 0;
		border-bottom: 1px solid var(--d-rule);
	}
	.chain dd {
		margin: 0;
		font-weight: 700;
		white-space: nowrap;
	}
	.chain .total {
		font-size: 17px;
		color: var(--d-accent);
	}
	.triple {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 270px), 1fr));
		gap: 14px 24px;
	}
	.triple > div {
		min-width: 0;
	}
	.chip {
		padding: 1px 7px;
		border: 1px solid var(--d-dim);
		border-radius: 10px;
		font-size: 11.5px;
	}
	.chip.pub {
		background: var(--d-fg);
		color: var(--d-bg);
	}
	.chip.cho {
		border-style: dashed;
	}
	.missing {
		margin: 12px 0 0;
	}
	.missing div {
		padding: 10px 0;
		border-top: 1px solid var(--d-rule);
	}
	.missing dt {
		font: 700 17px var(--d-head);
	}
	.missing dd {
		margin: 2px 0 0;
		max-width: 76ch;
	}
	.sources {
		padding-left: 20px;
		font-size: 13.5px;
	}
	.end {
		margin-top: 30px;
		text-align: center;
		max-width: none;
	}
	@media (max-width: 620px) {
		/* The header stays one line tall, so it doesn't eat a phone's screen. */
		.top {
			flex-wrap: wrap;
			padding: 6px 12px;
		}
		.top strong {
			flex: 1;
			font-size: 17px;
		}
		.top nav {
			order: 3;
			flex: 0 0 100%;
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
		}
		.top nav button {
			flex: none;
		}
		.page > section {
			scroll-margin-top: 76px;
		}
		.debrief :global(h2) {
			font-size: 24px;
		}
		.lead {
			font-size: 17px;
		}
		.pipeline li:not(:last-child)::after {
			top: auto;
			right: 50%;
			bottom: -21px;
			transform: rotate(90deg);
		}
		.diff-row {
			grid-template-columns: minmax(0, 1fr) 38px;
		}
		.diff .track {
			grid-column: 1 / -1;
			grid-row: 2;
		}
	}
</style>
