import { PSI_TO_KGCM2, type Lang } from '#lib/game/i18n.ts';
import { fmtCount, fmtKt } from '#lib/game/scenario.ts';

const trim = (v: number, digits: number) => +v.toFixed(digits);

/** Number formatting and units for one language. Russian uses kg/cm², m/s and R/h, as the console does. */
export function formatter(lang: Lang) {
	const ru = lang === 'ru';
	const num = (v: number) => (ru ? `${v}`.replace('.', ',') : `${v}`);
	const sig = (v: number, digits = 3) => num(+v.toPrecision(digits));
	const km = (v: number) => {
		if (v >= 1000) return `${num(Math.round(v))} ${ru ? 'км' : 'km'}`;
		if (v >= 10) return `${num(trim(v, 0))} ${ru ? 'км' : 'km'}`;
		if (v >= 1) return `${num(trim(v, 1))} ${ru ? 'км' : 'km'}`;
		return `${num(Math.round(v * 1000))} ${ru ? 'м' : 'm'}`;
	};
	const pressureValue = (psi: number) => (ru ? psi * PSI_TO_KGCM2 : psi);
	return {
		lang,
		num,
		sig,
		km,
		count: (v: number) => fmtCount(v, lang),
		/** A count for axes and ranges, with no trailing zeros: 60M, 2.5M, 220K. */
		short: (v: number) => {
			const unit = (x: number, en: string, cyr: string) => `${sig(x, 3)}${ru ? ` ${cyr}` : en}`;
			if (v >= 1e9) return unit(v / 1e9, 'B', 'МЛРД');
			if (v >= 1e6) return unit(v / 1e6, 'M', 'МЛН');
			if (v >= 1e3) return unit(v / 1e3, 'K', 'ТЫС');
			return sig(v, 3);
		},
		/** Whole numbers with separators, for exact-looking figures in a worked example. */
		full: (v: number) => Math.round(v).toLocaleString(ru ? 'ru-RU' : 'en-US'),
		kt: (v: number) => fmtKt(v, lang),
		/** A short length in metres, for the size of a device. */
		metres: (m: number) => `${num(+m.toFixed(2))} ${ru ? 'м' : 'm'}`,
		pressureValue,
		pressureUnit: ru ? 'кгс/см²' : 'psi',
		psi: (v: number) => `${sig(pressureValue(v), v >= 10 ? 3 : 2)} ${ru ? 'кгс/см²' : 'psi'}`,
		wind: (ms: number) => (ru ? `${Math.round(ms)} м/с` : `${Math.round(ms * 3.6)} km/h`),
		rate: (v: number) => `${sig(v, 3)} ${ru ? 'Р/ч' : 'rad/h'}`,
		rateUnit: ru ? 'Р/ч' : 'rad/h',
		dose: (v: number) => `${sig(v, 3)} ${ru ? 'рад' : 'rad'}`,
		pct: (v: number) => {
			const p = v * 100;
			if (p === 0) return '0%';
			if (p < 0.1) return `<${num(0.1)}%`;
			if (p < 10) return `${num(trim(p, 1))}%`;
			return `${Math.round(p)}%`;
		},
		time: (s: number) => {
			if (s < 0.001) return `${num(trim(s * 1e6, 0))} ${ru ? 'мкс' : 'µs'}`;
			if (s < 1) return `${num(trim(s * 1000, 0))} ${ru ? 'мс' : 'ms'}`;
			if (s < 90) return `${num(trim(s, s < 10 ? 1 : 0))} ${ru ? 'с' : 's'}`;
			if (s < 5400) return `${num(trim(s / 60, 1))} ${ru ? 'мин' : 'min'}`;
			return `${num(trim(s / 3600, 1))} ${ru ? 'ч' : 'h'}`;
		},
		area: (v: number) => `${sig(v, 2)} ${ru ? 'км²' : 'km²'}`
	};
}

export type Fmt = ReturnType<typeof formatter>;
