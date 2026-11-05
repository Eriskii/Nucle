import { optimumHobM } from './effects';
import type { Placement, Scenario } from './scenario';
import { hasDial, type Weapon } from './weapons';

// The console's sliders run on log scales, since yields and heights span orders
// of magnitude. The solver goes through these too, so it can only use settings
// a player can actually dial in.

export const SLIDER_MAX = 1000;
const HOB_DECADES = 4.7;

export const ktFromSlider = (w: Weapon, v: number) =>
	+(w.minKt * Math.pow(w.maxKt / w.minKt, v / SLIDER_MAX)).toPrecision(3);

export const ktToSlider = (w: Weapon, kt: number) =>
	w.maxKt === w.minKt ? SLIDER_MAX : (SLIDER_MAX * Math.log(kt / w.minKt)) / Math.log(w.maxKt / w.minKt);

export const hobFromSlider = (v: number) => (v <= 0 ? 0 : Math.round(Math.pow(10, 1 + (v / SLIDER_MAX) * HOB_DECADES)));

export const hobToSlider = (m: number) => (m <= 10 ? 0 : (SLIDER_MAX * (Math.log10(m) - 1)) / HOB_DECADES);

/** Heights with their own preset button, which need no slider rounding. */
export const presetHobs = (kt: number) => [0, optimumHobM(kt), 100000, 400000];

/** The closest settings to `p` that the sliders and preset buttons can produce. */
export function toReachable(s: Scenario, p: Placement): Placement {
	const w = s.arsenal[p.slot];
	const kt = hasDial(w) && !s.yieldLock ? clampKt(w, ktFromSlider(w, Math.round(ktToSlider(w, p.kt)))) : w.maxKt;
	const hobM = presetHobs(kt).includes(p.hobM) ? p.hobM : hobFromSlider(Math.round(hobToSlider(p.hobM)));
	return { slot: p.slot, lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5), kt, hobM };
}

const clampKt = (w: Weapon, kt: number) => Math.min(w.maxKt, Math.max(w.minKt, kt));
