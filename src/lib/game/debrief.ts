import type { TheatreMeta } from './data';
import {
	blastRangeKm,
	burnThreshold,
	cloudGeometry,
	EARTH_KM,
	effectiveWinds,
	EXO_HEIGHT_M,
	empKm,
	thermalExposure,
	type Weather,
	falloutBands,
	falloutField,
	fatalityFromFallout,
	fireballKm,
	groundCoupling,
	peakWindMs,
	psiProfile,
	radiationKm,
	rainoutShare,
	ringsFor,
	shockArrival,
	thermalKm,
	thermalMaxS,
	thermalPartition,
	dynamicPsi,
	type CloudGeometry,
	type PlumeBand,
	type Rings,
	type ShockPoint
} from './effects';
import { type Outcome, type Scenario } from './scenario';
import { CELL_OFFSETS, directFractions, distanceKm, type Burst, type Sim } from './sim';
import { fissionFractionAt } from './weapons';

// Everything the post-strike report shows, worked out from the plan as it flew. The game only needs
// each cell's survivors, so this goes further and splits those deaths by cause and by weapon.

const RAD = Math.PI / 180;
export const HIROSHIMA_KT = 15;
/** A saturated cell has an infinite hazard, so survival is floored to keep shares finite. */
const MIN_SURVIVE = 1e-9;
const hazard = (fraction: number) => -Math.log(Math.max(1 - fraction, MIN_SURVIVE));

export type Cause = 'blast' | 'burns' | 'radiation' | 'fallout';
export const CAUSES: Cause[] = ['blast', 'burns', 'radiation', 'fallout'];
export type CauseSplit = Record<Cause, number>;
const noCauses = (): CauseSplit => ({ blast: 0, burns: 0, radiation: 0, fallout: 0 });

export interface DistanceBin {
	fromKm: number;
	toKm: number;
	pop: number;
	deaths: number;
}

/** One ring of ground around a burst, for that burst on its own. */
export interface Zone {
	psi: number;
	fromKm: number;
	toKm: number;
	pop: number;
	deaths: number;
	structures: number;
	arrivalS: number;
	windMs: number;
	dynamicPsi: number;
}

export interface FalloutRow {
	rate: number;
	band: PlumeBand;
	areaKm2: number;
	pop: number;
	/** Dose in rad for sheltered people on the wind axis at the contour's midpoint. */
	sampleDose: number;
}

export interface BurstReport {
	index: number;
	burst: Burst;
	rings: Rings;
	exo: boolean;
	fissionShare: number;
	fissionKt: number;
	fusionKt: number;
	hiroshimas: number;
	thermalShare: number;
	burnCal: number;
	thermalMaxS: number;
	fireballKm: number;
	/** Fireball's reach: true if it touches the ground, which is what makes heavy local fallout. */
	fireballTouches: boolean;
	cloud: CloudGeometry;
	winds: { cap: number; stem: number };
	coupling: number;
	rainout: number;
	empKm: number;
	empPop: number;
	/** Heat on the ground by range for a high burst, and the exposure that burns. */
	exoHeat: { km: number; cal: number }[];
	shock: ShockPoint[];
	/** This weapon's share of the plan's deaths, with overlaps split. */
	deaths: number;
	causes: CauseSplit;
	/** What it would have done alone. */
	soloDeaths: number;
	soloStructures: number;
	soloFalloutPop: number;
	/** What the plan loses without it. */
	marginalDeaths: number;
	marginalStructures: number;
	zones: Zone[];
	bins: DistanceBin[];
	falloutRows: FalloutRow[];
	falloutDeaths: number;
	maxDeathKm: number;
	placesHit: { name: string; ru?: string; km: number; psi: number }[];
}

export interface FatalBand {
	from: number;
	to: number;
	pop: number;
	cells: number;
}

export interface PlaceRow {
	name: string;
	ru?: string;
	lat: number;
	lon: number;
	pop: number;
	deaths: number;
	nearestKm: number;
	peakPsi: number;
	rate: number;
	kind: 'city' | 'landmark';
}

export interface WorkedBurstStep {
	index: number;
	km: number;
	psi: number;
	blast: number;
	burns: number;
	radiation: number;
	survive: number;
	dose: number;
}

