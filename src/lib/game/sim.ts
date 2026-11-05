import {
	EARTH_KM,
	empKm,
	falloutField,
	fatalityFromFallout,
	fatalityFromPsi,
	psiProfile,
	radiationKm,
	structureLossFromPsi,
	thermalKm,
	type Weather
} from './effects';
import type { Weapon } from './weapons';

export interface PopGrid {
	n: number;
	lat: Float32Array;
	lon: Float32Array;
	pop: Float32Array;
	structures: Float32Array;
	/** Width of one data cell in km, used to smooth edges of effects. */
	cellKm: number;
	totalPop: number;
	totalStructures: number;
}

export interface Burst {
	weapon: Weapon;
	lat: number;
	lon: number;
	kt: number;
	hobM: number;
}

export interface Probe {
	lat: number;
	lon: number;
}

const RAD = Math.PI / 180;
const TABLE_SIZE = 200;

/** One burst's effect on the grid, sparse so combining many bursts stays cheap. */
export interface BurstEffect {
	idx: Int32Array;
	survive: Float32Array;
	standing: Float32Array;
	/** H+1 reference dose rate in rad/h. */
	fallout: Float32Array;
	/** Dose in rad to people with the assumed shelter, which is what kills. */
	dose: Float32Array;
	emp: Uint8Array;
	/** Overpressure at each probe. */
	probePsi: Float32Array;
	/** Fallout dose rate at each probe. */
	probeRate: Float32Array;
}

export interface Tally {
	fatalities: number;
	structures: number;
	falloutPop: number;
	empPop: number;
	yieldKt: number;
	warheads: number;
	probePsi: Float32Array;
	probeRate: Float32Array;
	/** Structures destroyed inside the target zone, when one is set. */
	zoneStructures: number;
	zoneFatalities: number;
}

type Vec = [number, number, number];
const toVec = (lat: number, lon: number): Vec => {
	const a = lat * RAD;
	const b = lon * RAD;
	return [Math.cos(a) * Math.cos(b), Math.cos(a) * Math.sin(b), Math.sin(a)];
};

/** Great-circle distance in km. */
export function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
	const [ax, ay, az] = toVec(aLat, aLon);
	const [bx, by, bz] = toVec(bLat, bLon);
	const c = Math.hypot(ax - bx, ay - by, az - bz);
	return 2 * EARTH_KM * Math.asin(Math.min(1, c / 2));
}

export class Sim {
	readonly grid: PopGrid;
	readonly weather: Weather;
	readonly probes: Probe[];
	private x: Float64Array;
	private y: Float64Array;
	private z: Float64Array;
	private zone: Uint8Array;
	private stamp: Uint32Array;
	private gen = 0;
	private surv: Float64Array;
	private stand: Float64Array;
	private rate: Float64Array;
	private dose: Float64Array;
	private empOn: Uint8Array;
	private touched: Int32Array;
	private cache = new Map<string, BurstEffect>();

	constructor(grid: PopGrid, weather: Weather, probes: Probe[], zone?: { lat: number; lon: number; km: number }) {
		this.grid = grid;
		this.weather = weather;
		this.probes = probes;
		const n = grid.n;
		this.x = new Float64Array(n);
		this.y = new Float64Array(n);
		this.z = new Float64Array(n);
		this.zone = new Uint8Array(n);
		for (let i = 0; i < n; i++) {
			const [x, y, z] = toVec(grid.lat[i], grid.lon[i]);
			this.x[i] = x;
			this.y[i] = y;
			this.z[i] = z;
		}
		if (zone) {
			const [zx, zy, zz] = toVec(zone.lat, zone.lon);
			const limit = 2 * Math.sin(zone.km / EARTH_KM / 2);
			for (let i = 0; i < n; i++) {
				if (Math.hypot(this.x[i] - zx, this.y[i] - zy, this.z[i] - zz) <= limit) this.zone[i] = 1;
			}
		}
		this.stamp = new Uint32Array(n);
		this.surv = new Float64Array(n);
		this.stand = new Float64Array(n);
		this.rate = new Float64Array(n);
		this.dose = new Float64Array(n);
		this.empOn = new Uint8Array(n);
		this.touched = new Int32Array(n);
	}

