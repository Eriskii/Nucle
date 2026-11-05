import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import type { Projection } from '#lib/game/projection.ts';

// Streams OpenStreetMap vector tiles from OpenFreeMap as the scope zooms in. Each
// tile is reprojected once into the scope's km coordinates and kept as Path2Ds, so
// redrawing while panning only changes a canvas transform.

const TILEJSON = 'https://tiles.openfreemap.org/planet';
export const MAX_TILE_Z = 14;
/** Lower than this, tiles hold too little to be worth showing. */
export const MIN_TILE_Z = 3;
/** The only level that carries building footprints here. */
export const BUILDING_TILE_Z = 14;
const TILE_PX = 512;
const MAX_CACHED = 260;
const MAX_ACTIVE_FETCHES = 8;
/** Water narrower than this counts as a pond. */
const POND_KM = 1.5;

/** How many tiles a view may use. Tiles with buildings are many times heavier. */
export const tileBudget = (z: number) => (z >= BUILDING_TILE_Z ? 24 : 96);

export type RoadClass = 'major' | 'mid' | 'minor' | 'service';

export interface Tile {
	z: number;
	x: number;
	y: number;
	/** The tile's own square, to clip the buffer that overlaps its neighbours. */
	frame: Path2D;
	water: Path2D;
	/** Shoreline only, without the edges water polygons get where tiles cut them. */
	shore: Path2D;
	/** Shoreline of small bodies of water, shown once there's room for them. */
	ponds: Path2D;
	waterways: Path2D;
	green: Path2D;
	buildings: Path2D;
	roads: Record<RoadClass, Path2D>;
	rail: Path2D;
	runways: Path2D;
	borders: Path2D;
}

/** A tile to draw, and the part of it to draw if finer tiles cover the rest. */
export interface TileLayer {
	tile: Tile;
	clip: Path2D | null;
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
	const project = (p: { x: number; y: number }, extent: number): [number, number] => {
		const u = p.x / extent;
		const v = p.y / extent;
		if (z >= 11) {
			return [
				(1 - v) * ((1 - u) * nw[0] + u * ne[0]) + v * ((1 - u) * sw[0] + u * se[0]),
				(1 - v) * ((1 - u) * nw[1] + u * ne[1]) + v * ((1 - u) * sw[1] + u * se[1])
			];
		}
		return proj.forward(tileLat(y + v, z), tileLon(x + u, z));
	};
	const place = (path: Path2D, g: { x: number; y: number }[], extent: number, close: boolean) => {
		for (let i = 0; i < g.length; i++) {
			const [px, py] = project(g[i], extent);
			if (i === 0) path.moveTo(px, py);
			else path.lineTo(px, py);
		}
		if (close) path.closePath();
	};
	/** Outlines a water ring, skipping stretches that only follow the tile's edge. */
	const shoreline = (g: { x: number; y: number }[], extent: number) => {
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (const p of g) {
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
		}
		const tileKm = Math.hypot(ne[0] - nw[0], ne[1] - nw[1]);
		const spanKm = (Math.max(maxX - minX, maxY - minY) / extent) * tileKm;
		const path = spanKm >= POND_KM ? tile.shore : tile.ponds;
		const m = extent * 0.002;
		const onEdge = (a: { x: number; y: number }, b: { x: number; y: number }) =>
			(a.x <= m && b.x <= m) ||
			(a.y <= m && b.y <= m) ||
			(a.x >= extent - m && b.x >= extent - m) ||
			(a.y >= extent - m && b.y >= extent - m);
		let drawing = false;
		for (let i = 0; i < g.length; i++) {
			const a = g[i];
			const b = g[(i + 1) % g.length];
			if (i === g.length - 1 && a.x === g[0].x && a.y === g[0].y) break;
			if (onEdge(a, b)) {
				drawing = false;
				continue;
			}
			if (!drawing) {
				const [sx, sy] = project(a, extent);
				path.moveTo(sx, sy);
				drawing = true;
			}
			const [ex, ey] = project(b, extent);
			path.lineTo(ex, ey);
		}
	};

