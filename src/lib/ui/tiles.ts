import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { Projection } from '#lib/game/projection.ts';

// Streams OpenStreetMap vector tiles from OpenFreeMap as the scope zooms in. Each
// tile is reprojected once into the scope's km coordinates and kept as Path2Ds, so
// redrawing while panning only changes a canvas transform.

const TILEJSON = 'https://tiles.openfreemap.org/planet';
export const MAX_TILE_Z = 14;
/** Below this the baked map is sharper and lighter than streaming tiles. */
export const MIN_TILE_Z = 8;
const TILE_PX = 512;
const MAX_CACHED = 160;
const MAX_VISIBLE = 30;
const MAX_ACTIVE_FETCHES = 8;

export type RoadClass = 'major' | 'mid' | 'minor' | 'service';

export interface Tile {
	z: number;
	x: number;
	y: number;
	/** The tile's own square, to clip the buffer that overlaps its neighbours. */
	frame: Path2D;
	water: Path2D;
	waterways: Path2D;
	green: Path2D;
	buildings: Path2D;
	roads: Record<RoadClass, Path2D>;
	rail: Path2D;
	runways: Path2D;
	borders: Path2D;
}

const RAD = Math.PI / 180;
const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const tileLat = (y: number, z: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) / RAD;
const lonToTile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const latToTile = (lat: number, z: number) =>
	((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * 2 ** z;

/** The tile zoom that shows about one tile pixel per screen pixel. */
export function tileZoomFor(pxPerKm: number, lat: number): number {
	const worldKm = 40075 * Math.max(0.05, Math.cos(lat * RAD));
	return Math.round(Math.log2((worldKm * pxPerKm) / TILE_PX));
}

const ROAD_CLASS: Record<string, RoadClass> = {
	motorway: 'major',
	trunk: 'major',
	primary: 'mid',
	secondary: 'mid',
	tertiary: 'minor',
	minor: 'minor',
	service: 'service',
	track: 'service'
};

function decode(buf: ArrayBuffer, z: number, x: number, y: number, proj: Projection): Tile {
	const vt = new VectorTile(new PbfReader(new Uint8Array(buf)));

	// Small tiles barely distort, so vertices interpolate from the corners. That
	// keeps a dense city tile with 100k vertices from stalling the display.
	const corner = (u: number, v: number) => proj.forward(tileLat(y + v, z), tileLon(x + u, z));
	const nw = corner(0, 0);
	const ne = corner(1, 0);
	const sw = corner(0, 1);
	const se = corner(1, 1);
	const place = (path: Path2D, g: { x: number; y: number }[], extent: number, close: boolean) => {
		for (let i = 0; i < g.length; i++) {
			const u = g[i].x / extent;
			const v = g[i].y / extent;
			let px: number;
			let py: number;
			if (z >= 11) {
				px = (1 - v) * ((1 - u) * nw[0] + u * ne[0]) + v * ((1 - u) * sw[0] + u * se[0]);
				py = (1 - v) * ((1 - u) * nw[1] + u * ne[1]) + v * ((1 - u) * sw[1] + u * se[1]);
			} else {
				[px, py] = proj.forward(tileLat(y + v, z), tileLon(x + u, z));
			}
			if (i === 0) path.moveTo(px, py);
			else path.lineTo(px, py);
		}
		if (close) path.closePath();
	};

	const tile: Tile = {
		z,
		x,
		y,
		frame: new Path2D(),
		water: new Path2D(),
		waterways: new Path2D(),
		green: new Path2D(),
		buildings: new Path2D(),
		roads: { major: new Path2D(), mid: new Path2D(), minor: new Path2D(), service: new Path2D() },
		rail: new Path2D(),
		runways: new Path2D(),
		borders: new Path2D()
	};
	place(
		tile.frame,
		[
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0, y: 1 }
		],
		1,
		true
	);

	const each = (
		name: string,
		fn: (geometry: { x: number; y: number }[][], props: Record<string, unknown>, extent: number, type: number) => void
	) => {
		const layer = vt.layers[name];
		if (!layer) return;
		for (let i = 0; i < layer.length; i++) {
			const f = layer.feature(i);
			fn(f.loadGeometry(), f.properties as Record<string, unknown>, layer.extent, f.type);
		}
	};

	each('water', (rings, _p, extent) => rings.forEach((r) => place(tile.water, r, extent, true)));
	each('waterway', (lines, _p, extent) => lines.forEach((l) => place(tile.waterways, l, extent, false)));
	each('park', (rings, _p, extent, type) => {
		if (type === 3) rings.forEach((r) => place(tile.green, r, extent, true));
	});
	each('building', (rings, _p, extent) => rings.forEach((r) => place(tile.buildings, r, extent, true)));
	each('aeroway', (geo, _p, extent, type) => geo.forEach((g) => place(tile.runways, g, extent, type === 3)));
	each('boundary', (lines, p, extent) => {
		if (Number(p.admin_level) <= 4) lines.forEach((l) => place(tile.borders, l, extent, false));
	});
	each('transportation', (lines, p, extent, type) => {
		if (type !== 2) return;
		const cls = String(p.class ?? '');
		const raw = cls.replace(/_construction$/, '');
		if (raw === 'rail' || raw === 'transit') {
			lines.forEach((l) => place(tile.rail, l, extent, false));
			return;
		}
		const road = ROAD_CLASS[raw];
		if (road) lines.forEach((l) => place(tile.roads[road], l, extent, false));
	});

	return tile;
}

export class TileStore {
	private template: string | null = null;
	private failed = false;
	private cache = new Map<string, Tile>();
	private pending = new Set<string>();
	private missing = new Set<string>();
	private queue: [number, number, number][] = [];
	private proj: Projection;
	private onLoad: () => void;

	constructor(proj: Projection, onLoad: () => void) {
		this.proj = proj;
		this.onLoad = onLoad;
		fetch(TILEJSON)
			.then((r) => r.json())
			.then((j) => {
				this.template = j.tiles[0];
				this.onLoad();
			})
			.catch(() => (this.failed = true));
	}

	get available() {
		return !this.failed;
	}

	private get(z: number, x: number, y: number): Tile | undefined {
		const key = `${z}/${x}/${y}`;
		const t = this.cache.get(key);
		if (t) {
			// Refresh its place in the eviction order.
			this.cache.delete(key);
			this.cache.set(key, t);
		}
		return t;
	}

	private pump() {
		while (this.template && this.pending.size < MAX_ACTIVE_FETCHES && this.queue.length) {
			const [z, x, y] = this.queue.shift()!;
			const key = `${z}/${x}/${y}`;
			if (this.cache.has(key) || this.pending.has(key) || this.missing.has(key)) continue;
			this.pending.add(key);
			const url = this.template.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`);
			fetch(url)
				.then((r) => {
					if (!r.ok) throw new Error(`${r.status}`);
					return r.arrayBuffer();
				})
				.then((buf) => {
					this.cache.set(key, decode(buf, z, x, y, this.proj));
					if (this.cache.size > MAX_CACHED) {
						const oldest = this.cache.keys().next().value;
						if (oldest) this.cache.delete(oldest);
					}
					this.onLoad();
				})
				.catch(() => this.missing.add(key))
				.finally(() => {
					this.pending.delete(key);
					this.pump();
				});
		}
	}

	/**
	 * Tiles to draw for a view, given points around its edge. Anything still in
	 * flight falls back to a loaded ancestor so the view never blanks.
	 */
	view(z: number, edge: [number, number][]): { tiles: Tile[]; complete: boolean } {
		let x0 = Infinity;
		let x1 = -Infinity;
		let y0 = Infinity;
		let y1 = -Infinity;
		for (const [lat, lon] of edge) {
			const x = lonToTile(lon, z);
			const y = latToTile(Math.max(-85, Math.min(85, lat)), z);
			x0 = Math.min(x0, x);
			x1 = Math.max(x1, x);
			y0 = Math.min(y0, y);
			y1 = Math.max(y1, y);
		}
		const minX = Math.floor(x0);
		const maxX = Math.floor(x1);
		const minY = Math.floor(y0);
		const maxY = Math.floor(y1);
		if ((maxX - minX + 1) * (maxY - minY + 1) > MAX_VISIBLE) return { tiles: [], complete: false };

		const tiles = new Map<string, Tile>();
		const wanted: [number, number, number][] = [];
		let complete = true;
		for (let x = minX; x <= maxX; x++) {
			for (let y = minY; y <= maxY; y++) {
				const t = this.get(z, x, y);
				if (t) {
					tiles.set(`${z}/${x}/${y}`, t);
					continue;
				}
				complete = false;
				wanted.push([z, x, y]);
				for (let up = 1; up <= 4 && z - up >= MIN_TILE_Z - 2; up++) {
					const parent = this.get(z - up, x >> up, y >> up);
					if (parent) {
						tiles.set(`${parent.z}/${parent.x}/${parent.y}`, parent);
						break;
					}
				}
			}
		}
		// Only what is on screen now is worth fetching.
		this.queue = wanted;
		this.pump();
		// Coarse parents draw first so that finer tiles land on top.
		return { tiles: [...tiles.values()].sort((a, b) => a.z - b.z), complete };
	}
}
