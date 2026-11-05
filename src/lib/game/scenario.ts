import { optimumHobM, type Weather } from './effects';
import { distanceKm, type Burst, type Probe, type Sim, type Tally } from './sim';
import type { Theatre } from './theatres';
import type { Weapon } from './weapons';

export type ObjectiveKind =
	| 'fatalities'
	| 'structures'
	| 'denial'
	| 'blackout'
	| 'counterforce'
	| 'economy'
	| 'surgical';

export interface Site {
	name: string;
	lat: number;
	lon: number;
	/** Overpressure needed to destroy a target, or the limit on a protected site. */
	psi: number;
}

export interface Zone {
	name: string;
	lat: number;
	lon: number;
	km: number;
}

export interface Scenario {
	day: number;
	date: string;
	theatre: Theatre;
	weather: Weather;
	/** One entry per warhead. */
	arsenal: Weapon[];
	kind: ObjectiveKind;
	/** For economy: which total has to reach the goal. */
	economyMetric?: 'fatalities' | 'structures';
	/** The threshold that must be met. Zero when the objective has none. */
	goal: number;
	/** Command estimate of the best score. */
	par: number;
	/** Softens lower-is-better ratings when par is close to zero. */
	slack: number;
	targets: Site[];
	protected: Site[];
	/** Fallout above 10 rad/h is banned here. */
	exclusion?: Zone;
	/** Ground zeros are banned here. */
	noFire?: Zone;
	/** Surgical objective: the area to destroy. */
	targetZone?: Zone;
	hobLock?: 'SURFACE' | 'AIRBURST';
	yieldLock?: boolean;
	allMustFly?: boolean;
	maxYieldKt?: number;
	wargames: number;
}

export interface Placement {
	slot: number;
	lat: number;
	lon: number;
	kt: number;
	hobM: number;
}

export interface Check {
	label: string;
	ok: boolean;
	detail: string;
}

export interface Outcome {
	tally: Tally;
	checks: Check[];
	passed: boolean;
	/** Raw score in the objective's unit. */
	value: number;
	/** 100 matches the command estimate. Can exceed 100. */
	rating: number;
	lowerIsBetter: boolean;
}

export const EXCLUSION_RATE = 10;

export const lowerIsBetter = (kind: ObjectiveKind) =>
	kind === 'counterforce' || kind === 'economy' || kind === 'surgical';

export function hobFor(s: Pick<Scenario, 'hobLock'>, w: Weapon, kt: number, hobM: number): number {
	if (w.surfaceOnly || s.hobLock === 'SURFACE') return 0;
	if (s.hobLock === 'AIRBURST') return optimumHobM(kt);
	return hobM;
}

export const toBurst = (s: Scenario, p: Placement): Burst => {
	const weapon = s.arsenal[p.slot];
	const kt = s.yieldLock ? weapon.maxKt : p.kt;
	return { weapon, lat: p.lat, lon: p.lon, kt, hobM: hobFor(s, weapon, kt, p.hobM) };
};

/** Probes in order: targets, protected sites, then the exclusion zone's ring. */
export function probesFor(s: Pick<Scenario, 'targets' | 'protected' | 'exclusion'>): Probe[] {
	const probes: Probe[] = [...s.targets, ...s.protected];
	if (s.exclusion) {
		const { lat, lon, km } = s.exclusion;
		probes.push({ lat, lon });
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * 2 * Math.PI;
			const dLat = (km / 111.2) * Math.cos(a);
			const dLon = ((km / 111.2) * Math.sin(a)) / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
			probes.push({ lat: lat + dLat, lon: lon + dLon });
		}
	}
	return probes;
}

export function scoreValue(s: Scenario, t: Tally): number {
	switch (s.kind) {
		case 'fatalities':
			return t.fatalities;
		case 'structures':
			return t.structures;
		case 'denial':
			return t.falloutPop;
		case 'blackout':
			return t.empPop;
		case 'counterforce':
			return t.fatalities;
		case 'economy':
			return t.yieldKt;
		case 'surgical':
			return t.fatalities - t.zoneFatalities;
	}
}

export function fmtCount(v: number): string {
	if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
	if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
	if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
	return `${Math.round(v)}`;
}

