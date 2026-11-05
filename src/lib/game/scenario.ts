import { optimumHobM, type Weather } from './effects';
import { fmtPressure, fmtRate, placeName, type Lang } from './i18n';
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
	ru?: string;
}

export interface Zone {
	name: string;
	lat: number;
	lon: number;
	km: number;
	ru?: string;
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
	/** The plan as flown, kept so the report can be reworded for another language. */
	bursts: Burst[];
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

export function fmtCount(v: number, lang: Lang = 'en'): string {
	if (lang === 'ru') {
		const n = (x: string) => x.replace('.', ',');
		if (v >= 1e9) return `${n((v / 1e9).toFixed(2))} МЛРД`;
		if (v >= 1e6) return `${n((v / 1e6).toFixed(2))} МЛН`;
		if (v >= 1e3) return `${n((v / 1e3).toFixed(1))} ТЫС`;
		return `${Math.round(v)}`;
	}
	if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
	if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
	if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
	return `${Math.round(v)}`;
}

export function fmtKt(v: number, lang: Lang = 'en'): string {
	const ru = lang === 'ru';
	const n = (x: number) => (ru ? `${x}`.replace('.', ',') : `${x}`);
	if (v >= 1000) return `${n(+(v / 1000).toFixed(2))} ${ru ? 'МТ' : 'MT'}`;
	if (v < 1) return `${n(+(v * 1000).toFixed(1))} T`;
	return `${n(+v.toFixed(1))} ${ru ? 'КТ' : 'KT'}`;
}

export const fmtScore = (s: Pick<Scenario, 'kind'>, v: number, lang: Lang = 'en') =>
	s.kind === 'economy' ? fmtKt(v, lang) : fmtCount(v, lang);

export const SCORE_UNIT: Record<Lang, Record<ObjectiveKind, string>> = {
	en: {
		fatalities: 'FATALITIES',
		structures: 'STRUCTURES DESTROYED',
		denial: 'POP. UNDER FALLOUT',
		blackout: 'POP. BLACKED OUT',
		counterforce: 'COLLATERAL FATALITIES',
		economy: 'TOTAL YIELD',
		surgical: 'COLLATERAL FATALITIES'
	},
	ru: {
		fatalities: 'ПОТЕРИ НАСЕЛЕНИЯ',
		structures: 'ЗДАНИЙ РАЗРУШЕНО',
		denial: 'НАСЕЛЕНИЕ НА СЛЕДЕ',
		blackout: 'НАСЕЛЕНИЕ БЕЗ ЭЛЕКТРОНИКИ',
		counterforce: 'ПОБОЧНЫЕ ПОТЕРИ',
		economy: 'СУММАРНАЯ МОЩНОСТЬ',
		surgical: 'ПОБОЧНЫЕ ПОТЕРИ'
	}
};

export const OBJECTIVE_TITLE: Record<Lang, Record<ObjectiveKind, string>> = {
	en: {
		fatalities: 'POPULATION ATTACK',
		structures: 'URBAN-INDUSTRIAL ATTACK',
		denial: 'AREA DENIAL',
		blackout: 'HIGH ALTITUDE BLACKOUT',
		counterforce: 'COUNTERFORCE',
		economy: 'MINIMUM EXPENDITURE',
		surgical: 'SURGICAL STRIKE'
	},
	ru: {
		fatalities: 'УДАР ПО НАСЕЛЕНИЮ',
		structures: 'УДАР ПО ПРОМЫШЛЕННОСТИ',
		denial: 'ЗАРАЖЕНИЕ МЕСТНОСТИ',
		blackout: 'ВЫСОТНЫЙ ЭМИ',
		counterforce: 'КОНТРСИЛОВОЙ УДАР',
		economy: 'МИНИМУМ РАСХОДА',
		surgical: 'ТОЧЕЧНЫЙ УДАР'
	}
};

export function objectiveText(s: Scenario, lang: Lang = 'en'): string {
	const c = (v: number) => fmtCount(v, lang);
	const zone = s.targetZone ? placeName(s.targetZone, lang) : '';
	const rate = fmtRate(EXCLUSION_RATE, lang);
	if (lang === 'ru') {
		switch (s.kind) {
			case 'fatalities':
				return `НАНЕСТИ ПОТЕРИ НЕ МЕНЕЕ ${c(s.goal)} ЧЕЛ. ОЦЕНКА ПО ОБЩИМ ПОТЕРЯМ.`;
			case 'structures':
				return `РАЗРУШИТЬ НЕ МЕНЕЕ ${c(s.goal)} ЗДАНИЙ. ОЦЕНКА ПО ЧИСЛУ РАЗРУШЕННЫХ.`;
			case 'denial':
				return `НАКРЫТЬ РАДИОАКТИВНЫМ СЛЕДОМ ОТ ${rate} НЕ МЕНЕЕ ${c(s.goal)} ЧЕЛ. ОЦЕНКА ПО ОХВАТУ.`;
			case 'blackout':
				return `ЭМИ ОХВАТИТЬ НЕ МЕНЕЕ ${c(s.goal)} ЧЕЛ. БЕЗ ЖЕРТВ. ПОДРЫВ ВЫШЕ 30 КМ. ОЦЕНКА ПО ОХВАТУ.`;
			case 'counterforce':
				return 'УНИЧТОЖИТЬ ВСЕ ОТМЕЧЕННЫЕ ЦЕЛИ. ОЦЕНКА ПО ПОБОЧНЫМ ПОТЕРЯМ, ЧЕМ МЕНЬШЕ, ТЕМ ЛУЧШЕ.';
			case 'economy':
				return `${s.economyMetric === 'structures' ? `РАЗРУШИТЬ ${c(s.goal)} ЗДАНИЙ` : `НАНЕСТИ ПОТЕРИ ${c(s.goal)} ЧЕЛ.`} ПРИ НАИМЕНЬШЕЙ МОЩНОСТИ. ЧЕМ МЕНЬШЕ, ТЕМ ЛУЧШЕ.`;
			case 'surgical':
				return `РАЗРУШИТЬ ${c(s.goal)} ЗДАНИЙ В РАЙОНЕ: ${zone}. ОЦЕНКА ПО ПОТЕРЯМ ВНЕ РАЙОНА, ЧЕМ МЕНЬШЕ, ТЕМ ЛУЧШЕ.`;
		}
	}
	switch (s.kind) {
		case 'fatalities':
			return `INFLICT AT LEAST ${c(s.goal)} FATALITIES. SCORE IS TOTAL FATALITIES.`;
		case 'structures':
			return `DESTROY AT LEAST ${c(s.goal)} STRUCTURES. SCORE IS TOTAL DESTROYED.`;
		case 'denial':
			return `PLACE AT LEAST ${c(s.goal)} PEOPLE UNDER FALLOUT OF ${rate} OR MORE. SCORE IS POPULATION COVERED.`;
		case 'blackout':
			return `BLACK OUT AT LEAST ${c(s.goal)} PEOPLE WITH EMP. NOBODY DIES. BURST ABOVE 30 KM. SCORE IS POPULATION COVERED.`;
		case 'counterforce':
			return `DESTROY EVERY MARKED TARGET. SCORE IS COLLATERAL FATALITIES, LOWER IS BETTER.`;
		case 'economy':
			return `${s.economyMetric === 'structures' ? `DESTROY ${c(s.goal)} STRUCTURES` : `INFLICT ${c(s.goal)} FATALITIES`} WITH AS LITTLE YIELD AS POSSIBLE. SCORE IS TOTAL YIELD, LOWER IS BETTER.`;
		case 'surgical':
			return `DESTROY ${c(s.goal)} STRUCTURES IN ${zone}. SCORE IS FATALITIES OUTSIDE THE ZONE, LOWER IS BETTER.`;
	}
}

export function conditionTexts(s: Scenario, lang: Lang = 'en'): string[] {
	const out: string[] = [];
	const ru = lang === 'ru';
	if (s.hobLock === 'SURFACE') out.push(ru ? 'ВЫСОТА ПОДРЫВА: ТОЛЬКО НАЗЕМНЫЙ' : 'DETONATION HEIGHT LOCKED: SURFACE BURST ONLY');
	if (s.hobLock === 'AIRBURST') out.push(ru ? 'ВЫСОТА ПОДРЫВА: ТОЛЬКО ОПТИМАЛЬНЫЙ ВОЗДУШНЫЙ' : 'DETONATION HEIGHT LOCKED: OPTIMUM AIRBURST ONLY');
	if (s.yieldLock) out.push(ru ? 'МОЩНОСТЬ ЗАФИКСИРОВАНА НА МАКСИМУМЕ' : 'YIELD DIALS LOCKED AT MAXIMUM');
	if (s.allMustFly) out.push(ru ? 'ИЗРАСХОДОВАТЬ ВСЕ БОЕЗАРЯДЫ' : 'ALL WARHEADS MUST BE EXPENDED');
	if (s.maxYieldKt) out.push(`${ru ? 'ПРЕДЕЛ СУММАРНОЙ МОЩНОСТИ' : 'TOTAL YIELD LIMIT'} ${fmtKt(s.maxYieldKt, lang)}`);
	for (const p of s.protected) {
		const name = placeName(p, lang);
		out.push(ru ? `${name}: НЕ БОЛЕЕ ${fmtPressure(p.psi, lang)}` : `${name} MUST STAY BELOW ${p.psi} PSI`);
	}
	if (s.exclusion) {
		const rate = fmtRate(EXCLUSION_RATE, lang);
		const name = placeName(s.exclusion, lang);
		out.push(ru ? `${name}: СЛЕД НЕ БОЛЕЕ ${rate}` : `NO FALLOUT OVER ${rate} ON ${name}`);
	}
	if (s.noFire) {
		const name = placeName(s.noFire, lang);
		const km = Math.round(s.noFire.km);
		out.push(ru ? `НЕ НАЗНАЧАТЬ ЭПИЦЕНТРЫ БЛИЖЕ ${km} КМ ОТ: ${name}` : `NO GROUND ZEROS WITHIN ${km} KM OF ${name}`);
	}
	return out;
}

/** Everything that can fail, shared by the player's result and the solver's penalty. */
export function checksFor(s: Scenario, bursts: Burst[], t: Tally, lang: Lang = 'en'): Check[] {
	const ru = lang === 'ru';
	const of = ru ? 'ИЗ' : 'OF';
	const c = (v: number) => fmtCount(v, lang);
	const checks: Check[] = [];
	const count = (ok: boolean, label: string, detail: string) => checks.push({ label, ok, detail });
	const goal = (have: number, en: string, russian: string) =>
		count(have >= s.goal, ru ? russian : en, `${c(have)} ${of} ${c(s.goal)}`);
	switch (s.kind) {
		case 'fatalities':
			goal(t.fatalities, 'FATALITY GOAL', 'ЗАДАНИЕ ПО ПОТЕРЯМ');
			break;
		case 'structures':
			goal(t.structures, 'STRUCTURE GOAL', 'ЗАДАНИЕ ПО ЗДАНИЯМ');
			break;
		case 'denial':
			goal(t.falloutPop, 'FALLOUT GOAL', 'ЗАДАНИЕ ПО СЛЕДУ');
			break;
		case 'blackout':
			goal(t.empPop, 'BLACKOUT GOAL', 'ЗАДАНИЕ ПО ЭМИ');
			count(t.fatalities < 1, ru ? 'БЕЗ ЖЕРТВ' : 'NO FATALITIES', c(t.fatalities));
			break;
		case 'counterforce':
			s.targets.forEach((site, i) => {
				count(t.probePsi[i] >= site.psi, placeName(site, lang), `${fmtPressure(t.probePsi[i], lang)} ${of} ${fmtPressure(site.psi, lang)}`);
			});
			break;
		case 'economy':
			goal(s.economyMetric === 'structures' ? t.structures : t.fatalities, 'DAMAGE GOAL', 'ЗАДАНИЕ ПО УЩЕРБУ');
			break;
		case 'surgical':
			goal(t.zoneStructures, 'ZONE GOAL', 'ЗАДАНИЕ ПО РАЙОНУ');
			break;
	}
	const first = s.targets.length;
	s.protected.forEach((site, i) => {
		const psi = t.probePsi[first + i];
		const name = placeName(site, lang);
		count(psi < site.psi, ru ? `ЗАЩИТА: ${name}` : `PROTECT ${name}`, `${fmtPressure(psi, lang)}, ${ru ? 'ПРЕДЕЛ' : 'LIMIT'} ${fmtPressure(site.psi, lang)}`);
	});
	if (s.exclusion) {
		const zoneProbes = t.probeRate.slice(first + s.protected.length);
		const peak = Math.max(0, ...zoneProbes);
		const name = placeName(s.exclusion, lang);
		count(peak < EXCLUSION_RATE, ru ? `ЧИСТОТА: ${name}` : `CLEAN ${name}`, fmtRate(peak, lang));
	}
	if (s.noFire) {
		const { lat, lon, km } = s.noFire;
		const violations = bursts.filter((b) => distanceKm(b.lat, b.lon, lat, lon) < km).length;
		const name = placeName(s.noFire, lang);
		count(violations === 0, ru ? `ЗАПРЕТ: ${name}` : `NO-FIRE ${name}`, ru ? `ЭПИЦЕНТРОВ ВНУТРИ: ${violations}` : `${violations} GROUND ZEROS INSIDE`);
	}
	if (s.allMustFly) count(bursts.length === s.arsenal.length, ru ? 'ВСЕ ИЗРАСХОДОВАНЫ' : 'ALL EXPENDED', `${bursts.length} ${of} ${s.arsenal.length}`);
	if (s.maxYieldKt) {
		const total = bursts.reduce((sum, b) => sum + b.kt, 0);
		count(total <= s.maxYieldKt, ru ? 'ПРЕДЕЛ МОЩНОСТИ' : 'YIELD LIMIT', `${fmtKt(total, lang)} ${of} ${fmtKt(s.maxYieldKt, lang)}`);
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
	return { bursts, tally, checks, passed, value, rating, lowerIsBetter: low };
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