export interface WorkedCell {
	cell: number;
	lat: number;
	lon: number;
	pop: number;
	structures: number;
	steps: WorkedBurstStep[];
	direct: number;
	dose: number;
	falloutFatal: number;
	fatal: number;
	deaths: number;
	standing: number;
}

/** OTA 1979 Fig. 1 applied to this plan's peak overpressure, as a check on the game's own curves. */
export interface OtaCheck {
	fatal: number;
	injured: number;
}

/** Survivors who are hurt, each counted once. See docs/CALCULATIONS.md. */
export interface Injuries {
	blast: number;
	burns: number;
	sickness: number;
	total: number;
}

/** A mass fire in the burned-out centre. Report only, see docs/CALCULATIONS.md. */
export interface Firestorm {
	state: 'burning' | 'wind' | 'wet' | 'fuel' | 'none';
	areaKm2: number;
	deaths: number;
	structures: number;
}

export interface DebriefData {
	bursts: BurstReport[];
	firestorm: Firestorm;
	/** Excess fatal cancers among survivors by linear no-threshold, decades later. */
	cancers: number;
	injuries: Injuries;
	/** People in cells where anyone died or was hurt. */
	harmedPop: number;
	ota: OtaCheck;
	causes: CauseSplit;
	deaths: number;
	structures: number;
	mapPop: number;
	mapStructures: number;
	yieldKt: number;
	hiroshimas: number;
	fissionKt: number;
	popAffected: number;
	/** Sum of what each weapon would have killed alone, minus what they did together. */
	overlapDeaths: number;
	bands: FatalBand[];
	places: PlaceRow[];
	worked: WorkedCell | null;
	/** Per cell, for the map: fraction killed, fraction of structures gone, H+1 rate, dose. */
	cellFatal: Float32Array;
	cellStand: Float32Array;
	cellRate: Float32Array;
	cellDose: Float32Array;
}

/** Distance along and across the wind, the same tangent plane the simulation uses. */
function plumeAxes(b: Burst, lat: number, lon: number, bearing: number): [number, number] {
	const p = (x: number, y: number): [number, number, number] => [
		Math.cos(x * RAD) * Math.cos(y * RAD),
		Math.cos(x * RAD) * Math.sin(y * RAD),
		Math.sin(x * RAD)
	];
	const [ax, ay, az] = p(lat, lon);
	const [bx, by, bz] = p(b.lat, b.lon);
	const dx = ax - bx;
	const dy = ay - by;
	const dz = az - bz;
	const la = b.lat * RAD;
	const lo = b.lon * RAD;
	const east = (dx * -Math.sin(lo) + dy * Math.cos(lo)) * EARTH_KM;
	const north = (dx * -Math.sin(la) * Math.cos(lo) + dy * -Math.sin(la) * Math.sin(lo) + dz * Math.cos(la)) * EARTH_KM;
	const w = bearing * RAD;
	return [east * Math.sin(w) + north * Math.cos(w), north * Math.sin(w) - east * Math.cos(w)];
}

const contourArea = (band: PlumeBand) => {
	let area = 0;
	for (const run of band.runs) {
		for (let i = 1; i < run.length; i++) area += (run[i][0] - run[i - 1][0]) * (run[i][1] + run[i - 1][1]);
	}
	return area;
};

// Estimates, for counting survivors who are hurt. Radiation sickness starts near 100 rad (G&D Table 12.108).
const BURN_INJURY = 0.25;
const SICKNESS_RAD = 100;

// Firestorm reading of OTA's criteria. All estimates. The game's wind is for the lowest few km, so the surface is taken
// as about half of it. Fuel can't be seen on the map, so a density of buildings stands in for it. A fifth to a third of
// people died in the worst WWII firestorm areas, as commonly reported, hence this share of those left alive.
const FIRE_WIND_KMH = 26;
const FIRE_STRUCTURES_KM2 = 800;
const FIRE_MIN_KM2 = 1.3;
const FIRE_FATAL = 0.3;

