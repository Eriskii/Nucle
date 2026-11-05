// Weapon effects, simplified for a game. Sources, validity ranges and how far the model sits
// from each published anchor are in docs/EFFECTS.md. Short names used in comments:
// G&D: Glasstone & Dolan, The Effects of Nuclear Weapons, 3rd ed., 1977.
// Brode: H. L. Brode, Airblast from Nuclear Bursts: Analytic Approximations, PSR 1419-3, 1987.
// Miller: C. F. Miller, Biological and Radiological Effects of Fallout, URS 702-1, 1969.
// Hanifen: D. W. Hanifen, Documentation and Analysis of the WSEG-10 Model, AFIT thesis, 1980.
// OTA: Office of Technology Assessment, The Effects of Nuclear War, 1979.
// Sublette: C. Sublette, Nuclear Weapons FAQ, section 5.

import { fissionFractionAt, type Weapon } from './weapons';

export type Precip = 'CLEAR' | 'HAZE' | 'OVERCAST' | 'RAIN' | 'SNOW';

export interface Weather {
	precip: Precip;
	/** Bearing the wind blows toward, in degrees. */
	windBearing: number;
	/** Wind in the lowest few kilometres. Clouds that rise higher feel faster air, see WIND_PROFILE. */
	windKmh: number;
}

export const EARTH_KM = 6371;
/** Above this height there is no blast, heat or fallout at ground level. */
export const EXO_HEIGHT_M = 30000;

const KM_PER_MI = 1.609344;
const FT_PER_M = 1 / 0.3048;
const FT_PER_MI = 5280;

const lerpTable = (table: [number, number][], x: number) => {
	if (x <= table[0][0]) return table[0][1];
	for (let i = 1; i < table.length; i++) {
		if (x <= table[i][0]) {
			const [x0, y0] = table[i - 1];
			const [x1, y1] = table[i];
			return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
		}
	}
	return table[table.length - 1][1];
};

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/** Largest height of burst with appreciable local fallout, ±30%. G&D eq. 2.128.1: 180 W^0.4 ft. */
export const localFalloutHeightM = (kt: number) => (180 * Math.pow(kt, 0.4)) / FT_PER_M;

/** Maximum fireball radius. G&D §2.127: twice breakaway, 110 W^0.4 ft in air, 145 W^0.4 ft on contact. */
export function fireballKm(kt: number, hobM = 1e9): number {
	const air = 220 * Math.pow(kt, 0.4);
	const contact = 290 * Math.pow(kt, 0.4);
	const t = clamp(hobM / localFalloutHeightM(kt), 0, 1);
	return ((contact + (air - contact) * t) / FT_PER_M) / 1000;
}

// ---- Airblast -------------------------------------------------------------------------------

/** Brode eq. 62, peak overpressure in psi over an ideal surface. x, y in kft per cube-root kt. */
function brodePsi(x: number, y: number): number {
	const r = Math.hypot(x, y);
	const z = y / x;
	const z2 = z * z;
	const z5 = z2 * z2 * z;
	const z18 = Math.pow(z, 18);
	const a = 1.22 - (3.908 * z2) / (1 + 810.2 * z5);
	const b =
		2.321 +
		(6.195 * z18) / (1 + 1.113 * z18) -
		(0.03831 * Math.pow(z, 17)) / (1 + 0.02415 * Math.pow(z, 17)) +
		0.6692 / (1 + 4164 * Math.pow(z, 8));
	const c = 4.153 - (1.149 * z18) / (1 + 1.641 * z18) - 1.1 / (1 + 2.771 * Math.pow(z, 2.5));
	const d = -4.166 + (25.76 * Math.pow(z, 1.75)) / (1 + 1.382 * z18) + (8.257 * z) / (1 + 3.219 * z);
	const e = 1 - (0.004642 * z18) / (1 + 0.003886 * z18);
	const f = 0.6096 + (2.879 * Math.pow(z, 9.25)) / (1 + 2.359 * Math.pow(z, 14.5)) - (17.15 * z2) / (1 + 71.66 * z2 * z);
	const g = 1.83 + (5.361 * z2) / (1 + 0.3139 * z2 * z2 * z2);
	const h =
		(8.808 * Math.pow(z, 1.5)) / (1 + 154.5 * Math.pow(z, 3.5)) -
		(0.2905 + 64.67 * z5) / (1 + 441.5 * z5) -
		(1.389 * z) / (1 + 49.03 * z5) +
		(1.094 * r * r) / ((781.2 - 123.4 * r + 37.98 * Math.pow(r, 1.5) + r * r) * (1 + 2 * y));
	const j = (0.000629 * Math.pow(y, 4)) / (3.493e-9 + Math.pow(y, 4)) - (2.67 * y * y) / (1 + 1e7 * Math.pow(y, 4.3));
	const k = 5.18 + (0.2803 * Math.pow(y, 3.5)) / (3.788e-6 + Math.pow(y, 4));
	return 10.47 / Math.pow(r, a) + b / Math.pow(r, c) + (d * e) / (1 + f * Math.pow(r, g)) + h + j / Math.pow(r, k);
}

// The fit is too dear to call per cell, so it is sampled once into a grid of ln(psi) over
// log range and scaled height. It goes negative far out, past the 0.1 psi it was built for.
const PSI_FLOOR = 0.1;
const XN = 96;
const YN = 72;
const X_MIN = 0.008;
const X_MAX = 400;
const Y_MAX = 30;
const LOG_DX = Math.log(X_MAX / X_MIN) / (XN - 1);
const yAt = (j: number) => 0.02 * (Math.exp((j / (YN - 1)) * Math.log(Y_MAX / 0.02 + 1)) - 1);
const yIndex = (y: number) => (Math.log(y / 0.02 + 1) / Math.log(Y_MAX / 0.02 + 1)) * (YN - 1);
let psiGrid: Float64Array | null = null;

