import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeGrid, type TheatreData, type TheatreMeta } from './data';
import {
	blastRangeKm,
	cloudGeometry,
	effectiveWinds,
	falloutBands,
	falloutField,
	fatalityFromFallout,
	groundCoupling,
	optimumHobM,
	patternField,
	psiProfile,
	radiationKm,
	rainoutShare,
	thermalExposure,
	thermalKm,
	type Weather
} from './effects';
import { toReachable } from './controls';
import { assessDifficulty } from './difficulty';
import { generate, theatreIdForDay } from './generator';
import { distanceKm } from './sim';
import { evaluate, objectiveText } from './scenario';
import { fissionFractionAt, weaponById } from './weapons';

const cache = new Map<string, TheatreData>();
function load(id: string): TheatreData {
	let d = cache.get(id);
	if (!d) {
		const meta = JSON.parse(readFileSync(`static/data/${id}.json`, 'utf8')) as TheatreMeta;
		const raw = readFileSync(`static/data/${id}.bin`);
		const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
		d = { meta, grid: decodeGrid(meta, buf), weather: JSON.parse(readFileSync(`static/data/weather-${id}.json`, 'utf8')) };
		cache.set(id, d);
	}
	return d;
}

const clear: Weather = { precip: 'CLEAR', windBearing: 90, windKmh: 24 };

const MI = 1.609344;
const FT = 0.3048;
const near = (got: number, want: number, frac: number) => {
	expect(got).toBeGreaterThan(want * (1 - frac));
	expect(got).toBeLessThan(want * (1 + frac));
};
/** Last point along the wind axis at or above a rate, in miles. */
const axisReach = (rate: (mi: number) => number, level: number) => {
	for (let x = 3000; x >= -100; x -= 0.05) if (rate(x) >= level) return x;
	return 0;
};
const UNIT = { cap: 1, stem: 1, rain: 0, rainStretch: 1 };

describe('airblast against published figures', () => {
	it('reproduces Glasstone & Dolan worked examples', () => {
		// G&D §3.73b: 100 kt at 2320 ft gives 50 psi at 1860 ft from ground zero. Model 46.8.
		near(psiProfile(100, 2320 * FT)((1860 * FT) / 1000), 50, 0.08);
		// G&D §3.73c: 125 kt, 4 psi reaches 13,000 ft from a 5500 ft burst. Model 12,640.
		near(blastRangeKm(4, 125, 5500 * FT) / FT, 13000 / 1000, 0.05);
	});

	it('stays near OTA 1979 Table 3, 1 Mt at 8000 ft', () => {
		const h = 8000 * FT;
		near(blastRangeKm(20, 1000, h), 1.3, 0.15); // model +7%
		near(blastRangeKm(10, 1000, h), 4.8, 0.2); // model -16%
		near(blastRangeKm(5, 1000, h), 7, 0.1); // model -7%
		near(blastRangeKm(3, 1000, h), 9.5, 0.1); // model -7%
		near(blastRangeKm(1, 1000, h), 18.6, 0.05); // model +1%
	});

	it('stays near Sublette 5.6.2 optimum ranges at 1 kt', () => {
		// Sublette's constants, for optimum height. Brode's fit runs a few percent lower across the board.
		const best = (psi: number) => {
			let top = 0;
			for (let h = 0; h < 1500; h += 5) top = Math.max(top, blastRangeKm(psi, 1, h));
			return top;
		};
		near(best(20), 0.28, 0.1);
		near(best(10), 0.45, 0.1);
		near(best(5), 0.71, 0.1);
		near(best(3), 1, 0.1);
		near(best(1), 2.2, 0.1);
	});

	it('peaks 5 psi range at optimum height and loses it far above', () => {
		const opt = blastRangeKm(5, 100, optimumHobM(100));
		expect(opt).toBeGreaterThan(blastRangeKm(5, 100, 0));
		expect(opt).toBeGreaterThanOrEqual(blastRangeKm(5, 100, optimumHobM(100) * 0.8));
		expect(opt).toBeGreaterThanOrEqual(blastRangeKm(5, 100, optimumHobM(100) * 1.2));
		expect(blastRangeKm(5, 100, 5000)).toBe(0);
	});

	it('falls off monotonically with distance', () => {
		const psi = psiProfile(500, 0);
		let last = Infinity;
		for (let km = 0.1; km < 40; km += 0.5) {
			const p = psi(km);
			expect(p).toBeLessThanOrEqual(last);
			last = p;
		}
	});

	it('matches Hiroshima damage', () => {
		// 15 kt at 580 m, severe damage to about 1.7 km.
		near(blastRangeKm(5, 15, 580), 1.7, 0.1);
	});
});