// Linear no-threshold: about 5% fatal cancers per sievert (ICRP's nominal figure), with 100 rad taken as 1 Sv.
// Above this people mostly die of something sooner, and it is outside what the line was fitted to.
const LNT_PER_SV = 0.05;
const MAX_LNT_RAD = 400;
// Prompt dose past the 1000 rad radius falls with distance squared and air attenuation, an estimate.
const PROMPT_EDGE_RAD = 400;
const PROMPT_FADE_KM = 0.3;

// The rows of OTA 1979 Table 3, so each ring can carry that table's description of the damage.
const ZONE_PSI = [20, 10, 5, 3, 1];
const BIN_COUNT = 24;

/** Blast, burn and radiation fractions by distance for one burst, averaged the way the simulation averages a cell. */
function directTable(b: Burst, sim: Sim) {
	const { grid, weather } = sim;
	const psiAt = psiProfile(b.kt, b.hobM);
	const thermal = thermalKm(b.kt, b.hobM, weather);
	const radiation = radiationKm(b.kt, b.hobM, b.weapon.enhanced);
	const offsets = CELL_OFFSETS.map((o) => o * grid.cellKm);
	return (km: number) => {
		let blast = 0;
		let burns = 0;
		let rad = 0;
		for (const o of offsets) {
			const r = Math.abs(km + o);
			const f = directFractions(psiAt(r), r, thermal, radiation);
			blast += f.blast;
			burns += f.burns;
			rad += f.radiation;
		}
		return { blast: blast / offsets.length, burns: burns / offsets.length, radiation: rad / offsets.length };
	};
}

function exoHeatCurve(kt: number, hobM: number, weather: Weather) {
	const h = hobM / 1000;
	const out: { km: number; cal: number }[] = [];
	for (let i = 0; i <= 40; i++) {
		const km = (i / 40) * 1600;
		out.push({ km, cal: thermalExposure(kt, hobM, Math.hypot(km, h) / 1.609344, weather) });
	}
	return out;
}

export interface MarchStation {
	cause: Cause | 'firestorm' | 'cancer';
	deaths: number;
	/** Deaths still to come after this station, counting this one's. */
	before: number;
	/** Latest time this hazard arrives anywhere it killed, in seconds. Null for fallout, which is hours. */
	byS: number | null;
	byWeapon: { index: number; deaths: number }[];
}

export interface March {
	reached: number;
	untouched: number;
	deaths: number;
	/** The part of the deaths the score counts. Firestorm and cancer deaths come on top. */
	scored: number;
	survivors: number;
	injuries: Injuries;
	stations: MarchStation[];
}

// Hazards in the order they arrive: gamma rays, the thermal pulse, the shock, then what falls from the cloud.
const ARRIVAL_ORDER: Cause[] = ['radiation', 'burns', 'blast', 'fallout'];

/** The people in reach of the plan, losing each cause's dead in turn, for the report's flow map. */
export function marchOf(d: DebriefData): March {
	const reached = d.harmedPop;
	const untouched = Math.max(0, d.mapPop - reached);
	const total = d.deaths + d.firestorm.deaths + d.cancers;
	let left = total;
	const stations: MarchStation[] = [];
	for (const cause of ARRIVAL_ORDER) {
		const deaths = d.causes[cause];
		if (deaths < 0.5) continue;
		const killers = d.bursts.filter((b) => b.causes[cause] >= 0.5);
		const byS =
			cause === 'radiation'
				? 1
				: cause === 'burns'
					? Math.max(...killers.map((b) => b.thermalMaxS))
					: cause === 'blast'
						? Math.max(0, ...killers.flatMap((b) => b.zones.filter((z) => z.deaths >= 0.5).map((z) => z.arrivalS)))
						: null;
		stations.push({
			cause,
			deaths,
			before: left,
			byS,
			byWeapon: killers.map((b) => ({ index: b.index, deaths: b.causes[cause] })).sort((a, b) => b.deaths - a.deaths)
		});
		left -= deaths;
		if (cause === 'blast' && d.firestorm.deaths >= 0.5) {
			stations.push({ cause: 'firestorm', deaths: d.firestorm.deaths, before: left, byS: null, byWeapon: [{ index: -1, deaths: d.firestorm.deaths }] });
			left -= d.firestorm.deaths;
		}
	}
	if (d.firestorm.deaths >= 0.5 && !stations.some((s) => s.cause === 'firestorm')) {
		stations.push({ cause: 'firestorm', deaths: d.firestorm.deaths, before: left, byS: null, byWeapon: [{ index: -1, deaths: d.firestorm.deaths }] });
		left -= d.firestorm.deaths;
	}
	if (d.cancers >= 0.5) stations.push({ cause: 'cancer', deaths: d.cancers, before: left, byS: null, byWeapon: [{ index: -1, deaths: d.cancers }] });
	return { reached, untouched, deaths: total, scored: d.deaths, survivors: Math.max(0, reached - total), injuries: d.injuries, stations };
}