export function fmtKt(v: number): string {
	if (v >= 1000) return `${+(v / 1000).toFixed(2)} MT`;
	if (v < 1) return `${+(v * 1000).toFixed(1)} T`;
	return `${+v.toFixed(1)} KT`;
}

export const fmtScore = (s: Pick<Scenario, 'kind'>, v: number) =>
	s.kind === 'economy' ? fmtKt(v) : fmtCount(v);

export const SCORE_UNIT: Record<ObjectiveKind, string> = {
	fatalities: 'FATALITIES',
	structures: 'STRUCTURES DESTROYED',
	denial: 'POP. UNDER FALLOUT',
	blackout: 'POP. BLACKED OUT',
	counterforce: 'COLLATERAL FATALITIES',
	economy: 'TOTAL YIELD',
	surgical: 'COLLATERAL FATALITIES'
};

export const OBJECTIVE_TITLE: Record<ObjectiveKind, string> = {
	fatalities: 'POPULATION ATTACK',
	structures: 'URBAN-INDUSTRIAL ATTACK',
	denial: 'AREA DENIAL',
	blackout: 'HIGH ALTITUDE BLACKOUT',
	counterforce: 'COUNTERFORCE',
	economy: 'MINIMUM EXPENDITURE',
	surgical: 'SURGICAL STRIKE'
};

export function objectiveText(s: Scenario): string {
	switch (s.kind) {
		case 'fatalities':
			return `INFLICT AT LEAST ${fmtCount(s.goal)} FATALITIES. SCORE IS TOTAL FATALITIES.`;
		case 'structures':
			return `DESTROY AT LEAST ${fmtCount(s.goal)} STRUCTURES. SCORE IS TOTAL DESTROYED.`;
		case 'denial':
			return `PLACE AT LEAST ${fmtCount(s.goal)} PEOPLE UNDER FALLOUT OF ${EXCLUSION_RATE} RAD/H OR MORE. SCORE IS POPULATION COVERED.`;
		case 'blackout':
			return `BLACK OUT AT LEAST ${fmtCount(s.goal)} PEOPLE WITH EMP. NOBODY DIES. BURST ABOVE 30 KM. SCORE IS POPULATION COVERED.`;
		case 'counterforce':
			return `DESTROY EVERY MARKED TARGET. SCORE IS COLLATERAL FATALITIES, LOWER IS BETTER.`;
		case 'economy':
			return `${s.economyMetric === 'structures' ? `DESTROY ${fmtCount(s.goal)} STRUCTURES` : `INFLICT ${fmtCount(s.goal)} FATALITIES`} WITH AS LITTLE YIELD AS POSSIBLE. SCORE IS TOTAL YIELD, LOWER IS BETTER.`;
		case 'surgical':
			return `DESTROY ${fmtCount(s.goal)} STRUCTURES IN ${s.targetZone?.name}. SCORE IS FATALITIES OUTSIDE THE ZONE, LOWER IS BETTER.`;
	}
}

export function conditionTexts(s: Scenario): string[] {
	const out: string[] = [];
	if (s.hobLock === 'SURFACE') out.push('DETONATION HEIGHT LOCKED: SURFACE BURST ONLY');
	if (s.hobLock === 'AIRBURST') out.push('DETONATION HEIGHT LOCKED: OPTIMUM AIRBURST ONLY');
	if (s.yieldLock) out.push('YIELD DIALS LOCKED AT MAXIMUM');
	if (s.allMustFly) out.push('ALL WARHEADS MUST BE EXPENDED');
	if (s.maxYieldKt) out.push(`TOTAL YIELD LIMIT ${fmtKt(s.maxYieldKt)}`);
	for (const p of s.protected) out.push(`${p.name} MUST STAY BELOW ${p.psi} PSI`);
	if (s.exclusion) out.push(`NO FALLOUT OVER ${EXCLUSION_RATE} RAD/H ON ${s.exclusion.name}`);
	if (s.noFire) out.push(`NO GROUND ZEROS WITHIN ${Math.round(s.noFire.km)} KM OF ${s.noFire.name}`);
	return out;
}

