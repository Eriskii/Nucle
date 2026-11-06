import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cloudRise, dustDown, settlingSpeed } from './cloudrise';
import { analyze, CAUSES, marchOf } from './debrief';
import { decodeGrid, type TheatreData, type TheatreMeta } from './data';
import { DELIVERY, flightFor } from './delivery';
import { dynamicPsi, peakWindMs, shockArrival, shockSpeedMs, thermalMaxS } from './effects';
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

describe('rising air and dust', () => {
	const start = (kt: number) => thermalMaxS(kt) * 5;
	it('reaches published cloud heights without being told them', () => {
		// Little Feller I, 18 t: 11,000 ft, taken as above sea level on ground near 5,000 ft.
		near(cloudRise(0.018, 10, start(0.018)).topKm, 1.9, 0.25);
		// G&D Fig. 2.16 and Table 2.12 for 1 Mt: about 22 km, and 10 miles up at 2.5 minutes.
		near(cloudRise(1000, 0, start(1000)).topKm, 22, 0.15);
		near(cloudRise(1000, 0, start(1000)).at(150).z, 16, 0.2);
		// Castle Bravo, about 40 km, and Tsar Bomba, about 65 km.
		near(cloudRise(15000, 2, start(15000)).topKm, 40, 0.15);
		near(cloudRise(50000, 4000, start(50000)).topKm, 65, 0.15);
	});
	it('rises more slowly as it cools, stops, then spreads', () => {
		const c = cloudRise(1000, 0, start(1000));
		expect(c.at(30).w).toBeGreaterThan(c.at(c.peakS * 0.9).w);
		expect(c.at(c.peakS + 600).r).toBeGreaterThan(c.at(c.peakS).r * 1.5);
		expect(c.at(3000).w).toBeLessThanOrEqual(0.001);
		expect(c.at(3600).h).toBeGreaterThan(0);
	});
	it('gets lift from condensing water, which matters most for small yields', () => {
		const top = (kt: number, humidity: number) => cloudRise(kt, 0, start(kt), humidity).topKm;
		expect(top(1, 0.95)).toBeGreaterThan(top(1, 0) * 1.3);
		expect(top(1000, 0.95)).toBeLessThan(top(1000, 0) * 1.05);
		expect(top(1000, 0.95)).toBeGreaterThanOrEqual(top(1000, 0));
		// A humid cloud holds condensed water. A dry one doesn't.
		expect(Math.max(...cloudRise(100, 0, start(100), 0.8).points.map((p) => p.water))).toBeGreaterThan(0.5);
		expect(Math.max(...cloudRise(100, 0, start(100), 0).points.map((p) => p.water))).toBeLessThan(0.05);
	});

	it('marks a cloud too big for the atmosphere', () => {
		expect(cloudRise(1000000, 0, start(1000000)).breached).toBe(true);
		expect(cloudRise(1000000, 0, start(1000000)).topKm).toBeLessThanOrEqual(90.01);
		expect(cloudRise(1000, 0, start(1000)).breached).toBe(false);
	});
	it('settles dust at the speed its size allows', () => {
		near(settlingSpeed(10e-6, 0), 0.008, 0.2);
		near(settlingSpeed(100e-6, 0), 0.55, 0.3);
		expect(settlingSpeed(100e-6, 20000)).toBeGreaterThan(settlingSpeed(100e-6, 0));
		expect(dustDown(10, 300)).toBeLessThan(dustDown(10, 3600));
	});
});

describe('post-strike report', () => {
	it('counts heat deaths from a gigaton burst at 100 km', () => {
		const data = load(theatreIdForDay(165));
		const { scenario: locked, sim } = generate(165, data);
		const scenario = { ...locked, hobLock: undefined };
		const slot = scenario.arsenal.findIndex((w) => w.id === 'gnomon');
		const big = data.grid.pop.indexOf(Math.max(...data.grid.pop));
		const plan = [{ slot, lat: data.grid.lat[big], lon: data.grid.lon[big], kt: 1000000, hobM: 100000 }];
		const d = analyze(scenario, sim, evaluate(scenario, sim, plan), data.meta);
		const b = d.bursts[0];
		expect(b.exo).toBe(true);
		expect(b.exoHeat[0].cal).toBeGreaterThan(b.burnCal);
		expect(b.rings.thermal).toBeGreaterThan(0);
		expect(b.causes.burns).toBeGreaterThan(0);
		// Heat dominates. The shock from the heated air adds a little, and nothing else reaches the ground.
		expect(b.causes.blast).toBeLessThan(b.causes.burns * 0.05);
		expect(b.causes.radiation + b.causes.fallout).toBeLessThan(b.causes.burns * 1e-3);
	});

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
			// The flow map's bands account for everyone it draws.
			const m = marchOf(d);
			const marched = m.stations.reduce((sum, s) => sum + s.deaths, 0);
			expect(Math.abs(marched - m.deaths)).toBeLessThan(tol + m.stations.length);
			// The extras never exceed the people left.
			expect(d.firestorm.deaths + d.cancers).toBeLessThanOrEqual(d.mapPop - d.deaths + 1);
			expect(Math.abs(m.survivors + m.deaths - m.reached)).toBeLessThan(1);
			// Nobody is both dead and hurt, and the hurt are among those in reach.
			expect(m.injuries.total).toBeLessThanOrEqual(m.survivors + 1);
			expect(Math.abs(m.injuries.blast + m.injuries.burns + m.injuries.sickness - m.injuries.total)).toBeLessThan(1);
			expect(m.reached + m.untouched).toBeLessThanOrEqual(d.mapPop + Math.max(1, d.mapPop * 1e-6) + m.deaths * 1e-3);
			expect(m.scored).toBeCloseTo(d.deaths, 3);
			for (const s of m.stations) {
				const split = s.byWeapon.reduce((sum, w) => sum + w.deaths, 0);
				expect(Math.abs(split - s.deaths)).toBeLessThan(Math.max(1, s.deaths * 1e-3) + s.byWeapon.length);
			}
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

describe('delivery timeline', () => {
	it('lands near the published fall times', () => {
		// Little Boy fell 43 to 44 s from 9470 m to 600 m. Fat Man about 43 s from a planned 9140 m to 503 m.
		near(flightFor('boy', 600).releaseS, 44, 0.08);
		near(flightFor('fat', 503).releaseS, 43, 0.08);
		// Tsar Bomba fell by parachute from 10.5 km to 4 km in about 188 s.
		near(flightFor('tsar', 4000).releaseS, 188, 0.1);
	});

	it('reaches the burst point for every weapon, even an awkward height', () => {
		for (const id of Object.keys(DELIVERY)) {
			for (const hob of [0, 500, 12000, 29000]) {
				const f = flightFor(id, hob);
				const end = f.at(0);
				expect(Math.abs(end.xM)).toBeLessThan(5);
				expect(f.durationS).toBeGreaterThan(0);
				expect(f.at(-f.durationS).altM).toBeGreaterThanOrEqual(end.altM - 1);
			}
		}
	});
});