export function analyze(s: Scenario, sim: Sim, outcome: Outcome, meta: TheatreMeta): DebriefData {
	const { grid, weather } = sim;
	const n = grid.n;
	const bursts = outcome.bursts;
	const effects = bursts.map((b) => sim.effect(b));

	// First pass: whole-plan state per cell, the same combination Sim.tally does.
	const surv = new Float64Array(n).fill(1);
	const stand = new Float32Array(n).fill(1);
	const rate = new Float32Array(n);
	const dose = new Float32Array(n);
	const empOn = new Uint8Array(n);
	const directHazard = new Float64Array(n);
	for (const e of effects) {
		for (let j = 0; j < e.idx.length; j++) {
			const i = e.idx[j];
			surv[i] *= e.survive[j];
			stand[i] *= e.standing[j];
			rate[i] += e.fallout[j];
			dose[i] += e.dose[j];
			if (e.emp[j]) empOn[i] = 1;
			directHazard[i] += hazard(1 - e.survive[j]);
		}
	}
	const cellFatal = new Float32Array(n);
	const falloutHazard = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const fallout = fatalityFromFallout(dose[i]);
		cellFatal[i] = 1 - surv[i] * (1 - fallout);
		falloutHazard[i] = hazard(fallout);
	}

	// Second pass: each death is shared among the weapons and causes in proportion to the hazard each
	// contributed. Hazards add when survival multiplies, so this doesn't depend on the order of bursts.
	const totals = noCauses();
	const reports: BurstReport[] = bursts.map((b, index) => {
		const e = effects[index];
		const table = directTable(b, sim);
		const causes = noCauses();
		let deaths = 0;
		let soloFalloutDeaths = 0;
		let soloFalloutPop = 0;
		let empPop = 0;
		for (let j = 0; j < e.idx.length; j++) {
			const i = e.idx[j];
			const pop = grid.pop[i];
			if (e.emp[j]) empPop += pop;
			if (e.fallout[j] >= 10) soloFalloutPop += pop;
			soloFalloutDeaths += pop * fatalityFromFallout(e.dose[j]);
			const total = directHazard[i] + falloutHazard[i];
			if (total <= 0 || pop <= 0) continue;
			const dead = pop * cellFatal[i];
			const fromFallout = dose[i] > 0 ? (falloutHazard[i] * e.dose[j]) / dose[i] : 0;
			const direct = hazard(1 - e.survive[j]);
			if (direct > 0) {
				const f = table(distanceKm(grid.lat[i], grid.lon[i], b.lat, b.lon));
				const hb = hazard(f.blast);
				const ht = hazard(f.burns);
				const hr = hazard(f.radiation);
				const sum = hb + ht + hr;
				// Rounding at a cell's edge can leave a little hazard with no named cause: call it blast.
				const scale = sum > 0 ? direct / sum : 0;
				causes.blast += (dead * (sum > 0 ? hb * scale : direct)) / total;
				causes.burns += (dead * ht * scale) / total;
				causes.radiation += (dead * hr * scale) / total;
			}
			causes.fallout += (dead * fromFallout) / total;
		}
		for (const c of CAUSES) {
			deaths += causes[c];
			totals[c] += causes[c];
		}

		const others = bursts.filter((_, k) => k !== index);
		const alone = sim.tally([b]);
		const without = sim.tally(others);
		const exo = b.hobM >= EXO_HEIGHT_M;
		const rings = ringsFor(b.weapon, b.kt, b.hobM, weather);
		const fission = fissionFractionAt(b.weapon, b.kt);
		const fire = fireballKm(b.kt, b.hobM);
		const maxRange = Math.max(rings.psi1 * 1.2, rings.thermal, 0.2);

		// Rings and distance bins, for this weapon alone.
		const shock = exo ? [] : shockArrival(b.kt, b.hobM, maxRange);
		const arrivalAt = (km: number) => {
			if (!shock.length) return 0;
			if (km <= shock[0].km) return shock[0].s;
			for (let k = 1; k < shock.length; k++) {
				if (km <= shock[k].km) {
					const a = shock[k - 1];
					const c = shock[k];
					return a.s + ((km - a.km) / Math.max(c.km - a.km, 1e-9)) * (c.s - a.s);
				}
			}
			return shock[shock.length - 1].s;
		};
		const edges = ZONE_PSI.map((psi) => ({ psi, km: exo ? 0 : blastRangeKm(psi, b.kt, b.hobM) }));
		const zones: Zone[] = edges.map((edge, k) => ({
			psi: edge.psi,
			fromKm: k > 0 ? edges[k - 1].km : 0,
			toKm: edge.km,
			pop: 0,
			deaths: 0,
			structures: 0,
			arrivalS: arrivalAt(edge.km),
			windMs: peakWindMs(edge.psi),
			dynamicPsi: dynamicPsi(edge.psi)
		}));
		const survives = new Map<number, number>();
		const standing = new Map<number, number>();
		for (let j = 0; j < e.idx.length; j++) {
			survives.set(e.idx[j], e.survive[j] * (1 - fatalityFromFallout(e.dose[j])));
			standing.set(e.idx[j], e.standing[j]);
		}
		// Bins run out to where this weapon's deaths practically end.
		const hits: { km: number; pop: number; dead: number }[] = [];
		const allKm = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const km = distanceKm(grid.lat[i], grid.lon[i], b.lat, b.lon);
			allKm[i] = km;
			const dead = grid.pop[i] * (1 - (survives.get(i) ?? 1));
			if (dead > 0) hits.push({ km, pop: grid.pop[i], dead });
			for (const z of zones) {
				if (km > z.fromKm && km <= z.toKm) {
					z.pop += grid.pop[i];
					z.deaths += dead;
					z.structures += grid.structures[i] * (1 - (standing.get(i) ?? 1));
					break;
				}
			}
		}
		hits.sort((x, y) => x.km - y.km);
		let running = 0;
		let reachKm = 0;
		const soloTotal = hits.reduce((sum, h) => sum + h.dead, 0);
		for (const h of hits) {
			running += h.dead;
			reachKm = h.km;
			if (running >= soloTotal * 0.995) break;
		}
		const binMax = Math.max(reachKm, rings.psi5, grid.cellKm * 2) * 1.05;
		const bins: DistanceBin[] = Array.from({ length: BIN_COUNT }, (_, k) => ({
			fromKm: (k / BIN_COUNT) * binMax,
			toKm: ((k + 1) / BIN_COUNT) * binMax,
			pop: 0,
			deaths: 0
		}));
		for (let i = 0; i < n; i++) {
			const k = Math.floor((allKm[i] / binMax) * BIN_COUNT);
			if (k >= BIN_COUNT) continue;
			bins[k].pop += grid.pop[i];
			bins[k].deaths += grid.pop[i] * (1 - (survives.get(i) ?? 1));
		}

		// Fallout contours.
		const bands = exo ? [] : falloutBands(b.weapon, b.kt, b.hobM, weather);
		const field = falloutField(b.weapon, b.kt, b.hobM, weather);
		const falloutRows: FalloutRow[] = bands.map((band) => {
			let pop = 0;
			for (let j = 0; j < e.idx.length; j++) if (e.fallout[j] >= band.rate) pop += grid.pop[e.idx[j]];
			const mid = band.length / 2;
			return {
				rate: band.rate,
				band,
				areaKm2: contourArea(band),
				pop,
				sampleDose: field ? field.doseAt(band.rate, mid) : 0
			};
		});

		const placesHit = meta.places
			.map((p) => ({ name: p.name, ru: p.ru, km: distanceKm(p.lat, p.lon, b.lat, b.lon), psi: 0 }))
			.sort((x, y) => x.km - y.km)
			.slice(0, 4);
		const psiAt = psiProfile(b.kt, b.hobM);
		for (const p of placesHit) p.psi = psiAt(p.km);

		return {
			index,
			burst: b,
			rings,
			exo,
			fissionShare: fission,
			fissionKt: b.kt * fission,
			fusionKt: b.kt * (1 - fission),
			hiroshimas: b.kt / HIROSHIMA_KT,
			thermalShare: thermalPartition(b.kt, b.hobM),
			burnCal: burnThreshold(b.kt),
			thermalMaxS: thermalMaxS(b.kt),
			fireballKm: fire,
			fireballTouches: fire * 1000 > b.hobM,
			cloud: cloudGeometry(b.kt),
			winds: effectiveWinds(b.kt, weather.windKmh),
			coupling: groundCoupling(b.kt, b.hobM),
			rainout: rainoutShare(b.kt, weather.precip),
			empKm: empKm(b.kt, b.hobM),
			empPop,
			exoHeat: exo ? exoHeatCurve(b.kt, b.hobM, weather) : [],
			shock,
			deaths,
			causes,
			soloDeaths: alone.fatalities,
			soloStructures: alone.structures,
			soloFalloutPop,
			marginalDeaths: outcome.tally.fatalities - without.fatalities,
			marginalStructures: outcome.tally.structures - without.structures,
			zones,
			bins,
			falloutRows,
			falloutDeaths: soloFalloutDeaths,
			maxDeathKm: binMax,
			placesHit
		};
	});

	// How the map's people ended up, by how bad their cell was.
	const BANDS: [number, number][] = [
		[0, 0.01],
		[0.01, 0.1],
		[0.1, 0.5],
		[0.5, 0.9],
		[0.9, 1.0001]
	];
	const bands: FatalBand[] = BANDS.map(([from, to]) => ({ from, to, pop: 0, cells: 0 }));
	let popAffected = 0;
	for (let i = 0; i < n; i++) {
		const f = cellFatal[i];
		const band = bands.find((x) => f >= x.from && f < x.to) ?? bands[0];
		band.pop += grid.pop[i];
		band.cells++;
		if (f > 0 || rate[i] > 0 || empOn[i]) popAffected += grid.pop[i];
	}

	const places = placeRows(s, sim, bursts, meta, cellFatal);

	const ota: OtaCheck = { fatal: 0, injured: 0 };
	const peak = new Float32Array(n);
	for (const b of bursts) {
		const psiAt = psiProfile(b.kt, b.hobM);
		const limit = blastRangeKm(1, b.kt, b.hobM);
		for (let i = 0; i < n; i++) {
			if (Math.abs(grid.lat[i] - b.lat) * 111.2 > limit) continue;
			const km = distanceKm(grid.lat[i], grid.lon[i], b.lat, b.lon);
			if (km <= limit) peak[i] = Math.max(peak[i], psiAt(km));
		}
	}
	for (let i = 0; i < n; i++) {
		const psi = peak[i];
		const pop = grid.pop[i];
		if (psi > 12) {
			ota.fatal += pop * 0.98;
			ota.injured += pop * 0.02;
		} else if (psi > 5) {
			ota.fatal += pop * 0.5;
			ota.injured += pop * 0.4;
		} else if (psi > 2) {
			ota.fatal += pop * 0.05;
			ota.injured += pop * 0.45;
		} else if (psi > 1) ota.injured += pop * 0.25;
	}

	// Injured survivors, cell by cell, so nobody is counted both hurt and dead. Blast shares are OTA's, above.
	// Firestorm conditions, from OTA 1979 as remembered: 8 lb of fuel per square foot, half the buildings alight at once,
	// under 8 mph of surface wind and at least half a square mile. See docs/CALCULATIONS.md for how each is read here.
	const prompt = new Float32Array(n);
	const inBurns = new Uint8Array(n);
	for (const r of reports) {
		if (r.rings.thermal <= 0) continue;
		for (let i = 0; i < n; i++) {
			if (Math.abs(grid.lat[i] - r.burst.lat) * 111.2 > r.rings.thermal) continue;
			if (distanceKm(grid.lat[i], grid.lon[i], r.burst.lat, r.burst.lon) <= r.rings.thermal) inBurns[i] = 1;
		}
	}
	for (const r of reports) {
		const R = r.rings.radiation;
		if (R <= 0) continue;
		const far = R + PROMPT_FADE_KM * 8;
		for (let i = 0; i < n; i++) {
			if (Math.abs(grid.lat[i] - r.burst.lat) * 111.2 > far) continue;
			const km = distanceKm(grid.lat[i], grid.lon[i], r.burst.lat, r.burst.lon);
			if (km <= far) prompt[i] += km <= R ? PROMPT_EDGE_RAD : PROMPT_EDGE_RAD * Math.pow(R / km, 2) * Math.exp(-(km - R) / PROMPT_FADE_KM);
		}
	}
	const cellArea = grid.cellKm * grid.cellKm;
	const dense = (i: number) => inBurns[i] === 1 && grid.structures[i] / cellArea >= FIRE_STRUCTURES_KM2;
	let denseArea = 0;
	let anyBurn = false;
	for (let i = 0; i < n; i++) {
		if (inBurns[i]) anyBurn = true;
		if (dense(i)) denseArea += cellArea;
	}
	const wet = weather.precip === 'RAIN' || weather.precip === 'SNOW';
	const fireState: Firestorm['state'] = !anyBurn ? 'none' : wet ? 'wet' : weather.windKmh > FIRE_WIND_KMH ? 'wind' : denseArea < FIRE_MIN_KM2 ? 'fuel' : 'burning';
	const firestorm: Firestorm = { state: fireState, areaKm2: fireState === 'burning' ? denseArea : 0, deaths: 0, structures: 0 };
	let cancers = 0;
	const injuries: Injuries = { blast: 0, burns: 0, sickness: 0, total: 0 };
	let harmedPop = 0;
	for (let i = 0; i < n; i++) {
		const pop = grid.pop[i];
		const psi = peak[i];
		const direct = pop * (1 - cellFatal[i]);
		const burned = fireState === 'burning' && dense(i);
		const fireDead = burned ? direct * FIRE_FATAL : 0;
		if (burned) {
			firestorm.deaths += fireDead;
			firestorm.structures += grid.structures[i];
		}
		const rad = Math.min(MAX_LNT_RAD, dose[i] + prompt[i]);
		const cancer = (direct - fireDead) * (rad / 100) * LNT_PER_SV;
		cancers += cancer;
		const alive = direct - fireDead - cancer;
		const share = psi > 12 ? 0.02 : psi > 5 ? 0.4 : psi > 2 ? 0.45 : psi > 1 ? 0.25 : 0;
		const blast = Math.min(alive, pop * share);
		// The same share the game kills inside the burn radius, as a matching share burned and alive.
		const burns = inBurns[i] ? (alive - blast) * BURN_INJURY : 0;
		const sickness = dose[i] >= SICKNESS_RAD ? alive - blast - burns : 0;
		injuries.blast += blast;
		injuries.burns += burns;
		injuries.sickness += sickness;
		if (cellFatal[i] > 0 || fireDead + cancer + blast + burns + sickness > 0) harmedPop += pop;
	}
	injuries.total = injuries.blast + injuries.burns + injuries.sickness;

	// The worked example is the cell that lost the most people while some of them lived, so every
	// term still means something. A cell where everybody died only shows a row of ones.
	let worst = -1;
	let worstScore = 0;
	for (let i = 0; i < n; i++) {
		const score = grid.pop[i] * cellFatal[i] * (cellFatal[i] < 0.97 ? 1 : 0.02);
		if (score > worstScore) {
			worstScore = score;
			worst = i;
		}
	}
	let worked: WorkedCell | null = null;
	if (worst >= 0) {
		const i = worst;
		const steps: WorkedBurstStep[] = [];
		bursts.forEach((b, index) => {
			const e = effects[index];
			const j = e.idx.indexOf(i);
			if (j < 0) return;
			const km = distanceKm(grid.lat[i], grid.lon[i], b.lat, b.lon);
			const f = directTable(b, sim)(km);
			steps.push({
				index,
				km,
				psi: psiProfile(b.kt, b.hobM)(km),
				blast: f.blast,
				burns: f.burns,
				radiation: f.radiation,
				survive: e.survive[j],
				dose: e.dose[j]
			});
		});
		worked = {
			cell: i,
			lat: grid.lat[i],
			lon: grid.lon[i],
			pop: grid.pop[i],
			structures: grid.structures[i],
			steps,
			direct: surv[i],
			dose: dose[i],
			falloutFatal: fatalityFromFallout(dose[i]),
			fatal: cellFatal[i],
			deaths: grid.pop[i] * cellFatal[i],
			standing: stand[i]
		};
	}

	const fissionKt = reports.reduce((sum, r) => sum + r.fissionKt, 0);
	const soloSum = reports.reduce((sum, r) => sum + r.soloDeaths, 0);
	return {
		bursts: reports,
		ota,
		firestorm,
		cancers,
		injuries,
		harmedPop,
		causes: totals,
		deaths: outcome.tally.fatalities,
		structures: outcome.tally.structures,
		mapPop: grid.totalPop,
		mapStructures: grid.totalStructures,
		yieldKt: outcome.tally.yieldKt,
		hiroshimas: outcome.tally.yieldKt / HIROSHIMA_KT,
		fissionKt,
		popAffected,
		overlapDeaths: Math.max(0, soloSum - outcome.tally.fatalities),
		bands,
		places,
		worked,
		cellFatal,
		cellStand: stand,
		cellRate: rate,
		cellDose: dose
	};
}

