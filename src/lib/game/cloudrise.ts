// How the hot air and dust from a burst actually move, for the report's side view. A buoyant thermal after Morton, Taylor
// & Turner (1956): a blob of hot air that mixes in the air around it as it rises through a standard atmosphere, and,
// where it stops being buoyant, flattens and spreads as a gravity current. Dust settles at speeds worked out from drag on
// each particle size. Water vapour mixed in condenses as the air cools, which releases heat and adds lift. The buoyant
// share of the yield and the mixing rate are fitted to published cloud heights, and docs/EFFECTS.md shows how close it
// comes. No wind shear. The fallout map and the score use Miller's fits.

const G = 9.81;
const R_AIR = 287;
const CP = 1005;
const P0 = 101325;
/** Share of the yield left as heat in the rising air, and mixing rate. Both fitted, see above. */
export const BUOYANT_SHARE = 0.35;
export const ENTRAINMENT = 0.13;
/** Where the hot air is taken to start, after the fireball has stopped growing fast. */
const START_K = 3000;
const J_PER_KT = 4.184e12;
const ADDED_MASS = 0.5;
const CEILING_M = 90000;
const MAX_BREACH_M = 30000;

// US Standard Atmosphere 1976: base height in m, base temperature in K, lapse rate in K/m.
const LAYERS: [number, number, number][] = [
	[0, 288.15, -0.0065],
	[11000, 216.65, 0],
	[20000, 216.65, 0.001],
	[32000, 228.65, 0.0028],
	[47000, 270.65, 0],
	[51000, 270.65, -0.0028],
	[71000, 214.65, -0.002],
	[84852, 186.95, 0]
];
const BASE_P: number[] = [];
{
	let p = P0;
	LAYERS.forEach(([h, T, L], i) => {
		BASE_P.push(p);
		const next = LAYERS[i + 1];
		if (!next) return;
		const dz = next[0] - h;
		p = L === 0 ? p * Math.exp((-G * dz) / (R_AIR * T)) : p * Math.pow((T + L * dz) / T, -G / (R_AIR * L));
	});
}

export function air(z: number): { T: number; p: number; rho: number; N: number } {
	const zz = Math.max(0, z);
	let i = LAYERS.length - 1;
	while (i > 0 && zz < LAYERS[i][0]) i--;
	const [h, T0, L] = LAYERS[i];
	const dz = zz - h;
	const T = T0 + L * dz;
	const p = L === 0 ? BASE_P[i] * Math.exp((-G * dz) / (R_AIR * T0)) : BASE_P[i] * Math.pow(T / T0, -G / (R_AIR * L));
	// Buoyancy frequency: how strongly this layer of air resists being lifted.
	const N = Math.sqrt(Math.max(1e-6, (G / T) * (L + G / CP)));
	return { T, p, rho: p / (R_AIR * T), N };
}

const LATENT_WARM = 2.5e6;
const LATENT_ICE = 2.83e6;
const R_VAPOUR = 461.5;
/** Condensed water the cloud can carry, kg per kg. More than this falls out as rain or ice and takes no further part. */
const MAX_CONDENSED = 0.003;
const DRY_STRATOSPHERE = 3e-6;

/** Saturation specific humidity by the Magnus formula, kg per kg. */
function saturation(T: number, p: number): number {
	if (T >= 372) return 1;
	const es = 611.2 * Math.exp((17.67 * (T - 273.15)) / (T - 29.65));
	return Math.min(1, (0.622 * es) / Math.max(p - 0.378 * es, 1));
}

/** Water vapour in the surrounding air: a relative humidity near the ground, drying to almost nothing above the tropopause. */
function ambientVapour(z: number, T: number, p: number, humidity: number): number {
	const taper = 1 - Math.min(1, Math.max(0, (z - 9000) / 4000));
	return Math.max(DRY_STRATOSPHERE, humidity * taper * saturation(T, p));
}

const latent = (T: number) => LATENT_WARM + (LATENT_ICE - LATENT_WARM) * Math.min(1, Math.max(0, (273.15 - T) / 20));

export interface CloudPoint {
	t: number;
	/** Height of the centre, km. */
	z: number;
	/** Radius across and half-height, km. */
	r: number;
	h: number;
	/** Rise speed, m/s. */
	w: number;
	/** How much hotter than the surrounding air, K. */
	dT: number;
	/** Condensed water in g/kg, which is what makes it white. */
	water: number;
	/** True once it has stopped rising and is spreading. */
	spreading: boolean;
}

