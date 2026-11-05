import { toReachable } from './controls';
import { optimumHobM, type Precip, type Weather } from './effects';
import type { Place, TheatreData } from './data';
import { between, intBetween, pick, rngFor, shuffled, type Rng } from './rng';
import {
	checksFor,
	evaluate,
	lowerIsBetter,
	probesFor,
	scoreValue,
	toBurst,
	type Check,
	type ObjectiveKind,
	type Placement,
	type Scenario,
	type Site,
	type Zone
} from './scenario';
import { distanceKm, Sim, type Tally } from './sim';
import { THEATRES, theatreById, type Theatre } from './theatres';
import { WEAPONS, hasDial, type Weapon } from './weapons';

const MS_DAY = 86400000;
const EPOCH = Date.UTC(2026, 10, 5);

/** Puzzle number for a local calendar date. No. 1 is 5 November 2026. */
export function dayNumber(date: Date): number {
	return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - EPOCH) / MS_DAY) + 1;
}

export const dateOfDay = (day: number) => new Date(EPOCH + (day - 1) * MS_DAY).toISOString().slice(0, 10);

const KINDS: ObjectiveKind[] = ['fatalities', 'counterforce', 'structures', 'economy', 'denial', 'surgical', 'blackout'];
// On anything smaller, one high burst covers the whole map and there is no puzzle.
const BLACKOUT_THEATRES = new Set(['usa', 'wld']);

/** Each theatre and each objective comes up once per cycle, in a seeded order. */
function theatreForDay(day: number): Theatre {
	const len = THEATRES.length;
	const cycle = Math.floor((day - 1) / len);
	return shuffled(rngFor(cycle, 'theatres'), THEATRES)[(day - 1) % len];
}

function kindForDay(day: number, theatre: Theatre): ObjectiveKind {
	const cycle = Math.floor((day - 1) / KINDS.length);
	const kind = shuffled(rngFor(cycle, 'kinds'), KINDS)[(day - 1) % KINDS.length];
	const blackoutOk = BLACKOUT_THEATRES.has(theatre.id);
	if (blackoutOk && rngFor(day, 'blackout')() < 0.5) return 'blackout';
	if (kind === 'blackout' && !blackoutOk) return pick(rngFor(day, 'stand-in'), KINDS.slice(0, -1));
	return kind;
}

function rollWeather(rng: Rng): Weather {
	const precip = pick<Precip>(rng, ['CLEAR', 'CLEAR', 'CLEAR', 'HAZE', 'OVERCAST', 'RAIN', 'SNOW']);
	return {
		precip,
		windBearing: Math.round(between(rng, 0, 72)) * 5,
		windKmh: Math.round(between(rng, 8, 90))
	};
}

function rollArsenal(rng: Rng, theatre: Theatre, kind: ObjectiveKind): Weapon[] {
	const pool = WEAPONS.filter((w) => w.tiers.includes(theatre.kind));
	const [lo, hi] = theatre.kind === 'city' ? [2, 5] : theatre.kind === 'region' ? [3, 8] : [5, 10];
	if (kind === 'blackout') {
		const strategic = WEAPONS.filter((w) => !w.surfaceOnly && w.maxKt >= 100 && w.maxKt <= 2000);
		return Array.from({ length: intBetween(rng, 2, 3) }, () => pick(rng, strategic));
	}
	const usable = kind === 'denial' ? pool.filter((w) => w.fission >= 0.25 && w.maxKt >= 1) : pool;
	const types = Array.from({ length: intBetween(rng, 1, 3) }, () => pick(rng, usable));
	const count = intBetween(rng, lo, hi);
	const arsenal = Array.from({ length: count }, (_, i) => types[i % types.length]);
	return arsenal.sort((a, b) => b.maxKt - a.maxKt);
}

function landmarksOf(theatre: Theatre, data: TheatreData): Place[] {
	if (theatre.landmarks) return theatre.landmarks.map((l) => ({ ...l, pop: 0 }));
	return data.meta.places;
}

