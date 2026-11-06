// Builds static/data/weather-<theatre>.json: real historical weather at a spread of points on each map, for several dates.
// Usage: node scripts/build-weather.ts [theatre ids...]   (already built theatres are kept)
//
// Weather data by Open-Meteo.com (CC BY 4.0), from ERA5 reanalysis, Copernicus Climate Change Service.
// Dates fall in the Cold War and are fixed by the seed, so a rebuild gives the same dates.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { rngFor } from '../src/lib/game/rng.ts';
import { THEATRES, type Theatre } from '../src/lib/game/theatres.ts';

const outDir = 'static/data';
mkdirSync(outDir, { recursive: true });
const DATES_PER_MAP = 8;
const FIRST_YEAR = 1950;
const LAST_YEAR = 1991;
const VARS = 'temperature_2m,relative_humidity_2m,weather_code,cloud_cover,wind_speed_100m,wind_direction_100m';
const LOCAL_HOUR = 12;
/** A call costs its share of the free tier's limit, so go gently. */
const PAUSE_MS = 2500;

const EARTH_KM = 6371;
const RAD = Math.PI / 180;

/** The point a distance away along a bearing. */
function destination(lat: number, lon: number, bearing: number, km: number): [number, number] {
	const d = km / EARTH_KM;
	const a = lat * RAD;
	const b = bearing * RAD;
	const lat2 = Math.asin(Math.sin(a) * Math.cos(d) + Math.cos(a) * Math.sin(d) * Math.cos(b));
	const lon2 = lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(a), Math.cos(d) - Math.sin(a) * Math.sin(lat2));
	return [lat2 / RAD, ((lon2 / RAD + 540) % 360) - 180];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Rings of points around the map's centre. More rings for larger maps, since weather varies more across them. */
function stations(t: Theatre): [number, number][] {
	const rings: [number, number][] = t.kind === 'city' ? [[0.7, 8]] : t.kind === 'region' ? [[0.45, 8], [0.92, 12]] : [[0.33, 12], [0.66, 16], [0.97, 24]];
	const out: [number, number][] = [[t.lat, t.lon]];
	for (const [share, count] of rings) {
		for (let i = 0; i < count; i++) {
			const [lat, lon] = destination(t.lat, t.lon, (i * 360) / count, t.radiusKm * share);
			out.push([+lat.toFixed(2), +lon.toFixed(2)]);
		}
	}
	return out;
}

function datesFor(t: Theatre): string[] {
	const rng = rngFor(t.id.charCodeAt(0) * 97 + t.id.charCodeAt(1) * 31 + (t.id.charCodeAt(2) || 0), 'weather-dates');
	const out: string[] = [];
	for (let i = 0; i < DATES_PER_MAP; i++) {
		const year = FIRST_YEAR + Math.floor(rng() * (LAST_YEAR - FIRST_YEAR + 1));
		// One date from each eighth of the year, so every map sees every season.
		const yearDay = Math.floor(((i + rng()) / DATES_PER_MAP) * 365);
		out.push(new Date(Date.UTC(year, 0, 1 + yearDay)).toISOString().slice(0, 10));
	}
	return out;
}

async function fetchDay(points: [number, number][], date: string): Promise<number[][]> {
	const url =
		`https://archive-api.open-meteo.com/v1/archive?latitude=${points.map((p) => p[0]).join(',')}&longitude=${points.map((p) => p[1]).join(',')}` +
		`&start_date=${date}&end_date=${date}&hourly=${VARS}&timezone=auto&wind_speed_unit=kmh`;
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(url);
		if (res.ok) {
			const body = await res.json();
			const list = Array.isArray(body) ? body : [body];
			return list.map((d, i) => {
				const h = d.hourly;
				const at = LOCAL_HOUR;
				// lat, lon, temperature °C, humidity %, weather code, cloud %, wind km/h at 100 m, direction it blows from.
				return [points[i][0], points[i][1], h.temperature_2m[at], h.relative_humidity_2m[at], h.weather_code[at], h.cloud_cover[at], h.wind_speed_100m[at], h.wind_direction_100m[at]];
			});
		}
		if (attempt >= 6) throw new Error(`${res.status} ${await res.text()}`);
		const wait = res.status === 429 ? 70000 * (attempt + 1) : 5000;
		console.log(`  ${res.status}, waiting ${wait / 1000} s`);
		await sleep(wait);
	}
}

const only = process.argv.slice(2);
for (const t of THEATRES) {
	if (only.length && !only.includes(t.id)) continue;
	const file = `${outDir}/weather-${t.id}.json`;
	if (existsSync(file)) continue;
	const points = stations(t);
	const days: { date: string; rows: number[][] }[] = [];
	for (const date of datesFor(t)) {
		days.push({ date, rows: await fetchDay(points, date) });
		console.log(t.id, date, points.length);
		await sleep(PAUSE_MS);
	}
	writeFileSync(file, JSON.stringify({ hour: LOCAL_HOUR, days }));
}
console.log('done');
