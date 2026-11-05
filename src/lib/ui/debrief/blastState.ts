import type { BurstReport } from '#lib/game/debrief.ts';
import { psiProfile, type Precip } from '#lib/game/effects.ts';
import type { SceneState } from './blastEngine.ts';

// Maps a moment to what the scene shows. Sizes come from the effects model. Timing of the fireball and cloud follows
// G&D's figures, scaled as noted, and the colour from reddish brown to white follows §2.08. Dust, fires, the skyline
// and how the billows look are illustrative.

/** Fits G&D Table 2.12 for 1 Mt: 6 of about 12 miles at 1.1 min, 10 at 2.5 min. Used at every yield, an estimate. */
export const RISE_S = 90;

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
}

export function momentAt(r: BurstReport, t: number): Moment {
	const hob = r.burst.hobM / 1000;
	const after = Math.max(t, 0);
	const tMax = r.thermalMaxS;
	const tForm = tMax * 10;
	const rise = 1 - Math.exp(-after / RISE_S);
	const fireR = t > 0 ? r.fireballKm * Math.min(1, Math.pow(after / tForm, 0.4)) : 0;
	const capAlt = hob + Math.max(0.01, r.cloud.centreKm - hob) * rise;
	const shockKm = shockGroundKm(r, after);
	return {
		fireR,
		fireAlt: hob + Math.max(0, r.cloud.centreKm - hob) * rise,
		capAlt,
		capR: Math.max(r.fireballKm * 0.9, r.cloud.radiusKm * Math.pow(rise, 0.7)),
		capH: Math.max(r.fireballKm * 0.7, r.cloud.halfThicknessKm * Math.pow(rise, 0.6)),
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
	const m = momentAt(r, t);
	const hob = r.burst.hobM / 1000;
	const after = Math.max(t, 0);
	const tForm = r.thermalMaxS * 10;
	const lit = t > 0;

	// Blue-white at the first instant, through yellow and orange, to a sullen red inside the rising cloud.
	const temp = Math.max(0, 1 - 0.45 * Math.log10(1 + after / (r.thermalMaxS * 0.6)));
	const fireOpacity = !lit ? 0 : after < tForm ? 1 : Math.max(0, 1 - (after - tForm) / (tForm * 6 + 4));

	// Heat in the cap fades over a few minutes, faster for small clouds, which cool quicker.
	const heatTime = 40 + 60 * Math.cbrt(r.burst.kt / 1000);
	const heat = lit ? Math.exp(-after / heatTime) : 0;
	// A cap of ice forms over the fast-rising top in moist air, while it's still climbing.
	const pileus = lit ? Math.min(1, after / 8) * Math.exp(-Math.max(0, after - 30) / 50) : 0;

	const shockFade = lit ? Math.min(1, m.psi / 1.2) : 0;
	// Condensation behind the shock: seconds, scaled by the cube root of yield as blast timing is.
	// G&D §2.50: at about 20 kt it began at 1 to 2 s and was gone within about another second. Scaled by cube root.
	const wTime = Math.cbrt(r.burst.kt / 21);
	const wilson = lit ? Math.exp(-Math.pow((after - 1.6 * wTime) / (0.7 * wTime), 2)) * 0.9 : 0;

	const dustReach = Math.min(m.shockKm, r.rings.psi1 * 0.8);
	const dustHeight = Math.max(r.rings.psi5 * 0.2, 0.02) * Math.pow(Math.min(1, after / (r.shock[r.shock.length - 1]?.s ?? 60) + 0.25), 0.5);
	const dustOpacity = lit ? Math.max(0, 1 - Math.max(0, after - 60) / 1800) : 0;

	const fires = lit && r.rings.thermal > 0 ? Math.min(1, Math.max(0, after - tForm) / 12) * (0.35 + 0.65 * Math.exp(-after / 2400)) : 0;
	const fallAmount = lit && r.coupling > 0 ? Math.min(1, Math.max(0, after - 180) / 500) * Math.min(1, 0.3 + r.coupling) : 0;
	const fallReach = m.capAlt * Math.min(1, Math.max(0, after - 180) / 1500);
	const windKms = (r.winds.cap * 1.609344) / 3600;
	// How far the debris trails behind the cap as it falls: lower air moves slower than the cap.
	const slant = windKms * 0.4 * 700 / Math.max(m.capAlt, 0.2);
	const stemOpacity = lit ? (0.32 + 0.68 * r.coupling) * Math.max(0.06, 1 - Math.max(0, after - 500) / 1500) * m.capOpacity : 0;

	// G&D §2.17: stem radius is about half the cloud's below about 20 kt, and a fifth to a tenth of its width in megatons.
	const capDrawn = Math.max(m.capH, m.capR * 0.52);
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
		rings: [r.rings.psi5, r.rings.thermal, fires, lit ? Math.max(0, m.pulse - 0.1) * 0.9 : 0],
		fall: [fallAmount, fallReach, slant],
		weather: PRECIP[precip],
		trail,
		grade
	};
}