const SITE_NAMES = ['SILO FIELD', 'COMMAND BUNKER', 'RADAR STATION', 'AIR BASE', 'DEPOT', 'SUB PEN', 'SIGNALS SITE'];

/** Invented military sites at thinly peopled cells, so they read true to the map. */
function inventSites(rng: Rng, data: TheatreData, count: number): Place[] {
	const { grid } = data;
	const sites: Place[] = [];
	const quiet: number[] = [];
	for (let i = 0; i < grid.n; i++) if (grid.pop[i] < 30 * Math.max(1, grid.cellKm)) quiet.push(i);
	const fallback = Array.from({ length: grid.n }, (_, i) => i);
	const from = quiet.length >= 40 ? quiet : fallback;
	for (let tries = 0; tries < 300 && sites.length < count; tries++) {
		const i = pick(rng, from);
		const lat = grid.lat[i];
		const lon = grid.lon[i];
		const spaced = sites.every((s) => distanceKm(s.lat, s.lon, lat, lon) > grid.cellKm * 8);
		if (spaced) {
			const tag = `${String.fromCharCode(65 + intBetween(rng, 0, 25))}-${intBetween(rng, 1, 9)}`;
			sites.push({ name: `${pick(rng, SITE_NAMES)} ${tag}`, lat, lon, pop: 0 });
		}
	}
	return sites;
}

const round2 = (v: number) => {
	if (v <= 0) return 0;
	const m = Math.pow(10, Math.floor(Math.log10(v)) - 1);
	return Math.round(v / m) * m;
};

const round3 = (v: number) => {
	if (v <= 0) return 0;
	const m = Math.pow(10, Math.floor(Math.log10(v)) - 2);
	return Math.round(v / m) * m;
};

function shortfall(checks: Check[]): number {
	return checks.reduce((sum, c) => sum + (c.ok ? 0 : 1), 0);
}

/** How the solver scores a candidate. Infeasibility dominates, with a slope toward fixing it. */
function fitness(s: Scenario, bursts: ReturnType<typeof toBurst>[], t: Tally, scale: number): number {
	const checks = checksFor(s, bursts, t);
	let penalty = shortfall(checks) * scale * 4;
	// Gradients for goals that are close to met.
	if (s.goal > 0 && (s.kind === 'economy' || s.kind === 'surgical')) {
		const have =
			s.kind === 'surgical' ? t.zoneStructures : s.economyMetric === 'structures' ? t.structures : t.fatalities;
		if (have < s.goal) penalty += ((s.goal - have) / s.goal) * scale * 8;
	}
	if (s.kind === 'counterforce') {
		s.targets.forEach((site, i) => {
			if (t.probePsi[i] < site.psi) penalty += (1 - t.probePsi[i] / site.psi) * scale * 2;
		});
	}
	const v = scoreValue(s, t);
	return (lowerIsBetter(s.kind) ? -v : v) - penalty;
}

/**
 * Greedy placement then local refinement. It is the source of each puzzle's par,
 * and proof the puzzle can be solved, so it only needs to be good, not optimal.
 */