	effect(b: Burst): BurstEffect {
		const key = `${b.weapon.id}|${b.lat.toFixed(5)}|${b.lon.toFixed(5)}|${b.kt}|${b.hobM}`;
		let e = this.cache.get(key);
		if (!e) {
			if (this.cache.size > 4000) this.cache.clear();
			e = this.compute(b);
			this.cache.set(key, e);
		}
		return e;
	}

	private compute(b: Burst): BurstEffect {
		const { grid, weather } = this;
		const psiAt = psiProfile(b.kt, b.hobM);
		const thermal = thermalKm(b.kt, b.hobM, weather);
		const radiation = radiationKm(b.kt, b.hobM, b.weapon.enhanced);
		const emp = empKm(b.kt, b.hobM);
		const field = falloutField(b.weapon, b.kt, b.hobM, weather);

		let blastMax = 0;
		while (blastMax < 40000 && psiAt(blastMax + 0.01) > 1) blastMax = blastMax * 1.05 + 0.01;
		const directKm = Math.max(blastMax, thermal, radiation) + grid.cellKm;

		// Lookup tables by distance, each entry averaged over a cell's width.
		const killT = new Float32Array(TABLE_SIZE + 1);
		const standT = new Float32Array(TABLE_SIZE + 1);
		const half = grid.cellKm / 2;
		const offsets = [-half * 0.75, -half * 0.25, half * 0.25, half * 0.75];
		for (let i = 0; i <= TABLE_SIZE; i++) {
			const d = (i / TABLE_SIZE) * directKm;
			let kill = 0;
			let stand = 0;
			for (const o of offsets) {
				const r = Math.abs(d + o);
				const psi = psiAt(r);
				const burn = thermal > 0 ? 0.25 * clamp01((thermal - r) / (thermal * 0.15)) : 0;
				const rad = radiation > 0 ? 0.9 * clamp01((radiation - r) / (radiation * 0.15)) : 0;
				kill += 1 - (1 - fatalityFromPsi(psi)) * (1 - burn) * (1 - rad);
				const fire = burn > 0 ? 0.3 * (burn / 0.25) : 0;
				stand += (1 - structureLossFromPsi(psi)) * (1 - fire);
			}
			killT[i] = 1 - kill / offsets.length;
			standT[i] = stand / offsets.length;
		}

		const [bx, by, bz] = toVec(b.lat, b.lon);
		const wind = weather.windBearing * RAD;
		const latR = b.lat * RAD;
		const lonR = b.lon * RAD;
		// Local east and north at the burst, for resolving the plume axes.
		const ex = -Math.sin(lonR);
		const ey = Math.cos(lonR);
		const nx = -Math.sin(latR) * Math.cos(lonR);
		const ny = -Math.sin(latR) * Math.sin(lonR);
		const nz = Math.cos(latR);
		const dirE = Math.sin(wind);
		const dirN = Math.cos(wind);

		// The corner of the plume's box, since cells are culled by distance from ground zero.
		const plumeReach = field ? Math.hypot(Math.max(field.downKm, field.upKm), field.halfWidthKm) : 0;
		const reach = Math.max(directKm, emp, plumeReach);
		const chordLimit = 2 * Math.sin(Math.min(reach / EARTH_KM, Math.PI) / 2);
		const lim2 = chordLimit * chordLimit;

		const hits: number[] = [];
		const survive: number[] = [];
		const standing: number[] = [];
		const fallout: number[] = [];
		const dose: number[] = [];
		const empHit: number[] = [];
		const { x, y, z } = this;
		for (let i = 0; i < grid.n; i++) {
			const dx = x[i] - bx;
			const dy = y[i] - by;
			const dz = z[i] - bz;
			const c2 = dx * dx + dy * dy + dz * dz;
			if (c2 > lim2) continue;
			const km = 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(c2) / 2));
			let s = 1;
			let st = 1;
			if (km <= directKm) {
				const t = (km / directKm) * TABLE_SIZE;
				const i0 = Math.floor(t);
				const f = t - i0;
				const i1 = Math.min(TABLE_SIZE, i0 + 1);
				s = killT[i0] + (killT[i1] - killT[i0]) * f;
				st = standT[i0] + (standT[i1] - standT[i0]) * f;
			}
			let r = 0;
			let d = 0;
			if (field) {
				const east = (dx * ex + dy * ey) * EARTH_KM;
				const north = (dx * nx + dy * ny + dz * nz) * EARTH_KM;
				const down = east * dirE + north * dirN;
				r = field.rateAt(down, north * dirE - east * dirN);
				if (r > 0) d = field.doseAt(r, down);
			}
			const em = km <= emp ? 1 : 0;
			if (s < 1 || st < 1 || r > 0 || em) {
				hits.push(i);
				survive.push(s);
				standing.push(st);
				fallout.push(r);
				dose.push(d);
				empHit.push(em);
			}
		}

		const probePsi = new Float32Array(this.probes.length);
		const probeRate = new Float32Array(this.probes.length);
		this.probes.forEach((p, i) => {
			const [px, py, pz] = toVec(p.lat, p.lon);
			const dx = px - bx;
			const dy = py - by;
			const dz = pz - bz;
			const km = 2 * EARTH_KM * Math.asin(Math.min(1, Math.hypot(dx, dy, dz) / 2));
			probePsi[i] = psiAt(km);
			if (field) {
				const east = (dx * ex + dy * ey) * EARTH_KM;
				const north = (dx * nx + dy * ny + dz * nz) * EARTH_KM;
				probeRate[i] = field.rateAt(east * dirE + north * dirN, north * dirE - east * dirN);
			}
		});

		return {
			idx: Int32Array.from(hits),
			survive: Float32Array.from(survive),
			standing: Float32Array.from(standing),
			fallout: Float32Array.from(fallout),
			dose: Float32Array.from(dose),
			emp: Uint8Array.from(empHit),
			probePsi,
			probeRate
		};
	}

	/** Combine bursts. Pass `perCell` to receive damage per grid cell for display. */
	tally(bursts: Burst[], perCell?: Float32Array): Tally {
		const { grid } = this;
		const gen = ++this.gen;
		let count = 0;
		const probePsi = new Float32Array(this.probes.length);
		const probeRate = new Float32Array(this.probes.length);
		let yieldKt = 0;
		const { stamp, surv, stand, rate, dose, empOn, touched } = this;
		for (const b of bursts) {
			yieldKt += b.kt;
			const e = this.effect(b);
			for (let j = 0; j < e.idx.length; j++) {
				const i = e.idx[j];
				if (stamp[i] !== gen) {
					stamp[i] = gen;
					surv[i] = 1;
					stand[i] = 1;
					rate[i] = 0;
					dose[i] = 0;
					empOn[i] = 0;
					touched[count++] = i;
				}
				surv[i] *= e.survive[j];
				stand[i] *= e.standing[j];
				rate[i] += e.fallout[j];
				dose[i] += e.dose[j];
				if (e.emp[j]) empOn[i] = 1;
			}
			for (let p = 0; p < probePsi.length; p++) {
				if (e.probePsi[p] > probePsi[p]) probePsi[p] = e.probePsi[p];
				probeRate[p] += e.probeRate[p];
			}
		}
		if (perCell) perCell.fill(0);
		let fatalities = 0;
		let structures = 0;
		let falloutPop = 0;
		let empPop = 0;
		let zoneStructures = 0;
		let zoneFatalities = 0;
		for (let k = 0; k < count; k++) {
			const i = touched[k];
			const pop = grid.pop[i];
			const f = 1 - surv[i] * (1 - fatalityFromFallout(dose[i]));
			const s = 1 - stand[i];
			fatalities += pop * f;
			structures += grid.structures[i] * s;
			if (rate[i] >= 10) falloutPop += pop;
			if (empOn[i]) empPop += pop;
			if (this.zone[i]) {
				zoneStructures += grid.structures[i] * s;
				zoneFatalities += pop * f;
			}
			if (perCell) perCell[i] = Math.max(f, s, rate[i] >= 10 ? 0.35 : 0, empOn[i] ? 0.2 : 0);
		}
		return {
			fatalities,
			structures,
			falloutPop,
			empPop,
			yieldKt,
			warheads: bursts.length,
			probePsi,
			probeRate,
			zoneStructures,
			zoneFatalities
		};
	}
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
