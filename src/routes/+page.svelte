<script lang="ts">
	import { onMount } from 'svelte';
	import { asset } from '$app/paths';
	import { boardFor } from '#lib/game/board.ts';
	import { hobFromSlider, hobToSlider, ktFromSlider, ktToSlider, SLIDER_MAX } from '#lib/game/controls.ts';
	import { loadTheatre, type TheatreData } from '#lib/game/data.ts';
	import { assessDifficulty, type Difficulty } from '#lib/game/difficulty.ts';
	import { optimumHobM, ringsFor } from '#lib/game/effects.ts';
	import { dayNumber, generate, theatreIdForDay } from '#lib/game/generator.ts';
	import {
		conditionTexts,
		evaluate,
		fmtScore,
		hobFor,
		OBJECTIVE_TITLE,
		objectiveText,
		rankFor,
		SCORE_UNIT,
		toBurst,
		type Outcome,
		type Placement,
		type Scenario
	} from '#lib/game/scenario.ts';
	import type { Sim } from '#lib/game/sim.ts';
	import {
		hasSeenOrders,
		loadHistory,
		loadRun,
		markOrdersSeen,
		saveResult,
		saveRun,
		statsFrom,
		type HistoryEntry
	} from '#lib/game/storage.ts';
	import { formatYield, hasDial, type Weapon } from '#lib/game/weapons.ts';
	import Scope from '#lib/ui/Scope.svelte';

	let scenario = $state.raw<Scenario | null>(null);
	let data = $state.raw<TheatreData | null>(null);
	let sim: Sim | null = null;
	let solution: Placement[] = [];
	let difficulty = $state.raw<Difficulty | null>(null);
	let loadError = $state<string | null>(null);
	let practice = $state(false);

	let placements = $state<Placement[]>([]);
	let selected = $state<number | null>(0);
	let wargamesUsed = $state(0);
	let lastRun = $state.raw<Outcome | null>(null);
	let final = $state.raw<Outcome | null>(null);
	let damage = $state.raw<Float32Array | null>(null);
	let playToken = $state(0);
	let pendingFinal = $state.raw<Outcome | null>(null);
	let coverOpen = $state(false);
	let history = $state.raw<HistoryEntry[]>([]);
	let showOrders = $state(false);
	let showRings = $state(true);
	let showFallout = $state(true);
	let showDensity = $state(true);
	let copied = $state(false);

	const stats = $derived(statsFrom(history));
	const finished = $derived(final !== null);
	const conditions = $derived(scenario ? conditionTexts(scenario) : []);
	const selectedWeapon = $derived<Weapon | null>(scenario && selected !== null ? scenario.arsenal[selected] : null);
	const selectedPlacement = $derived(placements.find((p) => p.slot === selected) ?? null);
	const board = $derived(
		scenario && final ? boardFor(scenario, { value: final.value, passed: final.passed }) : []
	);
	const canRun = $derived(placements.length > 0 && !finished && pendingFinal === null);

	const selectedBurst = $derived(
		scenario && selectedPlacement ? toBurst(scenario, selectedPlacement) : null
	);
	const selectedRings = $derived(
		scenario && selectedBurst
			? ringsFor(selectedBurst.weapon, selectedBurst.kt, selectedBurst.hobM, scenario.weather)
			: null
	);

	onMount(async () => {
		try {
			const params = new URLSearchParams(location.search);
			const requested = Number(params.get('day'));
			const today = dayNumber(new Date());
			const day = requested >= 1 ? requested : today;
			practice = day !== today;
			const loaded = await loadTheatre(theatreIdForDay(day), fetch, (file) => asset(file as Parameters<typeof asset>[0]));
			await new Promise((r) => setTimeout(r, 30));
			const generated = generate(day, loaded);
			sim = generated.sim;
			solution = generated.solution;
			data = loaded;
			scenario = generated.scenario;
			history = loadHistory();
			const saved = practice ? null : loadRun(day);
			if (saved) {
				placements = saved.placements;
				wargamesUsed = saved.wargamesUsed;
				if (saved.done) {
					const cells = new Float32Array(loaded.grid.n);
					final = evaluate(generated.scenario, generated.sim, saved.placements, cells);
					damage = cells;
					difficulty = assessDifficulty(generated.scenario, generated.sim, generated.solution);
				}
			}
			if (!hasSeenOrders()) showOrders = true;
		} catch (err) {
			loadError = err instanceof Error ? err.message : String(err);
		}
	});

	function persist(done = false) {
		if (!scenario || practice) return;
		saveRun({ day: scenario.day, wargamesUsed, done, placements });
	}

	/** The damage overlay shows the last wargame, so it goes once the plan moves on. */
	function planChanged() {
		damage = null;
		persist();
	}

	const defaultHob = (w: Weapon, kt: number) => (w.surfaceOnly ? 0 : optimumHobM(kt));

	function place(lat: number, lon: number) {
		if (!scenario || finished) return;
		const free = selected !== null && !placements.some((p) => p.slot === selected) ? selected : null;
		if (free === null) {
			if (selected !== null) move(selected, lat, lon);
			return;
		}
		const w = scenario.arsenal[free];
		placements.push({ slot: free, lat, lon, kt: w.maxKt, hobM: defaultHob(w, w.maxKt) });
		const next = scenario.arsenal.findIndex((_, i) => !placements.some((p) => p.slot === i));
		selected = next >= 0 ? next : free;
		planChanged();
	}

	function move(slot: number, lat: number, lon: number) {
		const p = placements.find((x) => x.slot === slot);
		if (!p || finished) return;
		p.lat = lat;
		p.lon = lon;
		planChanged();
	}

	function remove(slot: number) {
		if (finished) return;
		placements = placements.filter((p) => p.slot !== slot);
		selected = slot;
		planChanged();
	}

	function setKt(v: number) {
		if (selectedPlacement && selectedWeapon) {
			selectedPlacement.kt = ktFromSlider(selectedWeapon, v);
			planChanged();
		}
	}

	function setHob(m: number) {
		if (selectedPlacement) {
			selectedPlacement.hobM = m;
			planChanged();
		}
	}

	function runWargame() {
		if (!scenario || !sim || !canRun || wargamesUsed >= scenario.wargames) return;
		wargamesUsed++;
		const cells = new Float32Array(sim.grid.n);
		lastRun = evaluate(scenario, sim, placements, cells);
		damage = cells;
		persist();
	}

	function execute() {
		if (!scenario || !sim || !canRun || !coverOpen) return;
		const cells = new Float32Array(sim.grid.n);
		const out = evaluate(scenario, sim, placements, cells);
		damage = null;
		lastRun = null;
		pendingFinal = out;
		pendingCells = cells;
		coverOpen = false;
		playToken++;
	}

	let pendingCells: Float32Array | null = null;

	function strikePlayed() {
		if (!pendingFinal || !scenario) return;
		final = pendingFinal;
		damage = pendingCells;
		if (sim) difficulty = assessDifficulty(scenario, sim, solution);
		pendingFinal = null;
		persist(true);
		if (!practice) {
			saveResult({
				day: scenario.day,
				rating: final.rating,
				passed: final.passed,
				value: final.value,
				wargames: wargamesUsed
			});
			history = loadHistory();
		}
	}

	function shareText(s: Scenario, o: Outcome) {
		const used = s.arsenal.map((_, i) => (placements.some((p) => p.slot === i) ? '☢' : '·')).join('');
		const games = '▮'.repeat(wargamesUsed) + '▯'.repeat(s.wargames - wargamesUsed);
		const meters = Math.max(0, Math.min(10, Math.round(o.rating / 10)));
		const bar = '█'.repeat(meters) + '░'.repeat(10 - meters);
		const score = o.passed ? `${fmtScore(s, o.value)} ${SCORE_UNIT[s.kind]}` : 'MISSION FAILED';
		return [
			`NUCLE №${s.day} — ${s.theatre.name}`,
			OBJECTIVE_TITLE[s.kind] + (difficulty ? ` · ${difficulty.label} ${difficulty.score}` : ''),
			`${bar} ${o.rating}`,
			score,
			`WARHEADS ${used}`,
			`WARGAMES ${games}`,
			rankFor(o.rating)
		].join('\n');
	}

	async function share() {
		if (!scenario || !final) return;
		await navigator.clipboard.writeText(shareText(scenario, final));
		copied = true;
		setTimeout(() => (copied = false), 1800);
	}

	function closeOrders() {
		showOrders = false;
		markOrdersSeen();
	}

	const hobLabel = (m: number) =>
		m === 0 ? 'SURFACE' : m >= 10000 ? `${(m / 1000).toFixed(0)} KM` : `${m} M`;
	const km = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));
	const pad = (n: number) => String(n).padStart(3, '0');
	const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<main class="room">
	{#if loadError}
		<section class="status">
			<h1>TRANSMISSION FAILURE</h1>
			<p>{loadError}</p>
		</section>
	{:else if !scenario || !data}
		<section class="status">
			<h1>NUCLE</h1>
			<p class="blink">COMPUTING DAILY EXERCISE</p>
		</section>
	{:else}
		<div class="console">
			<header class="plate">
				<div class="title">
					<strong>NUCLE</strong>
					<span>WEAPONS DIRECTOR CONSOLE · TYPE OA-1008/N</span>
				</div>
				<div class="serial">
					<span>EXERCISE № {pad(scenario.day)}{practice ? ' · ARCHIVE, NOT SCORED' : ''}</span>
					<span>{scenario.date} · {scenario.theatre.name}</span>
				</div>
				<div class="tally">
					<span>STREAK <b>{stats.streak}</b></span>
					<span>PLAYED <b>{stats.played}</b></span>
					<span>BEST <b>{stats.best}</b></span>
					<button class="key small" onclick={() => (showOrders = true)}>ORDERS</button>
				</div>
			</header>

			<section class="scope-bay">
				<div class="bezel">
					<i class="screw tl"></i><i class="screw tr"></i><i class="screw bl"></i><i class="screw br"></i>
					<Scope
						{scenario}
						meta={data.meta}
						grid={data.grid}
						{placements}
						{selected}
						{damage}
						{showRings}
						{showFallout}
						{showDensity}
						locked={finished || pendingFinal !== null}
						{playToken}
						onplace={place}
						onmove={move}
						onselect={(s) => (selected = s)}
						onplayed={strikePlayed}
					/>
				</div>
				<div class="switches">
					<button class="key" class:lit={showRings} onclick={() => (showRings = !showRings)}>RINGS</button>
					<button class="key" class:lit={showFallout} onclick={() => (showFallout = !showFallout)}>FALLOUT</button>
					<button class="key" class:lit={showDensity} onclick={() => (showDensity = !showDensity)}>POPULATION</button>
				</div>
			</section>

			<aside class="desk">
				<section class="teletype">
					<div class="roll">
						<p class="head">+++ OPERATIONAL ORDER {pad(scenario.day)} +++</p>
						<p><b>{OBJECTIVE_TITLE[scenario.kind]}</b> / {scenario.theatre.name}</p>
						<p>{objectiveText(scenario)}</p>
						{#if conditions.length}
							<p class="head">CONDITIONS</p>
							<ul>
								{#each conditions as c (c)}<li>{c}</li>{/each}
							</ul>
						{/if}
						<p class="head">WEATHER</p>
						<p>
							{scenario.weather.precip}. WIND TOWARD {String(scenario.weather.windBearing).padStart(3, '0')}° AT
							{scenario.weather.windKmh} KM/H.
						</p>

						{#if lastRun && !final}
							<p class="head">WARGAME {wargamesUsed} OF {scenario.wargames}</p>
							<p>
								{SCORE_UNIT[scenario.kind]}: <b>{fmtScore(scenario, lastRun.value)}</b>
							</p>
							<ul class="checks">
								{#each lastRun.checks as c (c.label)}
									<li class:bad={!c.ok}>{c.ok ? 'PASS' : 'FAIL'} {c.label} {c.detail}</li>
								{/each}
							</ul>
						{/if}

						{#if final}
							<p class="head">+++ STRIKE REPORT +++</p>
							<p class="verdict" class:bad={!final.passed}>
								{final.passed ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED'}
							</p>
							<p>
								RATING <b>{final.rating}</b> · {rankFor(final.rating)}<br />
								{SCORE_UNIT[scenario.kind]}: <b>{fmtScore(scenario, final.value)}</b><br />
								FATALITIES {fmtScore({ kind: 'fatalities' }, final.tally.fatalities)} ·
								STRUCTURES {fmtScore({ kind: 'structures' }, final.tally.structures)}
							</p>
							<ul class="checks">
								{#each final.checks as c (c.label)}
									<li class:bad={!c.ok}>{c.ok ? 'PASS' : 'FAIL'} {c.label} {c.detail}</li>
								{/each}
							</ul>
							{#if difficulty}
								<p class="head">EXERCISE DIFFICULTY</p>
								<p class="verdict">{difficulty.score}/100 · {difficulty.label}</p>
								<ul>
									<li>PLAUSIBLE PLANS THAT SUCCEEDED: {pct(difficulty.planPass)}</li>
									<li>THEIR TYPICAL PROGRESS: {pct(difficulty.planProgress)}</li>
									<li>ESTIMATE SURVIVES AIM ERROR: {pct(difficulty.tolerance)}</li>
									<li>CONDITIONS IMPOSED: {difficulty.conditions}</li>
								</ul>
							{/if}
							<p class="head">DAILY BOARD, SIMULATED WINGS</p>
							<ol class="board">
								{#each board as row (row.name)}
									<li class:you={row.you}>
										<span>{row.name}</span>
										<span>{row.failed ? 'FAILED' : fmtScore(scenario, row.value)}</span>
									</li>
								{/each}
							</ol>
						{/if}
					</div>
				</section>

				{#if final}
					<section class="actions">
						<button class="key lit wide" onclick={share}>{copied ? 'COPIED TO CLIPBOARD' : 'COPY RESULT'}</button>
						<p class="engrave">NEXT EXERCISE AT 0000 LOCAL</p>
					</section>
				{:else}
					<section class="rack">
						<h2>WARHEAD SELECT</h2>
						<div class="keys">
							{#each scenario.arsenal as w, i (i)}
								{@const set = placements.some((p) => p.slot === i)}
								<button
									class="key warhead"
									class:lit={selected === i}
									class:armed={set}
									onclick={() => (selected = i)}
									title={`${w.name}, ${w.note}`}
								>
									<span class="no">{String(i + 1).padStart(2, '0')}</span>
									<span class="nm">{w.id.toUpperCase()}</span>
									<span class="yd">{formatYield(w.maxKt)}</span>
								</button>
							{/each}
						</div>
					</section>

					{#if selectedWeapon}
						<section class="dials">
							<div class="dial-head">
								<div>
									<strong>{selectedWeapon.name}</strong>
									<span>{selectedWeapon.note}{selectedWeapon.theoretical ? ' · THEORETICAL' : ''}</span>
								</div>
								{#if selectedPlacement}
									<button class="key small" onclick={() => selected !== null && remove(selected)}>DISARM</button>
								{/if}
							</div>

							{#if !selectedPlacement}
								<p class="prompt">AIM LIGHT GUN AT THE DISPLAY TO ASSIGN GROUND ZERO</p>
							{:else if selectedBurst}
								<label class="dial">
									<span>YIELD</span>
									<input
										type="range"
										min="0"
										max={SLIDER_MAX}
										disabled={!hasDial(selectedWeapon) || scenario.yieldLock}
										value={ktToSlider(selectedWeapon, selectedBurst.kt)}
										oninput={(e) => setKt(+e.currentTarget.value)}
									/>
									<output>{formatYield(selectedBurst.kt)}</output>
								</label>
								<label class="dial">
									<span>HEIGHT</span>
									<input
										type="range"
										min="0"
										max={SLIDER_MAX}
										disabled={selectedWeapon.surfaceOnly || !!scenario.hobLock}
										value={hobToSlider(hobFor(scenario, selectedWeapon, selectedBurst.kt, selectedPlacement.hobM))}
										oninput={(e) => setHob(hobFromSlider(+e.currentTarget.value))}
									/>
									<output>{hobLabel(selectedBurst.hobM)}</output>
								</label>
								{#if !selectedWeapon.surfaceOnly && !scenario.hobLock}
									<div class="presets">
										<button class="key small" onclick={() => setHob(0)}>SURFACE</button>
										<button class="key small" onclick={() => setHob(optimumHobM(selectedBurst.kt))}>OPTIMUM</button>
										<button class="key small" onclick={() => setHob(100000)}>EXO 100 KM</button>
										<button class="key small" onclick={() => setHob(400000)}>EXO 400 KM</button>
									</div>
								{/if}
								{#if selectedRings}
									<dl class="radii">
										<div><dt>20 PSI</dt><dd>{km(selectedRings.psi20)}</dd></div>
										<div><dt>5 PSI</dt><dd>{km(selectedRings.psi5)}</dd></div>
										<div><dt>1 PSI</dt><dd>{km(selectedRings.psi1)}</dd></div>
										<div><dt>BURNS</dt><dd>{km(selectedRings.thermal)}</dd></div>
									</dl>
								{/if}
							{/if}
						</section>
					{/if}

					<section class="commit">
						<div class="wargame">
							<button
								class="key wide"
								disabled={!canRun || wargamesUsed >= scenario.wargames}
								onclick={runWargame}>RUN WARGAME</button
							>
							<div class="lamps" aria-label="{scenario.wargames - wargamesUsed} wargames left">
								{#each Array(scenario.wargames) as _, i (i)}
									<i class:on={i >= wargamesUsed}></i>
								{/each}
							</div>
						</div>
						<div class="guard" class:open={coverOpen}>
							<button class="fire" disabled={!canRun || !coverOpen} onclick={execute}>EXECUTE</button>
							<button
								class="cover"
								disabled={!canRun}
								aria-pressed={coverOpen}
								onclick={() => (coverOpen = !coverOpen)}
							>
								{coverOpen ? 'CLOSE' : 'LIFT COVER'}
							</button>
						</div>
					</section>
				{/if}
			</aside>
		</div>
	{/if}

	{#if showOrders}
		<div class="overlay" role="dialog" aria-modal="true" aria-label="Standing orders">
			<div class="slip">
				<p class="head">+++ STANDING ORDERS +++</p>
				<p>ONE EXERCISE A DAY. THE SAME MAP, WARHEADS AND WEATHER FOR EVERYONE.</p>
				<ol>
					<li>READ THE ORDER. OBJECTIVES CHANGE DAILY: FATALITIES, STRUCTURES, FALLOUT, EMP, COUNTERFORCE, LEAST YIELD, SURGICAL.</li>
					<li>SELECT A WARHEAD, THEN CLICK THE DISPLAY TO SET GROUND ZERO. DRAG TO MOVE IT. THE ARROWS AND + / - BESIDE THE DISPLAY MOVE AND ZOOM THE MAP.</li>
					<li>SET YIELD AND HEIGHT. SURFACE BURSTS MAKE FALLOUT. AIRBURSTS REACH FURTHER. ABOVE 30 KM IS EMP ONLY.</li>
					<li>YOU GET THREE WARGAMES, WHICH REVEAL THE NUMBERS. THEN LIFT THE COVER AND EXECUTE. YOU ONLY EXECUTE ONCE.</li>
				</ol>
				<p class="fine">
					EFFECTS ARE SIMPLIFIED FROM PUBLIC FIGURES IN GLASSTONE &amp; DOLAN AND OTA 1979. POPULATION: GHS-POP R2023A, BUILT-UP:
					GHS-BUILT-S R2023A, EUROPEAN COMMISSION JRC, CC BY 4.0. STRUCTURE COUNTS ARE ESTIMATED FROM BUILT AREA. MAPS: NATURAL
					EARTH, STREETS AND BUILDINGS © OPENSTREETMAP CONTRIBUTORS VIA OPENFREEMAP AND OPENMAPTILES, STREAMED AS YOU ZOOM. THE BOARD IS SIMULATED FROM THE COMMAND ESTIMATE, THERE IS NO SERVER.
				</p>
				<button class="key lit wide" onclick={closeOrders}>ACKNOWLEDGE</button>
			</div>
		</div>
	{/if}
</main>

<style>
	.room {
		min-height: 100dvh;
		padding: clamp(0px, 1.4vw, 20px);
		background:
			radial-gradient(ellipse 90% 70% at 40% 40%, #15263a 0%, #0a121d 55%, #05080d 100%);
	}
	.status {
		display: grid;
		place-content: center;
		min-height: 90dvh;
		text-align: center;
		font-family: var(--crt);
		color: var(--phosphor);
		text-shadow: 0 0 10px rgba(134, 247, 176, 0.6);
		letter-spacing: 0.1em;
	}
	.status h1 {
		font-size: 3rem;
		margin: 0 0 8px;
		font-weight: 400;
	}
	.blink {
		animation: blink 1.1s steps(2, jump-none) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.35;
		}
	}

	/* The console: painted steel with a hammertone finish, lit from above. */
	.console {
		--hammer: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .34 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E");
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(360px, 430px);
		grid-template-rows: auto 1fr;
		gap: 12px;
		max-width: 1500px;
		margin: 0 auto;
		padding: 12px;
		border-radius: 6px;
		background: var(--hammer), linear-gradient(180deg, #5a6a6a, #3f4c50 70%, #333e43);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.28),
			inset 0 -2px 0 rgba(0, 0, 0, 0.45),
			0 20px 60px rgba(0, 0, 0, 0.7);
	}

	.plate {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 24px;
		padding: 8px 14px;
		border: 1px solid rgba(0, 0, 0, 0.5);
		border-radius: 3px;
		background: linear-gradient(180deg, #2c3438, #22292d);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1);
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 14px;
	}
	.title strong {
		font-size: 30px;
		font-weight: 600;
		letter-spacing: 0.32em;
		color: var(--legend);
		text-shadow: 0 -1px 0 #000;
	}
	.title span,
	.serial span,
	.tally span {
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.14em;
		color: var(--legend-dim);
	}
	.serial {
		display: flex;
		flex-direction: column;
		font-variant-numeric: tabular-nums;
	}
	.tally {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	.tally b {
		font: 16px var(--crt);
		color: var(--amber);
		text-shadow: 0 0 6px rgba(255, 194, 74, 0.6);
	}

	.scope-bay {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.bezel {
		position: relative;
		width: min(100%, calc(100dvh - 100px));
		min-width: 280px;
		padding: clamp(14px, 2.4vw, 34px);
		border-radius: 8px;
		background: var(--hammer), linear-gradient(145deg, #4d5b5b, #2e383c);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.22),
			inset 0 0 0 1px rgba(0, 0, 0, 0.5),
			0 2px 6px rgba(0, 0, 0, 0.6);
	}
	.screw {
		position: absolute;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background:
			linear-gradient(35deg, transparent 44%, #1a1f21 45% 55%, transparent 56%),
			radial-gradient(circle at 35% 30%, #9aa5a2, #4a5354);
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.7);
	}
	.tl { top: 8px; left: 8px; }
	.tr { top: 8px; right: 8px; }
	.bl { bottom: 8px; left: 8px; }
	.br { bottom: 8px; right: 8px; }

	.switches {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
	}

	/* Backlit square pushbuttons with engraved legends. */
	.key {
		appearance: none;
		min-height: 40px;
		padding: 6px 12px;
		border: 1px solid #14191b;
		border-radius: 2px;
		font: 600 14px var(--engraved);
		letter-spacing: 0.12em;
		color: #c9cdbb;
		cursor: pointer;
		background: linear-gradient(180deg, #4a5252, #2d3334);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.2),
			0 2px 0 #0e1213,
			0 3px 4px rgba(0, 0, 0, 0.5);
		transition: transform 60ms, box-shadow 60ms, background 120ms, color 120ms;
	}
	.key:hover:not(:disabled) {
		color: #fff;
	}
	.key:active:not(:disabled) {
		transform: translateY(2px);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.12),
			0 0 0 #0e1213;
	}
	.key:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.key.small {
		min-height: 30px;
		padding: 3px 9px;
		font-size: 13px;
	}
	.key.wide {
		width: 100%;
	}
	.key.lit {
		color: #2a1b00;
		background: radial-gradient(ellipse at 50% 40%, #ffe9a8, #ffc24a 60%, #d48f1e);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.6),
			0 2px 0 #0e1213,
			0 0 16px rgba(255, 194, 74, 0.55);
	}

	.desk {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
	}

	/* A roll of teletype paper feeding out of a slot in the panel. */
	.teletype {
		padding: 0 14px;
		border-radius: 3px;
		background: linear-gradient(180deg, #181d20, #101416);
		box-shadow: inset 0 2px 8px rgba(0, 0, 0, 0.8);
	}
	.roll {
		max-height: clamp(180px, 34dvh, 420px);
		overflow-y: auto;
		padding: 12px 14px 16px;
		background:
			repeating-linear-gradient(180deg, transparent 0 25px, rgba(60, 90, 70, 0.08) 25px 26px),
			var(--paper);
		color: var(--ink);
		font: 14px/1.45 var(--tty);
		box-shadow: inset 0 10px 10px -8px rgba(0, 0, 0, 0.6);
	}
	.roll p {
		margin: 0 0 8px;
	}
	.roll ul,
	.roll ol {
		margin: 0 0 8px;
		padding: 0;
		list-style: none;
	}
	.roll .head {
		margin-top: 10px;
		font-weight: 700;
	}
	.roll .head:first-child {
		margin-top: 0;
	}
	.checks .bad,
	.verdict.bad {
		color: #a21c00;
		font-weight: 700;
	}
	.verdict {
		font-size: 18px;
		font-weight: 700;
	}
	.board li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
	}
	.board .you {
		font-weight: 700;
		background: var(--ink);
		color: var(--paper);
		padding: 0 4px;
		margin: 0 -4px;
	}

	.rack,
	.dials,
	.commit,
	.actions {
		padding: 10px 12px;
		border: 1px solid rgba(0, 0, 0, 0.45);
		border-radius: 3px;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
	}
	.rack h2,
	.engrave {
		margin: 0 0 8px;
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.18em;
		color: var(--legend-dim);
		text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.7);
	}
	.engrave {
		margin: 8px 0 0;
		text-align: center;
	}
	.keys {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
		gap: 7px;
	}
	.warhead {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		min-height: 58px;
		padding: 4px 3px;
		letter-spacing: 0.06em;
	}
	.warhead .no {
		align-self: flex-start;
		font: 10px var(--crt);
		opacity: 0.7;
	}
	.warhead .nm {
		font-size: 15px;
		line-height: 1;
	}
	.warhead .yd {
		font: 12px var(--crt);
		letter-spacing: 0;
		margin-top: 3px;
	}
	.warhead.armed:not(.lit) {
		color: #06230f;
		background: radial-gradient(ellipse at 50% 40%, #b9ffcf, #5fd78a 62%, #3aa762);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.55),
			0 2px 0 #0e1213,
			0 0 12px rgba(95, 215, 138, 0.45);
	}

	.dial-head {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		align-items: flex-start;
	}
	.dial-head strong {
		display: block;
		font-size: 19px;
		font-weight: 600;
		letter-spacing: 0.08em;
	}
	.dial-head span,
	.prompt {
		font-size: 14px;
		letter-spacing: 0.1em;
		color: var(--legend-dim);
	}
	.prompt {
		margin: 10px 0 2px;
		color: var(--amber);
	}
	.dial {
		display: grid;
		grid-template-columns: 54px 1fr 86px;
		align-items: center;
		gap: 8px;
		margin-top: 9px;
		font-size: 14px;
		letter-spacing: 0.12em;
	}
	.dial output {
		padding: 3px 6px;
		text-align: right;
		font: 15px var(--crt);
		letter-spacing: 0;
		color: var(--phosphor);
		text-shadow: 0 0 6px rgba(134, 247, 176, 0.65);
		background: #06100d;
		border-radius: 2px;
		box-shadow: inset 0 1px 4px #000;
	}
	.dial input {
		width: 100%;
		accent-color: var(--amber);
	}
	.dial input:disabled {
		opacity: 0.35;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 9px;
	}
	.radii {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
		margin: 10px 0 0;
	}
	.radii div {
		padding: 4px 6px;
		background: #06100d;
		border-radius: 2px;
		box-shadow: inset 0 1px 4px #000;
	}
	.radii dt {
		font-size: 12px;
		letter-spacing: 0.1em;
		color: var(--legend-dim);
	}
	.radii dd {
		margin: 0;
		font: 15px var(--crt);
		color: var(--phosphor);
	}

	.commit {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		align-items: stretch;
	}
	.wargame {
		display: flex;
		flex-direction: column;
		gap: 8px;
		justify-content: center;
	}
	.lamps {
		display: flex;
		justify-content: center;
		gap: 10px;
	}
	.lamps i {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: radial-gradient(circle at 40% 35%, #47402d, #1c180f);
		box-shadow: inset 0 0 2px #000, 0 0 0 2px #1a1f21;
	}
	.lamps i.on {
		background: radial-gradient(circle at 40% 35%, #fff2c2, #ffc24a 60%, #c07c15);
		box-shadow: 0 0 10px rgba(255, 194, 74, 0.75), 0 0 0 2px #1a1f21;
	}

	/* The firing button sits under a red hinged guard. */
	.guard {
		position: relative;
		min-height: 88px;
		perspective: 500px;
	}
	.fire {
		position: absolute;
		inset: 0;
		border: 2px solid #1a0a06;
		border-radius: 4px;
		font: 600 21px var(--engraved);
		letter-spacing: 0.2em;
		color: #2a0702;
		background: radial-gradient(ellipse at 50% 40%, #ff9c7c, #ff5a33 58%, #b52c10);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 0 22px rgba(255, 90, 51, 0.6);
		cursor: pointer;
	}
	.fire:disabled {
		cursor: not-allowed;
		filter: saturate(0.5) brightness(0.55);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2);
	}
	.cover {
		position: absolute;
		inset: 0;
		border: 2px solid #4d0d00;
		border-radius: 4px;
		font: 600 14px var(--engraved);
		letter-spacing: 0.16em;
		color: #ffd7c9;
		cursor: pointer;
		background:
			repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.14) 0 8px, transparent 8px 16px),
			linear-gradient(180deg, rgba(190, 44, 14, 0.96), rgba(120, 22, 4, 0.96));
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 3px 5px rgba(0, 0, 0, 0.6);
		transform-origin: 50% 0;
		transition: transform 240ms cubic-bezier(0.3, 1.3, 0.5, 1);
	}
	.cover:disabled {
		cursor: not-allowed;
		filter: saturate(0.55) brightness(0.7);
	}
	.guard.open .cover {
		inset: auto 0 calc(100% - 26px) 0;
		height: 26px;
		transform: translateY(-6px);
		font-size: 12px;
		z-index: 1;
	}
	.guard.open .fire {
		top: 22px;
	}

	.overlay {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(3, 6, 10, 0.72);
		z-index: 10;
	}
	.slip {
		width: min(560px, 100%);
		max-height: 92dvh;
		overflow-y: auto;
		padding: 20px 24px;
		background:
			repeating-linear-gradient(180deg, transparent 0 25px, rgba(60, 90, 70, 0.08) 25px 26px),
			var(--paper);
		color: var(--ink);
		font: 15px/1.5 var(--tty);
		box-shadow: 0 20px 60px #000;
	}
	.slip .head {
		font-weight: 700;
		margin-top: 0;
	}
	.slip ol {
		padding-left: 22px;
	}
	.slip li {
		margin-bottom: 6px;
	}
	.fine {
		font-size: 12px;
		line-height: 1.4;
		opacity: 0.8;
	}

	@media (max-width: 900px) {
		.console {
			grid-template-columns: minmax(0, 1fr);
			padding: 8px;
			border-radius: 0;
		}
		.bezel {
			width: 100%;
			min-width: 0;
		}
		.title span {
			display: none;
		}
		.roll {
			max-height: 260px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.blink {
			animation: none;
		}
		.cover,
		.key {
			transition: none;
		}
	}
</style>