function buildPsiGrid(): Float64Array {
	const grid = new Float64Array(XN * YN);
	for (let j = 0; j < YN; j++) {
		const y = yAt(j);
		let below = Infinity;
		for (let i = 0; i < XN; i++) {
			const p = brodePsi(X_MIN * Math.exp(i * LOG_DX), y);
			// Once it has dropped through the floor it stays down: the far field is not a second wave.
			below = Math.min(below, p);
			grid[j * XN + i] = below < PSI_FLOOR ? -Infinity : Math.log(below);
		}
	}
	return grid;
}

/** ln(psi) at each range knot for a scaled height, interpolated across height. */
function psiSlice(y: number): Float64Array {
	if (!psiGrid) psiGrid = buildPsiGrid();
	const grid = psiGrid;
	const out = new Float64Array(XN);
	const t = clamp(yIndex(y), 0, YN - 1.0001);
	const j = Math.floor(t);
	const f = t - j;
	for (let i = 0; i < XN; i++) {
		const a = grid[j * XN + i];
		const b = grid[(j + 1) * XN + i];
		out[i] = a === -Infinity || b === -Infinity ? -Infinity : a + (b - a) * f;
	}
	return out;
}

const scaledHeight = (hobM: number, scale: number) => (hobM * FT_PER_M) / 1000 / scale;

/** Overpressure in psi at a ground range. Cube-root scaling at sea-level ambient pressure. */
export function psiProfile(kt: number, hobM: number): (km: number) => number {
	if (hobM >= EXO_HEIGHT_M) return () => 0;
	const scale = Math.cbrt(kt);
	const y = scaledHeight(hobM, scale);
	if (y > Y_MAX) return () => 0;
	const slice = psiSlice(y);
	const toX = FT_PER_M / scale;
	return (km) => {
		const x = km * toX;
		if (x <= X_MIN) return Math.exp(slice[0]);
		if (x >= X_MAX) return 0;
		const t = Math.log(x / X_MIN) / LOG_DX;
		const i = Math.min(XN - 2, Math.floor(t));
		const a = slice[i];
		const b = slice[i + 1];
		if (a === -Infinity) return 0;
		if (b === -Infinity) return Math.exp(a) * (1 - (t - i));
		return Math.exp(a + (b - a) * (t - i));
	};
}

/** Ground range in km at which an overpressure is reached. 0 if it never is. */
export function blastRangeKm(psi: number, kt: number, hobM: number): number {
	if (hobM >= EXO_HEIGHT_M) return 0;
	const scale = Math.cbrt(kt);
	const y = scaledHeight(hobM, scale);
	if (y > Y_MAX) return 0;
	const slice = psiSlice(y);
	const target = Math.log(psi);
	for (let i = XN - 1; i >= 1; i--) {
		if (slice[i - 1] >= target) {
			const f = slice[i] === -Infinity ? 0 : (slice[i - 1] - target) / (slice[i - 1] - slice[i]);
			const x = X_MIN * Math.exp((i - 1 + f) * LOG_DX);
			return (x * scale * 1000) / FT_PER_M / 1000;
		}
	}
	return slice[0] >= target ? (X_MIN * scale * 1000) / FT_PER_M / 1000 : 0;
}

/** Height that maximises the 5 psi range. Eq. 62 peaks near 270 m at 1 kt, and it scales by cube root. */
// Capped under the ceiling, or a 10 Gt device's optimum would have no effect on the ground at all.
export const optimumHobM = (kt: number) => Math.min(EXO_HEIGHT_M - 1000, Math.round(270 * Math.cbrt(kt)));

// Rankine-Hugoniot relations for the shock front at sea level, G&D §3.55, with 14.7 psi and 1116 ft/s.
const P0_PSI = 14.7;
const C0_MS = 340;

/** Shock front speed in m/s behind a peak overpressure in psi. */
export const shockSpeedMs = (psi: number) => C0_MS * Math.sqrt(1 + (6 * psi) / (7 * P0_PSI));
/** Peak wind in m/s behind the front. */
export const peakWindMs = (psi: number) => ((5 * psi) / (7 * P0_PSI)) * C0_MS / Math.sqrt(1 + (6 * psi) / (7 * P0_PSI));
/** Peak dynamic pressure in psi. */
export const dynamicPsi = (psi: number) => (5 * psi * psi) / (2 * (7 * P0_PSI + psi));

export interface ShockPoint {
	km: number;
	s: number;
}

/**
 * Arrival of the front along the ground, integrating distance over shock speed at each range's own overpressure.
 * An estimate built on Brode's pressures. On the way down to the ground from the burst, free air is taken as half
 * the surface-burst pressure. Times come back in rising order, starting where the front first touches ground.
 */
export function shockArrival(kt: number, hobM: number, maxKm: number): ShockPoint[] {
	if (hobM >= EXO_HEIGHT_M) return [];
	const h = hobM / 1000;
	const ground = psiProfile(kt, hobM);
	const air = psiProfile(kt, 0);
	const start = Math.max(0.0005 * Math.cbrt(kt), 1e-4);
	const steps = 240;
	const ratio = Math.pow(Math.hypot(maxKm, h) / start, 1 / steps);
	const out: ShockPoint[] = [];
	let s = start;
	let t = 0;
	for (let i = 0; i < steps; i++) {
		const next = s * ratio;
		const mid = Math.sqrt(s * next);
		const r2 = mid * mid - h * h;
		const psi = r2 > 0 ? ground(Math.sqrt(r2)) : air(mid) / 2;
		t += ((next - s) * 1000) / shockSpeedMs(Math.max(psi, 0));
		s = next;
		const here = s * s - h * h;
		if (here >= 0) out.push({ km: Math.sqrt(here), s: t });
	}
	return out;
}

/** Second thermal maximum in seconds, G&D §7.85. About 80% of the heat is out by ten of these. */
export const thermalMaxS = (kt: number) => 0.0417 * Math.pow(kt, 0.44);

/** The exposure that gives third-degree burns on medium skin at this yield, cal/cm². */
export const burnThreshold = (kt: number) => lerpTable(THIRD_DEGREE, Math.log10(kt));