export function solve(s: Scenario, sim: Sim, rng: Rng, effort = 1): Placement[] {
	const { grid } = sim;
	const weightOf = (i: number) => {
		if (s.kind === 'structures' || s.kind === 'surgical') return grid.structures[i];
		if (s.kind === 'economy' && s.economyMetric === 'structures') return grid.structures[i];
		return grid.pop[i];
	};
	const cum = new Float64Array(grid.n);
	let acc = 0;
	for (let i = 0; i < grid.n; i++) {
		acc += weightOf(i);
		cum[i] = acc;
	}
	const sampleCell = () => {
		const r = rng() * acc;
		let lo = 0;
		let hi = grid.n - 1;
		while (lo < hi) {
			const m = (lo + hi) >> 1;
			if (cum[m] < r) lo = m + 1;
			else hi = m;
		}
		return lo;
	};
	const scale = Math.max(grid.totalPop, grid.totalStructures, 1e4);
	const rating = (ps: Placement[]) => {
		const bursts = ps.map((p) => toBurst(s, p));
		return fitness(s, bursts, sim.tally(bursts), s.kind === 'economy' ? scale * 1e4 : scale);
	};

	const heightsFor = (w: Weapon, kt: number): number[] => {
		if (s.kind === 'blackout') return [60000, 150000, 300000, 450000];
		if (w.surfaceOnly || s.hobLock) return [0];
		if (s.kind === 'denial') return [0];
		return [0, optimumHobM(kt)];
	};
	const yieldsFor = (w: Weapon): number[] => {
		if (!hasDial(w) || s.yieldLock) return [w.maxKt];
		if (s.kind === 'economy' || s.kind === 'counterforce' || s.kind === 'surgical' || s.maxYieldKt)
			return [w.minKt, Math.sqrt(w.minKt * w.maxKt), w.maxKt];
		return [w.maxKt];
	};
	const positionsFor = (count: number): { lat: number; lon: number }[] => {
		const out: { lat: number; lon: number }[] = [];
		if (s.kind === 'counterforce') out.push(...s.targets.map((t) => ({ lat: t.lat, lon: t.lon })));
		if (s.kind === 'surgical' && s.targetZone) out.push({ lat: s.targetZone.lat, lon: s.targetZone.lon });
		if (s.kind === 'blackout') out.push({ lat: s.theatre.lat === 90 ? 60 : s.theatre.lat, lon: s.theatre.lon });
		while (out.length < count) {
			const i = sampleCell();
			out.push({ lat: grid.lat[i], lon: grid.lon[i] });
		}
		return out;
	};

	const inScope = (lat: number, lon: number) =>
		distanceKm(s.theatre.lat, s.theatre.lon, lat, lon) <= s.theatre.radiusKm;
	const order = s.arsenal.map((w, slot) => ({ w, slot }));
	const placed: Placement[] = [];
	let best = rating(placed);
	const positions = Math.round((s.theatre.kind === 'city' ? 22 : 30) * effort);

	for (const { w, slot } of order) {
		let top: Placement | null = null;
		let topScore = s.allMustFly ? -Infinity : best;
		for (const pos of positionsFor(positions)) {
			for (const kt of yieldsFor(w)) {
				for (const hobM of heightsFor(w, kt)) {
					const cand: Placement = { slot, lat: pos.lat, lon: pos.lon, kt, hobM };
					const f = rating([...placed, cand]);
					if (f > topScore) {
						topScore = f;
						top = cand;
					}
				}
			}
		}
		if (top) {
			placed.push(top);
			best = topScore;
		}
	}

	// Refine: nudge each warhead in shrinking steps, and try dropping it.
	const reach = s.theatre.kind === 'city' ? 8 : s.theatre.radiusKm / 25;
	for (const stepKm of [reach, reach / 3]) {
		for (let i = 0; i < placed.length; i++) {
			const cur = placed[i];
			const w = s.arsenal[cur.slot];
			const others = placed.filter((_, k) => k !== i);
			if (!s.allMustFly) {
				const f = rating(others);
				if (f >= best) {
					placed.splice(i, 1);
					best = f;
					i--;
					continue;
				}
			}
			for (let k = 0; k < Math.round(8 * effort); k++) {
				const a = rng() * 2 * Math.PI;
				const km = stepKm * Math.sqrt(rng());
				const lat = cur.lat + (km * Math.cos(a)) / 111.2;
				const lon = cur.lon + (km * Math.sin(a)) / (111.2 * Math.max(0.15, Math.cos((cur.lat * Math.PI) / 180)));
				if (!inScope(lat, lon)) continue;
				for (const kt of yieldsFor(w)) {
					for (const hobM of heightsFor(w, kt)) {
						const cand: Placement = { slot: cur.slot, lat, lon, kt, hobM };
						const f = rating([...others, cand]);
						if (f > best) {
							best = f;
							placed[i] = cand;
						}
					}
				}
			}
		}
	}
	return placed;
}

