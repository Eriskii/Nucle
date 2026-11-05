import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyze, CAUSES } from './debrief';
import { decodeGrid, type TheatreData, type TheatreMeta } from './data';
import { dynamicPsi, peakWindMs, shockArrival, shockSpeedMs } from './effects';
import { generate, theatreIdForDay } from './generator';
import { evaluate } from './scenario';

function load(id: string): TheatreData {
	const meta = JSON.parse(readFileSync(`static/data/${id}.json`, 'utf8')) as TheatreMeta;
	const raw = readFileSync(`static/data/${id}.bin`);
	return { meta, grid: decodeGrid(meta, raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer) };
}

const near = (got: number, want: number, frac: number) => {
	expect(got).toBeGreaterThan(want * (1 - frac));
	expect(got).toBeLessThan(want * (1 + frac));
};

describe('post-strike report', () => {
	for (const day of [1, 2, 4, 7, 20, 25, 33]) {
		it(`splits deaths without losing or inventing any, day ${day}`, () => {
			const data = load(theatreIdForDay(day));
			const { scenario, sim, solution } = generate(day, data);
			const out = evaluate(scenario, sim, solution);
			const d = analyze(scenario, sim, out, data.meta);
			const byCause = CAUSES.reduce((sum, c) => sum + d.causes[c], 0);
			const byBurst = d.bursts.reduce((sum, b) => sum + b.deaths, 0);
			const tol = Math.max(1, out.tally.fatalities * 1e-3);
			expect(Math.abs(byCause - out.tally.fatalities)).toBeLessThan(tol);
			expect(Math.abs(byBurst - out.tally.fatalities)).toBeLessThan(tol);
			// Population bands account for everyone kept on the map.
			const pop = d.bands.reduce((sum, b) => sum + b.pop, 0);
			expect(Math.abs(pop - data.grid.pop.reduce((a, b) => a + b, 0))).toBeLessThan(pop * 1e-3);
			if (d.worked) expect(d.worked.fatal).toBeGreaterThan(0);
			for (const b of d.bursts) {
				// A weapon can add more than it kills alone, because fallout doses stack past the lethal threshold.
				expect(b.marginalDeaths).toBeGreaterThanOrEqual(-1);
				expect(b.fissionKt + b.fusionKt).toBeCloseTo(b.burst.kt, 6);
			}
		});
	}

	it('gets the shock front right against published figures', () => {
		// G&D Table 3.07: wind in mph by overpressure.
		expect(peakWindMs(5) * 2.23694).toBeCloseTo(163, -1);
		expect(peakWindMs(20) * 2.23694).toBeCloseTo(502, -1);
		expect(dynamicPsi(20)).toBeCloseTo(8.1, 0);
		// Weak shocks move at the speed of sound.
		expect(shockSpeedMs(0)).toBe(340);
		const arrival = (kt: number, hobM: number, km: number) => shockArrival(kt, hobM, km * 1.2).find((p) => p.km >= km)!.s;
		const MI = 1.609344;
		// G&D §2.32: a 1 Mt front has gone about 12 miles at 50 s.
		near(arrival(1000, 600, 12 * MI), 50, 0.2);
		// G&D §3.09: 1 Mt reaches 1 mi at 1.4 s and 2 mi at 4.5 s. 20 kt reaches them at 3 s and 7.5 s.
		near(arrival(1000, 600, MI), 1.4, 0.45);
		near(arrival(1000, 600, 2 * MI), 4.5, 0.3);
		near(arrival(20, 160, MI), 3, 0.3);
		near(arrival(20, 160, 2 * MI), 7.5, 0.25);
	});
});