export interface CloudRise {
	points: CloudPoint[];
	/** True if it was too big for the atmosphere to stop. */
	breached: boolean;
	/** When and how high it first stops. */
	peakS: number;
	topKm: number;
	at(t: number): CloudPoint;
}

const cache = new Map<string, CloudRise>();

/** Follows the rising air for an hour from when it starts to rise. `startS` is when the fireball has stopped growing fast. */
export function cloudRise(kt: number, hobM: number, startS: number, humidity = 0): CloudRise {
	const key = `${kt}|${hobM}|${startS.toFixed(4)}|${humidity}`;
	const hit = cache.get(key);
	if (hit) return hit;

	const E = BUOYANT_SHARE * kt * J_PER_KT;
	const start = air(hobM);
	const V0 = E / ((CP / R_AIR) * start.p * (1 - start.T / START_K));
	let b = Math.cbrt((3 * V0) / (4 * Math.PI));
	// A burst on the ground starts as a hemisphere, so its centre is already off the ground.
	let z = Math.max(hobM, b * 0.6);
	let m = (air(z).p / (R_AIR * START_K)) * V0;
	let T = START_K;
	let w = 0;
	let t = 0;
	let vapour = ambientVapour(z, start.T, start.p, humidity);
	let liquid = 0;
	let dt = 0.02;
	let breached = false;
	const points: CloudPoint[] = [];
	const push = (r: number, h: number, spreading: boolean) => points.push({ t: startS + t, z: z / 1000, r: r / 1000, h: h / 1000, w, dT: T - air(z).T, water: liquid * 1000, spreading });
	push(b, b, false);

	// Rising: mass, momentum and heat of the thermal, with cooling as it expands and as cold air mixes in.
	while (t < 3600) {
		const a = air(z);
		// Density counts water vapour, which is lighter than air, and condensed water, which weighs the cloud down.
		const outside = ambientVapour(z, a.T, a.p, humidity);
		const rhoOut = a.p / (R_AIR * a.T * (1 + 0.608 * outside));
		const rho = (a.p / (R_AIR * T * (1 + 0.608 * vapour))) * (1 + liquid);
		b = Math.cbrt((3 * m) / (4 * Math.PI * rho));
		const inflow = 4 * Math.PI * b * b * ENTRAINMENT * Math.abs(w) * rhoOut + 1e-9 * m;
		const buoy = G * (rhoOut - rho) * ((4 / 3) * Math.PI * b * b * b);
		const dM = inflow;
		const dW = (buoy - inflow * w) / ((1 + ADDED_MASS) * m);
		const dT = (-G * w) / CP + (inflow / m) * (a.T - T);
		m += dM * dt;
		w += dW * dt;
		T += dT * dt;
		z += w * dt;
		// Mixing brings in the outside air's water and dilutes the cloud's own.
		const mix = Math.min(1, (inflow / m) * dt);
		vapour += (outside - vapour) * mix;
		liquid -= liquid * mix;
		// Vapour past saturation condenses and heats the air. Cloud water in air gone too dry evaporates and cools it.
		const here = air(z);
		const sat = saturation(T, here.p);
		const L = latent(T);
		const change = (vapour - sat) / (1 + (L * L * sat) / (CP * R_VAPOUR * T * T));
		const condense = change > 0 ? change : Math.max(change, -liquid);
		vapour -= condense;
		liquid += condense;
		T += (L * condense) / CP;
		if (liquid > MAX_CONDENSED) liquid = MAX_CONDENSED;
		t += dt;
		dt = Math.min(1, dt * 1.01);
		if (points.length < 400 && t >= points[points.length - 1].t - startS + Math.max(0.1, t * 0.04)) push(b, b, false);
		if (w <= 0 && t > 1) break;
		// Past here the bubble is bigger than the air that could hold it. A thermal stops being a fair description,
		// so it's held at the top of the atmosphere, and the cloud is marked as having broken through.
		if (z + b > CEILING_M) {
			breached = true;
			b = Math.min(b, MAX_BREACH_M);
			z = CEILING_M - b;
			break;
		}
	}
	const peakS = startS + t;
	const peakZ = z;
	const topKm = (z + b) / 1000;
	push(b, b, false);

	// Spreading: it sinks back to where it matches the air, and flattens outward as a gravity current.
	const V = (4 / 3) * Math.PI * b * b * b;
	let r = b;
	let h = b;
	const peakB = b;
	// It keeps mixing as it spreads, so it doesn't thin as fast as its starting volume alone would give.
	const minH = peakB * 0.38;
	const neutral = peakZ - b * 0.2;
	const zPeak = z;
	const period = (2 * Math.PI) / air(z).N;
	w = 0;
	while (t < 3600) {
		const a = air(z);
		const drdt = 0.3 * a.N * h;
		r += drdt * dt;
		h = Math.max(minH, (3 * V) / (4 * Math.PI * r * r));
		const settle = 1 - Math.exp(-(t + startS - peakS) / period);
		z = zPeak + (neutral - zPeak) * settle;
		T += (a.T - T) * Math.min(1, dt / 300);
		t += dt;
		dt = Math.min(4, dt * 1.02);
		if (points.length < 700 && t >= points[points.length - 1].t - startS + Math.max(0.5, t * 0.03)) push(r, h, true);
	}
	push(r, h, true);

	const rise: CloudRise = {
		points,
		breached,
		peakS,
		topKm,
		at(q: number) {
			if (q <= points[0].t) return { ...points[0], t: q, w: 0 };
			let lo = 0;
			let hi = points.length - 1;
			while (hi - lo > 1) {
				const mid = (lo + hi) >> 1;
				if (points[mid].t <= q) lo = mid;
				else hi = mid;
			}
			const A = points[lo];
			const B = points[hi];
			if (q >= B.t) return { ...B, t: q };
			const f = (q - A.t) / Math.max(B.t - A.t, 1e-6);
			return { t: q, water: A.water + (B.water - A.water) * f, z: A.z + (B.z - A.z) * f, r: A.r + (B.r - A.r) * f, h: A.h + (B.h - A.h) * f, w: A.w + (B.w - A.w) * f, dT: A.dT + (B.dT - A.dT) * f, spreading: B.spreading };
		}
	};
	if (cache.size > 200) cache.clear();
	cache.set(key, rise);
	return rise;
}