	const tile: Tile = {
		z,
		x,
		y,
		frame: new Path2D(),
		water: new Path2D(),
		shore: new Path2D(),
		ponds: new Path2D(),
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

	each('water', (rings, _p, extent) =>
		rings.forEach((r) => {
			place(tile.water, r, extent, true);
			shoreline(r, extent);
		})
	);
	each('waterway', (lines, _p, extent) => lines.forEach((l) => place(tile.waterways, l, extent, false)));
	each('park', (rings, _p, extent, type) => {
		if (type === 3) rings.forEach((r) => place(tile.green, r, extent, true));
	});
	if (z >= BUILDING_TILE_Z) each('building', (rings, _p, extent) => rings.forEach((r) => place(tile.buildings, r, extent, true)));
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
	private decodes: { buf: ArrayBuffer; z: number; x: number; y: number }[] = [];
	private decoding = false;
	private decodingKey = '';
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
			if (this.cache.has(key) || this.pending.has(key) || this.missing.has(key) || this.decodes.some((d) => `${d.z}/${d.x}/${d.y}` === key) || this.decodingKey === key) continue;
			this.pending.add(key);
			const url = this.template.replace('{z}', `${z}`).replace('{x}', `${x}`).replace('{y}', `${y}`);
			fetch(url)
				.then((r) => {
					if (!r.ok) throw new Error(`${r.status}`);
					return r.arrayBuffer();
				})
				.then((buf) => {
					this.decodes.push({ buf, z, x, y });
					this.drainDecodes();
				})
				.catch(() => this.missing.add(key))
				.finally(() => {
					this.pending.delete(key);
					this.pump();
				});
		}
	}

	/** One tile per task, so a burst of arrivals can't stall the display. */
	private drainDecodes() {
		if (this.decoding) return;
		const next = this.decodes.shift();
		if (!next) return;
		this.decoding = true;
		this.decodingKey = `${next.z}/${next.x}/${next.y}`;
		setTimeout(() => {
			const { buf, z, x, y } = next;
			try {
				this.cache.set(`${z}/${x}/${y}`, decode(buf, z, x, y, this.proj));
				while (this.cache.size > MAX_CACHED) {
					const oldest = this.cache.keys().next().value;
					if (!oldest) break;
					this.cache.delete(oldest);
				}
				this.onLoad();
			} catch {
				this.missing.add(`${z}/${x}/${y}`);
			}
			this.decoding = false;
			this.decodingKey = '';
			this.drainDecodes();
		}, 0);
	}

	/** The tiles at a level that touch the view, nearest the centre first. */
	tilesFor(z: number, edge: [number, number][], keep: (lat: number, lon: number, halfKm: number) => boolean): [number, number][] {
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
		const midX = (x0 + x1) / 2;
		const midY = (y0 + y1) / 2;
		const out: [number, number][] = [];
		const n = 2 ** z;
		for (let x = Math.floor(x0); x <= Math.floor(x1); x++) {
			for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(n - 1, Math.floor(y1)); y++) {
				const lat = tileLat(y + 0.5, z);
				const halfKm = (0.75 * 40075 * Math.cos(lat * RAD)) / n;
				if (keep(lat, tileLon(x + 0.5, z), halfKm)) out.push([x, y]);
			}
		}
		return out.sort((a, b) => Math.hypot(a[0] + 0.5 - midX, a[1] + 0.5 - midY) - Math.hypot(b[0] + 0.5 - midX, b[1] + 0.5 - midY));
	}

	/**
	 * Tiles to draw for a view, given points around its edge. Anything still in
	 * flight falls back to a loaded ancestor so the view never blanks.
	 */
	view(z: number, wanted: [number, number][]): { layers: TileLayer[]; covered: boolean; complete: boolean } {
		const exact: TileLayer[] = [];
		const parents = new Map<Tile, Path2D>();
		const fetchNow: [number, number, number][] = [];
		const coarse = new Map<string, [number, number, number]>();
		let covered = true;
		for (const [x, y] of wanted) {
			const t = this.get(z, x, y);
			if (t) {
				exact.push({ tile: t, clip: null });
				continue;
			}
			fetchNow.push([z, x, y]);
			let parentFound = false;
			for (let up = 1; up <= 6 && z - up >= 2; up++) {
				const parent = this.get(z - up, x >> up, y >> up);
				if (parent) {
					// Only where the child is missing, or the two would draw double-bright.
					let clip = parents.get(parent);
					if (!clip) {
						clip = new Path2D();
						parents.set(parent, clip);
					}
					clip.addPath(this.square(z, x, y));
					parentFound = true;
					break;
				}
			}
			if (!parentFound) covered = false;
			// A light tile three levels up arrives fast and underlays the slower detail.
			const up = Math.min(3, z - 2);
			if (up > 0) coarse.set(`${x >> up}/${y >> up}`, [z - up, x >> up, y >> up]);
		}
		// Only what is on screen now is worth fetching.
		this.queue = [...coarse.values(), ...fetchNow];
		this.pump();
		const under = [...parents.entries()].map(([tile, clip]) => ({ tile, clip })).sort((a, b) => a.tile.z - b.tile.z);
		return { layers: [...under, ...exact], covered, complete: fetchNow.length === 0 };
	}

	private square(z: number, x: number, y: number): Path2D {
		const p = new Path2D();
		[
			[x, y],
			[x + 1, y],
			[x + 1, y + 1],
			[x, y + 1]
		].forEach(([tx, ty], i) => {
			const [px, py] = this.proj.forward(tileLat(ty, z), tileLon(tx, z));
			if (i === 0) p.moveTo(px, py);
			else p.lineTo(px, py);
		});
		p.closePath();
		return p;
	}
}
