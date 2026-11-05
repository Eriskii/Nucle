// Builds static/data/<theatre>.bin and .json from GHSL rasters and Natural Earth.
// Usage: node scripts/build-data.ts <dir with pop/, built/ and geojson files>
//
// GHS-POP / GHS-BUILT-S R2023A (European Commission JRC, CC BY 4.0).
// Coastlines, lakes, rivers, roads, rail, urban areas and places from Natural
// Earth (public domain). Street-level detail is streamed at runtime, see src/lib/ui/tiles.ts.

import { mkdirSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fromFile } from 'geotiff';
import { mesh } from 'topojson-client';
import { THEATRES, type Theatre } from '../src/lib/game/theatres.ts';

const srcDir = process.argv[2];
if (!srcDir) throw new Error('pass the source data directory');
const outDir = 'static/data';
mkdirSync(outDir, { recursive: true });

const MAX_POINTS = 16000;
const CELL_DEG = 1 / 120;
/** Average footprint assumed per structure, to turn built m² into a count. */
const M2_PER_STRUCTURE = 150;
const RAD = Math.PI / 180;
const EARTH_KM = 6371;

const tifIn = (dir: string) => {
	const name = readdirSync(join(srcDir, dir)).find((f) => f.endsWith('.tif'));
	if (!name) throw new Error(`no tif in ${dir}`);
	return join(srcDir, dir, name);
};

const popTiff = await fromFile(tifIn('pop'));
const builtTiff = await fromFile(tifIn('built'));
const popImg = await popTiff.getImage();
const builtImg = await builtTiff.getImage();
const width = popImg.getWidth();
const height = popImg.getHeight();
const [originLon, originLat] = popImg.getOrigin();
console.log(`raster ${width}x${height} origin ${originLon},${originLat}`);

const distKm = (aLat: number, aLon: number, bLat: number, bLon: number) => {
	const a = Math.sin(((bLat - aLat) * RAD) / 2) ** 2;
	const b = Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(((bLon - aLon) * RAD) / 2) ** 2;
	return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a + b)));
};

/** Pixel windows covering the theatre circle. */
function windows(t: Theatre): [number, number, number, number][] {
	if (t.kind === 'world') {
		const maxRow = Math.ceil((originLat - (90 - t.radiusKm / 111.2)) * 120);
		return [[0, 0, width, Math.min(height, maxRow)]];
	}
	const dLat = t.radiusKm / 111.2;
	const dLon = dLat / Math.max(0.15, Math.cos(Math.min(85, Math.abs(t.lat) + dLat) * RAD));
	const clampRow = (v: number) => Math.max(0, Math.min(height, v));
	const row0 = clampRow(Math.floor((originLat - (t.lat + dLat)) * 120));
	const row1 = clampRow(Math.ceil((originLat - (t.lat - dLat)) * 120));
	const col0 = Math.floor((t.lon - dLon - originLon) * 120);
	const col1 = Math.ceil((t.lon + dLon - originLon) * 120);
	const clamped = (a: number, b: number): [number, number, number, number] => [
		Math.max(0, a),
		row0,
		Math.min(width, b),
		row1
	];
	return [clamped(col0, col1)];
}

interface Cell {
	lat: number;
	lon: number;
	pop: number;
	built: number;
}