export interface Rings {
	fireball: number;
	psi20: number;
	psi5: number;
	psi1: number;
	thermal: number;
	radiation: number;
}

// ---- Thermal --------------------------------------------------------------------------------

// G&D Table 7.88: thermal partition by burst height (kft, rows) and log10 yield (columns 1 kt to 10 Mt).
const PARTITION_KFT = [15, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const PARTITION = [
	[0.35, 0.35, 0.35, 0.35, 0.35],
	[0.35, 0.36, 0.39, 0.41, 0.43],
	[0.35, 0.36, 0.39, 0.41, 0.43],
	[0.35, 0.36, 0.38, 0.4, 0.42],
	[0.35, 0.36, 0.38, 0.4, 0.42],
	[0.35, 0.37, 0.38, 0.4, 0.42],
	[0.36, 0.37, 0.39, 0.4, 0.42],
	[0.37, 0.38, 0.39, 0.41, 0.43],
	[0.38, 0.39, 0.4, 0.41, 0.43],
	[0.4, 0.4, 0.41, 0.42, 0.45]
];
// G&D Table 7.101, effective partition near the ground, from its 1 kt column. Height in ft per
// cube-root kt: the other columns of the table collapse onto this one within about 0.02.
const CONTACT_PARTITION: [number, number][] = [
	[0, 0.18],
	[20, 0.19],
	[40, 0.21],
	[70, 0.23],
	[100, 0.26],
	[200, 0.35]
];

export function thermalPartition(kt: number, hobM: number): number {
	const kft = (hobM * FT_PER_M) / 1000;
	const col = clamp(Math.log10(kt), 0, 3.999);
	const c = Math.floor(col);
	const row = (r: number) => PARTITION[r][c] + (PARTITION[r][c + 1] - PARTITION[r][c]) * (col - c);
	let r = 0;
	while (r < PARTITION_KFT.length - 2 && kft > PARTITION_KFT[r + 1]) r++;
	const t = clamp((kft - PARTITION_KFT[r]) / (PARTITION_KFT[r + 1] - PARTITION_KFT[r]), 0, 1);
	const air = row(r) + (row(r + 1) - row(r)) * t;
	const near = lerpTable(CONTACT_PARTITION, (hobM * FT_PER_M) / Math.cbrt(kt));
	return Math.min(air, (near / 0.35) * air);
}

// G&D Fig. 12.64, read from the plot: exposure for third-degree burns on medium skin, by log10 yield.
const THIRD_DEGREE: [number, number][] = [
	[0, 6.2],
	[1, 7],
	[2, 8.4],
	[3, 10],
	[4, 11.8],
	[6, 15.4]
];

interface Sky {
	/** Daylight visibility in miles. CLEAR and HAZE are from G&D Table 7.12, the rest are estimates. */
	visMi: number;
	/** Cloud layer in feet. Base from G&D §9.68; tops inside its 10,000 to 33,000 ft range. */
	cloud?: { base: number; top: number; above: number };
	/** Ground reflection. G&D §7.100 gives 1.5 for snow, and the same for a cloud layer over the burst. */
	ground?: number;
}

const SKY: Record<Precip, Sky> = {
	CLEAR: { visMi: 12 },
	HAZE: { visMi: 6 },
	// `above` is the loss through the layer for a burst over it. Brode allows 0.1 to 1 for this.
	OVERCAST: { visMi: 12, cloud: { base: 2000, top: 10000, above: 0.3 } },
	RAIN: { visMi: 2.5, cloud: { base: 2000, top: 25000, above: 0.1 } },
	SNOW: { visMi: 6, cloud: { base: 2000, top: 10000, above: 0.3 }, ground: 1.5 }
};

function cloudFactor(sky: Sky, hobM: number): number {
	const ground = sky.ground ?? 1;
	if (!sky.cloud) return ground;
	const ft = hobM * FT_PER_M;
	const { base, top, above } = sky.cloud;
	return ground * (1.5 + (above - 1.5) * clamp((ft - base) / (top - base), 0, 1));
}

const CLEAR_AIR_ABOVE_MI = 15000 / FT_PER_MI;

/**
 * Brode eq. 86 with his α 2.9, β 1.9. G&D holds Fig. 7.42 good to 15,000 ft and says little attenuation
 * happens above that, so a higher burst counts only the share of its path below 15,000 ft (a simplification).
 */
function transmittance(slantMi: number, hobMi: number, visMi: number): number {
	const path = hobMi > CLEAR_AIR_ABOVE_MI ? (slantMi * CLEAR_AIR_ABOVE_MI) / hobMi : slantMi;
	const s = path / visMi;
	return (1 + 1.9 * s) * Math.exp(-2.9 * s);
}

/** Exposure at a slant range in cal/cm². G&D eq. 7.96.4: Q = 3.07 f W T / D², D in miles. */
export function thermalExposure(kt: number, hobM: number, slantMi: number, weather: Weather): number {
	const sky = SKY[weather.precip];
	const T = transmittance(slantMi, hobM / (KM_PER_MI * 1000), sky.visMi);
	return (3.07 * thermalPartition(kt, hobM) * kt * T * cloudFactor(sky, hobM)) / (slantMi * slantMi);
}

/** Ground range of third-degree burns on exposed skin. */
export function thermalKm(kt: number, hobM: number, weather: Weather): number {
	if (hobM >= EXO_HEIGHT_M) return 0;
	const need = lerpTable(THIRD_DEGREE, Math.log10(kt));
	const hMi = hobM / (KM_PER_MI * 1000);
	let lo = Math.max(hMi, 1e-3);
	if (thermalExposure(kt, hobM, lo, weather) < need) return 0;
	let hi = lo + 1;
	while (hi < 4000 && thermalExposure(kt, hobM, hi, weather) >= need) hi *= 2;
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (thermalExposure(kt, hobM, mid, weather) >= need) lo = mid;
		else hi = mid;
	}
	return groundRange(lo * KM_PER_MI, hobM);
}

// ---- Prompt radiation -----------------------------------------------------------------------

