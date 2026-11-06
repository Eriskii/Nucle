<script lang="ts">
	import { CAUSES, type BurstReport, type Cause } from '#lib/game/debrief.ts';
	import { blastRangeKm, localFalloutHeightM, optimumHobM, psiProfile, type Precip } from '#lib/game/effects.ts';
	import { LOOKS } from '#lib/game/weaponlooks.ts';
	import { directFractions } from '#lib/game/sim.ts';
	import { WEAPON_FACTS } from '#lib/game/weaponfacts.ts';
	import { fissionFractionAt, hasDial } from '#lib/game/weapons.ts';
	import DistanceBars from './DistanceBars.svelte';
	import ExoCoupling from './ExoCoupling.svelte';
	import ExoScene from './ExoScene.svelte';
	import ExoView from './ExoView.svelte';
	import FalloutPlan from './FalloutPlan.svelte';
	import type { Fmt } from './fmt.ts';
	import Plot, { type Series } from './Plot.svelte';
	import SideView from './SideView.svelte';
	import SplitBar from './SplitBar.svelte';
	import type { DebriefText } from './text.ts';
	import WeaponProfile from './WeaponProfile.svelte';
	import WeaponView from './WeaponView.svelte';

	interface Props {
		r: BurstReport;
		F: Fmt;
		t: DebriefText;
		placeName: (p: { name: string; ru?: string }) => string;
		precip: Precip;
		grade: number;
	}

	let { r, F, t, placeName, precip, grade }: Props = $props();
	let render3d = $state(true);
	const W = $derived(t.weapon);
	const b = $derived(r.burst);
	const facts = $derived(WEAPON_FACTS[b.weapon.id]);
	const tons = $derived(b.kt * 1000);
	const pctFmt = (v: number) => `${Math.round(v * 100)}%`;
	const psiAxis = (v: number) => F.sig(v, 2);
	const CAUSE_COLOR: Record<Cause, string> = {
		blast: 'var(--c-blast)',
		burns: 'var(--c-burns)',
		radiation: 'var(--c-radiation)',
		fallout: 'var(--c-fallout)'
	};

	const energy = $derived.by(() => {
		const heat = r.thermalShare;
		const prompt = 0.05;
		const residual = 0.1 * r.fissionShare;
		return [
			{ label: W.split.blast, value: Math.max(0, 1 - heat - prompt - residual), color: 'var(--c-blast)' },
			{ label: W.split.heat, value: heat, color: 'var(--c-burns)' },
			{ label: W.split.prompt, value: prompt, color: 'var(--c-radiation)' },
			{ label: W.split.residual, value: residual, color: 'var(--c-fallout)' }
		];
	});

	const dial = $derived.by(() => {
		if (!hasDial(b.weapon) || b.weapon.fission.length < 2) return null;
		const points: [number, number][] = [];
		for (let i = 0; i <= 40; i++) {
			const kt = b.weapon.minKt * Math.pow(b.weapon.maxKt / b.weapon.minKt, i / 40);
			points.push([kt, fissionFractionAt(b.weapon, kt)]);
		}
		return points;
	});

	// Range of the distance charts: out past everything that happens on this page.
	const outer = $derived(Math.max(r.rings.psi1, r.rings.thermal, r.rings.radiation, 0.05) * 1.15);

	const psiSeries = $derived.by<Series[]>(() => {
		const at = psiProfile(b.kt, b.hobM);
		const points: [number, number][] = [];
		for (let i = 1; i <= 140; i++) {
			const km = (i / 140) * outer;
			const p = at(km);
			if (p >= 0.3) points.push([km, F.pressureValue(p)]);
		}
		return [{ id: 'psi', label: W.psiY, color: 'var(--seq3)', points }];
	});

	const chanceSeries = $derived.by<Series[]>(() => {
		const at = psiProfile(b.kt, b.hobM);
		const blast: [number, number][] = [];
		const burns: [number, number][] = [];
		const rad: [number, number][] = [];
		const all: [number, number][] = [];
		for (let i = 0; i <= 200; i++) {
			const km = (i / 200) * outer;
			const f = directFractions(at(km), km, r.rings.thermal, r.rings.radiation);
			blast.push([km, f.blast]);
			burns.push([km, f.burns]);
			rad.push([km, f.radiation]);
			all.push([km, 1 - (1 - f.blast) * (1 - f.burns) * (1 - f.radiation)]);
		}
		return [
			{ id: 'all', label: W.chanceAll, color: 'var(--d-fg)', points: all, dash: '5 3' },
			{ id: 'blast', label: t.summary.causes.blast, color: CAUSE_COLOR.blast, points: blast },
			{ id: 'burns', label: t.summary.causes.burns, color: CAUSE_COLOR.burns, points: burns },
			{ id: 'rad', label: t.summary.causes.radiation, color: CAUSE_COLOR.radiation, points: rad }
		];
	});

	const optimum = $derived(optimumHobM(b.kt));
	const cutoffM = $derived(localFalloutHeightM(b.kt));
	const heightSeries = $derived.by<Series[]>(() => {
		const top = Math.min(29000, Math.max(optimum * 3, cutoffM * 1.4, b.hobM * 1.25, 50));
		const make = (psi: number): [number, number][] =>
			Array.from({ length: 61 }, (_, i) => {
				const h = (i / 60) * top;
				return [h / 1000, blastRangeKm(psi, b.kt, h)];
			});
		return [
			{ id: 'p1', label: W.yieldLabels.psi1, color: 'var(--seq1)', points: make(1) },
			{ id: 'p5', label: W.yieldLabels.psi5, color: 'var(--seq2)', points: make(5) },
			{ id: 'p20', label: W.yieldLabels.psi20, color: 'var(--seq3)', points: make(20) }
		];
	});

	const yieldRange = $derived<[number, number]>([Math.max(0.01, b.kt / 300), Math.min(1e7, b.kt * 300)]);
	const yieldSeries = $derived.by<Series[]>(() => {
		const [lo, hi] = yieldRange;
		const make = (psi: number): [number, number][] =>
			Array.from({ length: 41 }, (_, i) => {
				const kt = lo * Math.pow(hi / lo, i / 40);
				return [kt, blastRangeKm(psi, kt, Math.min(29000, b.hobM * Math.cbrt(kt / b.kt)))];
			});
		return [
			{ id: 'p1', label: W.yieldLabels.psi1, color: 'var(--seq1)', points: make(1) },
			{ id: 'p5', label: W.yieldLabels.psi5, color: 'var(--seq2)', points: make(5) },
			{ id: 'p20', label: W.yieldLabels.psi20, color: 'var(--seq3)', points: make(20) }
		];
	});

	const rows = $derived(r.falloutRows.filter((f) => f.band.runs.length));
	const decay = $derived<Series[]>([
		{
			id: 'rate',
			label: W.decayY,
			color: 'var(--c-fallout)',
			points: Array.from({ length: 50 }, (_, i) => {
				const h = Math.pow(10, (i / 49) * 3);
				return [h, 100 * Math.pow(h, -1.2)] as [number, number];
			})
		}
	]);
	const zones = $derived(r.zones.filter((z) => z.toKm > 0));
	const widest = $derived(Math.max(...zones.map((z) => z.toKm), 1e-3));
	const near = $derived(r.placesHit[0]);
	const heightNote = $derived(
		b.hobM === 0 ? W.heightSurface : r.coupling > 0 ? W.heightLow(F.km(cutoffM / 1000)) : W.heightAir(F.km(cutoffM / 1000))
	);
	const causeSegments = $derived(CAUSES.map((c) => ({ label: t.summary.causes[c], value: r.causes[c], color: CAUSE_COLOR[c] })));