describe('thermal and prompt radiation against published figures', () => {
	it('follows G&D eq. 7.96.4 and Fig. 7.42', () => {
		// G&D §7.43: 8 cal/cm² at a slant range of about 7 miles for a 1 Mt air burst, 12 mile visibility.
		near(thermalExposure(1000, 1000, 7, clear), 8, 0.1);
	});

	it('stays near the third-degree ranges in Sublette 5.6.1.1', () => {
		// Clear air, medium skin.
		// The model follows G&D's 12 mile visibility, which is why it reads low against these at long range.
		near(thermalKm(20, optimumHobM(20), clear), 2.7, 0.15); // model -10%
		near(thermalKm(1000, optimumHobM(1000), clear), 12, 0.2); // model -14%
		near(thermalKm(20000, optimumHobM(20000), clear), 39, 0.25); // model -24%
	});

	it('lets heat reach the ground from high bursts only at absurd yields', () => {
		expect(thermalKm(1400, 400000, clear)).toBe(0); // Starfish Prime
		expect(thermalKm(35000, 100000, clear)).toBe(0);
		expect(thermalKm(1000000, 100000, clear)).toBeGreaterThan(100);
		expect(thermalKm(10000000, 100000, clear)).toBeGreaterThan(thermalKm(1000000, 100000, clear));
	});

	it('gives a shock from heated air only at absurd yields', () => {
		// Starfish Prime left no shock on the ground.
		expect(blastRangeKm(0.1, 1400, 400000)).toBeLessThan(10);
		expect(blastRangeKm(1, 2000, 100000)).toBe(0);
		expect(blastRangeKm(1, 1e7, 100000)).toBeGreaterThan(0);
		near(blastRangeKm(1, 15000, 29000), blastRangeKm(1, 15000, 31000), 0.2);
	});

	it('makes a short-lived salt give its dose fast and fade', () => {
		const dose = (id: string, down: number) => {
			const f = falloutField(weaponById(id), 2000, 0, clear)!;
			return f.doseAt(f.rateAt(down, 0), down);
		};
		// A plain device of the same yield and fission share gives less near the burst.
		expect(dose('sodium', 40)).toBeGreaterThan(dose('b83', 40));
		expect(dose('gold', 40)).toBeGreaterThan(dose('sodium', 40));
	});

	it('has no jump in heat across the 30 km line', () => {
		near(thermalKm(15000, 29000, clear), thermalKm(15000, 31000, clear), 0.1);
	});

	it('cuts surface bursts to the effective partition of G&D Table 7.101', () => {
		near(thermalExposure(1000, 0, 5, clear) / thermalExposure(1000, 1000, 5, clear), 0.18 / 0.35, 0.01);
	});

	it('treats cloud by where the burst sits relative to it', () => {
		// G&D §7.100 and §7.16: a layer above the burst reflects, a layer below it blocks.
		const overcast: Weather = { ...clear, precip: 'OVERCAST' };
		expect(thermalKm(100, 200, overcast)).toBeGreaterThan(thermalKm(100, 200, clear));
		expect(thermalKm(1000, 6000, overcast)).toBeLessThan(thermalKm(1000, 6000, clear));
	});

	it('stays near G&D Figs. 8.33a and b for 1000 rad', () => {
		// Read from the plots, in yards of slant range. Ground range equals slant range for a surface burst.
		const slant = (kt: number) => radiationKm(kt, 0) / 0.9144 * 1000;
		near(slant(1), 750, 0.1); // model +2%
		near(slant(100), 1870, 0.1); // model -2%
		near(slant(1000), 2650, 0.1); // model +7%
		near(slant(10000), 4250, 0.1); // model +4%
	});

	it('sizes the neutron warhead from Sublette 1.6', () => {
		// 600 rads on unprotected soldiers: 1350 m at 1 kt ER against 900 m for pure fission.
		near(radiationKm(1, 0, weaponById('w70').enhanced) / radiationKm(1, 0), 1350 / 900, 0.01);
	});
});