/** Everything that can fail, shared by the player's result and the solver's penalty. */
export function checksFor(s: Scenario, bursts: Burst[], t: Tally): Check[] {
	const checks: Check[] = [];
	const count = (ok: boolean, label: string, detail: string) => checks.push({ label, ok, detail });
	switch (s.kind) {
		case 'fatalities':
			count(t.fatalities >= s.goal, 'FATALITY GOAL', `${fmtCount(t.fatalities)} OF ${fmtCount(s.goal)}`);
			break;
		case 'structures':
			count(t.structures >= s.goal, 'STRUCTURE GOAL', `${fmtCount(t.structures)} OF ${fmtCount(s.goal)}`);
			break;
		case 'denial':
			count(t.falloutPop >= s.goal, 'FALLOUT GOAL', `${fmtCount(t.falloutPop)} OF ${fmtCount(s.goal)}`);
			break;
		case 'blackout':
			count(t.empPop >= s.goal, 'BLACKOUT GOAL', `${fmtCount(t.empPop)} OF ${fmtCount(s.goal)}`);
			count(t.fatalities < 1, 'NO FATALITIES', fmtCount(t.fatalities));
			break;
		case 'counterforce':
			s.targets.forEach((site, i) => {
				count(t.probePsi[i] >= site.psi, site.name, `${t.probePsi[i].toFixed(1)} OF ${site.psi} PSI`);
			});
			break;
		case 'economy': {
			const v = s.economyMetric === 'structures' ? t.structures : t.fatalities;
			count(v >= s.goal, 'DAMAGE GOAL', `${fmtCount(v)} OF ${fmtCount(s.goal)}`);
			break;
		}
		case 'surgical':
			count(t.zoneStructures >= s.goal, 'ZONE GOAL', `${fmtCount(t.zoneStructures)} OF ${fmtCount(s.goal)}`);
			break;
	}
	const first = s.targets.length;
	s.protected.forEach((site, i) => {
		const psi = t.probePsi[first + i];
		count(psi < site.psi, `PROTECT ${site.name}`, `${psi.toFixed(1)} PSI, LIMIT ${site.psi}`);
	});
	if (s.exclusion) {
		const zoneProbes = t.probeRate.slice(first + s.protected.length);
		const peak = Math.max(0, ...zoneProbes);
		count(peak < EXCLUSION_RATE, `CLEAN ${s.exclusion.name}`, `${Math.round(peak)} RAD/H`);
	}
	if (s.noFire) {
		const { lat, lon, km } = s.noFire;
		const violations = bursts.filter((b) => distanceKm(b.lat, b.lon, lat, lon) < km).length;
		count(violations === 0, `NO-FIRE ${s.noFire.name}`, `${violations} GROUND ZEROS INSIDE`);
	}
	if (s.allMustFly) count(bursts.length === s.arsenal.length, 'ALL EXPENDED', `${bursts.length} OF ${s.arsenal.length}`);
	if (s.maxYieldKt) {
		const total = bursts.reduce((sum, b) => sum + b.kt, 0);
		count(total <= s.maxYieldKt, 'YIELD LIMIT', `${fmtKt(total)} OF ${fmtKt(s.maxYieldKt)}`);
	}
	return checks;
}

export function evaluate(s: Scenario, sim: Sim, placements: Placement[], perCell?: Float32Array): Outcome {
	const bursts = placements.map((p) => toBurst(s, p));
	const tally = sim.tally(bursts, perCell);
	const checks = checksFor(s, bursts, tally);
	const passed = checks.every((c) => c.ok);
	const value = scoreValue(s, tally);
	const low = lowerIsBetter(s.kind);
	const rating = !passed
		? 0
		: low
			? Math.round((100 * (s.par + s.slack)) / Math.max(value + s.slack, 1e-6))
			: Math.round((100 * value) / Math.max(s.par, 1));
	return { tally, checks, passed, value, rating, lowerIsBetter: low };
}

/** Rank title for a rating, shown on the result slip. */
export function rankFor(rating: number): string {
	if (rating <= 0) return 'RELIEVED OF COMMAND';
	if (rating < 60) return 'SECOND LIEUTENANT';
	if (rating < 75) return 'CAPTAIN';
	if (rating < 90) return 'MAJOR';
	if (rating < 100) return 'COLONEL';
	if (rating < 110) return 'GENERAL';
	return 'BEYOND COMMAND ESTIMATE';
}