/** Ground range of 1000 rad. Sublette 5.6.3.3: 700 Y^0.19 m, within 7% of G&D Figs. 8.33a and b to 20 Mt. */
export function radiationKm(kt: number, hobM: number, enhanced = 1): number {
	if (hobM >= EXO_HEIGHT_M) return 0;
	return groundRange(0.7 * Math.pow(kt, 0.19) * enhanced, hobM);
}

const groundRange = (slantKm: number, hobM: number) => {
	const h = hobM / 1000;
	return slantKm > h ? Math.sqrt(slantKm * slantKm - h * h) : 0;
};

export function ringsFor(w: Weapon, kt: number, hobM: number, weather: Weather): Rings {
	return {
		fireball: groundRange(fireballKm(kt, hobM), hobM),
		psi20: blastRangeKm(20, kt, hobM),
		psi5: blastRangeKm(5, kt, hobM),
		psi1: blastRangeKm(1, kt, hobM),
		thermal: thermalKm(kt, hobM, weather),
		radiation: radiationKm(kt, hobM, w.enhanced)
	};
}

// Fatality and structure-loss fractions by overpressure, after the OTA 1979 bands.
const FATALITY_BY_PSI: [number, number][] = [
	[1, 0],
	[2, 0.02],
	[5, 0.25],
	[12, 0.75],
	[20, 0.95],
	[50, 1]
];
const STRUCTURE_BY_PSI: [number, number][] = [
	[1, 0.01],
	[2, 0.08],
	[3, 0.25],
	[5, 0.6],
	[8, 0.85],
	[12, 1]
];

export const fatalityFromPsi = (psi: number) => (psi <= 1 ? 0 : lerpTable(FATALITY_BY_PSI, psi));
export const structureLossFromPsi = (psi: number) => (psi < 1 ? 0 : lerpTable(STRUCTURE_BY_PSI, psi));

// ---- Fallout --------------------------------------------------------------------------------
//
// Miller's Simplified Fallout Scaling System, the same family NUKEMAP uses. It treats the stem and
// the cap as separate sources and adds their patterns. Each pattern is a set of nested contours
// whose size runs linearly in log intensity, which lets the contour through a point be solved
// directly, so the field is continuous and costs a few square roots per grid cell.

/** Fatal fraction from an accumulated dose in rad. OTA 1979 ch. II for 300 to 600, G&D Table 12.108 at the ends. */
export const fatalityFromFallout = (dose: number) =>
	dose <= 200
		? 0
		: lerpTable(
				[
					[200, 0],
					[300, 0.1],
					[450, 0.5],
					[600, 0.9],
					[1000, 1]
				],
				dose
			);

export const FALLOUT_RATES = [1000, 100, 10, 1] as const;
/** Below this H+1 rate in rad/h a cell counts as clean: it is the last contour Miller and G&D give. */
const RATE_FLOOR = 1;

// Miller Table 3.1. The b row applies when the wind is slower than v r/h, so the point lies under the
// cloud. K5b and K6b are not as printed (46.12, 1345). The printed values overshoot I6 in his own Table 3.4
// by a factor of 4.5 and jump at the branch, which reads like an error in the scan or the table. 300 lands
// within 6% of I6 at 10 and 100 Mt, and 3.4 makes I5 continuous at the branch. These two are recalibrations.
const CAP = {
	5: { X: 0.142, n: 0.186, K: 14.57, m: -0.141, v: 22.5, p: -0.022, vr: 3.28, q: 0.245, vb: 1550, r: 0.218 },
	'5b': { K: 3.4, m: -0.012, v: 17.1, p: -0.09, vr: 2.49, q: 0.177, vb: 896, r: 0.082 },
	6: { X: 0.227, n: 0.2, K: 828.7, m: 0.357, v: 14, p: -0.036, vr: 2.04, q: 0.231, vb: 601, r: 0.19 },
	'6b': { K: 300, m: 0.393, v: 17.8, p: -0.145, vr: 2.59, q: 0.122, vb: 971, r: -0.028 },
	7: { K: 1169, m: 0.394, X: 0.234, n: 0.305, v: 13.6, p: -0.141, vr: 1.98, q: 0.126, vb: 565, r: -0.02 }
} as const;

/** Miller eq. 3.28 with 3.29 or 3.30, a location's intensity at 100% fission. */
function capIntensity(i: 5 | 6 | 7, W: number, v: number): number {
	const main = CAP[i];
	const under = i !== 7 && v <= main.vr * Math.pow(W, main.q);
	const c = under ? CAP[i === 5 ? '5b' : '6b'] : main;
	const vi = c.v * Math.pow(W, c.p);
	let phi: number;
	if (under) {
		phi =
			(v + Math.sqrt(v * v + 3.06 * vi * vi * Math.pow(W, 0.262))) /
			(0.0531 * vi * Math.pow(W, 0.08) * (v + Math.sqrt(v * v + 1.085 * Math.pow(W, 0.102))));
	} else {
		const vr = c.vr * Math.pow(W, c.q);
		const vb = c.vb * Math.pow(W, c.r);
		phi =
			(v + vr + Math.sqrt(vb + (v + vr) * (v + vr))) /
			(v - vr + Math.sqrt(vb + (v - vr) * (v - vr)));
	}
	return c.K * Math.pow(W, c.m) * Math.log10(phi);
}

/** Miller Fig. 3.2, read from the plot: stem half-width correction by wind speed (rows) and log10 W. */
const STEM_WIND: [number, number[]][] = [
	[7.5, [0.25, 0.38, 0.65, 0.86]],
	[10, [0.51, 0.66, 0.8, 0.9]],
	[15, [1, 1, 1, 1]],
	[20, [1.3, 1.18, 1.11, 1.1]],
	[25, [1.45, 1.22, 1.15, 1.15]],
	[30, [1.5, 1.24, 1.18, 1.18]],
	[45, [1.54, 1.27, 1.17, 1.13]]
];