function rollConditions(rng: Rng, s: Scenario, data: TheatreData, places: Place[]) {
	const { kind, theatre } = s;
	const roll = rng();
	const count = roll < 0.25 ? 0 : roll < 0.75 ? 1 : 2;
	const options = shuffled(rng, ['hob', 'yield', 'protect', 'exclusion', 'nofire', 'all', 'budget'] as const);
	const free = places.filter((p) => !s.targets.some((t) => t.name === p.name) && p.name !== s.targetZone?.name);
	let used = 0;
	for (const o of options) {
		if (used >= count) break;
		switch (o) {
			case 'hob': {
				if (kind === 'blackout') break;
				s.hobLock = kind === 'denial' ? 'SURFACE' : rng() < 0.5 ? 'SURFACE' : 'AIRBURST';
				if (s.hobLock === 'AIRBURST' && s.arsenal.some((w) => w.surfaceOnly)) {
					s.hobLock = 'SURFACE';
				}
				used++;
				break;
			}
			case 'yield':
				if (s.arsenal.some(hasDial)) {
					s.yieldLock = true;
					used++;
				}
				break;
			case 'protect': {
				if (kind === 'blackout' || free.length < 2) break;
				const n = intBetween(rng, 1, 2);
				s.protected = shuffled(rng, free)
					.slice(0, n)
					.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, psi: pick(rng, [1, 3, 5]) }));
				used++;
				break;
			}
			case 'exclusion': {
				if (kind === 'blackout' || free.length === 0) break;
				const taken = new Set(s.protected.map((p) => p.name));
				const pool = free.filter((p) => !taken.has(p.name));
				if (pool.length === 0) break;
				const p = pick(rng, pool);
				s.exclusion = { name: p.name, lat: p.lat, lon: p.lon, km: theatre.radiusKm * 0.05 };
				used++;
				break;
			}
			case 'nofire': {
				if (kind === 'counterforce' || kind === 'surgical' || free.length === 0) break;
				const p = pick(rng, free);
				s.noFire = { name: p.name, lat: p.lat, lon: p.lon, km: theatre.radiusKm * between(rng, 0.08, 0.2) };
				used++;
				break;
			}
			case 'all':
				if (kind === 'economy' || kind === 'counterforce' || kind === 'surgical' || kind === 'blackout') break;
				s.allMustFly = true;
				used++;
				break;
			case 'budget':
				if (kind === 'economy') break;
				s.maxYieldKt = round2(s.arsenal.reduce((sum, w) => sum + w.maxKt, 0) * between(rng, 0.5, 0.8));
				if (s.maxYieldKt < Math.min(...s.arsenal.map((w) => w.minKt))) {
					s.maxYieldKt = undefined;
					break;
				}
				used++;
				break;
		}
	}
}

function buildBase(day: number, attempt: number, theatre: Theatre, data: TheatreData): { s: Scenario; rng: Rng } {
	const rng = rngFor(day, `scenario-${attempt}`);
	const kind = kindForDay(day, theatre);
	const s: Scenario = {
		day,
		date: dateOfDay(day),
		theatre,
		weather: rollWeather(rng),
		arsenal: rollArsenal(rng, theatre, kind),
		kind,
		goal: 0,
		par: 0,
		slack: 0,
		targets: [],
		protected: [],
		wargames: 3
	};
	if (kind === 'counterforce' || kind === 'surgical') s.slack = round2(data.grid.totalPop * 0.002);
	const places = landmarksOf(theatre, data);
	if (kind === 'counterforce') {
		const n = Math.min(s.arsenal.length, intBetween(rng, 2, 4));
		const from = theatre.kind === 'city' ? shuffled(rng, places).slice(0, n) : inventSites(rng, data, n);
		s.targets = from.map(
			(p): Site => ({
				name: p.name,
				lat: p.lat,
				lon: p.lon,
				psi: theatre.kind === 'city' ? pick(rng, [10, 20, 50]) : pick(rng, [20, 50, 100, 200])
			})
		);
	}
	if (kind === 'surgical') {
		const p = pick(rng, places.slice(0, 12));
		const km = theatre.kind === 'city' ? between(rng, 5, 12) : theatre.radiusKm * between(rng, 0.03, 0.06);
		s.targetZone = { name: p.name, lat: p.lat, lon: p.lon, km } satisfies Zone;
	}
	if (kind === 'economy') s.economyMetric = rng() < 0.5 ? 'fatalities' : 'structures';
	rollConditions(rng, s, data, places);
	return { s, rng };
}

