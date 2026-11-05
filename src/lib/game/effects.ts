// Weapon effects, simplified for a game. Airblast and thermal scale from the
// Glasstone & Dolan / OTA figures that public tools like NUKEMAP also draw on.
// The height-of-burst curves are hand-fitted to those figures, not a hydrocode.

import type { Weapon } from './weapons';

export type Precip = 'CLEAR' | 'HAZE' | 'OVERCAST' | 'RAIN' | 'SNOW';

export interface Weather {
	precip: Precip;
	/** Bearing the wind blows toward, in degrees. */
	windBearing: number;
	windKmh: number;
}

/** Multiplier on thermal radius. Snow reflects, haze and cloud absorb. */
export const THERMAL_FACTOR: Record<Precip, number> = {
	CLEAR: 1,
	HAZE: 0.8,
	OVERCAST: 0.7,
	RAIN: 0.55,
	SNOW: 1.15
};

export const EARTH_KM = 6371;
/** Above this height there is no blast, heat or fallout at ground level. */
export const EXO_HEIGHT_M = 30000;

// Columns: psi, surface range, optimum range (km at 1 kt), optimum height,
// height where this overpressure stops reaching the ground (m at 1 kt).
const BLAST: [number, number, number, number, number][] = [
	[200, 0.09, 0.09, 40, 90],
	[100, 0.115, 0.125, 70, 130],
	[50, 0.15, 0.17, 100, 180],
	[20, 0.21, 0.274, 140, 280],
	[10, 0.3, 0.434, 180, 380],
	[5, 0.46, 0.71, 240, 520],
	[3, 0.62, 0.95, 300, 680],
	[1, 1.24, 1.77, 450, 1300],
	[0.5, 2.0, 2.8, 700, 2200]
];

export const fireballKm = (kt: number) => 0.06 * Math.pow(kt, 0.4);
export const optimumHobM = (kt: number) => Math.round(240 * Math.cbrt(kt));

/** Ground range in km at which an overpressure is reached. 0 if it never is. */
export function blastRangeKm(psi: number, kt: number, hobM: number): number {
	const row = BLAST.find((r) => r[0] === psi);
	if (!row) throw new Error(`no blast row for ${psi} psi`);
	return scaledRange(row, kt, hobM);
}

function scaledRange(row: (typeof BLAST)[number], kt: number, hobM: number): number {
	const scale = Math.cbrt(kt);
	const z = hobM / scale;
	const [, surface, optimum, zOpt, zMax] = row;
	if (z >= zMax) return 0;
	const scaled =
		z <= zOpt
			? surface + (optimum - surface) * Math.sin((z / zOpt) * (Math.PI / 2))
			: optimum * Math.sqrt(1 - ((z - zOpt) / (zMax - zOpt)) ** 2);
	return scaled * scale;
}

export interface Rings {
	fireball: number;
	psi20: number;
	psi5: number;
	psi1: number;
	thermal: number;
	radiation: number;
}

export function thermalKm(kt: number, hobM: number, weather: Weather): number {
	if (hobM >= EXO_HEIGHT_M) return 0;
	const touches = hobM < fireballKm(kt) * 1000;
	const slant = 0.67 * Math.pow(kt, 0.41) * THERMAL_FACTOR[weather.precip] * (touches ? 0.75 : 1);
	return groundRange(slant, hobM);
}

export function radiationKm(kt: number, hobM: number, enhanced = 1): number {
	if (hobM >= EXO_HEIGHT_M) return 0;
	return groundRange(0.72 * Math.pow(kt, 0.19) * enhanced, hobM);
}

const groundRange = (slantKm: number, hobM: number) => {
	const h = hobM / 1000;
	return slantKm > h ? Math.sqrt(slantKm * slantKm - h * h) : 0;
};

export function ringsFor(w: Weapon, kt: number, hobM: number, weather: Weather): Rings {
	const fb = fireballKm(kt);
	return {
		fireball: groundRange(fb, hobM),
		psi20: blastRangeKm(20, kt, hobM),
		psi5: blastRangeKm(5, kt, hobM),
		psi1: blastRangeKm(1, kt, hobM),
		thermal: thermalKm(kt, hobM, weather),
		radiation: radiationKm(kt, hobM, w.enhanced)
	};
}

/** Overpressure in psi at a ground range. Interpolated log-log between rows. */
export function psiProfile(kt: number, hobM: number): (km: number) => number {
	const pts = BLAST.map((row) => ({ psi: row[0], r: scaledRange(row, kt, hobM) })).filter((p) => p.r > 0);
	if (pts.length === 0) return () => 0;
	return (km) => {
		if (km <= pts[0].r) return pts[0].psi;
		for (let i = 1; i < pts.length; i++) {
			if (km <= pts[i].r) {
				const a = pts[i - 1];
				const b = pts[i];
				if (b.r === a.r) return b.psi;
				const t = (Math.log(km) - Math.log(a.r)) / (Math.log(b.r) - Math.log(a.r));
				return Math.exp(Math.log(a.psi) + t * (Math.log(b.psi) - Math.log(a.psi)));
			}
		}
		const last = pts[pts.length - 1];
		return km > last.r * 1.6 ? 0 : last.psi * (1 - (km - last.r) / (last.r * 0.6));
	};
}

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

/** Fatal fraction from an accumulated fallout dose rate in rad/h at H+1. */
export const fatalityFromFallout = (rate: number) =>
	rate < 10
		? 0
		: lerpTable(
				[
					[10, 0.01],
					[30, 0.08],
					[100, 0.3],
					[300, 0.6],
					[1000, 0.9]
				],
				rate
			);

export const FALLOUT_RATES = [1000, 100, 10, 1] as const;
// Plume size for 1 Mt of fission products at ground level with a 24 km/h wind.
const PLUME_LENGTH_KM = [60, 180, 360, 630];
const PLUME_WIDTH_KM = [5, 18, 35, 70];

export interface PlumeBand {
	rate: number;
	/** Downwind reach in km. */
	length: number;
	/** Upwind reach in km. */
	upwind: number;
	/** Maximum width in km. */
	width: number;
}

/** Fallout contours from innermost to outermost. Empty for clean airbursts. */
export function falloutBands(w: Weapon, kt: number, hobM: number, weather: Weather): PlumeBand[] {
	const fb = fireballKm(kt) * 1000;
	if (hobM >= fb) return [];
	const coupling = Math.min(1, (1 - hobM / fb) * 1.25);
	const fissionKt = kt * w.fission * (w.salted ?? 1) * coupling;
	if (fissionKt <= 0) return [];
	const scale = Math.pow(fissionKt / 1000, 0.45);
	const wind = Math.max(weather.windKmh, 4) / 24;
	const rain = weather.precip === 'RAIN' ? 0.6 : 1;
	const rateBoost = weather.precip === 'RAIN' ? 2.5 : 1;
	return FALLOUT_RATES.map((rate, i) => {
		const length = PLUME_LENGTH_KM[i] * scale * Math.pow(wind, 0.6) * rain;
		return {
			rate: rate * rateBoost,
			length,
			upwind: length * 0.05 + fireballKm(kt) * 0.5,
			width: PLUME_WIDTH_KM[i] * scale * Math.pow(wind, -0.2)
		};
	});
}

/** Line-of-sight EMP footprint in km for an exoatmospheric burst. */
export function empKm(kt: number, hobM: number): number {
	if (hobM < EXO_HEIGHT_M) return 0;
	const los = Math.sqrt(2 * EARTH_KM * (hobM / 1000));
	return los * Math.min(1, 0.35 + 0.18 * Math.log10(Math.max(kt, 1)));
}