</script>

<article class="panel">
	{#if near}<p class="aim">{W.aimed(F.km(near.km), placeName(near))}</p>{/if}

	<section>
		<h3>{W.sectionDevice}</h3>
		<div class="pair">
			<div>
				{#if facts?.outline}
					{#if render3d && LOOKS[b.weapon.id]}
						<WeaponView id={b.weapon.id} {facts} height={280} {grade} dragLabel={W.renderHint} desc={W.renderDesc} onunavailable={() => (render3d = false)} />
						<p class="small">{W.renderNote} {W.paint[b.weapon.id] ?? ''}</p>
					{/if}
					<WeaponProfile {facts} {F} labels={{ person: W.person, desc: W.profileDesc }} />
					<p class="small">{facts.drawn ? `${W.drawnAs[facts.drawn]} ` : ''}{W.outlineNote}</p>
				{:else}
					<p class="small">{W.noDrawing}</p>
				{/if}
			</div>
			<div>
				<p>{W.facts_[b.weapon.id]}</p>
				<dl class="facts">
					{#if facts?.lengthM}<div><dt>{W.facts.length}</dt><dd>{F.metres(facts.lengthM)}</dd></div>{/if}
					{#if facts?.diameterM}<div><dt>{W.facts.diameter}</dt><dd>{F.metres(facts.diameterM)}</dd></div>{/if}
					{#if facts?.massKg}
						<div><dt>{W.facts.mass}</dt><dd>{F.full(facts.massKg)} {F.lang === 'ru' ? 'кг' : 'kg'}{facts.massNote === 'conflict' ? ` (${W.massConflict})` : facts.massNote === 'approx' ? ` (${W.massApprox})` : ''}</dd></div>
					{/if}
					{#if facts}<div><dt>{W.facts.year}</dt><dd>{facts.year}</dd></div>{/if}
					{#if facts}<div><dt>{W.facts.confidence}</dt><dd><a href={facts.source} target="_blank" rel="noreferrer">{W.confidence[facts.confidence]}</a></dd></div>{/if}
				</dl>
			</div>
		</div>
	</section>

	<section>
		<h3>{W.sectionEnergy}</h3>
		<p>{W.yieldLine(F.kt(b.kt), W.tons(F.full(tons)), F.sig(r.hiroshimas, 2))}</p>
		<div class="pair">
			<div>
				<h4>{W.fissionHead}</h4>
				<SplitBar
					segments={[
						{ label: W.fission, value: r.fissionKt, color: 'var(--c-fallout)', text: F.kt(r.fissionKt) },
						{ label: W.fusion, value: r.fusionKt, color: 'var(--c-radiation)', text: F.kt(r.fusionKt) }
					]}
					fmtShare={F.pct}
					desc={W.fissionHead}
				/>
				<p class="small">{W.fissionBody(F.pct(r.fissionShare))}{b.weapon.salted ? ` ${W.salted(F.num(b.weapon.salted))}` : ''}</p>
			</div>
			<div>
				<h4>{W.splitHead}</h4>
				<SplitBar segments={energy} fmtShare={F.pct} desc={W.splitHead} />
				<p class="small">{W.splitBody}</p>
			</div>
		</div>
		{#if dial}
			<h4>{W.dialHead}</h4>
			<p class="small">{W.dialBody}</p>
			<Plot
				series={[{ id: 'f', label: W.dialY, color: 'var(--c-fallout)', points: dial }]}
				xLog
				xLabel={W.dialX}
				yLabel={W.dialY}
				xFmt={F.kt}
				yFmt={pctFmt}
				yDomain={[0, 1]}
				dots={[{ x: b.kt, y: r.fissionShare, label: W.youSet }]}
				height={220}
				desc={W.dialHead}
			/>
		{/if}
	</section>

	{#if r.exo}
		<section>
			<h3>{W.sectionExo}</h3>
			{#key r.index}<ExoScene {r} {F} text={W.exoScene} {grade} />{/key}
			<ExoView {r} {F} labels={W.exoLabels} />
			<p>{W.exoBody}</p>
			<p>{W.exoCoupling(F.pct(r.fissionShare))}</p>
			<ExoCoupling {r} {F} labels={W.exoChart} />
			<p><b>{r.rings.thermal > 0 ? W.exoBurns(F.km(r.rings.thermal)) : W.exoNoBurns(r.exoHeat[0].cal.toPrecision(2), r.burnCal.toFixed(0))}</b></p>
			<p>{W.exoLimit}</p>
			<p>{W.exoStarfish}</p>
			<p><b>{W.exoPeople(F.count(r.empPop))}</b></p>
		</section>
	{:else}
		<section>
			<h3>{W.sectionSide}</h3>
			<p>{W.sideBody}</p>
			{#key r.index}<SideView {r} {F} text={W.side} {precip} {grade} />{/key}
		</section>

		<section>
			<h3>{W.sectionWalk}</h3>
			<p>{W.walkBody}</p>
			<div class="scroll">
				<table class="dt">
					<thead>
						<tr>
							<th>{W.walkCols.ring}</th><th>{W.walkCols.reach}</th><th>{W.walkCols.arrives}</th><th>{W.walkCols.wind}</th><th>{W.walkCols.what}</th>
							<th class="n">{W.walkCols.people}</th><th class="n">{W.walkCols.dead}</th><th class="n">{W.walkCols.buildings}</th>
						</tr>
					</thead>
					<tbody>
						{#each zones as z (z.psi)}
							<tr>
								<td class="nw"><b>{F.psi(z.psi)}</b></td>
								<td class="nw">
									{F.km(z.toKm)}
									<span class="range"><i style:width={`${(z.toKm / widest) * 100}%`}></i></span>
								</td>
								<td class="nw">{F.time(z.arrivalS)}</td>
								<td class="nw">{F.wind(z.windMs)}</td>
								<td class="wide">{W.walkWhat[z.psi]}</td>
								<td class="n">{F.count(z.pop)}</td>
								<td class="n">{F.count(z.deaths)}</td>
								<td class="n">{F.count(z.structures)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<p>{W.beyond(F.km(r.rings.thermal), F.km(r.rings.radiation), F.sig(r.burnCal, 2))}</p>
		</section>

		<section>
			<h3>{W.firstHead}</h3>
			<div class="pair">
				<div>
					<h4>{W.psiHead}</h4>
					<Plot
						series={psiSeries}
						yLog
						xLabel={W.psiX}
						yLabel={`${W.psiY}, ${F.pressureUnit}`}
						xFmt={F.km}
						yFmt={psiAxis}
						markers={[
							{ x: r.rings.psi5, label: W.yieldLabels.psi5 },
							{ x: r.rings.psi1, label: W.yieldLabels.psi1 }
						]}
						area
						desc={W.psiHead}
					/>
					<p class="small">{W.psiBody}</p>
				</div>
				<div>
					<h4>{W.chanceHead}</h4>
					<Plot series={chanceSeries} xLabel={W.chanceX} yLabel={W.chanceY} xFmt={F.km} yFmt={pctFmt} yDomain={[0, 1]} desc={W.chanceHead} />
					<p class="small">{W.chanceBody}</p>
				</div>
			</div>
			<h4>{W.distHead}</h4>
			<DistanceBars bins={r.bins} {F} labels={{ pop: W.distPop, deaths: W.distDead, x: W.distX, y: W.distY }} desc={W.distHead} />
			<p class="small">{W.distBody}</p>
			<div class="pair">
				<div>
					<h4>{W.heightHead}</h4>
					<Plot
						series={heightSeries}
						xLabel={W.heightX}
						yLabel={W.heightY}
						xFmt={F.km}
						yFmt={F.km}
						markers={[
							{ x: b.hobM / 1000, label: W.heightYou, color: 'var(--d-accent)' },
							{ x: optimum / 1000, label: W.heightOptimum },
							{ x: cutoffM / 1000, label: W.heightCutoff, color: 'var(--c-fallout)' }
						]}
						desc={W.heightHead}
					/>
					<p class="small">{W.heightBody}</p>
					<p class="small"><b>{heightNote}</b></p>
				</div>
				<div>
					<h4>{W.yieldHead}</h4>
					<Plot
						series={yieldSeries}
						xLog
						yLog
						xLabel={W.yieldX}
						yLabel={W.yieldY}
						xFmt={F.kt}
						yFmt={F.km}
						dots={[{ x: b.kt, y: r.rings.psi5, label: W.yieldYou }]}
						desc={W.yieldHead}
					/>
					<p class="small">{W.yieldBody(F.pct(Math.cbrt(2) - 1))}</p>
				</div>
			</div>
		</section>

		<section>
			<h3>{W.sectionFallout}</h3>
			{#if rows.length}
				<p>{W.falloutBody}</p>
				<FalloutPlan {r} {F} labels={{ gz: W.gz, wind: W.wind, blast: W.blastRing, desc: W.falloutDesc }} />
				<div class="scroll">
					<table class="dt">
						<thead>
							<tr>
								<th>{W.falloutCols.rate}</th><th>{W.falloutCols.length}</th><th>{W.falloutCols.width}</th><th>{W.falloutCols.area}</th>
								<th class="n">{W.falloutCols.people}</th><th class="n">{W.falloutCols.dose}</th>
							</tr>
						</thead>
						<tbody>
							{#each rows as row (row.rate)}
								<tr>
									<td class="nw"><b>{F.rate(row.rate)}</b></td>
									<td class="nw">{F.km(row.band.length)}</td>
									<td class="nw">{F.km(row.band.width)}</td>
									<td class="nw">{F.area(row.areaKm2)}</td>
									<td class="n">{F.count(row.pop)}</td>
									<td class="n">{F.dose(row.sampleDose)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
				<p>
					{W.falloutWhy(
						F.pct(r.fissionShare),
						F.pct(r.coupling),
						F.wind((r.winds.cap * 1.609344) / 3.6),
						F.wind((r.winds.stem * 1.609344) / 3.6),
						F.km(r.cloud.centreKm + r.cloud.halfThicknessKm),
						r.rainout > 0 ? W.rainSome(F.pct(r.rainout)) : W.rainNone
					)}
				</p>
				<p><b>{W.falloutDeaths(F.count(r.falloutDeaths))}</b></p>
				<div class="pair">
					<div>
						<h4>{W.decayHead}</h4>
						<Plot
							series={decay}
							xLog
							yLog
							xLabel={W.decayX}
							yLabel={`${W.decayY}, ${F.rateUnit}`}
							xFmt={(v) => F.sig(v, 2)}
							yFmt={(v) => F.sig(v, 2)}
							markers={[{ x: 7, label: '7' }, { x: 49, label: '49' }, { x: 336, label: '336' }]}
							height={240}
							desc={W.decayHead}
						/>
						<p class="small">{W.decayBody}</p>
					</div>
					<div>
						<h4>{W.doseHead}</h4>
						<table class="dt">
							<thead><tr><th>{W.doseCols.dose}</th><th>{W.doseCols.what}</th></tr></thead>
							<tbody>
								{#each W.doseRows as [dose, what] (dose)}
									<tr><td class="nw"><b>{dose}</b></td><td>{what}</td></tr>
								{/each}
							</tbody>
						</table>
						<p class="small">{W.doseNote}</p>
					</div>
				</div>
			{:else}
				<p>{W.noFallout(F.km(cutoffM / 1000))}</p>
			{/if}
		</section>

		<section>
			<h3>{W.sectionContribution}</h3>
			<div class="tiles">
				<div><b>{F.count(r.deaths)}</b><span>{W.contribution.share}</span></div>
				<div><b>{F.count(r.soloDeaths)}</b><span>{W.contribution.alone}</span></div>
				<div><b>{F.count(r.marginalDeaths)}</b><span>{W.contribution.adds}</span></div>
				<div><b>{F.count(r.deaths / Math.max(b.kt, 1e-3))}</b><span>{W.contribution.perKt}</span></div>
				<div><b>{F.count(r.soloStructures)}</b><span>{W.contribution.structures}</span></div>
			</div>
			{#if r.deaths > 0.5}
				<h4>{W.causesOf}</h4>
				<SplitBar segments={causeSegments} fmtShare={F.pct} desc={W.causesOf} />
			{/if}
		</section>
	{/if}
</article>

<style>
	.aim {
		color: var(--d-dim);
	}
	section {
		margin-top: 30px;
	}
	.pair {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 340px), 1fr));
		gap: 22px 30px;
		margin-top: 8px;
	}
	.pair > div {
		min-width: 0;
	}
	.small {
		font-size: 13.5px;
		color: var(--d-soft);
	}
	.facts {
		margin: 8px 0 0;
		display: grid;
		gap: 2px;
		font-size: 14px;
	}
	.facts div {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		padding: 3px 0;
		border-bottom: 1px solid var(--d-rule);
	}
	.facts dt {
		color: var(--d-soft);
	}
	.facts dd {
		margin: 0;
		text-align: right;
		font-weight: 700;
	}
	.scroll {
		overflow-x: auto;
	}
	.range {
		display: block;
		width: 80px;
		height: 5px;
		margin-top: 4px;
		background: var(--d-rule);
	}
	.range i {
		display: block;
		height: 100%;
		background: var(--seq3);
	}
	.wide {
		min-width: 220px;
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px;
		margin: 10px 0;
	}
	.tiles div {
		display: flex;
		flex-direction: column;
		padding: 10px 12px;
		border: 1px solid var(--d-rule);
	}
	.tiles b {
		font-size: 22px;
		font-family: var(--d-head);
	}
	.tiles span {
		font-size: 12.5px;
		color: var(--d-soft);
	}
</style>
