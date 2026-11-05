import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeGrid, type TheatreData, type TheatreMeta } from './data';
import { blastRangeKm, falloutBands, optimumHobM, psiProfile, type Weather } from './effects';
import { toReachable } from './controls';
import { assessDifficulty } from './difficulty';
import { generate, theatreIdForDay } from './generator';
import { distanceKm } from './sim';
import { evaluate, objectiveText } from './scenario';
import { weaponById } from './weapons';

const cache = new Map<string, TheatreData>();
function load(id: string): TheatreData {
	let d = cache.get(id);
	if (!d) {
		const meta = JSON.parse(readFileSync(`static/data/${id}.json`, 'utf8')) as TheatreMeta;
		const raw = readFileSync(`static/data/${id}.bin`);
		const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
		d = { meta, grid: decodeGrid(meta, buf) };
		cache.set(id, d);
	}
	return d;
}

const clear: Weather = { precip: 'CLEAR', windBearing: 90, windKmh: 24 };

describe('effects', () => {
	it('matches published figures at the anchor yields', () => {
		// OTA 1979: 1 Mt at about 1800 m gives 5 psi near 7.1 km.
		expect(blastRangeKm(5, 1000, 1830)).toBeGreaterThan(6.5);
		expect(blastRangeKm(5, 1000, 1830)).toBeLessThan(7.5);
		// Hiroshima: 15 kt at 580 m, severe damage to about 1.7 km.
		expect(blastRangeKm(5, 15, 580)).toBeGreaterThan(1.5);
		expect(blastRangeKm(5, 15, 580)).toBeLessThan(1.9);
	});

	it('peaks 5 psi range at optimum height and loses it far above', () => {
		const opt = blastRangeKm(5, 100, optimumHobM(100));
		expect(opt).toBeGreaterThan(blastRangeKm(5, 100, 0));
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

	it('makes fallout from ground bursts only', () => {
		const w = weaponById('w88');
		expect(falloutBands(w, 475, 0, clear).length).toBe(4);
		expect(falloutBands(w, 475, 3000, clear).length).toBe(0);
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