async function readCells(t: Theatre): Promise<Cell[]> {
	const f = t.cellFactor;
	const cells = new Map<number, Cell>();
	for (const [x0, y0, x1, y1] of windows(t)) {
		// Read in bands so the hemisphere theatre does not need gigabytes of RAM.
		const bandRows = 1200;
		for (let y = y0; y < y1; y += bandRows) {
			const win = [x0, y, x1, Math.min(y1, y + bandRows)];
			const [pop] = (await popImg.readRasters({ window: win })) as unknown as [ArrayLike<number>];
			const [built] = (await builtImg.readRasters({ window: win })) as unknown as [ArrayLike<number>];
			const w = win[2] - win[0];
			const h = win[3] - win[1];
			for (let r = 0; r < h; r++) {
				const row = win[1] + r;
				const lat = originLat - (row + 0.5) * CELL_DEG;
				for (let c = 0; c < w; c++) {
					const i = r * w + c;
					const p = pop[i];
					const b = built[i];
					if (!(p > 0) && !(b > 0)) continue;
					const col = win[0] + c;
					const lon = originLon + (col + 0.5) * CELL_DEG;
					if (t.kind !== 'world' && distKm(t.lat, t.lon, lat, lon) > t.radiusKm) continue;
					if (t.kind === 'world' && 90 - lat > t.radiusKm / 111.2) continue;
					const key = Math.floor(row / f) * 100000 + Math.floor(col / f);
					let cell = cells.get(key);
					if (!cell) {
						cell = {
							lat: originLat - (Math.floor(row / f) + 0.5) * f * CELL_DEG,
							lon: originLon + (Math.floor(col / f) + 0.5) * f * CELL_DEG,
							pop: 0,
							built: 0
						};
						cells.set(key, cell);
					}
					cell.pop += Math.max(0, p || 0);
					cell.built += Math.max(0, b || 0);
				}
			}
		}
	}
	return [...cells.values()];
}

// Natural Earth vectors.
const countries = JSON.parse(readFileSync('node_modules/world-atlas/countries-10m.json', 'utf8'));
const coast = mesh(countries, countries.objects.countries, (a: unknown, b: unknown) => a === b);
const borders = mesh(countries, countries.objects.countries, (a: unknown, b: unknown) => a !== b);
const lakesRaw = JSON.parse(readFileSync(join(srcDir, 'lakes.geojson'), 'utf8'));
const riversRaw = JSON.parse(readFileSync(join(srcDir, 'rivers.geojson'), 'utf8'));
const placesRaw = JSON.parse(readFileSync(join(srcDir, 'places.geojson'), 'utf8'));

const collectLines = (fc: any): number[][][] => {
	const out: number[][][] = [];
	for (const f of fc.features) {
		const g = f.geometry;
		if (!g) continue;
		if (g.type === 'LineString') out.push(g.coordinates);
		else if (g.type === 'MultiLineString') out.push(...g.coordinates);
		else if (g.type === 'Polygon') out.push(...g.coordinates);
		else if (g.type === 'MultiPolygon') for (const p of g.coordinates) out.push(...p);
	}
	return out;
};
const lakes = collectLines(lakesRaw);
const rivers = collectLines(riversRaw);
const neLayer = (name: string) => collectLines(JSON.parse(readFileSync(join(srcDir, `${name}.geojson`), 'utf8')));
const neRoads = JSON.parse(readFileSync(join(srcDir, 'roads.geojson'), 'utf8'));
const roadsWhere = (test: (type: string, rank: number) => boolean) =>
	collectLines({
		features: neRoads.features.filter((f: any) => test(String(f.properties.type ?? ''), Number(f.properties.scalerank ?? 9)))
	});
const neMajor = roadsWhere((type) => /major|beltway/i.test(type));
const neMinor = roadsWhere((type) => /secondary/i.test(type));
const neRail = neLayer('rail');
const neUrban = neLayer('urban');
const neAdmin = neLayer('admin');

/** Clip polylines to the theatre circle, thinning points to the display scale. */
function clipLines(lines: number[][][], t: Theatre, minKm: number): number[][] {
	const inside = (lon: number, lat: number) =>
		t.kind === 'world'
			? 90 - lat <= t.radiusKm / 111.2 + 1
			: distKm(t.lat, t.lon, lat, lon) <= t.radiusKm * 1.03;
	const prec = t.kind === 'city' ? 1000 : t.kind === 'region' ? 100 : 20;
	const out: number[][] = [];
	for (const line of lines) {
		let cur: number[] = [];
		let lastLat = 0;
		let lastLon = 0;
		const flush = () => {
			if (cur.length >= 4) out.push(cur);
			cur = [];
		};
		line.forEach(([lon, lat], i) => {
			if (!inside(lon, lat)) {
				flush();
				return;
			}
			const end = i === line.length - 1;
			if (cur.length && !end && distKm(lastLat, lastLon, lat, lon) < minKm) return;
			cur.push(Math.round(lon * prec) / prec, Math.round(lat * prec) / prec);
			lastLat = lat;
			lastLon = lon;
		});
		flush();
	}
	return out;
}