describe('fission fractions', () => {
	it('carries the published test figures', () => {
		near(fissionFractionAt(weaponById('bravo'), 15000), 10 / 15, 0.001); // Sublette, Operation Castle
		near(fissionFractionAt(weaponById('tsar'), 50000), 0.03, 0.001); // Sublette, Tsar Bomba
		near(fissionFractionAt(weaponById('tsar2'), 100000), 0.5, 0.001); // Sublette, Tsar Bomba
		near(fissionFractionAt(weaponById('w70'), 1), 0.4, 0.001); // Sublette 1.6, W70 Mod 3
	});

	it('moves with the dial on variable devices', () => {
		for (const id of ['b61', 'w80', 'b83']) {
			const w = weaponById(id);
			expect(fissionFractionAt(w, w.minKt)).toBe(1);
			expect(fissionFractionAt(w, w.maxKt)).toBe(0.5);
			expect(fissionFractionAt(w, Math.sqrt(w.minKt * w.maxKt))).toBeLessThan(1);
		}
	});
});

describe('fallout against published figures', () => {
	// Miller Table 3.4, 15 mph at 100% fission: X7 peak, X8 widest point, X9 1 R/h tip, Y8 half-width
	// of the 1 R/h contour, ridge and peak rates. Table 3.1 and these figures were read from the scan.
	const MILLER: [number, number, number, number, number, number, number][] = [
		[100, 14.4, 20.8, 126, 9.1, 35300, 803],
		[1000, 28.8, 42.8, 258, 33.6, 9800, 2712],
		[10000, 58.4, 88.6, 528, 64.7, 3550, 9070],
		[100000, 118, 183, 1080, 123, 1440, 30510]
	];

	it('reproduces Miller Table 3.4', () => {
		for (const [kt, x7, x8, x9, y8, ridge, peak] of MILLER) {
			const f = patternField(kt, 15, 15, UNIT);
			const rate = (mi: number) => f.rateAt(mi * MI, 0);
			near(axisReach(rate, 1), x9, 0.02);
			let hi = 0;
			for (let y = 0; y < 300; y += 0.05) if (f.rateAt(x8 * MI, y * MI) >= 1) hi = y;
			near(hi, y8, 0.08);
			near(rate(x7), peak, 0.08);
			// The ridge sits at (X2 + X3) / 2.
			const a = 0.0327 * Math.pow(kt, 0.23) * 15;
			expect(rate(a)).toBeGreaterThan(ridge * 0.9);
		}
	});

	it('reproduces Miller Table 3.4 below his fitted range', () => {
		const f = patternField(10, 15, 15, UNIT);
		near(axisReach((mi) => f.rateAt(mi * MI, 0), 1), 61.2, 0.02);
		const g = patternField(1, 15, 15, UNIT);
		near(axisReach((mi) => g.rateAt(mi * MI, 0), 1), 29.4, 0.02);
	});

	it('sits within the known spread of G&D Table 9.93', () => {
		// 1 Mt, 15 mph, 100% fission, contour length in miles. Miller's far contours are much shorter
		// than G&D's: this bounds the disagreement rather than claiming agreement.
		const f = patternField(1000, 15, 15, UNIT);
		const reach = (level: number) => axisReach((mi) => f.rateAt(mi * MI, 0), level);
		near(reach(1000), 40.3, 0.5); // model 57.8, +43%
		near(reach(300), 100.7, 0.15); // model 92.8, -8%
		near(reach(100), 199, 0.45); // model 124.8, -37%
		near(reach(10), 537, 0.7); // model 191.8, -64%
		near(reach(1), 895, 0.75); // model 258.8, -71%
	});

	it('lofts the cloud to the heights G&D and the tests report', () => {
		const ft = (km: number) => (km * 1000) / FT;
		const edge = (kt: number) => {
			const g = cloudGeometry(kt);
			return [ft(g.centreKm - g.halfThicknessKm), ft(g.centreKm + g.halfThicknessKm)];
		};
		// G&D Fig. 9.96, read from the plot: 1 Mt about 35,000 to 65,000 ft.
		near(edge(1000)[0], 35000, 0.2);
		near(edge(1000)[1], 65000, 0.1);
		// 10 kt about 11,000 to 19,000 ft, where Miller's table runs higher at the base.
		near(edge(10)[1], 19000, 0.15);
		// Sublette, Operation Castle: Bravo's cloud bottom above 55,000 ft and its peak near 130,000 ft.
		near(edge(15000)[0], 55000, 0.1);
		near(edge(15000)[1], 130000, 0.25);
		// G&D Fig. 2.16 scale: cloud radius about 21 miles at 10 Mt. Miller's r is the radius at top height.
		near(cloudGeometry(10000).radiusKm / MI, 21, 0.25);
	});

	it('scales dose rate, not shape, with fission fraction', () => {
		// G&D §9.94: shapes follow total yield, rates are multiplied by the fission share.
		const whole = patternField(1000, 15, 15, UNIT);
		const half = patternField(1000, 15, 15, { cap: 0.5, stem: 0.5, rain: 0, rainStretch: 1 });
		for (const mi of [5, 30, 100, 150]) near(half.rateAt(mi * MI, 0) / whole.rateAt(mi * MI, 0), 0.5, 0.001);
		// Bravo at 67% against Tsar at 3%, the comparison Wellerstein draws from NUKEMAP.
		const bravo = falloutBands(weaponById('bravo'), 15000, 0, clear)[1];
		const tsar = falloutBands(weaponById('tsar'), 50000, 0, clear)[1];
		expect(bravo.length).toBeGreaterThan(tsar.length);
	});

	it('moves low settings of a dial-a-yield weapon toward fission', () => {
		// The same dial, so the only thing changing in activity per kiloton is the fission share.
		const w = weaponById('b83');
		const low = falloutField(w, 10, 0, clear)!;
		const hi = patternField(10, effectiveWinds(10, 24).cap, effectiveWinds(10, 24).stem, {
			cap: fissionFractionAt(w, 10),
			stem: fissionFractionAt(w, 10),
			rain: 0,
			rainStretch: 1
		});
		near(low.rateAt(10, 0), hi.rateAt(10, 0), 0.001);
		expect(fissionFractionAt(w, 10)).toBeGreaterThan(fissionFractionAt(w, 1000));
	});

	it('makes local fallout only below the G&D height', () => {
		// G&D eq. 2.128.1: 180 W^0.4 ft, about 2900 ft at 1 Mt.
		const w = weaponById('w88');
		expect(falloutBands(w, 475, 0, clear).length).toBe(4);
		expect(falloutBands(w, 475, 3000, clear).length).toBe(0);
		expect(groundCoupling(1000, 2800 * FT)).toBeGreaterThan(0);
		expect(groundCoupling(1000, 2900 * FT)).toBe(0);
		expect(groundCoupling(1000, 0)).toBe(1);
	});

	it('scavenges the clouds G&D §9.68 says rain can reach', () => {
		// All of a 10 kt cloud, part of a 100 kt one, and almost nothing higher.
		expect(rainoutShare(10, 'RAIN')).toBeCloseTo(0.75, 2);
		expect(rainoutShare(100, 'RAIN')).toBeGreaterThan(0);
		expect(rainoutShare(100, 'RAIN')).toBeLessThan(0.75);
		expect(rainoutShare(475, 'RAIN')).toBe(0);
		expect(rainoutShare(10, 'CLEAR')).toBe(0);
		// §9.71: the area shrinks and the near field rises when it rains into the cloud.
		const boy = weaponById('boy');
		const dry = falloutBands(boy, 15, 0, clear)[3];
		const wet = falloutBands(boy, 15, 0, { ...clear, precip: 'RAIN' })[3];
		expect(wet.length).toBeLessThan(dry.length);
		// §9.67: an air burst lays down rainout, though it has no fallout in clear air.
		expect(falloutBands(boy, 15, 580, clear).length).toBe(0);
		expect(falloutBands(boy, 15, 580, { ...clear, precip: 'RAIN' }).length).toBe(4);
	});

	it('feels faster air when the cloud rises into it', () => {
		const low = effectiveWinds(1, 24);
		const high = effectiveWinds(1000, 24);
		expect(high.cap).toBeGreaterThan(low.cap);
		expect(high.stem).toBeGreaterThan(low.stem);
	});

	it('turns the rate into dose by arrival time, per Hanifen eq. 27 and OTA', () => {
		// Hanifen eq. 27 at 1 hour: exp(-(0.287 + 0.52 ln(1/31.6) + 0.04475 ln²(1/31.6))) = 2.65.
		const f = patternField(1000, 15, 15, UNIT);
		near(f.doseAt(100, 0) / 100, 1.33 * 0.2 * 3.0, 0.02); // half-hour floor: Bio is 3.0 there
		// Later arrival is less dose per unit H+1 rate, from the t^-1.2 decay already done by then.
		expect(f.doseAt(100, 400 * MI)).toBeLessThan(f.doseAt(100, 30 * MI));
		// OTA ch. II: 300 rem kills about 10%, 450 about half, 600 about 90%.
		expect(fatalityFromFallout(300)).toBeCloseTo(0.1, 5);
		expect(fatalityFromFallout(450)).toBeCloseTo(0.5, 5);
		expect(fatalityFromFallout(600)).toBeCloseTo(0.9, 5);
		expect(fatalityFromFallout(100)).toBe(0);
	});
});