function stemWindFactor(W: number, v: number): number {
	const col = clamp(Math.log10(W) - 2, 0, 2.999);
	const c = Math.floor(col);
	const at = (row: number[]) => row[c] + (row[c + 1] - row[c]) * (col - c);
	const r = lerpTable(
		STEM_WIND.map(([speed, row]) => [speed, at(row)]),
		v
	);
	return r;
}

/** Miller eqs. 3.39 and 3.40, the wind factor on the cloud pattern's maximum half-width. */
const capWindFactor = (v: number) => (v <= 22.6 ? 0.36 * (1 + 26.7 / v) : 0.426 * (1 + 19 / v));

// Everything needed for one yield and one pair of winds, in miles and R/h at 1 h for 100% fission.
interface StemShape {
	x1: number;
	x2: number;
	x3: number;
	x4: number;
	i23: number;
	i4: number;
	ys: number;
}
interface CapShape {
	x5: number;
	x6: number;
	x7: number;
	x8: number;
	x9: number;
	i5: number;
	i6: number;
	i7: number;
	i9: number;
	y8: number;
}

function stemFit(W: number, v: number): StemShape {
	const nw = W < 9000 ? 0.821 - 0.0191 * Math.log10(W) : 1.2 - 0.115 * Math.log10(W);
	const a = 0.0327 * Math.pow(W, 0.23);
	const b = 3.96 * Math.pow(W, 0.128);
	const x2 = a * (v - b);
	const i23 = 3.02e6 * Math.pow(v, -nw) * Math.pow(W, -0.519);
	return {
		x1: x2 - 0.174 * Math.pow(W, 0.337) * Math.log10(i23),
		x2,
		x3: a * (v + b),
		x4: 0.316 * v * Math.pow(W, 0.203),
		i23,
		i4: 15 / v,
		ys: 0.316 * Math.pow(W, 0.4) * stemWindFactor(W, v)
	};
}

function capFit(W: number, v: number): CapShape {
	const x = (i: 5 | 6 | 7) => v * CAP[i].X * Math.pow(W, CAP[i].n);
	const y15 = W < 750 ? 0.518 * Math.pow(W, 0.615) : 4.75 * Math.pow(W, 0.283);
	return {
		x5: v <= 3.28 * Math.pow(W, 0.245) ? 0.186 * Math.pow(W, 0.254) * (v - 2.49 * Math.pow(W, 0.177)) : x(5),
		x6: v <= 2.04 * Math.pow(W, 0.231) ? 0.179 * Math.pow(W, 0.309) * (v - 2.59 * Math.pow(W, 0.122)) : x(6),
		x7: x(7),
		x8: 0.325 * v * Math.pow(W, 0.315),
		x9: 2.027 * v * Math.pow(W, 0.31),
		i5: capIntensity(5, W, v),
		i6: capIntensity(6, W, v),
		i7: capIntensity(7, W, v),
		i9: 15 / v,
		y8: y15 * capWindFactor(v)
	};
}

// Miller's functions hold from 30 kt. Below that his Table 3.4 gives 1 and 10 kt at 15 mph, so the shape
// is taken at 30 kt for the actual wind and scaled by the table's ratio. Under 1 kt the 1 to 10 kt slope
// is extrapolated, which is an estimate: nothing here was fitted to tests of that size.
const LOW: { [k in keyof StemShape | keyof CapShape | 'h']?: [number, number] } = {
	x1: [0.385, 1.21],
	x2: [0.0648, 0.342],
	x3: [0.352, 0.967],
	x4: [1.46, 5.18],
	i23: [1730, 22900],
	ys: [0.316, 0.796],
	x5: [0.834, 2.58],
	x6: [1.34, 4.05],
	x7: [1.38, 5.3],
	x8: [1.91, 7.56],
	x9: [29.4, 61.2],
	i6: [130, 222],
	i7: [180, 317],
	y8: [1.26, 2.28],
	h: [6600, 18400]
};

/** Table 3.4 value at W relative to the 30 kt value, interpolated log-log through 1, 10 and 30 kt. */
function lowYieldRatio(key: keyof typeof LOW, W: number, at30: number): number {
	const [a, b] = LOW[key] as [number, number];
	const lw = Math.log10(W);
	const lb = Math.log10(b);
	if (W <= 10) return Math.pow(10, Math.log10(a) + (lb - Math.log10(a)) * lw) / at30;
	const l30 = Math.log10(30);
	return Math.pow(10, lb + (Math.log10(at30) - lb) * ((lw - 1) / (l30 - 1))) / at30;
}

function stemShape(W: number, v: number): StemShape {
	if (W >= 30) return stemFit(W, v);
	const here = stemFit(30, v);
	const ref = stemFit(30, 15);
	const r = (k: 'x1' | 'x2' | 'x3' | 'x4' | 'i23' | 'ys') => lowYieldRatio(k, W, Math.abs(ref[k]));
	return {
		x1: here.x1 * r('x1'),
		x2: here.x2 * r('x2'),
		x3: here.x3 * r('x3'),
		x4: here.x4 * r('x4'),
		i23: here.i23 * r('i23'),
		i4: here.i4,
		ys: here.ys * r('ys')
	};
}

function capShape(W: number, v: number): CapShape {
	if (W >= 30) return capFit(W, v);
	const here = capFit(30, v);
	const ref = capFit(30, 15);
	const r = (k: 'x5' | 'x6' | 'x7' | 'x8' | 'x9' | 'i6' | 'i7' | 'y8') => lowYieldRatio(k, W, ref[k]);
	return {
		x5: here.x5 * r('x5'),
		x6: here.x6 * r('x6'),
		x7: here.x7 * r('x7'),
		x8: here.x8 * r('x8'),
		x9: here.x9 * r('x9'),
		i5: here.i5 * r('i6'),
		i6: here.i6 * r('i6'),
		i7: here.i7 * r('i7'),
		i9: here.i9,
		y8: here.y8 * r('y8')
	};
}