const simFor = (s: Scenario, data: TheatreData) =>
	new Sim(data.grid, s.weather, probesFor(s), s.targetZone);

/** Set the goal and par by solving. Returns the sim and the solution, or null if unsolvable. */
function calibrate(s: Scenario, data: TheatreData, rng: Rng): { sim: Sim; solution: Placement[] } | null {
	const sim = simFor(s, data);
	const passes = (ps: Placement[]) => evaluate(s, sim, ps).checks.every((c) => c.ok);
	const solveReachable = (scn: Scenario, scnSim: Sim) => solve(scn, scnSim, rng).map((p) => toReachable(scn, p));
	let solution: Placement[];
	if (s.kind === 'counterforce') {
		solution = solveReachable(s, sim);
		if (!passes(solution)) return null;
		s.par = round3(Math.max(evaluate(s, sim, solution).value, 1));
	} else if (s.kind === 'economy' || s.kind === 'surgical') {
		// First learn how much damage is on offer, then ask for part of it for less.
		const probe: Scenario = { ...s, kind: s.kind === 'surgical' ? 'structures' : s.economyMetric! };
		const probeSim = s.kind === 'surgical' ? sim : simFor(probe, data);
		const reachable = solve(probe, probeSim, rng);
		const t = sim.tally(reachable.map((p) => toBurst(s, p)));
		const have = s.kind === 'surgical' ? t.zoneStructures : s.economyMetric === 'structures' ? t.structures : t.fatalities;
		if (have <= 0) return null;
		s.goal = round2(have * (s.kind === 'surgical' ? 0.6 : 0.4));
		solution = solveReachable(s, sim);
		if (!passes(solution)) return null;
		s.par = round3(Math.max(evaluate(s, sim, solution).value, s.kind === 'economy' ? 0.01 : 1));
	} else {
		solution = solveReachable(s, sim);
		const best = scoreValue(s, sim.tally(solution.map((p) => toBurst(s, p))));
		if (best <= 0) return null;
		s.goal = round2(best * 0.6);
		s.par = round3(best);
		if (!passes(solution)) return null;
		// A blackout that any burst completes is no puzzle.
		if (s.kind === 'blackout' && best > data.grid.totalPop * 0.97) return null;
	}
	return { sim, solution };
}

export interface Generated {
	scenario: Scenario;
	sim: Sim;
	/** A passing plan, using only settings the console can produce. */
	solution: Placement[];
	/** True if every roll failed and conditions were stripped to get a puzzle. */
	fallback: boolean;
}

export const theatreIdForDay = (day: number) => theatreForDay(day).id;

/** The daily puzzle. Pure in the day number and the theatre's data. */
export function generate(day: number, data: TheatreData): Generated {
	const theatre = theatreById(theatreIdForDay(day));
	for (let attempt = 0; attempt < 12; attempt++) {
		const { s, rng } = buildBase(day, attempt, theatre, data);
		const result = calibrate(s, data, rng);
		if (result) return { scenario: s, ...result, fallback: false };
	}
	// Last resort, every warhead free and no conditions, always solvable.
	const rng = rngFor(day, 'fallback');
	const s: Scenario = {
		day,
		date: dateOfDay(day),
		theatre,
		weather: rollWeather(rng),
		arsenal: rollArsenal(rng, theatre, 'fatalities'),
		kind: 'fatalities',
		goal: 0,
		par: 0,
		slack: 0,
		targets: [],
		protected: [],
		wargames: 3
	};
	const result = calibrate(s, data, rng);
	if (!result) throw new Error(`no puzzle for day ${day}`);
	return { scenario: s, ...result, fallback: true };
}