describe('daily generator', () => {
	// NUCLE_DAYS=365 npm test runs the longer audit.
	const COUNT = Number(process.env.NUCLE_DAYS ?? 40);
	const DAYS = Array.from({ length: COUNT }, (_, i) => i + 1);

	it('is deterministic', () => {
		const a = generate(3, load(theatreIdForDay(3))).scenario;
		const b = generate(3, load(theatreIdForDay(3))).scenario;
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	}, 60000);

	it('always has a plan a player can actually enter on the console', () => {
		const kinds = new Map<string, number[]>();
		const hist = [0, 0, 0, 0, 0];
		let slowest = 0;
		let fallbacks = 0;
		for (const day of DAYS) {
			const start = performance.now();
			const { scenario: s, sim, solution, fallback } = generate(day, load(theatreIdForDay(day)));
			slowest = Math.max(slowest, performance.now() - start);
			if (fallback) fallbacks++;
			const label = `day ${day} ${s.kind} ${s.theatre.id}`;

			// Every setting has to survive the sliders, and every aim point the scope edge.
			for (const p of solution) {
				expect(toReachable(s, p), label).toEqual(p);
				expect(distanceKm(s.theatre.lat, s.theatre.lon, p.lat, p.lon), label).toBeLessThanOrEqual(s.theatre.radiusKm);
			}
			for (const site of [...s.targets, ...s.protected]) {
				expect(distanceKm(s.theatre.lat, s.theatre.lon, site.lat, site.lon), `${label} ${site.name}`).toBeLessThanOrEqual(
					s.theatre.radiusKm
				);
			}
			const out = evaluate(s, sim, solution);
			expect(out.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`), label).toEqual([]);
			expect(out.rating, label).toBeGreaterThanOrEqual(95);

			// The same plan after a round trip through the cookie format.
			const stored = solution.map((p) => ({ ...p, kt: +p.kt.toPrecision(4), hobM: Math.round(p.hobM) }));
			expect(evaluate(s, sim, stored).passed, `${label} stored`).toBe(true);

			const d = assessDifficulty(s, sim, solution);
			hist[Math.min(4, Math.floor(d.score / 20))]++;
			kinds.set(s.kind, [...(kinds.get(s.kind) ?? []), d.score]);
			console.log(
				`${String(day).padStart(3)} ${s.theatre.id} ${s.kind.padEnd(12)} x${s.arsenal.length} ` +
					`D=${String(d.score).padStart(3)} pass=${d.planPass.toFixed(2)} prog=${d.planProgress.toFixed(2)} tol=${d.tolerance.toFixed(2)} cond=${d.conditions}`
			);
		}
		const mean = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
		console.log(`SUMMARY days=${COUNT} fallbacks=${fallbacks} slowest=${Math.round(slowest)}ms`);
		console.log(`SUMMARY difficulty bands ${hist.join(' / ')}`);
		for (const [k, v] of kinds) console.log(`SUMMARY ${k}: n=${v.length} mean D=${mean(v)}`);
		expect(kinds.size).toBeGreaterThanOrEqual(6);
	}, 1500000);
});