const DUST_DENSITY = 2600;

/** Air's viscosity by Sutherland's law, Pa s. */
const viscosity = (T: number) => (1.458e-6 * Math.pow(T, 1.5)) / (T + 110.4);

/** Terminal fall speed of a dust grain, m/s, from the balance of its weight and drag, at a height in metres. */
export function settlingSpeed(diameterM: number, z: number): number {
	const a = air(z);
	const mu = viscosity(a.T);
	let v = ((DUST_DENSITY - a.rho) * G * diameterM * diameterM) / (18 * mu);
	for (let i = 0; i < 12; i++) {
		const re = Math.max((a.rho * v * diameterM) / mu, 1e-6);
		// Schiller-Naumann drag for a sphere.
		const cd = (24 / re) * (1 + 0.15 * Math.pow(re, 0.687)) + (re > 1000 ? 0.42 - 0.44 : 0);
		v = 0.5 * v + 0.5 * Math.sqrt((4 * (DUST_DENSITY - a.rho) * G * diameterM) / (3 * a.rho * Math.max(cd, 0.42)));
	}
	return v;
}

/** How far a grain has fallen from a starting height after a time, km. */
export function fallenKm(diameterM: number, fromKm: number, seconds: number): number {
	let z = fromKm * 1000;
	let left = seconds;
	while (left > 0 && z > 0) {
		const step = Math.min(left, 30);
		z -= settlingSpeed(diameterM, z) * step;
		left -= step;
	}
	return fromKm - Math.max(z, 0) / 1000;
}

/** Grain sizes and shares of the mass, broad enough to stand for lofted soil. The split is an estimate. */
export const DUST_SIZES: [number, number][] = [
	[10e-6, 0.1],
	[30e-6, 0.15],
	[100e-6, 0.3],
	[300e-6, 0.3],
	[1000e-6, 0.15]
];

/** Share of the cloud's dust that has reached the ground after a time, from a starting height. */
export function dustDown(fromKm: number, seconds: number): number {
	let down = 0;
	for (const [d, share] of DUST_SIZES) if (fallenKm(d, fromKm, seconds) >= fromKm - 1e-6) down += share;
	return down;
}
