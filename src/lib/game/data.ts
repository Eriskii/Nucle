import type { PopGrid } from './sim';
import type { WeatherFile } from './weatherfield';

export interface Place {
	name: string;
	lat: number;
	lon: number;
	pop: number;
	/** Russian name, where Natural Earth has one. */
	ru?: string;
}

export interface TheatreMeta {
	n: number;
	minLat: number;
	minLon: number;
	step: number;
	cellKm: number;
	totalPop: number;
	totalStructures: number;
	/** Flat [lon, lat, lon, lat, ...] polylines. */
	coast: number[][];
	borders: number[][];
	lakes: number[][];
	rivers: number[][];
	roads: number[][];
	minorRoads: number[][];
	rail: number[][];
	admin: number[][];
	urban: number[][];
	places: Place[];
}

export interface TheatreData {
	meta: TheatreMeta;
	grid: PopGrid;
	weather?: WeatherFile;
}

export function decodeGrid(meta: TheatreMeta, buf: ArrayBuffer): PopGrid {
	const view = new DataView(buf);
	const n = meta.n;
	const lat = new Float32Array(n);
	const lon = new Float32Array(n);
	const pop = new Float32Array(n);
	const structures = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		lat[i] = meta.minLat + view.getUint16(i * 8, true) * meta.step;
		lon[i] = meta.minLon + view.getUint16(i * 8 + 2, true) * meta.step;
		pop[i] = Math.expm1(view.getUint16(i * 8 + 4, true) / 3000);
		structures[i] = Math.expm1(view.getUint16(i * 8 + 6, true) / 3000);
	}
	return {
		n,
		lat,
		lon,
		pop,
		structures,
		cellKm: meta.cellKm,
		totalPop: meta.totalPop,
		totalStructures: meta.totalStructures
	};
}

export async function loadTheatre(
	id: string,
	fetcher: typeof fetch,
	urlFor: (file: string) => string
): Promise<TheatreData> {
	const [metaRes, binRes, weatherRes] = await Promise.all([
		fetcher(urlFor(`data/${id}.json`)),
		fetcher(urlFor(`data/${id}.bin`)),
		fetcher(urlFor(`data/weather-${id}.json`))
	]);
	// Without its weather a puzzle would differ from everyone else's, so this is as fatal as the map being missing.
	if (!metaRes.ok || !binRes.ok || !weatherRes.ok) throw new Error(`could not load theatre ${id}`);
	const meta = (await metaRes.json()) as TheatreMeta;
	return { meta, grid: decodeGrid(meta, await binRes.arrayBuffer()), weather: (await weatherRes.json()) as WeatherFile };
}