export interface CloudGeometry {
	/** Altitude of the cap's centre, its half-thickness and its radius, in km. */
	centreKm: number;
	halfThicknessKm: number;
	radiusKm: number;
}

/** Stabilised cap, Miller eqs. 3.22 to 3.24. Below 30 kt the height comes from his Table 3.4. */
export function cloudGeometry(kt: number): CloudGeometry {
	const h =
		kt >= 30
			? 3.18 * Math.pow(kt, 0.164)
			: 3.18 * Math.pow(30, 0.164) * lowYieldRatio('h', kt, (3.18 * Math.pow(30, 0.164) * FT_PER_MI));
	return {
		centreKm: h * KM_PER_MI,
		halfThicknessKm: 0.265 * Math.pow(kt, 0.3) * KM_PER_MI,
		radiusKm: 0.464 * Math.pow(kt, 0.431) * KM_PER_MI
	};
}

// Speed against height relative to the reported low-level wind, jet stream at 11 km and calm above 20 km.
// This shape is an estimate of mid-latitude climatology, not from a cited table: the weather only gives
// one number, so something has to say what a lofted cloud feels. It is what makes lofting matter.
export const WIND_PROFILE: [number, number][] = [
	[0, 1],
	[3, 1.2],
	[6, 1.6],
	[11, 2],
	[16, 1.6],
	[20, 1],
	[30, 0.8],
	[60, 0.8]
];

/** Mean relative wind from the ground up to an altitude. */
export function meanWindTo(km: number): number {
	let sum = 0;
	let below = 0;
	for (let i = 1; i < WIND_PROFILE.length && below < km; i++) {
		const [z0, w0] = WIND_PROFILE[i - 1];
		const [z1, w1] = WIND_PROFILE[i];
		const top = Math.min(km, z1);
		const wTop = w0 + ((w1 - w0) * (top - z0)) / (z1 - z0);
		sum += ((w0 + wTop) / 2) * (top - z0);
		below = top;
	}
	return km > 0 ? sum / km : 1;
}

const clampWindMph = (mph: number) => clamp(mph, 7.5, 50);

/**
 * Effective fallout winds in mph, by G&D §9.84: the mean of the average winds from the ground to the
 * cloud's base and to its top. The stem uses the average to the cap's base. Miller's fits stop at 10 to
 * 50 mph and G&D's at 8 to 45, so speeds outside 7.5 to 50 are held there.
 */
export function effectiveWinds(kt: number, windKmh: number): { cap: number; stem: number } {
	const g = cloudGeometry(kt);
	const base = Math.max(0.1, g.centreKm - g.halfThicknessKm);
	const top = g.centreKm + g.halfThicknessKm;
	const low = windKmh / KM_PER_MI;
	return {
		cap: clampWindMph((low * (meanWindTo(base) + meanWindTo(top))) / 2),
		stem: clampWindMph(low * meanWindTo(base))
	};
}

/** Scale on activity for a burst off the ground: the share of a fireball of radius H that the ground cuts off. */
export function groundCoupling(kt: number, hobM: number): number {
	const l = hobM / localFalloutHeightM(kt);
	if (l >= 1) return 0;
	if (l <= 0) return 1;
	// Geometry on G&D's cutoff height, an estimate: no source gives the curve between ground and cutoff.
	return ((1 - l) * (1 - l) * (2 + l)) / 2;
}

// Rainout. G&D §9.68: rain cloud tops reach 33,000 ft at most, which puts all of a 10 kt cloud and part
// of a 100 kt one inside it and almost nothing higher, as G&D states. §9.71: rain falls at 800 to 1200
// ft/min, snow at 200. Table 9.74a: about 75% is scavenged in 0.32 h. Snow's top is an estimate.
const SCAVENGE: Partial<Record<Precip, { topFt: number; fallFtMin: number }>> = {
	RAIN: { topFt: 33000, fallFtMin: 1000 },
	SNOW: { topFt: 20000, fallFtMin: 200 }
};
const SCAVENGED_SHARE = 0.75;
const SCAVENGE_HOURS = 0.32;
/** How much of an air burst's debris rainout can bring down locally. G&D §9.73 calls this unverified: an estimate. */
const AIRBURST_RAINOUT = 0.25;

/** Share of the cap's activity that precipitation scavenges. */
export function rainoutShare(kt: number, precip: Precip): number {
	const s = SCAVENGE[precip];
	if (!s) return 0;
	const g = cloudGeometry(kt);
	const top = s.topFt / FT_PER_M / 1000;
	return SCAVENGED_SHARE * clamp((top - (g.centreKm - g.halfThicknessKm)) / (2 * g.halfThicknessKm), 0, 1);
}

const LN10 = Math.LN10;

/** Contour position through a point in the stem pattern, in decades below the ridge intensity. */
function stemDecades(p: Solved, x: number, y2: number): number {
	const u = x < p.x2 ? (p.x2 - x) / p.upRate : x > p.x3 ? (x - p.x3) / p.downRate : 0;
	return Math.sqrt(u * u + y2 / (p.ysRate * p.ysRate));
}

interface Solved {
	x2: number;
	x3: number;
	upRate: number;
	downRate: number;
	ysRate: number;
	i23: number;
}

interface CapSolved {
	x7: number;
	/** Miles per decade: where the widest point moves to, the downwind tip and the half-width. */
	a: number;
	c: number;
	d: number;
	/** Upwind tip: fast until I6, then slowly back toward X5, then held. */
	u1: number;
	t6: number;
	u2: number;
	t5: number;
	i7: number;
}

/** Positive root of the half-ellipse through (xi, y) when its size runs linearly with t. */
function ellipseRoot(xi: number, y2: number, a: number, e: number, d: number): number {
	const d2 = d * d;
	const A = d2 * (a * a - e * e);
	const B = -2 * a * d2 * xi;
	const C = d2 * xi * xi + y2 * e * e;
	if (Math.abs(A) < 1e-12) return B !== 0 ? -C / B : 0;
	const disc = Math.sqrt(Math.max(0, B * B - 4 * A * C));
	const r1 = (-B + disc) / (2 * A);
	const r2 = (-B - disc) / (2 * A);
	return Math.max(r1, r2);
}

