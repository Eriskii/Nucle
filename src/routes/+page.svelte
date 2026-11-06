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
		weatherFor,
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
	import Debrief from '#lib/ui/debrief/Debrief.svelte';
	import { BUTTON_LABEL } from '#lib/ui/debrief/text.ts';
	import Tasking from '#lib/ui/Tasking.svelte';
	import Nixie from '#lib/ui/Nixie.svelte';
	import Scope from '#lib/ui/Scope.svelte';
	import { Soundscape, type SoundEvent } from '#lib/ui/sound.ts';
	import { THEME_ORDER, THEMES, type ThemeId } from '#lib/ui/themes.ts';

	const PAPER_TERMS = {
		console: 'TARGET PLANNING WORKSHEET',
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
	let sim = $state.raw<Sim | null>(null);
	let solution = $state.raw<Placement[]>([]);
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
	let showDebrief = $state(false);

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
		scenario && selectedBurst ? ringsFor(selectedBurst.weapon, selectedBurst.kt, selectedBurst.hobM, weatherFor(scenario, selectedBurst.lat, selectedBurst.lon)) : null
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
				<div class="serial card">
					<span>{L.exercise} {pad(scenario.day)}{practice ? ` · ${L.archive}` : ''}</span>
					<span>{scenario.field?.date ?? scenario.date} · {theatreName}</span>
				</div>
				<div class="tally">
					<span>{L.streak} {@render number(`${stats.streak}`, 3)}</span>
					<span>{L.played} {@render number(`${stats.played}`, 3)}</span>
					<span>{L.best} {@render number(`${stats.best}`, 3)}</span>
					<button class="key small" onclick={() => (showOrders = true)}>{L.orders}</button>
				</div>
				<div class="selector" role="group" aria-label="Console theme">
					<!-- The first slot is held open so the other keys never move between themes. -->
					{#if themeId === 'pvo'}
						<button class="key small" class:armed={translated} aria-pressed={translated} onclick={() => (translated = !translated)}>
							{UI.ru.translate}
						</button>
					{:else}
						<span></span>
					{/if}
					<button class="key small" class:armed={!soundOff} aria-pressed={!soundOff} onclick={toggleSound}>{L.sound}</button>
					{#each THEME_ORDER as id (id)}
						<button class="key small" class:lit={themeId === id} aria-pressed={themeId === id} onclick={() => pickTheme(id)}>
							{THEMES[id].name}
						</button>
					{/each}
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
						<svg class="gun" viewBox="0 0 150 76" role="img" aria-label="Light gun in its holder">
							<defs>
								<linearGradient id="alu" x1="0" y1="0" x2="0" y2="1">
									<stop offset="0" stop-color="#eef0ee" />
									<stop offset="0.45" stop-color="#b9bdbc" />
									<stop offset="1" stop-color="#6f7473" />
								</linearGradient>
								<pattern id="knurl" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
									<rect width="3" height="3" fill="#a9adac" />
									<path d="M0 0h3" stroke="#5a5e5d" stroke-width="1" />
								</pattern>
							</defs>
							<path d="M92 56c10 18 34 18 58 10" fill="none" stroke="#17191b" stroke-width="4" />
							<path d="M4 24h44v5H4z" fill="#8e9392" stroke="#23272a" />
							<path d="M46 16h48c7 0 10 4 10 11v9c0 5-3 8-8 8H46z" fill="url(#alu)" stroke="#23272a" />
							<path d="M62 44h34l6 21c1 5-2 8-6 8H74c-4 0-6-3-5-7z" fill="url(#knurl)" stroke="#23272a" />
							<path d="M56 44l5 9h7l-2-9" fill="#8a1d12" stroke="#23272a" />
							<circle cx="82" cy="24" r="1.8" fill="#50555a" />
							<circle cx="85" cy="66" r="1.8" fill="#50555a" />
						</svg>
					{/if}
					<span class="group-label">{L.dataSelect}</span>
					<button class="key" class:lit={showRings} onclick={() => (showRings = !showRings)}>{L.rings}</button>
					<button class="key" class:lit={showFallout} onclick={() => (showFallout = !showFallout)}>{L.fallout}</button>
					<button class="key" class:lit={showDensity} onclick={() => (showDensity = !showDensity)}>{L.population}</button>
					{#if themeId === 'sage'}
						<svg class="dial" viewBox="0 0 60 60" role="img" aria-label="Telephone dial">
							<circle cx="30" cy="30" r="29" fill="#3f444a" stroke="#14171a" stroke-width="1.5" />
							{#each Array(10) as _, i (i)}
								{@const a = ((i * 29 - 62) * Math.PI) / 180}
								<text x={30 + 26 * Math.cos(a)} y={30 + 26 * Math.sin(a) + 1.6} text-anchor="middle" font-size="4.6" fill="#e8eae4">{(i + 1) % 10}</text>
							{/each}
							<circle cx="30" cy="30" r="22.5" fill="#60666c" stroke="#23272a" />
							{#each Array(10) as _, i (i)}
								<circle
									cx={30 + 17 * Math.cos(((i * 29 - 62) * Math.PI) / 180)}
									cy={30 + 17 * Math.sin(((i * 29 - 62) * Math.PI) / 180)}
									r="3.6"
									fill="#23272a"
									stroke="#868c91"
									stroke-width="0.5"
								/>
							{/each}
							<circle cx="30" cy="30" r="10" fill="#d9c21f" stroke="#23272a" />
							<path d="M44 44l8 6" stroke="#b9bdbc" stroke-width="2.4" stroke-linecap="round" />
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
						<p class="head">{L.weather}{scenario.field ? ` ${scenario.field.date}` : ''}</p>
						<p>
							{ru ? PRECIP_RU[scenario.weather.precip] : scenario.weather.precip}. {L.windToward}
							{String(scenario.weather.windBearing).padStart(3, '0')}°{ru ? ',' : ` ${L.at}`}
							{fmtWind(scenario.weather.windKmh, lang)}.
							{#if scenario.field}{L.realWeather}{/if}
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
						<button class="key lit wide learn" onclick={() => (showDebrief = true)}>{BUTTON_LABEL[lang]}</button>
						<button class="key wide" onclick={share}>{copied ? L.copied : L.copy}</button>
						<p class="engrave">{L.next}</p>
					</section>
				{:else}
					<section class="rack">
						<h2>{L.rack}</h2>
						{#if themeId === 'sage'}
							<Tasking
								arsenal={scenario.arsenal}
								{placements}
								{selected}
								nameOf={weaponKey}
								yieldOf={(w) => yieldText(w.maxKt)}
								onselect={(slot) => (selected = slot)}
								onturn={() => sfx('select')}
								label={L.rack}
							/>
						{:else}
							<div class="keys" class:dense={scenario.arsenal.length > 5}>
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
										<span class="legend">
											<span class="nm">{weaponKey(w)}</span>
											<span class="yd">{yieldText(w.maxKt)}</span>
										</span>
									</button>
								{/each}
							</div>
						{/if}
					</section>

					{#if selectedWeapon}
						<section class="dials">
							<div class="dial-head">
								<div class="card">
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
									<output>{@render number(yieldValue, 4)}<small>{yieldUnit}</small></output>
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
									<output>{@render number(hobValue, 4)}<small>{hobUnit}</small></output>
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
											<div><dt>{L.psi20}</dt><dd>{@render number(km(selectedRings.psi20), 4)}</dd></div>
											<div><dt>{L.psi5}</dt><dd>{@render number(km(selectedRings.psi5), 4)}</dd></div>
											<div><dt>{L.psi1}</dt><dd>{@render number(km(selectedRings.psi1), 4)}</dd></div>
											<div><dt>{L.burns}</dt><dd>{@render number(km(selectedRings.thermal), 4)}</dd></div>
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

	{#if showDebrief && scenario && data && final && sim}
		<Debrief {scenario} {sim} outcome={final} meta={data.meta} grid={data.grid} {theme} {lang} {difficulty} {solution} onclose={() => (showDebrief = false)} />
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
						BOARD IS SIMULATED FROM THE COMMAND ESTIMATE, THERE IS NO SERVER. WEATHER: OPEN-METEO.COM, ERA5 REANALYSIS, COPERNICUS, CC BY 4.0.
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
		--wear: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='640'%3E%3Cfilter id='a' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.006 .009' numOctaves='3' seed='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1.6 0 0 0 -0.6'/%3E%3C/filter%3E%3Cfilter id='b' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.003 .5' numOctaves='2' seed='7' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 3.2 0 0 0 -1.92'/%3E%3C/filter%3E%3Cfilter id='c' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.33' numOctaves='2' seed='11' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 9 0 0 0 -6.5'/%3E%3C/filter%3E%3Crect width='640' height='640' filter='url(%23a)' opacity='0.06'/%3E%3Crect width='640' height='640' filter='url(%23b)' opacity='0.035'/%3E%3Crect width='640' height='640' filter='url(%23c)' opacity='0.05'/%3E%3C/svg%3E");
		--hammer: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .3 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E");
		--room-bg: radial-gradient(ellipse 90% 70% at 40% 40%, #1a3555 0%, #0c1a2c 55%, #05090f 100%);
		--casing: var(--wear), var(--hammer), linear-gradient(180deg, #767c81, #62676d 70%, #54595e);
		--casing-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 -2px 0 rgba(0, 0, 0, 0.35), 0 20px 60px rgba(0, 0, 0, 0.7);
		--plate-bg: var(--wear), var(--hammer), linear-gradient(180deg, #565b62, #474c52);
		--plate-edge: 1px solid rgba(0, 0, 0, 0.45);
		--plate-text: #e8eae4;
		--text: #e8eae4;
		--text-dim: #c0c4c0;
		--text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.65);
		--section-edge: 1px solid rgba(0, 0, 0, 0.35);
		--bezel-bg: var(--wear), var(--hammer), linear-gradient(145deg, #5a5f66, #44494f);
		--bezel-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), inset 0 0 0 1px rgba(0, 0, 0, 0.4), inset 0 0 34px rgba(0, 0, 0, 0.3), 0 3px 8px rgba(0, 0, 0, 0.55);
		--tube-face: radial-gradient(circle at 50% 48%, #24210c 0%, #15130a 62%, #070602 100%);
		--tube-shadow: inset 0 0 40px 8px rgba(0, 0, 0, 0.7), inset 0 0 90px rgba(240, 220, 120, 0.09), 0 0 0 7px #575c62, 0 0 0 11px #2a2e32, 0 0 0 13px #767c81;
		--tube-glass:
			radial-gradient(ellipse 58% 30% at 34% 16%, rgba(255, 245, 200, 0.12), transparent 70%),
			radial-gradient(circle at 50% 50%, transparent 74%, rgba(0, 0, 0, 0.38) 100%),
			radial-gradient(circle at 50% 50%, rgba(240, 205, 60, 0.02), rgba(240, 205, 60, 0.05)),
			repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.05) 0 1px, transparent 1px 3px);
		--readout: #e8eae4;
		--readout-glow: none;
		--num: #fff0a0;
		--num-glow: 0 0 6px rgba(255, 235, 140, 0.7);
		--crt: 'Overpass Mono', ui-monospace, monospace;
		--engraved: 'Routed Gothic', 'Arial Narrow', sans-serif;
		--tty: 'Overpass Mono', 'Courier New', monospace;
		font-synthesis: none;
		--panel-hardware: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11'%3E%3Cdefs%3E%3CradialGradient id='g' cx='.35' cy='.3'%3E%3Cstop stop-color='%23c5ccc8'/%3E%3Cstop offset='1' stop-color='%23565e5e'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='5.5' cy='5.5' r='5' fill='url(%23g)' stroke='%23161a1b' stroke-width='.8'/%3E%3Cpath d='M1.5 5.5h8' stroke='%2315191a' stroke-width='1.4' transform='rotate(25 5.5 5.5)'/%3E%3C/svg%3E") 4px 4px no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11'%3E%3Cdefs%3E%3CradialGradient id='g' cx='.35' cy='.3'%3E%3Cstop stop-color='%23c5ccc8'/%3E%3Cstop offset='1' stop-color='%23565e5e'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='5.5' cy='5.5' r='5' fill='url(%23g)' stroke='%23161a1b' stroke-width='.8'/%3E%3Cpath d='M1.5 5.5h8' stroke='%2315191a' stroke-width='1.4' transform='rotate(-40 5.5 5.5)'/%3E%3C/svg%3E") calc(100% - 4px) 4px no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11'%3E%3Cdefs%3E%3CradialGradient id='g' cx='.35' cy='.3'%3E%3Cstop stop-color='%23c5ccc8'/%3E%3Cstop offset='1' stop-color='%23565e5e'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='5.5' cy='5.5' r='5' fill='url(%23g)' stroke='%23161a1b' stroke-width='.8'/%3E%3Cpath d='M1.5 5.5h8' stroke='%2315191a' stroke-width='1.4' transform='rotate(80 5.5 5.5)'/%3E%3C/svg%3E") 4px calc(100% - 4px) no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11'%3E%3Cdefs%3E%3CradialGradient id='g' cx='.35' cy='.3'%3E%3Cstop stop-color='%23c5ccc8'/%3E%3Cstop offset='1' stop-color='%23565e5e'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='5.5' cy='5.5' r='5' fill='url(%23g)' stroke='%23161a1b' stroke-width='.8'/%3E%3Cpath d='M1.5 5.5h8' stroke='%2315191a' stroke-width='1.4' transform='rotate(5 5.5 5.5)'/%3E%3C/svg%3E") calc(100% - 4px) calc(100% - 4px) no-repeat;
		--panel-face: var(--wear), var(--hammer), linear-gradient(180deg, #575c63, #474c52);
		--panel-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(0, 0, 0, 0.45), inset 0 0 22px rgba(0, 0, 0, 0.26), 0 3px 6px rgba(0, 0, 0, 0.5);
		--card-face: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.16) 0 1px, transparent 1px 3px), radial-gradient(ellipse at 50% 45%, #25210d, #100e05 85%);
		--card-ink: #efe189;
		--card-font: var(--crt);
		--card-glow: 0 0 5px rgba(255, 235, 140, 0.55);
		--card-radius: 7px;
		--card-frame: inset 0 2px 7px #000, 0 0 0 3px #30353a, 0 0 0 4px #15181b, 0 1px 0 4px rgba(255, 255, 255, 0.16);
		--well-face: #17150a;
		--well-ink: #fff0a0;
		--well-shadow: inset 0 2px 5px #000, 0 0 0 2px #4e5453, 0 1px 0 2px rgba(255, 255, 255, 0.25);
		--gauge-case: #5b6066;
		--gauge-rim: #1d2122;
		--gauge-face: #e8e1c8;
		--gauge-ink: #24231e;
		--gauge-needle: #b52c10;
		--gauge-hub: #30363a;
		--gauge-drop: rgba(0, 0, 0, 0.55);
		--gauge-plate-ink: #eceee8;
		--key-face: var(--hammer), linear-gradient(180deg, #555a61, #3c4046);
		--key-text: #fff;
		--key-border: 1px solid #111316;
		--key-radius: 2px;
		--key-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.38), inset 2px 0 0 rgba(255, 255, 255, 0.1), inset -2px 0 0 rgba(0, 0, 0, 0.18), inset 0 -3px 0 rgba(0, 0, 0, 0.3), 0 0 0 2px #2f3536, 0 5px 0 1px #1c2021, 0 8px 9px rgba(0, 0, 0, 0.55);
		--key-pressed: inset 0 2px 5px rgba(0, 0, 0, 0.55), 0 0 0 2px #2f3536, 0 1px 0 1px #1c2021;
		--track-face: linear-gradient(180deg, #0b0e0f, #2a3031);
		--track-edge: inset 0 2px 3px #000, 0 1px 0 rgba(255, 255, 255, 0.22);
		--tick: rgba(255, 255, 255, 0.34);
		--thumb-face: linear-gradient(90deg, transparent 46%, #cf3a24 46% 54%, transparent 54%), repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.3) 0 1px, rgba(255, 255, 255, 0.14) 1px 3px), linear-gradient(180deg, #b6bdba, #6a7270 55%, #4c5352);
		--thumb-edge: 1px solid #15191a;
		--thumb-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.5), inset 0 -3px 0 rgba(0, 0, 0, 0.35), 0 3px 0 #15191a, 0 5px 6px rgba(0, 0, 0, 0.6);
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
		--title-size: 26px;
		--ink-spread: 0 0 0.6px rgba(36, 35, 30, 0.75);
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
		--casing: var(--wear), var(--hammer), var(--hammer), linear-gradient(180deg, #5d7470, #4b5f5c 70%, #3f514e);
		--casing-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -2px 0 rgba(0, 0, 0, 0.45), 0 20px 60px rgba(0, 0, 0, 0.8);
		--plate-bg: var(--wear), linear-gradient(180deg, #c8c2a8, #aba58c);
		--plate-text: #1d2122;
		--text: #eef0e0;
		--text-dim: #cfd4bf;
		--text-shadow: 0 -1px 0 rgba(0, 0, 0, 0.6);
		--section-edge: 1px solid rgba(0, 0, 0, 0.5);
		--bezel-bg: var(--wear), var(--hammer), var(--hammer), linear-gradient(145deg, #546a66, #38494a);
		--bezel-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), inset 0 0 0 1px rgba(0, 0, 0, 0.5), inset 0 0 34px rgba(0, 0, 0, 0.3), 0 3px 8px rgba(0, 0, 0, 0.6);
		--tube-face: radial-gradient(circle at 50% 48%, #0f2410 0%, #081508 62%, #020602 100%);
		--tube-shadow: inset 0 0 40px 10px rgba(0, 0, 0, 0.78), inset 0 0 90px rgba(140, 240, 90, 0.08), 0 0 0 9px #171a17, 0 0 0 11px #3f4a44;
		--tube-glass:
			radial-gradient(ellipse 58% 30% at 34% 16%, rgba(220, 255, 200, 0.09), transparent 70%),
			radial-gradient(circle at 50% 50%, transparent 72%, rgba(0, 0, 0, 0.42) 100%);
		--readout: #eef0e0;
		--crt: 'Open GOST Type B', 'PT Mono', monospace;
		--engraved: 'Open GOST Type B', 'Arial Narrow', sans-serif;
		--tty: 'PT Mono', 'Courier New', monospace;
		--panel-hardware: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11'%3E%3Cdefs%3E%3CradialGradient id='g' cx='.35' cy='.3'%3E%3Cstop stop-color='%23c5ccc8'/%3E%3Cstop offset='1' stop-color='%23565e5e'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='5.5' cy='5.5' r='5' fill='url(%23g)' stroke='%23161a1b' stroke-width='.8'/%3E%3Cpath d='M1.5 5.5h8' stroke='%2315191a' stroke-width='1.4' transform='rotate(25 5.5 5.5)'/%3E%3C/svg%3E") 4px 4px no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11'%3E%3Cdefs%3E%3CradialGradient id='g' cx='.35' cy='.3'%3E%3Cstop stop-color='%23c5ccc8'/%3E%3Cstop offset='1' stop-color='%23565e5e'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='5.5' cy='5.5' r='5' fill='url(%23g)' stroke='%23161a1b' stroke-width='.8'/%3E%3Cpath d='M1.5 5.5h8' stroke='%2315191a' stroke-width='1.4' transform='rotate(-40 5.5 5.5)'/%3E%3C/svg%3E") calc(100% - 4px) 4px no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11'%3E%3Cdefs%3E%3CradialGradient id='g' cx='.35' cy='.3'%3E%3Cstop stop-color='%23c5ccc8'/%3E%3Cstop offset='1' stop-color='%23565e5e'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='5.5' cy='5.5' r='5' fill='url(%23g)' stroke='%23161a1b' stroke-width='.8'/%3E%3Cpath d='M1.5 5.5h8' stroke='%2315191a' stroke-width='1.4' transform='rotate(80 5.5 5.5)'/%3E%3C/svg%3E") 4px calc(100% - 4px) no-repeat, url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='11' height='11'%3E%3Cdefs%3E%3CradialGradient id='g' cx='.35' cy='.3'%3E%3Cstop stop-color='%23c5ccc8'/%3E%3Cstop offset='1' stop-color='%23565e5e'/%3E%3C/radialGradient%3E%3C/defs%3E%3Ccircle cx='5.5' cy='5.5' r='5' fill='url(%23g)' stroke='%23161a1b' stroke-width='.8'/%3E%3Cpath d='M1.5 5.5h8' stroke='%2315191a' stroke-width='1.4' transform='rotate(5 5.5 5.5)'/%3E%3C/svg%3E") calc(100% - 4px) calc(100% - 4px) no-repeat;
		--panel-face: var(--wear), var(--hammer), linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.14));
		--panel-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), inset 0 -1px 0 rgba(0, 0, 0, 0.5), inset 0 0 22px rgba(0, 0, 0, 0.28), 0 3px 6px rgba(0, 0, 0, 0.6);
		--card-face: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.2) 0 1px, transparent 1px 3px), #070a05;
		--card-ink: #ffb066;
		--card-font: var(--crt);
		--card-glow: 0 0 5px rgba(255, 150, 70, 0.55);
		--card-radius: 2px;
		--card-frame: inset 0 2px 6px #000, 0 0 0 2px #171917, 0 0 0 3px #000, 0 1px 0 3px rgba(255, 255, 255, 0.13);
		--well-face: #050b05;
		--well-ink: #ffb066;
		--well-shadow: inset 0 2px 5px #000, 0 0 0 2px #171917, 0 1px 0 2px rgba(255, 255, 255, 0.14);
		--gauge-case: #1f1f1c;
		--gauge-rim: #000;
		--gauge-face: #0d1a10;
		--gauge-ink: #b7e29a;
		--gauge-needle: #ff8a2a;
		--gauge-hub: #30302c;
		--gauge-drop: rgba(0, 0, 0, 0.75);
		--gauge-plate-ink: #d9d6bf;
		--key-face: var(--hammer), linear-gradient(180deg, #30302c, #141412);
		--key-text: #f2f0dd;
		--key-border: 1px solid #000;
		--key-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.2), inset 2px 0 0 rgba(255, 255, 255, 0.06), inset -2px 0 0 rgba(0, 0, 0, 0.4), inset 0 -3px 0 rgba(0, 0, 0, 0.5), 0 0 0 2px #07090a, 0 5px 0 1px #030303, 0 8px 9px rgba(0, 0, 0, 0.7);
		--key-pressed: inset 0 2px 6px #000, 0 0 0 2px #07090a, 0 1px 0 1px #030303;
		--track-face: linear-gradient(180deg, #030403, #1b1f1a);
		--track-edge: inset 0 2px 3px #000, 0 1px 0 rgba(255, 255, 255, 0.13);
		--tick: rgba(242, 240, 221, 0.3);
		--thumb-face: linear-gradient(90deg, transparent 46%, #ff8a2a 46% 54%, transparent 54%), repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0 1px, rgba(255, 255, 255, 0.07) 1px 3px), linear-gradient(180deg, #45453e, #1b1b18 55%, #0c0c0a);
		--thumb-edge: 1px solid #000;
		--thumb-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.25), inset 0 -3px 0 rgba(0, 0, 0, 0.6), 0 3px 0 #000, 0 5px 6px rgba(0, 0, 0, 0.8);
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
		--ink-spread: 0 0 0.6px rgba(35, 36, 31, 0.75);
		--prompt: #ffb35c;
	}

	/* ---------- CHART: a printed sheet on a planner's table, marked by hand ---------- */
	.room[data-theme='paper'] {
		--sheet: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.7' numOctaves='4'/%3E%3CfeColorMatrix values='0 0 0 0 .35 0 0 0 0 .28 0 0 0 0 .18 0 0 0 .11 0'/%3E%3C/filter%3E%3Crect width='240' height='240' filter='url(%23p)'/%3E%3C/svg%3E");
		--room-bg: linear-gradient(115deg, #2c3a30, #1f2a23 60%, #161e19);
		--casing: none;
		--casing-shadow: none;
		--plate-bg: var(--wear), var(--sheet), #d9c48f;
		--plate-edge: 1px solid #93794a;
		--plate-text: #1d2122;
		--text: #2b261c;
		--text-dim: #4a4233;
		--text-shadow: none;
		--section-edge: 1px solid #b7ab8a;
		--bezel-bg: var(--fold), var(--wear), var(--sheet), #ece3c9;
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
		--crt: 'Architects Daughter', cursive;
		--engraved: 'Architects Daughter', cursive;
		--tty: 'Courier Prime', 'Courier New', monospace;
		--wear: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='640' height='640'%3E%3Cfilter id='a' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.006 .009' numOctaves='3' seed='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.42 0 0 0 0 0.3 0 0 0 0 0.12 1.6 0 0 0 -0.6'/%3E%3C/filter%3E%3Cfilter id='b' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.003 .5' numOctaves='2' seed='7' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.27 0 0 0 0 0.15 3.2 0 0 0 -1.92'/%3E%3C/filter%3E%3Cfilter id='c' x='0' y='0' width='100%25' height='100%25'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.33' numOctaves='2' seed='11' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.3 0 0 0 0 0.2 0 0 0 0 0.08 9 0 0 0 -6.5'/%3E%3C/filter%3E%3Crect width='640' height='640' filter='url(%23a)' opacity='0.08'/%3E%3Crect width='640' height='640' filter='url(%23b)' opacity='0.03'/%3E%3Crect width='640' height='640' filter='url(%23c)' opacity='0.04'/%3E%3C/svg%3E");
		--fold: linear-gradient(90deg, transparent calc(50% - 1px), rgba(90, 70, 40, 0.2) calc(50% - 1px), rgba(255, 255, 255, 0.4) 50%, transparent calc(50% + 1px));
		--panel-hardware: none;
		--panel-face: var(--wear);
		--panel-shadow: none;
		--card-face: none;
		--card-ink: #2b261c;
		--card-font: var(--tty);
		--card-glow: none;
		--card-radius: 0;
		--card-frame: none;
		--well-face: none;
		--well-ink: #2b261c;
		--well-shadow: none;
		--gauge-case: #eee6d0;
		--gauge-rim: #6d6248;
		--gauge-face: #f6efdc;
		--gauge-ink: #2b261c;
		--gauge-needle: #a01d16;
		--gauge-hub: #a01d16;
		--gauge-drop: rgba(60, 50, 30, 0.35);
		--gauge-plate-ink: #2b261c;
		--key-face: var(--sheet), #f3ecd8;
		--key-text: #2b261c;
		--key-border: 1px solid #6d6248;
		--key-radius: 1px;
		--key-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), inset 0 -2px 0 rgba(90, 76, 45, 0.28), 0 0 0 1px #8b7d5c, 0 3px 0 #8b7d5c, 0 5px 5px rgba(60, 50, 30, 0.4);
		--key-pressed: inset 0 2px 4px rgba(60, 50, 30, 0.45), 0 0 0 1px #8b7d5c;
		--track-face: linear-gradient(180deg, #b9ab87, #e3d9bd);
		--track-edge: inset 0 2px 2px rgba(60, 50, 30, 0.55), 0 1px 0 rgba(255, 255, 255, 0.7);
		--tick: rgba(60, 50, 30, 0.5);
		--thumb-face: linear-gradient(90deg, transparent 47%, #a01d16 47% 53%, transparent 53%), linear-gradient(180deg, #f2d98e, #c79d3f 55%, #8d6a20);
		--thumb-edge: 1px solid #5c4413;
		--thumb-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75), inset 0 -2px 0 rgba(70, 50, 10, 0.4), 0 3px 0 #5c4413, 0 5px 5px rgba(60, 50, 30, 0.5);
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
		--ink-spread: none;
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

	/* Fixed columns, so a theme's font width can't move anything to another row. */
	.plate {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: minmax(0, 1fr) 270px 300px 354px;
		grid-auto-rows: 50px;
		align-items: center;
		gap: 6px 14px;
		padding: 6px 12px;
		border: var(--plate-edge);
		border-radius: 3px;
		background: var(--plate-bg);
		color: var(--plate-text);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28);
	}
	.title {
		display: flex;
		align-items: baseline;
		gap: 12px;
		min-width: 0;
	}
	.title strong {
		flex: none;
	}
	.title span,
	.serial span {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.title strong {
		font-size: var(--title-size);
		letter-spacing: 0.28em;
	}
	.title span,
	.serial span,
	.tally span {
		font-size: 12px;
		letter-spacing: 0.05em;
	}
	.serial {
		display: flex;
		flex-direction: column;
		min-width: 0;
		font-variant-numeric: tabular-nums;
	}
	.tally {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr 96px;
		align-items: center;
		gap: 6px;
		font-size: 15px;
	}
	.tally span {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		line-height: 1.1;
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
		display: grid;
		grid-template-columns: 72px 96px 56px 56px 58px;
		gap: 4px;
	}
	.selector .key,
	.tally .key {
		padding: 2px 0;
		white-space: nowrap;
		overflow: hidden;
		letter-spacing: 0.02em;
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
		width: min(100%, calc(100dvh - 114px));
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
	.switches .key {
		min-width: 112px;
		padding-inline: 4px;
	}
	.group-label {
		width: 170px;
		margin-right: 4px;
		white-space: nowrap;
		text-align: right;
		font-size: 13px;
		letter-spacing: 0.1em;
		color: var(--text);
		text-shadow: var(--text-shadow);
	}
	/* Decoration only, placed so it can't push the keys off their common position. */
	.switches {
		position: relative;
		width: 100%;
		container-type: inline-size;
	}
	/* They sit at the ends of the row, and go when the keys need the room. */
	@container (max-width: 830px) {
		.gun {
			display: none;
		}
	}
	@container (max-width: 680px) {
		.dial {
			display: none;
		}
	}
	.gun {
		position: absolute;
		left: 0;
		top: 50%;
		width: 126px;
		height: auto;
		transform: translateY(-50%);
	}
	.dial {
		position: absolute;
		right: 0;
		top: 50%;
		width: 54px;
		height: 54px;
		transform: translateY(-50%);
	}

	/* Illuminated pushbuttons. */
	.key {
		appearance: none;
		min-height: 46px;
		padding: 6px 12px;
		border: var(--key-border);
		border-radius: var(--key-radius);
		font: 14px var(--engraved);
		letter-spacing: 0.06em;
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
		transform: translateY(4px);
		box-shadow: var(--key-pressed);
	}
	.key:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.key.small {
		min-height: 36px;
		padding: 2px 8px;
		font-size: 12px;
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
		height: clamp(140px, calc(20dvh - 22px), 420px);
		overflow-y: auto;
		padding: 12px 14px 16px;
		background:
			repeating-linear-gradient(180deg, transparent 0 25px, rgba(60, 90, 70, 0.08) 25px 26px),
			var(--paper);
		color: var(--ink);
		font: 14px/1.45 var(--tty);
		text-shadow: var(--ink-spread);
		box-shadow: inset 0 10px 10px -8px rgba(0, 0, 0, 0.6);
	}
	.roll.reporting {
		height: auto;
		/* Leaves room for the buttons below it, so they don't start off screen. */
		max-height: calc(100dvh - 300px);
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

	/* Each section is its own plate, screwed to the casing. */
	.rack,
	.dials,
	.commit,
	.actions {
		padding: 8px 20px;
		border: var(--section-edge);
		border-radius: 3px;
		background: var(--panel-hardware), var(--panel-face);
		box-shadow: var(--panel-shadow);
	}
	/* What changes per game shows on a small display, or is typed on the sheet. Engraving is only for what never changes. */
	.card {
		padding: 3px 9px;
		border-radius: var(--card-radius);
		color: var(--card-ink);
		font-family: var(--card-font);
		text-shadow: var(--card-glow);
		background: var(--card-face);
		box-shadow: var(--card-frame);
	}
	.card span,
	.card strong {
		color: inherit;
		font-family: inherit;
		text-shadow: inherit;
	}
	.dial-head .card {
		flex: 1;
		min-width: 0;
	}
	.dial-head .card strong,
	.dial-head .card span {
		color: var(--card-ink);
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.dial-head .card strong {
		font-size: 17px;
		letter-spacing: 0.01em;
	}
	.dial-head .card span {
		font-size: 11px;
		letter-spacing: 0;
	}
	.legend {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		margin-top: 1px;
		padding: 3px 1px;
		border-radius: 1px;
		font-family: var(--tty);
	}
	.legend .nm,
	.legend .yd {
		font-family: inherit;
		letter-spacing: 0;
	}
	.legend .nm {
		font-size: 13px;
		font-weight: 700;
	}
	.legend .yd {
		font-size: 11px;
	}
	/* Units sit in the readout's window too, since they change with the value. */
	.slider small {
		padding: 1px 3px;
		color: var(--well-ink);
		background: var(--well-face);
		box-shadow: var(--well-shadow);
		border-radius: 1px;
	}
	.rack h2,
	.engrave,
	.digital h3 {
		margin: 0 0 8px;
		font-size: 14px;
		line-height: 18px;
		letter-spacing: 0.1em;
		color: var(--text-dim);
		text-shadow: var(--text-shadow);
	}
	.learn {
		margin-bottom: 8px;
	}
	.engrave {
		margin: 8px 0 0;
		text-align: center;
	}
	.keys {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(64px, 1fr));
		gap: 9px 8px;
		padding-bottom: 6px;
	}
	.warhead {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 64px;
		padding: 3px 3px;
		letter-spacing: 0.04em;
	}
	.keys.dense .warhead {
		height: 52px;
	}
	.keys.dense .legend .nm {
		font-size: 12px;
	}
	.keys.dense .warhead .no {
		position: absolute;
		top: 1px;
		left: 3px;
		z-index: 1;
		font-size: 8px;
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
		line-height: 24px;
		letter-spacing: 0.05em;
		text-shadow: var(--text-shadow);
	}
	.dial-head span,
	.prompt {
		display: block;
		line-height: 18px;
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
		grid-template-columns: 66px minmax(0, 1fr) 166px;
		align-items: center;
		gap: 10px;
		height: 44px;
		margin-top: 5px;
		font-size: 14px;
		letter-spacing: 0.1em;
	}
	.slider output {
		display: inline-flex;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		font-size: 23px;
	}
	.slider small {
		width: 54px;
		font: 12px var(--engraved);
		letter-spacing: 0.04em;
	}
	.slider .num {
		font-size: 15px;
	}
	/* A long slot cut in the panel with a scale beneath it, and a heavy ridged slider block riding in it. */
	.slider input {
		appearance: none;
		width: 100%;
		height: 44px;
		margin: 0;
		cursor: grab;
		background: repeating-linear-gradient(90deg, var(--tick) 0 1px, transparent 1px calc(10% - 0.1px)) 0 100% / 100% 6px no-repeat;
	}
	.slider input:active {
		cursor: grabbing;
	}
	.slider input::-webkit-slider-runnable-track {
		height: 14px;
		border-radius: 3px;
		background: var(--track-face);
		box-shadow: var(--track-edge);
	}
	.slider input::-moz-range-track {
		height: 14px;
		border-radius: 3px;
		background: var(--track-face);
		box-shadow: var(--track-edge);
	}
	.slider input::-webkit-slider-thumb {
		appearance: none;
		width: 30px;
		height: 36px;
		margin-top: -11px;
		border: var(--thumb-edge);
		border-radius: 3px;
		background: var(--thumb-face);
		box-shadow: var(--thumb-shadow);
	}
	.slider input::-moz-range-thumb {
		box-sizing: border-box;
		width: 30px;
		height: 36px;
		border: var(--thumb-edge);
		border-radius: 3px;
		background: var(--thumb-face);
		box-shadow: var(--thumb-shadow);
	}
	.slider input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	.slider input:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.presets {
		display: flex;
		flex-wrap: wrap;
		gap: 7px;
		margin-top: 12px;
		padding-bottom: 6px;
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
		display: flex;
		align-items: center;
		height: 30px;
		margin: 0;
		font-size: 19px;
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
		height: 88px;
		perspective: 500px;
	}
	.fire {
		position: absolute;
		inset: 0;
		border: 2px solid #1a0a06;
		border-radius: 4px;
		font: 21px var(--engraved);
		letter-spacing: 0.14em;
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
		font: 14px var(--engraved);
		letter-spacing: 0.08em;
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
		font-size: 15px;
		color: #1d2122;
	}
	[data-theme='pvo'] .fire {
		inset: 2px auto auto 50%;
		width: 72px;
		height: 72px;
		margin-left: -36px;
		border-radius: 50%;
		border: 4px solid #2a2a26;
		font-size: 19px;
		letter-spacing: 0.08em;
		box-shadow: inset 0 3px 3px rgba(255, 255, 255, 0.5), inset 0 -6px 8px rgba(90, 0, 0, 0.5), 0 0 22px rgba(255, 90, 51, 0.6), 0 0 0 3px #101010;
	}
	[data-theme='pvo'] .guard.open .fire {
		top: 16px;
	}

	/* ---------- CHART materials ---------- */
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
		letter-spacing: 0.22em;
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
	[data-theme='paper'] .key {
		letter-spacing: 0.02em;
	}
	[data-theme='paper'] .key:not(.small) {
		font-size: 15px;
	}
	[data-theme='paper'] .warhead.armed::after {
		content: '✓';
		position: absolute;
		top: 0;
		right: 2px;
		font-size: 10px;
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
		font: 700 21px var(--tty);
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

	/* Same rearrangement for every theme as the window narrows. */
	@media (max-width: 1300px) {
		.plate {
			grid-template-columns: minmax(0, 1fr) 354px;
		}
		.tally {
			order: 3;
		}
		.selector {
			order: 2;
		}
		.serial {
			order: 4;
			grid-column: 1;
			grid-row: 2;
		}
		.tally {
			grid-column: 2;
			grid-row: 2;
		}
	}

	@media (max-width: 900px) {
		.serial,
		.tally {
			grid-column: 1;
			grid-row: auto;
		}
		.console {
			grid-template-columns: minmax(0, 1fr);
			padding: 8px;
			border-radius: 0;
		}
		.bezel {
			width: 100%;
			min-width: 0;
		}
		.plate {
			grid-template-columns: minmax(0, 1fr);
		}
		.title span {
			display: none;
		}
		.selector {
			grid-template-columns: 1fr 1.3fr 0.8fr 0.8fr 0.8fr;
		}
		.slider {
			grid-template-columns: 58px minmax(0, 1fr) 150px;
		}
		.rack,
		.dials,
		.commit,
		.actions {
			padding: 8px 12px;
			background: var(--panel-face);
		}
		.switches .key {
			min-width: 0;
		}
		.group-label {
			min-width: 0;
			width: 100%;
			text-align: center;
		}
		.roll {
			height: 200px;
		}
		.plate {
			grid-auto-rows: auto;
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
