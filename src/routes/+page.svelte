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
		BOARD_RU,
		DIFFICULTY_RU,
		fmtWind,
		heightParts,
		PRECIP_RU,
		RANK_RU,
		THEATRE_RU,
		UI,
		WEAPON_KEY_RU,
		WEAPON_NAME_RU,
		WEAPON_NOTE_RU,
		yieldParts,
		type Lang
	} from '#lib/game/i18n.ts';
	import {
		checksFor,
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
		loadSoundOff,
		loadThemeId,
		markOrdersSeen,
		saveResult,
		saveRun,
		saveSoundOff,
		saveThemeId,
		statsFrom,
		type HistoryEntry
	} from '#lib/game/storage.ts';
	import { hasDial, type Weapon } from '#lib/game/weapons.ts';
	import Nixie from '#lib/ui/Nixie.svelte';
	import Scope from '#lib/ui/Scope.svelte';
	import { Soundscape, type SoundEvent } from '#lib/ui/sound.ts';
	import { THEME_ORDER, THEMES, type ThemeId } from '#lib/ui/themes.ts';

	const PAPER_TERMS = {
		console: 'TARGET PLANNING STAFF · CHART WORKSHEET',
		rack: 'WARHEAD ALLOCATION',
		dataSelect: 'OVERLAYS',
		digital: 'EFFECTS TABLE, KM',
		aim: 'MARK GROUND ZERO ON THE CHART',
		lift: 'SIGN ORDER',
		close: 'WITHDRAW',
		execute: 'APPROVED',
		disarm: 'ERASE',
		runWargame: 'RUN WARGAME'
	};

	let scenario = $state.raw<Scenario | null>(null);
	let data = $state.raw<TheatreData | null>(null);
	let sim: Sim | null = null;
	let solution: Placement[] = [];
	let difficulty = $state.raw<Difficulty | null>(null);
	let loadError = $state<string | null>(null);
	let practice = $state(false);

	let themeId = $state<ThemeId>('sage');
	let translated = $state(false);
	const theme = $derived(THEMES[themeId]);
	const lang = $derived<Lang>(translated ? 'en' : theme.lang);
	const L = $derived(themeId === 'paper' ? { ...UI.en, ...PAPER_TERMS } : UI[lang]);

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

	// Browsers only allow audio after a gesture, so the room comes alive on first touch.
	let soundscape: Soundscape | null = null;
	let soundOff = $state(false);
	const sfx = (e: SoundEvent) => soundscape?.play(e);

	function wakeAudio() {
		if (soundscape) return;
		const ctx = new AudioContext();
		soundscape = new Soundscape(ctx);
		soundscape.setMuted(soundOff);
		soundscape.setTheme(themeId);
		soundscape.startScheduler();
		void ctx.resume();
	}

	function toggleSound() {
		soundOff = !soundOff;
		saveSoundOff(soundOff);
		soundscape?.setMuted(soundOff);
	}

	/** Controls sound by what they physically are, wherever they sit on the console. */
	function onConsolePress(e: PointerEvent) {
		wakeAudio();
		const el = (e.target as HTMLElement).closest('button, input');
		if (!el || (el as HTMLButtonElement).disabled) return;
		if (el.matches('.fire, .cover, .wargame .key')) return;
		if (el.matches('.padkey')) sfx('arrow');
		else if (el.matches('.warhead')) sfx('select');
		else if (el.matches('.switches .key')) sfx('toggle');
		else if (el.matches('button')) sfx('key');
	}

	const stats = $derived(statsFrom(history));
	const finished = $derived(final !== null);
	const conditions = $derived(scenario ? conditionTexts(scenario, lang) : []);
	const selectedWeapon = $derived<Weapon | null>(scenario && selected !== null ? scenario.arsenal[selected] : null);
	const selectedPlacement = $derived(placements.find((p) => p.slot === selected) ?? null);
	const board = $derived(scenario && final ? boardFor(scenario, { value: final.value, passed: final.passed }) : []);
	const canRun = $derived(placements.length > 0 && !finished && pendingFinal === null);

	const selectedBurst = $derived(scenario && selectedPlacement ? toBurst(scenario, selectedPlacement) : null);
	const selectedRings = $derived(
		scenario && selectedBurst ? ringsFor(selectedBurst.weapon, selectedBurst.kt, selectedBurst.hobM, scenario.weather) : null
	);

	const ru = $derived(lang === 'ru');
	const theatreName = $derived(scenario ? (ru ? THEATRE_RU[scenario.theatre.id] : scenario.theatre.name) : '');
	const weaponName = (w: Weapon) => (ru ? (WEAPON_NAME_RU[w.id] ?? w.name) : w.name);
	const weaponKey = (w: Weapon) => (ru ? (WEAPON_KEY_RU[w.id] ?? w.id.toUpperCase()) : w.id.toUpperCase());
	const weaponNote = (w: Weapon) => (ru ? WEAPON_NOTE_RU[w.id] : w.note);
	const yieldText = (kt: number) => yieldParts(kt, lang).join(' ');
	const rankText = (rating: number) => (ru ? RANK_RU[rankFor(rating)] : rankFor(rating));
	const checksOf = (o: Outcome) => (scenario ? checksFor(scenario, o.bursts, o.tally, lang) : []);

	onMount(async () => {
		try {
			const params = new URLSearchParams(location.search);
			const wanted = params.get('theme') ?? loadThemeId();
			if (wanted && wanted in THEMES) themeId = wanted as ThemeId;
			soundOff = loadSoundOff();
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

	function pickTheme(id: ThemeId) {
		themeId = id;
		translated = false;
		saveThemeId(id);
		wakeAudio();
		soundscape?.setTheme(id);
	}

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
		sfx('place');
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
		sfx('erase');
		planChanged();
	}

	function setKt(v: number) {
		if (selectedPlacement && selectedWeapon) {
			selectedPlacement.kt = ktFromSlider(selectedWeapon, v);
			sfx('slider');
			planChanged();
		}
	}

	function setHob(m: number) {
		if (selectedPlacement) {
			selectedPlacement.hobM = m;
			sfx('slider');
			planChanged();
		}
	}

	function runWargame() {
		if (!scenario || !sim || !canRun || wargamesUsed >= scenario.wargames) return;
		wargamesUsed++;
		const cells = new Float32Array(sim.grid.n);
		lastRun = evaluate(scenario, sim, placements, cells);
		damage = cells;
		sfx('wargame');
		persist();
	}

	let pendingCells: Float32Array | null = null;

	function execute() {
		if (!scenario || !sim || !canRun || !coverOpen) return;
		const cells = new Float32Array(sim.grid.n);
		const out = evaluate(scenario, sim, placements, cells);
		damage = null;
		lastRun = null;
		pendingFinal = out;
		pendingCells = cells;
		coverOpen = false;
		sfx('fire');
		// One per warhead, in step with the scope's playback.
		placements.forEach((_, i) => setTimeout(() => sfx('impact'), 900 + i * 420));
		playToken++;
	}

	function strikePlayed() {
		if (!pendingFinal || !scenario) return;
		final = pendingFinal;
		damage = pendingCells;
		if (sim) difficulty = assessDifficulty(scenario, sim, solution);
		pendingFinal = null;
		sfx('report');
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
		const score = o.passed ? `${fmtScore(s, o.value)} ${SCORE_UNIT.en[s.kind]}` : 'MISSION FAILED';
		return [
			`NUCLE №${s.day} — ${s.theatre.name}`,
			OBJECTIVE_TITLE.en[s.kind] + (difficulty ? ` · ${difficulty.label} ${difficulty.score}` : ''),
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

	const km = (v: number) => {
		const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
		return ru ? s.replace('.', ',') : s;
	};
	const pad = (n: number) => String(n).padStart(3, '0');
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	const wingName = (name: string) => (ru ? (BOARD_RU[name] ?? name) : name);
	const nixies = $derived(themeId === 'pvo');

	// When the report prints, bring it into view rather than leaving it below the order.
	let roll = $state<HTMLDivElement | null>(null);
	let reportHead = $state<HTMLParagraphElement | null>(null);
	$effect(() => {
		if (roll && reportHead) roll.scrollTop = reportHead.offsetTop - roll.offsetTop - 8;
	});
</script>

{#snippet number(value: string, tubes = 0)}
	{#if nixies}<Nixie {value} {tubes} />{:else}<b class="num">{value}</b>{/if}
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<main class="room" data-theme={themeId} onpointerdown={onConsolePress}>
	{#if loadError}
		<section class="status">
			<h1>TRANSMISSION FAILURE</h1>
			<p>{loadError}</p>
		</section>
	{:else if !scenario || !data}
		<section class="status">
			<h1>{L.title}</h1>
			<p class="blink">{L.computing}</p>
		</section>
	{:else}
		<div class="console">
			<header class="plate">
				<div class="title">
					<strong>{L.title}</strong>
					<span>{L.console}</span>
				</div>
				<div class="serial">
					<span>{L.exercise} {pad(scenario.day)}{practice ? ` · ${L.archive}` : ''}</span>
					<span>{scenario.date} · {theatreName}</span>
				</div>
				<div class="tally">
					<span>{L.streak} {@render number(`${stats.streak}`)}</span>
					<span>{L.played} {@render number(`${stats.played}`)}</span>
					<span>{L.best} {@render number(`${stats.best}`)}</span>
					<button class="key small" onclick={() => (showOrders = true)}>{L.orders}</button>
				</div>
				<div class="selector" role="group" aria-label="Console theme">
					<button class="key small" class:armed={!soundOff} aria-pressed={!soundOff} onclick={toggleSound}>{L.sound}</button>
					{#each THEME_ORDER as id (id)}
						<button class="key small" class:lit={themeId === id} aria-pressed={themeId === id} onclick={() => pickTheme(id)}>
							{THEMES[id].name}
						</button>
					{/each}
					{#if themeId === 'pvo'}
						<button class="key small" class:armed={translated} aria-pressed={translated} onclick={() => (translated = !translated)}>
							{UI.ru.translate}
						</button>
					{/if}
				</div>
			</header>

			<section class="scope-bay">
				<div class="bezel">
					<i class="screw tl"></i><i class="screw tr"></i><i class="screw bl"></i><i class="screw br"></i>
					<Scope
						{theme}
						{lang}
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
					{#if themeId === 'sage'}
						<svg class="gun" viewBox="0 0 120 54" role="img" aria-label="Light gun in its holder">
							<path d="M6 16h78l14 5v9l-14 3H56l-6 17H30l5-17H6z" fill="#7d8583" stroke="#23292a" stroke-width="2" />
							<path d="M98 22h16v7H98z" fill="#23292a" />
							<path d="M44 33l-4 9" stroke="#23292a" stroke-width="3" />
							<circle cx="114" cy="25.500" r="2" fill="#f5f6ff" />
						</svg>
					{/if}
					<span class="group-label">{L.dataSelect}</span>
					<button class="key" class:lit={showRings} onclick={() => (showRings = !showRings)}>{L.rings}</button>
					<button class="key" class:lit={showFallout} onclick={() => (showFallout = !showFallout)}>{L.fallout}</button>
					<button class="key" class:lit={showDensity} onclick={() => (showDensity = !showDensity)}>{L.population}</button>
					{#if themeId === 'sage'}
						<svg class="dial" viewBox="0 0 60 60" role="img" aria-label="Telephone dial">
							<circle cx="30" cy="30" r="28" fill="#8a918f" stroke="#23292a" stroke-width="2" />
							{#each Array(10) as _, i (i)}
								<circle
									cx={30 + 19 * Math.cos(((i * 30 - 60) * Math.PI) / 180)}
									cy={30 + 19 * Math.sin(((i * 30 - 60) * Math.PI) / 180)}
									r="4"
									fill="#23292a"
								/>
							{/each}
							<circle cx="30" cy="30" r="8" fill="#c9cdc8" />
						</svg>
					{/if}
				</div>
			</section>

			<aside class="desk">
				<section class="teletype">
					<div class="roll" class:reporting={final} bind:this={roll}>
						{#if themeId === 'paper'}<p class="classification">SECRET · EXERCISE ONLY</p>{/if}
						<p class="head">+++ {L.order} {pad(scenario.day)} +++</p>
						<p><b>{OBJECTIVE_TITLE[lang][scenario.kind]}</b> / {theatreName}</p>
						<p>{objectiveText(scenario, lang)}</p>
						{#if conditions.length}
							<p class="head">{L.conditions}</p>
							<ul>
								{#each conditions as c (c)}<li>{c}</li>{/each}
							</ul>
						{/if}
						<p class="head">{L.weather}</p>
						<p>
							{ru ? PRECIP_RU[scenario.weather.precip] : scenario.weather.precip}. {L.windToward}
							{String(scenario.weather.windBearing).padStart(3, '0')}°{ru ? ',' : ` ${L.at}`}
							{fmtWind(scenario.weather.windKmh, lang)}.
						</p>

						{#if lastRun && !final}
							<p class="head">{L.wargame} {wargamesUsed} {L.of} {scenario.wargames}</p>
							<p>
								{SCORE_UNIT[lang][scenario.kind]}: <b>{fmtScore(scenario, lastRun.value, lang)}</b>
							</p>
							<ul class="checks">
								{#each checksOf(lastRun) as c (c.label)}
									<li class:bad={!c.ok}>{c.ok ? L.pass : L.fail} {c.label} {c.detail}</li>
								{/each}
							</ul>
						{/if}

						{#if final}
							<p class="head" bind:this={reportHead}>+++ {L.report} +++</p>
							<p class="verdict" class:bad={!final.passed}>{final.passed ? L.success : L.failure}</p>
							<p>
								{L.rating} <b>{final.rating}</b> · {rankText(final.rating)}<br />
								{SCORE_UNIT[lang][scenario.kind]}: <b>{fmtScore(scenario, final.value, lang)}</b><br />
								{L.fatalities} {fmtScore({ kind: 'fatalities' }, final.tally.fatalities, lang)} ·
								{L.structures} {fmtScore({ kind: 'structures' }, final.tally.structures, lang)}
							</p>
							<ul class="checks">
								{#each checksOf(final) as c (c.label)}
									<li class:bad={!c.ok}>{c.ok ? L.pass : L.fail} {c.label} {c.detail}</li>
								{/each}
							</ul>
							{#if difficulty}
								<p class="head">{L.difficulty}</p>
								<p class="score-line">{difficulty.score}/100 · {ru ? DIFFICULTY_RU[difficulty.label] : difficulty.label}</p>
								<ul>
									<li>{L.planPass}: {pct(difficulty.planPass)}</li>
									<li>{L.planProgress}: {pct(difficulty.planProgress)}</li>
									<li>{L.tolerance}: {pct(difficulty.tolerance)}</li>
									<li>{L.condCount}: {difficulty.conditions}</li>
								</ul>
							{/if}
							<p class="head">{L.board}</p>
							<ol class="board">
								{#each board as row (row.name)}
									<li class:you={row.you}>
										<span>{wingName(row.name)}</span>
										<span>{row.failed ? L.failed : fmtScore(scenario, row.value, lang)}</span>
									</li>
								{/each}
							</ol>
						{/if}
					</div>
				</section>

				{#if final}
					<section class="actions">
						<button class="key lit wide" onclick={share}>{copied ? L.copied : L.copy}</button>
						<p class="engrave">{L.next}</p>
					</section>
				{:else}
					<section class="rack">
						<h2>{L.rack}</h2>
						<div class="keys">
							{#each scenario.arsenal as w, i (i)}
								{@const set = placements.some((p) => p.slot === i)}
								<button
									class="key warhead"
									class:lit={selected === i}
									class:armed={set}
									onclick={() => (selected = i)}
									title={`${weaponName(w)}, ${weaponNote(w)}`}
								>
									<span class="no">{String(i + 1).padStart(2, '0')}</span>
									<span class="nm">{weaponKey(w)}</span>
									<span class="yd">{yieldText(w.maxKt)}</span>
								</button>
							{/each}
						</div>
					</section>

					{#if selectedWeapon}
						<section class="dials">
							<div class="dial-head">
								<div>
									<strong>{weaponName(selectedWeapon)}</strong>
									<span>{weaponNote(selectedWeapon)}{selectedWeapon.theoretical ? ` · ${L.theoretical}` : ''}</span>
								</div>
								{#if selectedPlacement}
									<button class="key small" onclick={() => selected !== null && remove(selected)}>{L.disarm}</button>
								{/if}
							</div>

							{#if !selectedPlacement}
								<p class="prompt">{L.aim}</p>
							{:else if selectedBurst}
								{@const [yieldValue, yieldUnit] = yieldParts(selectedBurst.kt, lang)}
								{@const [hobValue, hobUnit] = heightParts(selectedBurst.hobM, lang)}
								<label class="slider">
									<span>{L.yieldLabel}</span>
									<input
										type="range"
										min="0"
										max={SLIDER_MAX}
										disabled={!hasDial(selectedWeapon) || scenario.yieldLock}
										value={ktToSlider(selectedWeapon, selectedBurst.kt)}
										oninput={(e) => setKt(+e.currentTarget.value)}
									/>
									<output>{@render number(yieldValue)}<small>{yieldUnit}</small></output>
								</label>
								<label class="slider">
									<span>{L.height}</span>
									<input
										type="range"
										min="0"
										max={SLIDER_MAX}
										disabled={selectedWeapon.surfaceOnly || !!scenario.hobLock}
										value={hobToSlider(hobFor(scenario, selectedWeapon, selectedBurst.kt, selectedPlacement.hobM))}
										oninput={(e) => setHob(hobFromSlider(+e.currentTarget.value))}
									/>
									<output>{@render number(hobValue)}<small>{hobUnit}</small></output>
								</label>
								{#if !selectedWeapon.surfaceOnly && !scenario.hobLock}
									<div class="presets">
										<button class="key small" onclick={() => setHob(0)}>{L.surface}</button>
										<button class="key small" onclick={() => setHob(optimumHobM(selectedBurst.kt))}>{L.optimum}</button>
										<button class="key small" onclick={() => setHob(100000)}>{L.exo100}</button>
										<button class="key small" onclick={() => setHob(400000)}>{L.exo400}</button>
									</div>
								{/if}
								{#if selectedRings}
									<div class="digital">
										<h3>{L.digital}</h3>
										<dl>
											<div><dt>{L.psi20}</dt><dd>{@render number(km(selectedRings.psi20))}</dd></div>
											<div><dt>{L.psi5}</dt><dd>{@render number(km(selectedRings.psi5))}</dd></div>
											<div><dt>{L.psi1}</dt><dd>{@render number(km(selectedRings.psi1))}</dd></div>
											<div><dt>{L.burns}</dt><dd>{@render number(km(selectedRings.thermal))}</dd></div>
										</dl>
									</div>
								{/if}
							{/if}
						</section>
					{/if}

					<section class="commit">
						<div class="wargame">
							<button class="key wide" disabled={!canRun || wargamesUsed >= scenario.wargames} onclick={runWargame}>
								{L.runWargame}
							</button>
							<div class="lamps" aria-label="{scenario.wargames - wargamesUsed} wargames left">
								{#each Array(scenario.wargames) as _, i (i)}
									<i class:on={i >= wargamesUsed}></i>
								{/each}
							</div>
						</div>
						<div class="guard" class:open={coverOpen}>
							<button class="fire" disabled={!canRun || !coverOpen} onclick={execute}>{L.execute}</button>
							<button class="cover" disabled={!canRun} aria-pressed={coverOpen} onclick={() => {
									coverOpen = !coverOpen;
									sfx('cover');
								}}>
								{coverOpen ? L.close : L.lift}
							</button>
						</div>
					</section>
				{/if}
			</aside>
		</div>
	{/if}

	{#if showOrders}
		<div class="overlay" role="dialog" aria-modal="true" aria-label={L.orders}>
			<div class="slip">
				{#if ru}
					<p class="head">+++ ПОСТОЯННЫЕ УКАЗАНИЯ +++</p>
					<p>ОДНО УЧЕНИЕ В СУТКИ. ОДНА КАРТА, БОЕЗАРЯДЫ И ПОГОДА ДЛЯ ВСЕХ.</p>
					<ol>
						<li>ПРОЧТИТЕ ПРИКАЗ. ЗАДАЧИ МЕНЯЮТСЯ ЕЖЕДНЕВНО: ПОТЕРИ, ЗДАНИЯ, СЛЕД, ЭМИ, КОНТРСИЛОВОЙ, МИНИМУМ МОЩНОСТИ, ТОЧЕЧНЫЙ.</li>
						<li>ВЫБЕРИТЕ БОЕЗАРЯД НА ТАБЛО И УКАЖИТЕ ЭПИЦЕНТР НА ИНДИКАТОРЕ. ПЕРЕТАЩИТЕ ДЛЯ ПЕРЕНОСА. СТРЕЛКИ И + / − ДВИГАЮТ И МАСШТАБИРУЮТ КАРТУ.</li>
						<li>ЗАДАЙТЕ МОЩНОСТЬ И ВЫСОТУ. НАЗЕМНЫЙ ВЗРЫВ ДАЁТ СЛЕД. ВОЗДУШНЫЙ ДЕЙСТВУЕТ ДАЛЬШЕ. ВЫШЕ 30 КМ ТОЛЬКО ЭМИ.</li>
						<li>ТРИ ПРОБНЫХ РАСЧЁТА ПОКАЖУТ ЧИСЛА. ЗАТЕМ ОТКРОЙТЕ КРЫШКУ И НАЖМИТЕ ПУСК. ПУСК ТОЛЬКО ОДИН.</li>
					</ol>
					<p class="fine">
						ДАВЛЕНИЕ В КГ/СМ², ВЕТЕР В М/С, СЛЕД В Р/Ч. ДАННЫЕ И ИСТОЧНИКИ СМ. НА АНГЛИЙСКОМ ЧЕРЕЗ КНОПКУ ПЕРЕВОД.
					</p>
				{:else}
					<p class="head">+++ STANDING ORDERS +++</p>
					<p>ONE EXERCISE A DAY. THE SAME MAP, WARHEADS AND WEATHER FOR EVERYONE.</p>
					<ol>
						<li>READ THE ORDER. OBJECTIVES CHANGE DAILY: FATALITIES, STRUCTURES, FALLOUT, EMP, COUNTERFORCE, LEAST YIELD, SURGICAL.</li>
						<li>SELECT A WARHEAD, THEN CLICK THE DISPLAY TO SET GROUND ZERO. DRAG TO MOVE IT. THE ARROWS AND + / − BESIDE THE DISPLAY MOVE AND ZOOM THE MAP.</li>
						<li>SET YIELD AND HEIGHT. SURFACE BURSTS MAKE FALLOUT. AIRBURSTS REACH FURTHER. ABOVE 30 KM IS EMP ONLY.</li>
						<li>YOU GET THREE WARGAMES, WHICH REVEAL THE NUMBERS. THEN COMMIT AND EXECUTE. YOU ONLY EXECUTE ONCE.</li>
					</ol>
					<p class="fine">
						EFFECTS ARE SIMPLIFIED FROM PUBLIC FIGURES IN GLASSTONE &amp; DOLAN AND OTA 1979. POPULATION: GHS-POP R2023A, BUILT-UP:
						GHS-BUILT-S R2023A, EUROPEAN COMMISSION JRC, CC BY 4.0. STRUCTURE COUNTS ARE ESTIMATED FROM BUILT AREA. MAPS: NATURAL
						EARTH, STREETS AND BUILDINGS © OPENSTREETMAP CONTRIBUTORS VIA OPENFREEMAP AND OPENMAPTILES, STREAMED AS YOU ZOOM. THE
						BOARD IS SIMULATED FROM THE COMMAND ESTIMATE, THERE IS NO SERVER.
					</p>
				{/if}
				<button class="key lit wide" onclick={closeOrders}>{L.acknowledge}</button>
			</div>
		</div>
	{/if}
</main>

<style>
	/* ---------- SAGE: textured light grey casing, grey keys, white legends, red lamps ---------- */
	.room {
		--hammer: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .3 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E");
		--room-bg: radial-gradient(ellipse 90% 70% at 40% 40%, #1a3555 0%, #0c1a2c 55%, #05090f 100%);
		--casing: var(--hammer), linear-gradient(180deg, #a4a9a6, #8b918f 70%, #7a807f);
		--casing-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 -2px 0 rgba(0, 0, 0, 0.35), 0 20px 60px rgba(0, 0, 0, 0.7);
		--plate-bg: linear-gradient(180deg, #c5c8c4, #aeb2ae);
		--plate-edge: 1px solid rgba(0, 0, 0, 0.45);
		--text: #1d2122;
		--text-dim: #33393a;
		--text-shadow: 0 1px 0 rgba(255, 255, 255, 0.35);
		--section-edge: 1px solid rgba(0, 0, 0, 0.35);
		--bezel-bg: var(--hammer), linear-gradient(145deg, #a9aeab, #858b89);
		--bezel-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.5);
		--tube-face: radial-gradient(circle at 50% 48%, #24210c 0%, #15130a 62%, #070602 100%);
		--tube-shadow: inset 0 0 40px 8px rgba(0, 0, 0, 0.7), inset 0 0 90px rgba(240, 220, 120, 0.09), 0 0 0 7px #4e5453, 0 0 0 11px #2a2f30, 0 0 0 13px #9da2a0;
		--tube-glass:
			radial-gradient(ellipse 58% 30% at 34% 16%, rgba(255, 245, 200, 0.1), transparent 70%),
			radial-gradient(circle at 50% 50%, transparent 74%, rgba(0, 0, 0, 0.38) 100%),
			repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.05) 0 1px, transparent 1px 3px);
		--readout: #1d2122;
		--readout-glow: none;
		--num: #fff0a0;
		--num-glow: 0 0 6px rgba(255, 235, 140, 0.7);
		--crt: 'Share Tech Mono', ui-monospace, monospace;
		--engraved: 'Barlow Condensed', 'Arial Narrow', sans-serif;
		--tty: 'Courier Prime', 'Courier New', monospace;
		--key-face: linear-gradient(180deg, #7d8583, #5f6665);
		--key-text: #fff;
		--key-border: 1px solid #23292a;
		--key-radius: 2px;
		--key-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.32), 0 2px 0 #2a2f30, 0 3px 4px rgba(0, 0, 0, 0.4);
		--lit-face: radial-gradient(ellipse at 50% 40%, #ffb3a0, #ee4a32 62%, #a92414);
		--lit-text: #fff;
		--lit-glow: 0 0 16px rgba(238, 74, 50, 0.65);
		--armed-face: radial-gradient(ellipse at 50% 40%, #ffffff, #e4e6da 62%, #b5b8ac);
		--armed-text: #1d2122;
		--armed-glow: 0 0 12px rgba(255, 255, 240, 0.5);
		--paper: #e7dfc4;
		--ink: #24231e;
		--bad: #a21c00;
		--slot: linear-gradient(180deg, #33393a, #23282a);
		--display: #17150a;
		--accent: #cf3a24;
		--lamp-off: radial-gradient(circle at 40% 35%, #5c2820, #2b100c);
		--lamp-on: radial-gradient(circle at 40% 35%, #ffc4b4, #ee4a32 60%, #9c1f10);
		--lamp-glow: 0 0 10px rgba(238, 74, 50, 0.8);
		--title-size: 30px;
		--prompt: #7a1205;

		min-height: 100dvh;
		padding: clamp(0px, 1.4vw, 20px);
		background: var(--room-bg);
		color: var(--text);
		font-family: var(--engraved);
	}

	/* ---------- PVO: hammer-finish grey-green, nixie tubes, an indicator board ---------- */
	.room[data-theme='pvo'] {
		--room-bg: radial-gradient(ellipse 90% 70% at 40% 40%, #20241c 0%, #12140f 60%, #070806 100%);
		--casing: var(--hammer), var(--hammer), linear-gradient(180deg, #5d7470, #4b5f5c 70%, #3f514e);
		--casing-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -2px 0 rgba(0, 0, 0, 0.45), 0 20px 60px rgba(0, 0, 0, 0.8);
		--plate-bg: linear-gradient(180deg, #c8c2a8, #aba58c);
		--text: #eef0e0;
		--text-dim: #cfd4bf;
		--text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.6);
		--section-edge: 1px solid rgba(0, 0, 0, 0.5);
		--bezel-bg: var(--hammer), var(--hammer), linear-gradient(145deg, #546a66, #38494a);
		--bezel-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), inset 0 0 0 1px rgba(0, 0, 0, 0.5), 0 2px 6px rgba(0, 0, 0, 0.6);
		--tube-face: radial-gradient(circle at 50% 48%, #0f2410 0%, #081508 62%, #020602 100%);
		--tube-shadow: inset 0 0 40px 10px rgba(0, 0, 0, 0.78), inset 0 0 90px rgba(140, 240, 90, 0.08), 0 0 0 9px #171a17, 0 0 0 11px #3f4a44;
		--tube-glass:
			radial-gradient(ellipse 58% 30% at 34% 16%, rgba(220, 255, 200, 0.09), transparent 70%),
			radial-gradient(circle at 50% 50%, transparent 72%, rgba(0, 0, 0, 0.42) 100%);
		--readout: #eef0e0;
		--crt: 'PT Mono', ui-monospace, monospace;
		--engraved: 'PT Sans Narrow', 'Arial Narrow', sans-serif;
		--tty: 'PT Mono', 'Courier New', monospace;
		--key-face: linear-gradient(180deg, #30302c, #141412);
		--key-text: #f2f0dd;
		--key-border: 1px solid #000;
		--key-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 2px 0 #060605, 0 3px 4px rgba(0, 0, 0, 0.6);
		--lit-face: linear-gradient(180deg, #4a3a18, #2a2008);
		--lit-text: #ffd27a;
		--lit-glow: inset 0 0 12px rgba(255, 170, 40, 0.65), 0 0 8px rgba(255, 170, 40, 0.35);
		--armed-face: linear-gradient(180deg, #1c3d1c, #0d240d);
		--armed-text: #a8f58f;
		--armed-glow: inset 0 0 12px rgba(90, 240, 90, 0.5);
		--paper: #d9d8c9;
		--ink: #23241f;
		--slot: linear-gradient(180deg, #12150f, #0a0c08);
		--display: #0c0a07;
		--accent: #ff8a2a;
		--lamp-off: radial-gradient(circle at 40% 35%, #4c2a10, #1f1006);
		--lamp-on: radial-gradient(circle at 40% 35%, #ffd9a0, #ff8a2a 60%, #a84a05);
		--lamp-glow: 0 0 10px rgba(255, 138, 42, 0.85);
		--title-size: 28px;
		--prompt: #ffb35c;
	}

	/* ---------- CHART: a printed sheet on a planner's table, marked by hand ---------- */
	.room[data-theme='paper'] {
		--sheet: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='4'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .28 0 0 0 0 .18 0 0 0 .11 0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23p)'/%3E%3C/svg%3E");
		--room-bg: linear-gradient(115deg, #2c3a30, #1f2a23 60%, #161e19);
		--casing: none;
		--casing-shadow: none;
		--plate-bg: var(--sheet), #d9c48f;
		--plate-edge: 1px solid #93794a;
		--text: #2b261c;
		--text-dim: #4a4233;
		--text-shadow: none;
		--section-edge: 1px solid #b7ab8a;
		--bezel-bg: var(--sheet), #ece3c9;
		--bezel-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 12px 30px rgba(0, 0, 0, 0.55);
		--tube-face:
			linear-gradient(90deg, transparent 49.8%, rgba(90, 70, 40, 0.13) 50%, transparent 50.2%),
			linear-gradient(0deg, transparent 49.8%, rgba(90, 70, 40, 0.1) 50%, transparent 50.2%),
			var(--sheet),
			#f0e7d0;
		--tube-shadow: 0 0 0 1px #8d8163;
		--readout: #2b261c;
		--num: #2b261c;
		--num-glow: none;
		--crt: 'Courier Prime', ui-monospace, monospace;
		--engraved: 'Courier Prime', 'Courier New', monospace;
		--tty: 'Courier Prime', 'Courier New', monospace;
		--key-face: var(--sheet), #f3ecd8;
		--key-text: #2b261c;
		--key-border: 1px solid #6d6248;
		--key-radius: 1px;
		--key-shadow: 1px 1px 0 rgba(60, 50, 30, 0.45);
		--lit-face: var(--sheet), #f3ecd8;
		--lit-text: #a01d16;
		--lit-glow: inset 0 0 0 2px #a01d16;
		--armed-face: var(--sheet), #dfe7cf;
		--armed-text: #1f4a27;
		--armed-glow: inset 0 0 0 1px #1f4a27;
		--paper: #f1e9d3;
		--slot: none;
		--display: transparent;
		--accent: #a01d16;
		--lamp-off: none;
		--lamp-on: none;
		--title-size: 26px;
		--prompt: #a01d16;
	}

	.status {
		display: grid;
		place-content: center;
		min-height: 90dvh;
		text-align: center;
		font-family: var(--crt);
		color: #f3e58a;
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

	.console {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(360px, 430px);
		grid-template-rows: auto 1fr;
		gap: 12px;
		max-width: 1500px;
		margin: 0 auto;
		padding: 12px;
		border-radius: 6px;
		background: var(--casing);
		box-shadow: var(--casing-shadow);
	}

	.plate {
		grid-column: 1 / -1;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 22px;
		padding: 8px 14px;
		border: var(--plate-edge);
		border-radius: 3px;
		background: var(--plate-bg);
		color: #1d2122;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 14px;
	}
	.title strong {
		font-size: var(--title-size);
		font-weight: 600;
		letter-spacing: 0.32em;
	}
	.title span,
	.serial span,
	.tally span {
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.12em;
	}
	.serial {
		display: flex;
		flex-direction: column;
		font-variant-numeric: tabular-nums;
	}
	.tally {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 17px;
	}
	.num {
		font: 16px var(--crt);
		padding: 0 4px;
		border-radius: 2px;
		background: var(--display);
		color: var(--num);
		text-shadow: var(--num-glow);
	}
	.selector {
		display: flex;
		gap: 5px;
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
		padding: clamp(18px, 2.4vw, 34px);
		border-radius: 8px;
		background: var(--bezel-bg);
		box-shadow: var(--bezel-shadow);
	}
	.screw {
		position: absolute;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		background:
			linear-gradient(35deg, transparent 44%, #1a1f21 45% 55%, transparent 56%),
			radial-gradient(circle at 35% 30%, #c5ccc8, #626b6b);
		box-shadow: 0 1px 1px rgba(0, 0, 0, 0.7);
	}
	.tl { top: 8px; left: 8px; }
	.tr { top: 8px; right: 8px; }
	.bl { bottom: 8px; left: 8px; }
	.br { bottom: 8px; right: 8px; }

	.switches {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 8px;
	}
	.group-label {
		font-size: 13px;
		font-weight: 500;
		letter-spacing: 0.14em;
		color: var(--text);
		text-shadow: var(--text-shadow);
	}
	.gun {
		width: 96px;
		height: auto;
		margin-right: 12px;
	}
	.dial {
		width: 46px;
		height: 46px;
		margin-left: 12px;
	}

	/* Illuminated pushbuttons. */
	.key {
		appearance: none;
		min-height: 40px;
		padding: 6px 12px;
		border: var(--key-border);
		border-radius: var(--key-radius);
		font: 600 14px var(--engraved);
		letter-spacing: 0.12em;
		color: var(--key-text);
		cursor: pointer;
		background: var(--key-face);
		box-shadow: var(--key-shadow);
		transition: transform 60ms, box-shadow 60ms, background 120ms, color 120ms;
	}
	.key:hover:not(:disabled) {
		filter: brightness(1.1);
	}
	.key:active:not(:disabled) {
		transform: translateY(2px);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
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
	.key.armed {
		color: var(--armed-text);
		background: var(--armed-face);
		box-shadow: var(--key-shadow), var(--armed-glow);
	}
	/* Red is kept for the selected warhead; a data toggle that's on is plainly backlit. */
	[data-theme='sage'] .switches .key.lit {
		color: var(--armed-text);
		background: var(--armed-face);
		box-shadow: var(--key-shadow), var(--armed-glow);
	}
	.key.lit {
		color: var(--lit-text);
		background: var(--lit-face);
		box-shadow: var(--key-shadow), var(--lit-glow);
	}

	.desk {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 0;
		color: var(--text);
	}

	/* Paper feeding out of a slot in the panel. */
	.teletype {
		padding: 0 14px;
		border-radius: 3px;
		background: var(--slot);
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
	.roll.reporting {
		max-height: calc(100dvh - 240px);
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
		color: var(--bad);
		font-weight: 700;
	}
	.verdict,
	.score-line {
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
		border: var(--section-edge);
		border-radius: 3px;
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
	}
	.rack h2,
	.engrave,
	.digital h3 {
		margin: 0 0 8px;
		font-size: 14px;
		font-weight: 500;
		letter-spacing: 0.16em;
		color: var(--text-dim);
		text-shadow: var(--text-shadow);
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
		letter-spacing: 0.04em;
	}
	.warhead .no {
		align-self: flex-start;
		font: 10px var(--crt);
		opacity: 0.8;
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
		text-shadow: var(--text-shadow);
	}
	.dial-head span,
	.prompt {
		font-size: 14px;
		letter-spacing: 0.08em;
		color: var(--text-dim);
	}
	.prompt {
		margin: 10px 0 2px;
		color: var(--prompt);
		font-weight: 600;
	}
	.slider {
		display: grid;
		grid-template-columns: 66px 1fr auto;
		align-items: center;
		gap: 8px;
		margin-top: 9px;
		font-size: 14px;
		letter-spacing: 0.1em;
	}
	.slider output {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		min-width: 92px;
		font-size: 25px;
	}
	.slider small {
		font: 500 12px var(--engraved);
		letter-spacing: 0.06em;
	}
	.slider .num {
		font-size: 15px;
	}
	.slider input {
		width: 100%;
		accent-color: var(--accent);
	}
	.slider input:disabled {
		opacity: 0.35;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: 9px;
	}

	/* The five-inch tabular tube that sits beside SAGE's situation display. */
	.digital {
		margin-top: 10px;
		padding: 7px 10px 9px;
		border-radius: 10px;
		background: var(--display);
		box-shadow: inset 0 1px 6px #000, 0 0 0 3px #4e5453;
	}
	.digital h3 {
		margin-bottom: 4px;
		font: 12px var(--crt);
		color: #e3d27c;
		text-shadow: none;
	}
	.digital dl {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
		margin: 0;
	}
	.digital dt {
		font: 12px var(--crt);
		color: #cdbe74;
	}
	.digital dd {
		margin: 0;
		font-size: 22px;
	}
	.digital .num {
		padding: 0;
		background: none;
		font-size: 16px;
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
		background: var(--lamp-off);
		box-shadow: inset 0 0 2px #000, 0 0 0 2px #1a1f21;
	}
	.lamps i.on {
		background: var(--lamp-on);
		box-shadow: var(--lamp-glow), 0 0 0 2px #1a1f21;
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
		letter-spacing: 0.14em;
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

	/* ---------- PVO hardware ---------- */
	[data-theme='pvo'] .plate {
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px rgba(0, 0, 0, 0.5);
	}
	[data-theme='pvo'] .title strong {
		letter-spacing: 0.22em;
	}
	/* The rack is an electronic board of lit cells, per the Vozdukh-1 workplaces. */
	[data-theme='pvo'] .keys {
		gap: 3px;
		padding: 5px;
		background: #050504;
		border-radius: 2px;
		box-shadow: inset 0 1px 5px #000;
	}
	[data-theme='pvo'] .warhead {
		border: 0;
		border-radius: 0;
		color: #6f6c55;
		background: #181712;
		box-shadow: none;
	}
	[data-theme='pvo'] .warhead.armed {
		color: var(--armed-text);
		background: var(--armed-face);
		box-shadow: var(--armed-glow);
	}
	[data-theme='pvo'] .warhead.lit {
		color: var(--lit-text);
		background: var(--lit-face);
		box-shadow: var(--lit-glow);
	}
	[data-theme='pvo'] .digital {
		border-radius: 2px;
		box-shadow: inset 0 1px 6px #000;
	}
	[data-theme='pvo'] .digital h3,
	[data-theme='pvo'] .digital dt {
		color: #c8c2a8;
	}
	[data-theme='pvo'] .tally {
		font-size: 23px;
		color: #1d2122;
	}
	[data-theme='pvo'] .fire {
		inset: 4px auto auto 50%;
		width: 78px;
		height: 78px;
		margin-left: -39px;
		border-radius: 50%;
		border: 4px solid #2a2a26;
		font-size: 19px;
		letter-spacing: 0.08em;
		box-shadow: inset 0 3px 3px rgba(255, 255, 255, 0.5), inset 0 -6px 8px rgba(90, 0, 0, 0.5), 0 0 22px rgba(255, 90, 51, 0.6), 0 0 0 3px #101010;
	}
	[data-theme='pvo'] .guard.open .fire {
		top: 28px;
	}
	[data-theme='pvo'] .guard {
		min-height: 110px;
	}

	/* ---------- CHART materials ---------- */
	[data-theme='paper'] .console {
		padding: 16px;
	}
	[data-theme='paper'] .plate {
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
		border-radius: 2px 14px 2px 2px;
	}
	[data-theme='paper'] .title span,
	[data-theme='paper'] .serial span,
	[data-theme='paper'] .tally span {
		font-size: 12px;
		letter-spacing: 0.06em;
	}
	[data-theme='paper'] .title strong {
		font-weight: 700;
		letter-spacing: 0.3em;
	}
	[data-theme='paper'] .bezel {
		border-radius: 1px;
	}
	/* Drawing pins, not screws. */
	[data-theme='paper'] .screw {
		width: 13px;
		height: 13px;
		background: radial-gradient(circle at 35% 30%, #ff9a86, #b3201a 65%, #6d0f0a);
		box-shadow: 1px 2px 2px rgba(0, 0, 0, 0.55);
	}
	[data-theme='paper'] .switches,
	[data-theme='paper'] .group-label {
		color: #e4dcc0;
	}
	[data-theme='paper'] .group-label {
		font-weight: 700;
	}
	[data-theme='paper'] .key {
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	[data-theme='paper'] .key.armed::after {
		content: ' ✓';
	}
	[data-theme='paper'] .teletype {
		padding: 0;
		background: none;
		box-shadow: 0 8px 20px rgba(0, 0, 0, 0.5);
	}
	[data-theme='paper'] .roll {
		background: var(--sheet), var(--paper);
		box-shadow: none;
		font-weight: 400;
	}
	.classification {
		color: #a01d16;
		font-weight: 700;
		letter-spacing: 0.2em;
		text-align: center;
	}
	[data-theme='paper'] .rack,
	[data-theme='paper'] .dials,
	[data-theme='paper'] .commit,
	[data-theme='paper'] .actions {
		background: var(--sheet), var(--paper);
		box-shadow: 0 6px 14px rgba(0, 0, 0, 0.45);
		border-radius: 1px;
	}
	[data-theme='paper'] .digital {
		padding: 6px 0 0;
		border-top: 1px dashed #6d6248;
		border-radius: 0;
		box-shadow: none;
	}
	[data-theme='paper'] .digital h3,
	[data-theme='paper'] .digital dt {
		color: #4a4233;
	}
	/* Wargames are pencil tally boxes. */
	[data-theme='paper'] .lamps i {
		border-radius: 0;
		background: none;
		box-shadow: inset 0 0 0 1.5px #2b261c;
	}
	[data-theme='paper'] .lamps i:not(.on) {
		background:
			linear-gradient(45deg, transparent 46%, #a01d16 46% 54%, transparent 54%),
			linear-gradient(-45deg, transparent 46%, #a01d16 46% 54%, transparent 54%);
	}
	[data-theme='paper'] .lamps i.on {
		background: none;
		box-shadow: inset 0 0 0 1.5px #2b261c;
	}
	/* Execute is a signature, then a rubber stamp. */
	[data-theme='paper'] .cover {
		border: 1px solid #6d6248;
		border-radius: 1px;
		color: #2b261c;
		background: var(--sheet), #d9c48f;
		box-shadow: 1px 2px 3px rgba(40, 30, 10, 0.5);
	}
	[data-theme='paper'] .fire {
		inset: 8px 6px 2px;
		border: 4px double #a01d16;
		border-radius: 3px;
		font-size: 22px;
		font-weight: 700;
		letter-spacing: 0.1em;
		color: #a01d16;
		background: rgba(160, 29, 22, 0.05);
		box-shadow: none;
		transform: rotate(-4deg);
	}
	[data-theme='paper'] .fire:disabled {
		filter: opacity(0.3);
		box-shadow: none;
	}
	[data-theme='paper'] .guard.open .fire {
		top: 28px;
	}
	[data-theme='paper'] .verdict {
		display: inline-block;
		padding: 2px 8px;
		border: 3px double #1f4a27;
		color: #1f4a27;
		transform: rotate(-2deg);
	}
	[data-theme='paper'] .verdict.bad {
		border-color: #a01d16;
		color: #a01d16;
	}
	[data-theme='paper'] .engrave {
		color: #4a4233;
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
		.gun,
		.dial {
			display: none;
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
