import type { BurstReport } from '#lib/game/debrief.ts';
import { cloudRise, dustDown, fallenKm } from '#lib/game/cloudrise.ts';
import { psiProfile, type Precip } from '#lib/game/effects.ts';
import type { SceneState } from './blastEngine.ts';

// Maps a moment to what the scene shows. Blast ranges come from the effects model. The rising air and settling dust come
// from cloudrise.ts, and the colour from reddish brown to white follows §2.08. Fires, the skyline and how the billows
// look are illustrative.

/** Relative humidity near the ground for each kind of weather. The game has no humidity of its own, so these are estimates. */
export const HUMIDITY: Record<Precip, number> = { CLEAR: 0.45, HAZE: 0.65, OVERCAST: 0.8, RAIN: 0.95, SNOW: 0.85 };

/** The rising air for this burst. It starts once the fireball has stopped growing fast. */
export const riseOf = (r: BurstReport, precip: Precip = 'CLEAR') => cloudRise(r.burst.kt, r.burst.hobM, r.thermalMaxS * 5, HUMIDITY[precip]);

/** How much height the air's moisture added, in km. */
export const moistureLiftKm = (r: BurstReport, precip: Precip) => riseOf(r, precip).topKm - cloudRise(r.burst.kt, r.burst.hobM, r.thermalMaxS * 5, 0).topKm;

export function shockGroundKm(r: BurstReport, t: number): number {
	const s = r.shock;
	if (!s.length || t < s[0].s) return 0;
	for (let i = 1; i < s.length; i++) {
		if (t <= s[i].s) return s[i - 1].km + ((t - s[i - 1].s) / Math.max(s[i].s - s[i - 1].s, 1e-9)) * (s[i].km - s[i - 1].km);
	}
	// Past the table the front carries on at the speed of sound.
	return s[s.length - 1].km + 0.34 * (t - s[s.length - 1].s);
}

/** Slant radius of the front. Before it touches ground it scales from the first touch. */
export function shockSlantKm(r: BurstReport, t: number): number {
	const s = r.shock;
	const hob = r.burst.hobM / 1000;
	if (!s.length || t <= 0) return 0;
	if (t < s[0].s) return Math.hypot(s[0].km, hob) * Math.pow(t / s[0].s, 0.4);
	return Math.hypot(shockGroundKm(r, t), hob);
}

export interface Moment {
	fireR: number;
	fireAlt: number;
	capAlt: number;
	capR: number;
	capH: number;
	capDrift: number;
	capOpacity: number;
	pulse: number;
	shockKm: number;
	shockSlant: number;
	psi: number;
	rise: number;
	/** Rise speed in m/s, excess temperature in K, and when it stops rising. */
	w: number;
	dT: number;
	peakS: number;
	/** Condensed water, g/kg. */
	water: number;
}

export function momentAt(r: BurstReport, t: number, precip: Precip = 'CLEAR'): Moment {
	const hob = r.burst.hobM / 1000;
	const after = Math.max(t, 0);
	const tMax = r.thermalMaxS;
	const tForm = tMax * 10;
	// A fireball stays centred on the burst while it grows. It only starts to climb once it has stopped growing fast.
	const air = riseOf(r, precip);
	const p = air.at(after);
	const start = tForm * 0.5;
	const lift = Math.min(1, Math.max(0, after - start) / Math.max(start, 0.1));
	const peak = air.at(air.peakS);
	const rise = Math.min(1, Math.max(0, (p.z - hob) / Math.max(peak.z - hob, 0.001)));
	const fireR = t > 0 ? r.fireballKm * Math.min(1, Math.pow(after / tForm, 0.4)) : 0;
	const capAlt = hob + (p.z - hob) * lift;
	const shockKm = shockGroundKm(r, after);
	return {
		fireR,
		fireAlt: capAlt,
		capAlt,
		capR: Math.max(r.fireballKm * 0.9, p.r),
		capH: Math.max(r.fireballKm * 0.7 * (1 - rise), p.h),
		w: p.w,
		dT: p.dT,
		water: p.water,
		peakS: air.peakS,
		capDrift: (r.winds.cap * 1.609344 * Math.max(0, after - 60)) / 3600,
		capOpacity: Math.min(1, Math.max(0, (after - tForm * 0.9) / (tForm * 1.5 + 0.5))),
		pulse: t > 0 ? Math.min(1, (after / tMax) * Math.exp(1 - after / tMax)) : 0,
		shockKm,
		shockSlant: shockSlantKm(r, after),
		psi: shockKm > 0 ? psiProfile(r.burst.kt, r.burst.hobM)(shockKm) : 0,
		rise
	};
}

const PRECIP: Record<Precip, [number, number, number]> = {
	CLEAR: [0, 0, 0],
	HAZE: [0.18, 0, 0],
	OVERCAST: [0.85, 0, 0],
	RAIN: [1, 1, 0],
	SNOW: [0.9, 0, 1]
};

// These integrate down through the air, so they're remembered to the nearest few seconds.
const memo = new Map<string, number>();
const remember = (key: string, make: () => number) => {
	let v = memo.get(key);
	if (v === undefined) {
		if (memo.size > 2000) memo.clear();
		v = make();
		memo.set(key, v);
	}
	return v;
};
const settled = (fromKm: number, s: number) => remember(`d${fromKm.toFixed(2)}|${Math.round(s / 5)}`, () => dustDown(Math.max(fromKm, 0.01), s));
const fallingFront = (fromKm: number, s: number) => (s <= 0 ? 0 : remember(`f${fromKm.toFixed(1)}|${Math.round(s / 5)}`, () => fallenKm(300e-6, fromKm, s)));