/** Contour position through a point in the cap pattern, in decades below the peak I7. */
function capDecades(p: CapSolved, x: number, y2: number, tMax: number): number {
	const xi = x - p.x7;
	if (xi === 0 && y2 === 0) return 0;
	const t = ellipseRoot(xi, y2, p.a, p.c - p.a, p.d);
	if (xi >= p.a * t) return t;
	const t1 = ellipseRoot(xi, y2, p.a, p.a + p.u1, p.d);
	if (t1 <= p.t6) return t1;
	// Past I6 the upwind tip is no longer proportional to t, so search for it.
	const outside = (v: number) => {
		const back = p.u1 * p.t6 + p.u2 * (Math.min(v, p.t5) - p.t6);
		const s = p.a * v + back;
		const dx = (xi - p.a * v) / s;
		return dx * dx + y2 / (p.d * p.d * v * v) > 1;
	};
	if (outside(tMax)) return Infinity;
	let lo = p.t6;
	let hi = tMax;
	for (let i = 0; i < 12; i++) {
		const mid = (lo + hi) / 2;
		if (outside(mid)) lo = mid;
		else hi = mid;
	}
	return hi;
}

export interface FalloutField {
	/** H+1 rate in rad/h, at km along and across the wind from ground zero. */
	rateAt(downKm: number, crossKm: number): number;
	/** Dose in rad from a rate at a downwind distance, for people with the assumed shelter. */
	doseAt(rate: number, downKm: number): number;
	/** Downwind, upwind and half-width reach of the outermost contour, in km. */
	downKm: number;
	upKm: number;
	halfWidthKm: number;
}

const WSEG_MIN_ARRIVAL_H = 0.5;
// Miller §3.4.3: his intensities read 75% of the true air rate. G&D Table 9.120 gives transmission of 0.3
// to 0.6 in a frame house, 0.1 low in a block of flats and 0.05 to 0.1 in a basement. The 0.2 mix is an estimate.
const TRUE_RATE = 1.33;
const SHELTER = 0.2;

/** The field for a pattern at 100% fission, scaled by activity. Exposed for the tests against Miller. */
export function patternField(
	kt: number,
	capMph: number,
	stemMph: number,
	activity: { cap: number; stem: number; rain: number; rainStretch: number }
): FalloutField {
	const st = stemShape(kt, stemMph);
	const cp = capShape(kt, capMph);
	const stem: Solved = {
		x2: st.x2,
		x3: Math.max(st.x2, st.x3),
		upRate: Math.max(1e-3, (st.x2 - st.x1) / Math.max(0.3, Math.log10(st.i23))),
		downRate: Math.max(1e-3, (st.x4 - st.x3) / Math.max(0.3, Math.log10(st.i23 / st.i4))),
		ysRate: Math.max(1e-3, st.ys / Math.max(0.3, Math.log10(st.i23))),
		i23: st.i23
	};
	const t9 = Math.max(0.1, Math.log10(cp.i7 / cp.i9));
	const t6 = Math.max(0.01, Math.log10(cp.i7 / Math.min(cp.i6, cp.i7 * 0.98)));
	const t5 = Math.max(t6 + 0.01, Math.log10(cp.i7 / Math.min(Math.max(cp.i5, 0.01), cp.i6)));
	const cap: CapSolved = {
		x7: cp.x7,
		a: (cp.x8 - cp.x7) / t9,
		c: (cp.x9 - cp.x7) / t9,
		d: cp.y8 / t9,
		u1: Math.max(1e-3, (cp.x7 - cp.x6) / t6),
		t6,
		u2: Math.max(0, (cp.x6 - cp.x5) / (t5 - t6)),
		t5,
		i7: cp.i7
	};
	const floorDecades = (i: number, a: number) => Math.max(0, Math.log10((i * a) / RATE_FLOOR));
	const stemT = floorDecades(st.i23, activity.stem);
	const capT = floorDecades(cp.i7, activity.cap);
	const rainA = activity.rain / activity.rainStretch;
	const rainT = rainA > 0 ? floorDecades(cp.i7, rainA) : 0;
	const down = Math.max(
		activity.stem > 0 && stemT > 0 ? st.x3 + stem.downRate * stemT : 0,
		capT > 0 ? cp.x7 + cap.c * capT : 0,
		rainT > 0 ? (cp.x7 + cap.c * rainT) * activity.rainStretch : 0
	);
	const up = Math.max(
		stemT > 0 ? Math.max(0, stem.upRate * stemT - st.x2) : 0,
		capT > 0 ? Math.max(0, -(cp.x7 - cap.u1 * t6 - cap.u2 * (Math.min(capT, t5) - t6))) : 0
	);
	const half = Math.max(stem.ysRate * stemT, cap.d * capT, cap.d * rainT);

	const rateMi = (x: number, y: number): number => {
		if (x > down || x < -up || y > half || y < -half) return 0;
		const y2 = y * y;
		let rate = 0;
		if (activity.stem > 0) {
			const t = stemDecades(stem, x, y2);
			if (t < stemT) rate += activity.stem * stem.i23 * Math.exp(-t * LN10);
		}
		if (activity.cap > 0) {
			const t = capDecades(cap, x, y2, capT);
			if (t < capT) rate += activity.cap * cap.i7 * Math.exp(-t * LN10);
		}
		if (rainA > 0) {
			const t = capDecades(cap, x / activity.rainStretch, y2, rainT);
			if (t < rainT) rate += rainA * cap.i7 * Math.exp(-t * LN10);
		}
		return rate;
	};
	const radiusMi = cloudGeometry(kt).radiusKm / KM_PER_MI;
	return {
		downKm: down * KM_PER_MI,
		upKm: up * KM_PER_MI,
		halfWidthKm: half * KM_PER_MI,
		rateAt: (downKm, crossKm) => rateMi(downKm / KM_PER_MI, crossKm / KM_PER_MI),
		doseAt: (rate, downKm) => {
			// G&D §9.91 for arrival, WSEG's half-hour floor, then Hanifen eq. 27 for dose per unit H+1 rate.
			const arrive = Math.max(WSEG_MIN_ARRIVAL_H, (downKm / KM_PER_MI - radiusMi) / capMph);
			const b = Math.log(arrive / 31.6);
			return rate * TRUE_RATE * SHELTER * Math.exp(-(0.287 + 0.52 * b + 0.04475 * b * b));
		}
	};
}

