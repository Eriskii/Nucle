import { EARTH_KM } from './effects';
import { destination } from './projection';

// The centre line of a fallout plume, carried along by the wind at each point it passes through. Fallout's strength is
// still worked out along the line as if it were straight, then laid along this curve. Distances to it are in km east and
// north of ground zero, measured on the same flat plane the simulation uses.

const STEPS = 32;
/** How often to look at the line first, before looking closely near the nearest match. Keeps this cheap per map cell. */
const COARSE = 4;
const RAD = Math.PI / 180;
/** The most it can turn in one step. Stops a sudden wind shift between stations making a kink the plume couldn't follow. */
const MAX_TURN_DEG = 22;
/** At the start the plume is mostly carried by the wind at ground zero, then it takes up the local wind. */
const TAKE_UP = 0.55;

export class PlumeTrack {
	readonly lat = new Float64Array(STEPS + 1);
	readonly lon = new Float64Array(STEPS + 1);
	private east = new Float64Array(STEPS + 1);
	private north = new Float64Array(STEPS + 1);
	private bearing = new Float64Array(STEPS + 1);
	private step: number;

	constructor(lat: number, lon: number, lengthKm: number, windBearingAt: (lat: number, lon: number) => number) {
		this.step = Math.max(lengthKm, 1) / STEPS;
		const la = lat * RAD;
		const lo = lon * RAD;
		const ex = -Math.sin(lo);
		const ey = Math.cos(lo);
		const nx = -Math.sin(la) * Math.cos(lo);
		const ny = -Math.sin(la) * Math.sin(lo);
		const nz = Math.cos(la);
		const bx = Math.cos(la) * Math.cos(lo);
		const by = Math.cos(la) * Math.sin(lo);
		const bz = Math.sin(la);
		let at: [number, number] = [lat, lon];
		let heading = windBearingAt(lat, lon);
		for (let i = 0; i <= STEPS; i++) {
			const pa = at[0] * RAD;
			const po = at[1] * RAD;
			const dx = Math.cos(pa) * Math.cos(po) - bx;
			const dy = Math.cos(pa) * Math.sin(po) - by;
			const dz = Math.sin(pa) - bz;
			this.lat[i] = at[0];
			this.lon[i] = at[1];
			this.east[i] = (dx * ex + dy * ey) * EARTH_KM;
			this.north[i] = (dx * nx + dy * ny + dz * nz) * EARTH_KM;
			const wanted = windBearingAt(at[0], at[1]);
			const turn = ((wanted - heading + 540) % 360) - 180;
			heading += Math.max(-MAX_TURN_DEG, Math.min(MAX_TURN_DEG, turn * TAKE_UP));
			this.bearing[i] = heading;
			at = destination(at[0], at[1], heading, this.step);
		}
	}

	/** Distance along the line and to its side, from km east and north of ground zero. Upwind counts as negative. */
	axes(east: number, north: number): [number, number] {
		let best = 0;
		let bestD = Infinity;
		for (let i = 0; i <= STEPS; i += COARSE) {
			const dx = east - this.east[i];
			const dy = north - this.north[i];
			const d = dx * dx + dy * dy;
			if (d < bestD) {
				bestD = d;
				best = i;
			}
		}
		const from = Math.max(0, best - COARSE);
		const to = Math.min(STEPS - 1, best + COARSE - 1);
		let down = 0;
		let cross = 0;
		bestD = Infinity;
		for (let i = from; i <= to; i++) {
			const ax = this.east[i];
			const ay = this.north[i];
			const sx = this.east[i + 1] - ax;
			const sy = this.north[i + 1] - ay;
			const len = Math.hypot(sx, sy) || 1;
			const ux = sx / len;
			const uy = sy / len;
			const px = east - ax;
			const py = north - ay;
			let along = px * ux + py * uy;
			// The two ends carry on straight, so upwind of the burst and past the tip still measure properly.
			if (i > 0 && along < 0) along = 0;
			if (i < STEPS - 1 && along > len) along = len;
			const rx = px - ux * along;
			const ry = py - uy * along;
			const d = rx * rx + ry * ry;
			if (d < bestD) {
				bestD = d;
				down = i * this.step + along;
				cross = py * ux - px * uy;
			}
		}
		return [down, cross];
	}

	/** The point a distance along the line and off to its side. */
	point(along: number, cross: number): [number, number] {
		const t = Math.max(0, Math.min(STEPS, along / this.step));
		const i = Math.min(STEPS - 1, Math.floor(t));
		const f = t - i;
		const heading = this.bearing[i] + f * (((this.bearing[i + 1] - this.bearing[i] + 540) % 360) - 180);
		const base: [number, number] = along < 0 ? destination(this.lat[0], this.lon[0], this.bearing[0] + 180, -along) : destination(this.lat[i], this.lon[i], this.bearing[i], Math.max(0, along - i * this.step));
		return cross === 0 ? base : destination(base[0], base[1], heading + (cross > 0 ? -90 : 90), Math.abs(cross));
	}
}
