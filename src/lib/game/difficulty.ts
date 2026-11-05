import { optimumHobM } from './effects';
import { pick, rngFor, type Rng } from './rng';
import { evaluate, EXCLUSION_RATE, toBurst, type Outcome, type Placement, type Scenario } from './scenario';
import { distanceKm, type Sim } from './sim';
import { hasDial } from './weapons';

// Difficulty is measured, not estimated from the setup. A plausible player is
// simulated many times and the score reflects how they fare: they aim at the
// right kind of thing and respect what the rings show, but they don't optimize.

const PLANS = 60;
const NUDGES = 30;
/** Scraping past the checks with a poor score doesn't count as solving it. */
const GOOD_RATING = 50;

export interface Difficulty {
	score: number;
	label: string;
	/** Share of plausible plans that passed with a respectable rating. */
	planPass: number;
	/** Median progress of those plans toward the objective, 0 to 1. */
	planProgress: number;
	/** Share of slightly misaimed copies of the solver's plan that still passed. */
	tolerance: number;
	conditions: number;
}

export function labelFor(score: number): string {
	if (score < 20) return 'ROUTINE';
	if (score < 40) return 'PRIORITY';
	if (score < 60) return 'IMMEDIATE';
	if (score < 80) return 'FLASH';
	return 'FLASH OVERRIDE';
}

function plausiblePlan(s: Scenario, sim: Sim, rng: Rng, weights: Float64Array, total: number): Placement[] {
	const { grid } = sim;
	const plan: Placement[] = [];
	let spent = 0;

	const sampleCell = () => {
		const r = rng() * total;
		let lo = 0;
		let hi = grid.n - 1;
		while (lo < hi) {
			const m = (lo + hi) >> 1;
			if (weights[m] < r) lo = m + 1;
			else hi = m;
		}
		return lo;
	};

	const near = (lat: number, lon: number, km: number) => {
		const a = rng() * 2 * Math.PI;
		const d = km * Math.sqrt(rng());
		return {
			lat: lat + (d * Math.cos(a)) / 111.2,
			lon: lon + (d * Math.sin(a)) / (111.2 * Math.max(0.15, Math.cos((lat * Math.PI) / 180)))
		};
	};

	// Economy players try to use only some of what they have.
	const useCount =
		s.allMustFly || s.kind === 'fatalities' || s.kind === 'structures' || s.kind === 'denial'
			? s.arsenal.length
			: 1 + Math.floor(rng() * s.arsenal.length);

	for (let slot = 0; slot < useCount; slot++) {
		const w = s.arsenal[slot];
		// Candidates that visibly break a condition are redrawn, as a player would.
		for (let tries = 0; tries < 8; tries++) {
			let pos: { lat: number; lon: number };
			if (s.kind === 'counterforce') {
				if (slot >= s.targets.length) break;
				pos = s.targets[slot]; // The light gun snaps to targets.
			} else if (s.kind === 'surgical' && s.targetZone) {
				pos = near(s.targetZone.lat, s.targetZone.lon, s.targetZone.km * 0.5);
			} else {
				const i = sampleCell();
				pos = { lat: grid.lat[i], lon: grid.lon[i] };
			}
			const low = s.kind === 'economy' || s.kind === 'surgical' || s.kind === 'counterforce';
			const kt =
				hasDial(w) && !s.yieldLock && (low || s.maxYieldKt)
					? w.minKt * Math.pow(w.maxKt / w.minKt, rng())
					: w.maxKt;
			const hobM =
				s.kind === 'blackout'
					? pick(rng, [100000, 400000])
					: s.kind === 'denial' || w.surfaceOnly
						? 0
						: s.kind === 'counterforce'
							? pick(rng, [0, 0, optimumHobM(kt)])
							: pick(rng, [optimumHobM(kt), optimumHobM(kt), 0]);
			const cand: Placement = { slot, lat: pos.lat, lon: pos.lon, kt, hobM };
			if (violatesVisibly(s, sim, cand, spent)) continue;
			plan.push(cand);
			spent += toBurst(s, cand).kt;
			break;
		}
	}
	return plan;
}