const fieldCache = new Map<string, FalloutField | null>();

/** The burst's fallout field, or null when it deposits nothing locally. */
export function falloutField(w: Weapon, kt: number, hobM: number, weather: Weather): FalloutField | null {
	const key = `${w.id}|${kt}|${hobM}|${weather.precip}|${weather.windKmh}`;
	const hit = fieldCache.get(key);
	if (hit !== undefined) return hit;
	if (fieldCache.size > 2000) fieldCache.clear();
	const field = buildField(w, kt, hobM, weather);
	fieldCache.set(key, field);
	return field;
}

function buildField(w: Weapon, kt: number, hobM: number, weather: Weather): FalloutField | null {
	if (hobM >= EXO_HEIGHT_M) return null;
	// G&D §9.94: contour shapes follow total yield, dose rates scale with the fission share.
	const source = fissionFractionAt(w, kt) * (w.salted ?? 1);
	if (source <= 0) return null;
	const coupling = groundCoupling(kt, hobM);
	const share = rainoutShare(kt, weather.precip);
	const wet = Math.max(coupling, AIRBURST_RAINOUT) * share;
	if (coupling <= 0 && wet <= 0) return null;
	const winds = effectiveWinds(kt, weather.windKmh);
	let rainStretch = 1;
	if (share > 0) {
		// Rain brings activity down within the time to scavenge it plus the fall from cap height,
		// so the pattern's far tip moves to there and the same activity is packed into the shorter pattern.
		const g = cloudGeometry(kt);
		const fall = (g.centreKm * 1000 * FT_PER_M) / (SCAVENGE[weather.precip]!.fallFtMin * 60);
		const tip = winds.cap * (SCAVENGE_HOURS + fall);
		rainStretch = clamp(tip / capShape(kt, winds.cap).x9, 0.02, 1);
	}
	return patternField(kt, winds.cap, winds.stem, {
		cap: source * coupling * (1 - share),
		stem: source * coupling,
		rain: source * wet,
		rainStretch
	});
}

export interface PlumeBand {
	rate: number;
	/** Downwind reach in km. */
	length: number;
	/** Upwind reach in km. */
	upwind: number;
	/** Maximum width in km. */
	width: number;
	/** Each stretch of the contour as [km along the wind, half-width in km], upwind to downwind. */
	runs: [number, number][][];
}

const bandCache = new Map<string, PlumeBand[]>();

/** Contours of the field from innermost to outermost. Empty for clean airbursts. */
export function falloutBands(w: Weapon, kt: number, hobM: number, weather: Weather): PlumeBand[] {
	const key = `${w.id}|${kt}|${hobM}|${weather.precip}|${weather.windKmh}`;
	const hit = bandCache.get(key);
	if (hit) return hit;
	if (bandCache.size > 500) bandCache.clear();
	const field = falloutField(w, kt, hobM, weather);
	const bands = field ? FALLOUT_RATES.map((rate) => traceContour(field, rate)) : [];
	bandCache.set(key, bands);
	return bands;
}

const TRACE_STEPS = 72;

function traceContour(field: FalloutField, rate: number): PlumeBand {
	// Spaced by sinh, because the pattern's detail is all close to ground zero.
	const unit = Math.max(0.05, field.upKm * 0.2 + 0.05);
	const from = -Math.asinh(field.upKm / unit);
	const to = Math.asinh(field.downKm / unit);
	const xAt = (i: number) => unit * Math.sinh(from + ((to - from) * i) / TRACE_STEPS);
	const tip = (inside: number, outside: number) => {
		for (let k = 0; k < 16; k++) {
			const mid = (inside + outside) / 2;
			if (field.rateAt(mid, 0) >= rate) inside = mid;
			else outside = mid;
		}
		return inside;
	};
	const halfWidth = (x: number) => {
		let lo = 0;
		let hi = field.halfWidthKm;
		for (let k = 0; k < 12; k++) {
			const mid = (lo + hi) / 2;
			if (field.rateAt(x, mid) >= rate) lo = mid;
			else hi = mid;
		}
		return lo;
	};
	const runs: [number, number][][] = [];
	let run: [number, number][] | null = null;
	let length = 0;
	let upwind = 0;
	let width = 0;
	let prev = xAt(0) - unit;
	for (let i = 0; i <= TRACE_STEPS; i++) {
		const x = xAt(i);
		if (field.rateAt(x, 0) >= rate) {
			if (!run) {
				const start = tip(x, prev);
				run = [[start, 0]];
				upwind = Math.max(upwind, -start);
			}
			const h = halfWidth(x);
			run.push([x, h]);
			width = Math.max(width, h * 2);
		} else if (run) {
			const end = tip(prev, x);
			run.push([end, 0]);
			length = Math.max(length, end);
			runs.push(run);
			run = null;
		}
		prev = x;
	}
	if (run) {
		const end = tip(prev, field.downKm * 1.001 + 0.01);
		run.push([end, 0]);
		length = Math.max(length, end);
		runs.push(run);
	}
	return { rate, length, upwind, width, runs };
}

/** Line-of-sight EMP footprint in km for an exoatmospheric burst. The yield factor is an estimate. */
export function empKm(kt: number, hobM: number): number {
	if (hobM < EXO_HEIGHT_M) return 0;
	const h = hobM / 1000;
	const horizon = EARTH_KM * Math.acos(EARTH_KM / (EARTH_KM + h));
	return horizon * Math.min(1, 0.35 + 0.18 * Math.log10(Math.max(kt, 1)));
}