const only = process.argv[3]?.split(',');
for (const t of THEATRES) {
	if (only && !only.includes(t.id)) continue;
	const started = Date.now();
	const cells = await readCells(t);
	const totalPop = cells.reduce((s, c) => s + c.pop, 0);
	const totalBuilt = cells.reduce((s, c) => s + c.built, 0);
	// Keep the cells that matter most. Scored together so built-up but
	// sparsely resident cells like ports and airports survive the cut.
	const weigh = (c: Cell) => c.pop / totalPop + c.built / totalBuilt;
	cells.sort((a, b) => weigh(b) - weigh(a));
	const kept = cells.slice(0, MAX_POINTS);
	kept.sort((a, b) => b.lat - a.lat || a.lon - b.lon);

	const step = t.cellFactor * CELL_DEG;
	const minLat = Math.min(...kept.map((c) => c.lat));
	const minLon = Math.min(...kept.map((c) => c.lon));
	const buf = Buffer.alloc(kept.length * 8);
	kept.forEach((c, i) => {
		buf.writeUInt16LE(Math.round((c.lat - minLat) / step), i * 8);
		buf.writeUInt16LE(Math.round((c.lon - minLon) / step), i * 8 + 2);
		buf.writeUInt16LE(Math.min(65535, Math.round(Math.log1p(c.pop) * 3000)), i * 8 + 4);
		buf.writeUInt16LE(Math.min(65535, Math.round(Math.log1p(c.built / M2_PER_STRUCTURE) * 3000)), i * 8 + 6);
	});
	writeFileSync(join(outDir, `${t.id}.bin`), buf);

	const minKm = t.radiusKm / 700;
	const line = (lines: number[][][], km = minKm) => clipLines(lines, t, km);
	const places = placesRaw.features
		.map((f: any) => {
			const [lon, lat] = f.geometry.coordinates;
			return {
				name: String(f.properties.nameascii ?? f.properties.name).toUpperCase(),
				lat: +lat.toFixed(3),
				lon: +lon.toFixed(3),
				pop: f.properties.pop_max ?? 0
			};
		})
		.filter((p: any) =>
			t.kind === 'world' ? 90 - p.lat <= t.radiusKm / 111.2 : distKm(t.lat, t.lon, p.lat, p.lon) <= t.radiusKm * 0.97
		)
		.sort((a: any, b: any) => b.pop - a.pop)
		.slice(0, t.kind === 'city' ? 60 : 220);

	const meta = {
		n: kept.length,
		minLat,
		minLon,
		step,
		cellKm: step * 111.2 * (t.kind === 'world' ? 0.7 : Math.cos(t.lat * RAD)),
		totalPop: Math.round(kept.reduce((s, c) => s + c.pop, 0)),
		totalStructures: Math.round(kept.reduce((s, c) => s + c.built, 0) / M2_PER_STRUCTURE),
		coast: line(coast.coordinates as number[][][]),
		borders: line(borders.coordinates as number[][][]),
		lakes: t.kind === 'world' ? [] : line(lakes),
		rivers: t.kind === 'world' ? [] : line(rivers),
		roads: t.kind === 'world' ? [] : line(neMajor),
		minorRoads: t.kind === 'world' ? [] : line(neMinor),
		rail: t.kind === 'world' ? [] : line(neRail),
		admin: t.kind === 'city' ? [] : line(neAdmin),
		urban: t.kind === 'world' ? [] : line(neUrban),
		places
	};
	writeFileSync(join(outDir, `${t.id}.json`), JSON.stringify(meta));
	const size = statSync(join(outDir, `${t.id}.json`)).size;
	console.log(
		`${t.id}: ${kept.length}/${cells.length} cells, pop ${(meta.totalPop / 1e6).toFixed(1)}M of ${(totalPop / 1e6).toFixed(1)}M, ` +
			`structures ${(meta.totalStructures / 1e6).toFixed(1)}M, meta ${(size / 1024).toFixed(0)} KB, ${Date.now() - started} ms`
	);
}