export const placeLimitKm = (cellKm: number) => Math.max(25, cellKm * 4);

/** Named places on the map. Each cell's people count toward the nearest city, up to a limit. */
function placeRows(s: Scenario, sim: Sim, bursts: Burst[], meta: TheatreMeta, cellFatal: Float32Array): PlaceRow[] {
	const { grid, weather } = sim;
	const cities = meta.places;
	const limitKm = placeLimitKm(grid.cellKm);
	const pop = new Float64Array(cities.length);
	const dead = new Float64Array(cities.length);
	if (cities.length) {
		for (let i = 0; i < grid.n; i++) {
			let best = -1;
			let bestKm = limitKm;
			for (let c = 0; c < cities.length; c++) {
				// A cheap box test first: this runs for every cell against every city.
				if (Math.abs(cities[c].lat - grid.lat[i]) * 111.2 > bestKm) continue;
				const km = distanceKm(grid.lat[i], grid.lon[i], cities[c].lat, cities[c].lon);
				if (km < bestKm) {
					bestKm = km;
					best = c;
				}
			}
			if (best >= 0) {
				pop[best] += grid.pop[i];
				dead[best] += grid.pop[i] * cellFatal[i];
			}
		}
	}
	const probe = (lat: number, lon: number) => {
		let nearestKm = Infinity;
		let peakPsi = 0;
		let rate = 0;
		for (const b of bursts) {
			const km = distanceKm(lat, lon, b.lat, b.lon);
			nearestKm = Math.min(nearestKm, km);
			peakPsi = Math.max(peakPsi, psiProfile(b.kt, b.hobM)(km));
			const field = falloutField(b.weapon, b.kt, b.hobM, weather);
			if (field) {
				const [down, cross] = plumeAxes(b, lat, lon, weather.windBearing);
				rate += field.rateAt(down, cross);
			}
		}
		return { nearestKm, peakPsi, rate };
	};
	const rows: PlaceRow[] = cities.map((c, i) => ({
		name: c.name,
		ru: c.ru,
		lat: c.lat,
		lon: c.lon,
		pop: pop[i],
		deaths: dead[i],
		kind: 'city',
		...probe(c.lat, c.lon)
	}));
	for (const l of s.theatre.landmarks ?? []) {
		rows.push({ name: l.name, lat: l.lat, lon: l.lon, pop: 0, deaths: 0, kind: 'landmark', ...probe(l.lat, l.lon) });
	}
	return rows.sort((a, b) => b.deaths - a.deaths || b.peakPsi - a.peakPsi);
}