export interface SceneView {
	width: number;
	height: number;
	ppk: number;
	centreX: number;
	groundY: number;
}

export interface Trail {
	kind: number;
	head: [number, number];
	tail: [number, number];
	width: number;
}

const NO_TRAIL: Trail = { kind: 0, head: [0, 0], tail: [0, 0], width: 0 };

export function sceneFor(r: BurstReport, t: number, churn: number, view: SceneView, precip: Precip, grade: number, trail: Trail = NO_TRAIL): SceneState {
	const m = momentAt(r, t, precip);
	const hob = r.burst.hobM / 1000;
	const after = Math.max(t, 0);
	const tForm = r.thermalMaxS * 10;
	const lit = t > 0;

	// Blue-white at the first instant, through yellow and orange, to a sullen red inside the rising cloud.
	const temp = Math.max(0, 1 - 0.45 * Math.log10(1 + after / (r.thermalMaxS * 0.6)));
	const fireOpacity = !lit ? 0 : after < tForm ? 1 : Math.max(0, 1 - (after - tForm) / (tForm * 6 + 4));

	// The cap glows only while it's far hotter than the air, which mixing ends quickly.
	const heat = lit ? Math.min(1, Math.max(0, m.dT) / 350) : 0;
	// A cap of ice forms over the top in moist air when it's climbing fast through the height of the clouds.
	const pileus = lit ? Math.min(1, m.w / 50) * Math.exp(-Math.pow((m.capAlt + m.capH - 9) / 7, 2)) * Math.min(1, HUMIDITY[precip] / 0.7) : 0;

	// The light on the whole scene follows the pulse, but a gigaton's lasts minutes, and that would hide everything.
	const flashS = Math.min(r.thermalMaxS, 1.5);
	const skyFlash = lit ? Math.min(1, (after / flashS) * Math.exp(1 - after / flashS)) : 0;

	const shockFade = lit ? Math.min(1, m.psi / 1.2) : 0;
	// Condensation behind the shock: seconds, scaled by the cube root of yield as blast timing is.
	// G&D §2.50: at about 20 kt it began at 1 to 2 s and was gone within about another second. Scaled by cube root.
	const wTime = Math.cbrt(r.burst.kt / 21);
	// It needs moist air, so it's faint on a dry day.
	const wilson = lit ? Math.exp(-Math.pow((after - 1.6 * wTime) / (0.7 * wTime), 2)) * 0.9 * Math.min(1, Math.max(0.15, (HUMIDITY[precip] - 0.35) / 0.45)) : 0;

	const dustReach = Math.min(m.shockKm, r.rings.psi1 * 0.8);
	const dustHeight = Math.max(r.rings.psi5 * 0.2, 0.02) * Math.pow(Math.min(1, after / (r.shock[r.shock.length - 1]?.s ?? 60) + 0.25), 0.5);
	// Fine dust hangs. The rest comes down at the speed its size allows.
	const dustOpacity = lit ? Math.max(0.05, 1 - settled(dustHeight, after)) : 0;

	const fires = lit && r.rings.thermal > 0 ? Math.min(1, Math.max(0, after - tForm) / 12) * (0.35 + 0.65 * Math.exp(-after / 2400)) : 0;
	// Debris starts to fall out once the cloud stops carrying it upward, led by the heaviest grains.
	const falling = Math.max(0, after - m.peakS);
	const fallAmount = lit && r.coupling > 0 ? Math.min(1, falling / 240) * Math.min(1, 0.3 + r.coupling) : 0;
	const fallReach = fallingFront(m.capAlt, falling);
	const windKms = (r.winds.cap * 1.609344) / 3600;
	// How far the debris trails behind the cap as it falls: lower air moves slower than the cap.
	const slant = windKms * 0.4 * 700 / Math.max(m.capAlt, 0.2);
	const stemOpacity = lit ? (0.32 + 0.68 * r.coupling) * Math.max(0.06, 1 - Math.max(0, after - 500) / 1500) * m.capOpacity : 0;

	// G&D §2.17: stem radius is about half the cloud's below about 20 kt, and a fifth to a tenth of its width in megatons.
	// The limit keeps a huge yield's very wide cap from swelling down to the ground.
	const capDrawn = Math.max(m.capH, Math.min(m.capR * 0.52, m.capAlt * 0.38));
	const stemRatio = 0.5 + (0.15 - 0.5) * Math.max(0, Math.min(1, Math.log10(r.burst.kt / 20) / Math.log10(50)));

	return {
		...view,
		t,
		churn,
		hob,
		fire: [m.fireR, m.fireAlt, temp, fireOpacity],
		pulse: m.pulse,
		// The model's cap is very flat, and lumps stretch into strata on anything that thin. The picture thickens it,
		// mostly downward, so the top stays near the model's height.
		cap: [m.capAlt - Math.max(0, capDrawn - m.capH) * 0.7, m.capR, capDrawn, m.capDrift],
		capLook: [lit ? m.capOpacity : 0, heat, m.rise, pileus],
		stem: [m.capR * stemRatio * 1.45, m.capR * stemRatio, stemOpacity, Math.max(0, m.capAlt - Math.max(0, capDrawn - m.capH) * 0.7 - capDrawn * 0.55)],
		shock: [m.shockSlant, m.shockKm, shockFade, wilson],
		dust: [dustReach, dustHeight, dustOpacity, r.rings.psi1],
		rings: [r.rings.psi5, r.rings.thermal, fires, lit ? Math.max(0, skyFlash - 0.1) * 0.9 : 0],
		fall: [fallAmount, fallReach, slant],
		weather: PRECIP[precip],
		trail,
		grade
	};
}