function violatesVisibly(s: Scenario, sim: Sim, p: Placement, spent: number): boolean {
	const b = toBurst(s, p);
	if (s.maxYieldKt && spent + b.kt > s.maxYieldKt) return true;
	if (s.noFire && distanceKm(p.lat, p.lon, s.noFire.lat, s.noFire.lon) < s.noFire.km) return true;
	const e = sim.effect(b);
	const first = s.targets.length;
	for (let i = 0; i < s.protected.length; i++) {
		if (e.probePsi[first + i] >= s.protected[i].psi) return true;
	}
	if (s.exclusion) {
		for (let i = first + s.protected.length; i < e.probeRate.length; i++) {
			if (e.probeRate[i] >= EXCLUSION_RATE) return true;
		}
	}
	return false;
}

/** 0 when nothing was achieved, 1 when every check passed. */
function progressOf(s: Scenario, out: Outcome): number {
	const t = out.tally;
	const share = out.checks.filter((c) => c.ok).length / Math.max(out.checks.length, 1);
	let toward = 1;
	switch (s.kind) {
		case 'fatalities':
			toward = t.fatalities / s.goal;
			break;
		case 'structures':
			toward = t.structures / s.goal;
			break;
		case 'denial':
			toward = t.falloutPop / s.goal;
			break;
		case 'blackout':
			toward = t.empPop / s.goal;
			break;
		case 'economy':
			toward = (s.economyMetric === 'structures' ? t.structures : t.fatalities) / s.goal;
			break;
		case 'surgical':
			toward = t.zoneStructures / s.goal;
			break;
		case 'counterforce':
			toward = s.targets.reduce((sum, site, i) => sum + Math.min(1, t.probePsi[i] / site.psi), 0) / s.targets.length;
			break;
	}
	return Math.min(1, toward) * (0.5 + 0.5 * share);
}

export function assessDifficulty(s: Scenario, sim: Sim, solution: Placement[]): Difficulty {
	const rng = rngFor(s.day, 'difficulty');
	const { grid } = sim;
	const useStructures =
		s.kind === 'structures' || s.kind === 'surgical' || (s.kind === 'economy' && s.economyMetric === 'structures');
	const weights = new Float64Array(grid.n);
	let total = 0;
	for (let i = 0; i < grid.n; i++) {
		total += useStructures ? grid.structures[i] : grid.pop[i];
		weights[i] = total;
	}

	const progress: number[] = [];
	let passes = 0;
	for (let k = 0; k < PLANS; k++) {
		const out = evaluate(s, sim, plausiblePlan(s, sim, rng, weights, total));
		if (out.passed && out.rating >= GOOD_RATING) passes++;
		progress.push(progressOf(s, out));
	}
	progress.sort((a, b) => a - b);
	const planProgress = progress[Math.floor(PLANS / 2)];
	const planPass = passes / PLANS;

	// Aim error of about 1.5% of the scope. Shots snapped to a target stay exact.
	const errorKm = s.theatre.radiusKm * 0.015;
	let held = 0;
	for (let k = 0; k < NUDGES; k++) {
		const nudged = solution.map((p) => {
			if (s.targets.some((t) => Math.abs(t.lat - p.lat) < 1e-4 && Math.abs(t.lon - p.lon) < 1e-4)) return p;
			const a = rng() * 2 * Math.PI;
			const d = errorKm * Math.sqrt(rng());
			return {
				...p,
				lat: p.lat + (d * Math.cos(a)) / 111.2,
				lon: p.lon + (d * Math.sin(a)) / (111.2 * Math.max(0.15, Math.cos((p.lat * Math.PI) / 180)))
			};
		});
		if (evaluate(s, sim, nudged).passed) held++;
	}
	const tolerance = held / NUDGES;

	const conditions =
		s.protected.length +
		(s.exclusion ? 1 : 0) +
		(s.noFire ? 1 : 0) +
		(s.hobLock ? 1 : 0) +
		(s.yieldLock ? 1 : 0) +
		(s.allMustFly ? 1 : 0) +
		(s.maxYieldKt ? 1 : 0);

	const score = Math.round(
		100 *
			(0.5 * (1 - planPass) + 0.2 * (1 - planProgress) + 0.2 * (1 - tolerance) + 0.1 * Math.min(1, conditions / 3))
	);
	return { score, label: labelFor(score), planPass, planProgress, tolerance, conditions };
}
