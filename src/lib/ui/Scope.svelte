<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { TheatreMeta } from '#lib/game/data.ts';
	import { falloutBands, ringsFor, empKm, type PlumeBand } from '#lib/game/effects.ts';
	import { destination, Projection } from '#lib/game/projection.ts';
	import { toBurst, type Placement, type Scenario, type Zone } from '#lib/game/scenario.ts';
	import type { PopGrid } from '#lib/game/sim.ts';
	import type { TheatreKind } from '#lib/game/theatres.ts';
	import { MAX_TILE_Z, MIN_TILE_Z, TileStore, tileZoomFor, type Tile } from './tiles.ts';

	interface Props {
		scenario: Scenario;
		meta: TheatreMeta;
		grid: PopGrid;
		placements: Placement[];
		selected: number | null;
		damage: Float32Array | null;
		showRings: boolean;
		showFallout: boolean;
		showDensity: boolean;
		locked: boolean;
		/** Increments to play the strike animation. */
		playToken: number;
		onplace: (lat: number, lon: number) => void;
		onmove: (slot: number, lat: number, lon: number) => void;
		onselect: (slot: number) => void;
		onplayed: () => void;
	}

	let {
		scenario,
		meta,
		grid,
		placements,
		selected,
		damage,
		showRings,
		showFallout,
		showDensity,
		locked,
		playToken,
		onplace,
		onmove,
		onselect,
		onplayed
	}: Props = $props();

	// P7 radar phosphor: a blue-white flash that decays to yellow-green.
	const FLASH = '#dcefff';
	const PHOSPHOR = '#86f7b0';
	const PHOSPHOR_DIM = 'rgba(134, 247, 176, 0.42)';
	const DECAY = '#b9d873';
	const AMBER = '#ffc24a';
	const ALERT = '#ff6a45';

	const STIPPLE_FROM_PX = 9;

	let wrap: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let size = $state(600);
	let cursor = $state<{ lat: number; lon: number } | null>(null);

	let zoom = $state(1);
	let cx = $state(0);
	let cy = $state(0);

	const proj = $derived(new Projection(scenario.theatre.lat, scenario.theatre.lon));
	const radius = $derived(scenario.theatre.radiusKm);
	// Deep enough to pick out individual buildings, about a metre to the pixel.
	const MAX_PX_PER_KM = 1100;
	const maxZoom = $derived((MAX_PX_PER_KM * radius) / ((size / 2) * 0.97));
	const pxPerKm = $derived(((size / 2) * 0.97 * zoom) / radius);

	const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

	function toScreen(lat: number, lon: number): [number, number] {
		const [x, y] = proj.forward(lat, lon);
		return [size / 2 + (x - cx) * pxPerKm, size / 2 - (y - cy) * pxPerKm];
	}

	function fromScreen(px: number, py: number): [number, number] {
		const x = (px - size / 2) / pxPerKm + cx;
		const y = -(py - size / 2) / pxPerKm + cy;
		return proj.inverse(x, y);
	}

	const panLimit = () => radius * (1 - 1 / zoom);

	function clampPan() {
		const limit = panLimit();
		cx = Math.max(-limit, Math.min(limit, cx));
		cy = Math.max(-limit, Math.min(limit, cy));
	}

	function zoomBy(f: number, px = size / 2, py = size / 2) {
		const next = Math.max(1, Math.min(maxZoom, zoom * f));
		const before = [(px - size / 2) / pxPerKm + cx, -(py - size / 2) / pxPerKm + cy];
		zoom = next;
		const k = ((size / 2) * 0.97 * next) / radius;
		cx = before[0] - (px - size / 2) / k;
		cy = before[1] + (py - size / 2) / k;
		clampPan();
	}

	function recenter() {
		zoom = 1;
		cx = 0;
		cy = 0;
	}

	// Vector layers are projected once per theatre, so panning only rescales numbers.
	interface Line {
		pts: Float64Array;
		minX: number;
		maxX: number;
		minY: number;
		maxY: number;
	}
	const prepare = (lines: number[][]): Line[] =>
		lines.map((flat) => {
			const pts = new Float64Array(flat.length);
			let minX = Infinity;
			let maxX = -Infinity;
			let minY = Infinity;
			let maxY = -Infinity;
			for (let i = 0; i + 1 < flat.length; i += 2) {
				const [x, y] = proj.forward(flat[i + 1], flat[i]);
				pts[i] = x;
				pts[i + 1] = y;
				minX = Math.min(minX, x);
				maxX = Math.max(maxX, x);
				minY = Math.min(minY, y);
				maxY = Math.max(maxY, y);
			}
			return { pts, minX, maxX, minY, maxY };
		});
	const layers = $derived({
		coast: prepare(meta.coast),
		borders: prepare(meta.borders),
		lakes: prepare(meta.lakes),
		rivers: prepare(meta.rivers),
		roads: prepare(meta.roads),
		minorRoads: prepare(meta.minorRoads),
		rail: prepare(meta.rail),
		admin: prepare(meta.admin),
		urban: prepare(meta.urban)
	});
	const gridXY = $derived.by(() => {
		const xy = new Float64Array(grid.n * 2);
		for (let i = 0; i < grid.n; i++) {
			const [x, y] = proj.forward(grid.lat[i], grid.lon[i]);
			xy[i * 2] = x;
			xy[i * 2 + 1] = y;
		}
		return xy;
	});

	// The map is cached to an offscreen canvas and only redrawn when the view changes.
	let base: HTMLCanvasElement | null = null;
	let sweepBuf: HTMLCanvasElement | null = null;
	let baseStale = true;
	let interacting = false;
	let settle = 0;

	function drawLines(ctx: CanvasRenderingContext2D, lines: Line[], color: string, width: number, dash: number[] = []) {
		const halfKm = size / 2 / pxPerKm;
		const left = cx - halfKm;
		const right = cx + halfKm;
		const bottom = cy - halfKm;
		const top = cy + halfKm;
		const mid = size / 2;
		ctx.strokeStyle = color;
		ctx.lineWidth = width;
		ctx.setLineDash(dash);
		ctx.beginPath();
		for (const l of lines) {
			if (l.maxX < left || l.minX > right || l.maxY < bottom || l.minY > top) continue;
			for (let i = 0; i + 1 < l.pts.length; i += 2) {
				const x = mid + (l.pts[i] - cx) * pxPerKm;
				const y = mid - (l.pts[i + 1] - cy) * pxPerKm;
				if (i === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
		}
		ctx.stroke();
		ctx.setLineDash([]);
	}

	function niceRing(km: number): number {
		const mag = Math.pow(10, Math.floor(Math.log10(km)));
		for (const m of [1, 2, 5, 10]) if (mag * m >= km) return mag * m;
		return mag * 10;
	}

	const BUILDINGS_FROM_Z = 13;
	const MAJOR_LABELS: Record<TheatreKind, number> = { city: 1, region: 8, world: 12 };

	let store: TileStore | null = null;
	const storeFor = () => {
		if (!store) {
			store = new TileStore(proj, () => {
				baseStale = true;
			});
		}
		return store;
	};

	function tileView(): { z: number; tiles: Tile[]; complete: boolean } | null {
		const [centreLat] = fromScreen(size / 2, size / 2);
		const z = Math.min(MAX_TILE_Z, tileZoomFor(pxPerKm, centreLat));
		const tiles = storeFor();
		if (z < MIN_TILE_Z || !tiles.available) return null;
		const edge: [number, number][] = [];
		for (let i = 0; i <= 4; i++) {
			for (let j = 0; j <= 4; j++) edge.push(fromScreen((i / 4) * size, (j / 4) * size));
		}
		return { z, ...tiles.view(z, edge) };
	}

	/** Draws tiles in km coordinates, so stroke widths are given in km too. */
	function drawTiles(ctx: CanvasRenderingContext2D, tiles: Tile[], ratio: number) {
		const k = pxPerKm;
		const px = (n: number) => n / k;
		// Lines thicken toward their true width once they are big enough to show it.
		const road = (minPx: number, metres: number) => Math.max(px(minPx), metres / 1000);
		// Once a road is wide enough it draws as a double line, like a plotted street.
		const casedRoad = (path: Path2D, color: string, minPx: number, metres: number) => {
			const width = road(minPx, metres);
			ctx.strokeStyle = color;
			ctx.lineWidth = width;
			ctx.stroke(path);
			if (width * k > 3.5) {
				ctx.strokeStyle = '#061310';
				ctx.lineWidth = width - px(2.2);
				ctx.stroke(path);
			}
		};
		ctx.save();
		ctx.setTransform(ratio * k, 0, 0, -ratio * k, ratio * (size / 2 - cx * k), ratio * (size / 2 + cy * k));
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		for (const t of tiles) {
			ctx.save();
			ctx.clip(t.frame);
			ctx.fillStyle = 'rgba(46, 120, 110, 0.09)';
			ctx.fill(t.green);
			ctx.fillStyle = 'rgba(70, 150, 200, 0.16)';
			ctx.fill(t.water);
			ctx.strokeStyle = 'rgba(130, 210, 240, 0.85)';
			ctx.lineWidth = px(1.2);
			ctx.stroke(t.waterways);

			if (t.z >= BUILDINGS_FROM_Z) {
				ctx.fillStyle = 'rgba(134, 247, 176, 0.18)';
				ctx.fill(t.buildings);
				ctx.strokeStyle = 'rgba(175, 255, 205, 0.95)';
				ctx.lineWidth = px(1);
				ctx.stroke(t.buildings);
			}
			ctx.strokeStyle = 'rgba(225, 240, 228, 0.8)';
			ctx.lineWidth = road(1.3, 20);
			ctx.stroke(t.runways);
			// Road hierarchy tightens with distance: from afar only highways stand out.
			const near = Math.max(0, Math.min(1, (t.z - MIN_TILE_Z) / (MAX_TILE_Z - MIN_TILE_Z)));
			if (t.z >= BUILDINGS_FROM_Z) casedRoad(t.roads.service, 'rgba(195, 220, 205, 0.7)', 0.9, 6);
			casedRoad(t.roads.minor, `rgba(205, 228, 212, ${0.16 + 0.69 * near * near})`, 0.6 + 0.4 * near, 10);
			casedRoad(t.roads.mid, `rgba(225, 240, 220, ${0.34 + 0.61 * near})`, 0.8 + 0.5 * near, 16);
			casedRoad(t.roads.major, `rgba(245, 250, 232, ${0.62 + 0.38 * near})`, 1.1 + 0.7 * near, 26);
			ctx.strokeStyle = 'rgba(185, 205, 255, 0.85)';
			ctx.lineWidth = px(1.1);
			ctx.setLineDash([px(5), px(3)]);
			ctx.stroke(t.rail);
			ctx.strokeStyle = 'rgba(160, 250, 195, 0.8)';
			ctx.lineWidth = px(1.3);
			ctx.setLineDash([px(4), px(3)]);
			ctx.stroke(t.borders);
			ctx.setLineDash([]);
			ctx.strokeStyle = PHOSPHOR;
			ctx.lineWidth = px(1.7);
			ctx.stroke(t.water);
			ctx.restore();
		}
		ctx.restore();
	}

	function drawBase() {
		if (!base) base = document.createElement('canvas');
		const ratio = dpr();
		base.width = Math.round(size * ratio);
		base.height = Math.round(size * ratio);
		const ctx = base.getContext('2d')!;
		ctx.scale(ratio, ratio);
		ctx.clearRect(0, 0, size, size);
		ctx.lineJoin = 'round';

		// Range rings and bearing lines, spaced to the current zoom.
		const ringStep = niceRing(radius / zoom / 3.5);
		const originX = size / 2 - cx * pxPerKm;
		const originY = size / 2 + cy * pxPerKm;
		ctx.strokeStyle = 'rgba(134, 247, 176, 0.22)';
		ctx.lineWidth = 1;
		ctx.fillStyle = 'rgba(134, 247, 176, 0.75)';
		ctx.font = `${Math.max(9, size / 66)}px "Share Tech Mono", monospace`;
		// Only rings crossing the view: at deep zoom there could be thousands.
		const viewKm = (size / 2 / pxPerKm) * Math.SQRT2;
		const fromCentre = Math.hypot(cx, cy);
		const firstRing = Math.max(1, Math.floor((fromCentre - viewKm) / ringStep));
		const lastRing = Math.min(Math.ceil((fromCentre + viewKm) / ringStep), Math.floor((radius * 1.0001) / ringStep));
		for (let n = firstRing; n <= lastRing; n++) {
			const r = n * ringStep;
			ctx.beginPath();
			ctx.arc(originX, originY, r * pxPerKm, 0, 2 * Math.PI);
			ctx.stroke();
			const tag = r >= 1000 ? `${+(r / 1000).toPrecision(3)}K` : `${+r.toPrecision(3)}`;
			ctx.fillText(tag, originX + 3, originY - r * pxPerKm - 3);
		}
		for (let a = 0; a < 12; a++) {
			const t = (a / 12) * 2 * Math.PI;
			ctx.beginPath();
			ctx.moveTo(originX, originY);
			ctx.lineTo(originX + Math.sin(t) * radius * pxPerKm, originY - Math.cos(t) * radius * pxPerKm);
			ctx.stroke();
		}

		const isCity = scenario.theatre.kind === 'city';
		const streamed = tileView();
		const buildingsShown = (streamed?.z ?? 0) >= BUILDINGS_FROM_Z;
		const scale = pxPerKm;
		const screenX = (i: number) => size / 2 + (gridXY[i * 2] - cx) * scale;
		const screenY = (i: number) => size / 2 - (gridXY[i * 2 + 1] - cy) * scale;
		const cellPx = meta.cellKm * scale;

		// Inhabited cells. They read as dots when far out and fill in as tiles up close.
		if (showDensity) {
			const buckets: [number, number][][] = [[], [], [], []];
			const logMax = Math.log1p(Math.max(...sampleMax()));
			for (let i = 0; i < grid.n; i++) {
				const x = screenX(i);
				const y = screenY(i);
				if (x < -cellPx || y < -cellPx || x > size + cellPx || y > size + cellPx) continue;
				const v = Math.log1p(Math.max(grid.pop[i], grid.structures[i] * 2)) / logMax;
				const b = Math.min(3, Math.floor(v * v * 5));
				buckets[b].push([x, y]);
			}
			const dot = Math.max(1, cellPx * 0.42);
			if (cellPx <= STIPPLE_FROM_PX) {
				const alpha = [0.14, 0.26, 0.48, 0.85];
				buckets.forEach((pts, b) => {
					ctx.fillStyle = `rgba(150, 245, 180, ${alpha[b]})`;
					for (const [x, y] of pts) ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
				});
			}
		}

		// Up close each cell breaks into stipple, its dot count following its density.
		// Offsets hash from the cell index, so dots hold still as the map pans.
		if (showDensity && cellPx > STIPPLE_FROM_PX && !buildingsShown) {
			const logMax = Math.log1p(Math.max(...sampleMax()));
			const cellH = meta.step * 111.2 * scale;
			const cellW = cellH * Math.max(0.2, Math.cos((scenario.theatre.lat * Math.PI) / 180));
			const area = cellW * cellH;
			ctx.fillStyle = 'rgba(150, 245, 180, 0.62)';
			for (let i = 0; i < grid.n; i++) {
				const x = screenX(i);
				const y = screenY(i);
				if (x < -cellW || y < -cellH || x > size + cellW || y > size + cellH) continue;
				const v = Math.log1p(Math.max(grid.pop[i], grid.structures[i] * 2)) / logMax;
				const count = Math.min(240, Math.round((v * v * v * area) / 26));
				let h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
				for (let k = 0; k < count; k++) {
					h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
					const fx = (h & 0xffff) / 0xffff - 0.5;
					const fy = (h >>> 16) / 0xffff - 0.5;
					ctx.fillRect(x + fx * cellW, y + fy * cellH, 1.4, 1.4);
				}
			}
		}

		// Finer layers fade in with zoom so the wide view stays readable.
		const fade = (from: number, to: number) => Math.max(0, Math.min(1, (zoom - from) / (to - from)));
		const majorAt = isCity ? 0.9 : 1;
		const minorIn = isCity ? fade(1.2, 3) : fade(1.5, 4);
		// The baked map holds until the streamed tiles for this view have arrived.
		if (!streamed?.complete) {
			drawLines(ctx, layers.urban, `rgba(185, 216, 115, ${0.35 + 0.25 * fade(1, 4)})`, 1);
			drawLines(ctx, layers.rivers, `rgba(130, 210, 240, ${isCity ? 0.7 : 0.5})`, 1.1);
			drawLines(ctx, layers.lakes, 'rgba(130, 210, 240, 0.85)', 1.2);
			if (layers.admin.length) drawLines(ctx, layers.admin, 'rgba(134, 247, 176, 0.42)', 1, [2, 4]);
			if (minorIn > 0) drawLines(ctx, layers.minorRoads, `rgba(215, 235, 210, ${0.6 * minorIn})`, 1);
			drawLines(ctx, layers.rail, `rgba(185, 205, 255, ${0.35 + 0.35 * fade(1, 3)})`, 1, [5, 3]);
			drawLines(ctx, layers.roads, `rgba(235, 245, 225, ${0.42 * majorAt + 0.35 * fade(1, 4)})`, 1.1);
			drawLines(ctx, layers.borders, 'rgba(160, 250, 195, 0.8)', 1.3, [5, 3]);
			drawLines(ctx, layers.coast, PHOSPHOR, 1.7);
		}
		if (streamed) drawTiles(ctx, streamed.tiles, ratio);

		// Damage from the last run, painted over the dots as hot phosphor.
		if (damage) {
			const dot = Math.max(1.4, cellPx * 0.8);
			for (let i = 0; i < grid.n; i++) {
				const d = damage[i];
				if (d < 0.05) continue;
				const x = screenX(i);
				const y = screenY(i);
				if (x < -cellPx || y < -cellPx || x > size + cellPx || y > size + cellPx) continue;
				const soften = cellPx > STIPPLE_FROM_PX ? 0.42 : 1;
				ctx.fillStyle = d > 0.6 ? `rgba(255, 244, 214, ${(0.5 + d * 0.5) * soften})` : `rgba(255, 170, 70, ${(0.2 + d) * soften})`;
				ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
			}
		}

		// A soft second pass gives everything the bloom of a real CRT.
		if ('filter' in ctx && !interacting) {
			const copy = document.createElement('canvas');
			copy.width = base.width;
			copy.height = base.height;
			copy.getContext('2d')!.drawImage(base, 0, 0);
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalCompositeOperation = 'lighter';
			ctx.filter = `blur(${2.2 * ratio}px)`;
			ctx.globalAlpha = streamed?.complete ? 0.35 : 0.6;
			ctx.drawImage(copy, 0, 0);
			ctx.restore();
		}

		// Labels, biggest first, skipping any that would collide. Objective labels
		// are drawn on top each frame, so their space is reserved up front.
		const fontPx = Math.max(11.5, size / 50);
		ctx.font = `${fontPx}px "Share Tech Mono", monospace`;
		const taken: [number, number, number, number][] = [];
		const claim = (x: number, y: number, w: number, h: number) => {
			for (const r of taken) {
				if (x < r[0] + r[2] && x + w > r[0] && y < r[1] + r[3] && y + h > r[1]) return false;
			}
			taken.push([x, y, w, h]);
			return true;
		};
		for (const site of [...scenario.targets, ...scenario.protected]) {
			const [x, y] = toScreen(site.lat, site.lon);
			claim(x - 8, y - fontPx, 12 + (site.name.length + 8) * fontPx * 0.56, fontPx * 1.7);
		}
		for (const zone of [scenario.targetZone, scenario.exclusion, scenario.noFire]) {
			if (!zone) continue;
			const [x, y] = toScreen(zone.lat, zone.lon);
			claim(x, y - fontPx - 8, 12 + (zone.name.length + 8) * fontPx * 0.56, fontPx * 1.5);
		}
		// Only the biggest cities get names. Objectives label themselves on top.
		const majors = meta.places.slice(0, MAJOR_LABELS[scenario.theatre.kind]);
		for (const m of majors) {
			const [x, y] = toScreen(m.lat, m.lon);
			if (x < 0 || y < 0 || x > size || y > size) continue;
			const w = m.name.length * fontPx * 0.56;
			if (!claim(x - 4, y - fontPx * 1.1, w + 14, fontPx * 2)) continue;
			ctx.fillStyle = DECAY;
			ctx.fillRect(x - 2, y - 2, 4, 4);
			// A dark outline keeps text legible on top of dense streets.
			ctx.lineJoin = 'round';
			ctx.lineWidth = 3.5;
			ctx.strokeStyle = 'rgba(2, 10, 8, 0.92)';
			ctx.strokeText(m.name, x + 6, y + fontPx * 0.32);
			ctx.fillStyle = '#e6f7b4';
			ctx.fillText(m.name, x + 6, y + fontPx * 0.32);
		}

		baseStale = false;
	}

	let maxCache: number[] | null = null;
	function sampleMax(): number[] {
		if (!maxCache) {
			let m = 1;
			for (let i = 0; i < grid.n; i++) m = Math.max(m, grid.pop[i], grid.structures[i] * 2);
			maxCache = [m];
		}
		return maxCache;
	}

	function circlePath(ctx: CanvasRenderingContext2D, lat: number, lon: number, km: number) {
		const steps = 56;
		ctx.beginPath();
		for (let i = 0; i <= steps; i++) {
			const [la, lo] = destination(lat, lon, (i / steps) * 360, km);
			const [x, y] = toScreen(la, lo);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
	}

	function plumePath(ctx: CanvasRenderingContext2D, lat: number, lon: number, band: PlumeBand, reach = 1) {
		const bearing = scenario.weather.windBearing;
		const a = (band.length + band.upwind) / 2;
		const c = (band.length - band.upwind) / 2;
		const steps = 48;
		ctx.beginPath();
		for (let i = 0; i <= steps; i++) {
			const t = (i / steps) * 2 * Math.PI;
			const along = (c + a * Math.cos(t)) * reach;
			const cross = (band.width / 2) * Math.sin(t) * Math.min(1, reach * 1.4);
			const dist = Math.hypot(along, cross);
			const az = bearing + (Math.atan2(cross, along) * 180) / Math.PI;
			const [la, lo] = destination(lat, lon, az, dist);
			const [x, y] = toScreen(la, lo);
			if (i === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
	}

	function drawZone(ctx: CanvasRenderingContext2D, zone: Zone, color: string, tag: string) {
		circlePath(ctx, zone.lat, zone.lon, zone.km);
		ctx.strokeStyle = color;
		ctx.lineWidth = 1.2;
		ctx.setLineDash([7, 5]);
		ctx.stroke();
		ctx.setLineDash([]);
		const [x, y] = toScreen(zone.lat, zone.lon);
		ctx.fillStyle = color;
		ctx.font = `${Math.max(11.5, size / 50)}px "Share Tech Mono", monospace`;
		ctx.lineWidth = 3.5;
		ctx.strokeStyle = 'rgba(2, 10, 8, 0.92)';
		ctx.strokeText(`${tag} ${zone.name}`, x + 6, y - 6);
		ctx.fillText(`${tag} ${zone.name}`, x + 6, y - 6);
	}

	function drawObjectives(ctx: CanvasRenderingContext2D, now: number) {
		const blink = reduced() ? 1 : 0.65 + 0.35 * Math.sin(now / 280);
		ctx.font = `${Math.max(11.5, size / 50)}px "Share Tech Mono", monospace`;
		ctx.lineJoin = 'round';
		ctx.lineWidth = 3.5;
		ctx.strokeStyle = 'rgba(2, 10, 8, 0.92)';
		if (scenario.targetZone) drawZone(ctx, scenario.targetZone, AMBER, 'TGT');
		if (scenario.exclusion) drawZone(ctx, scenario.exclusion, FLASH, 'CLEAN');
		if (scenario.noFire) drawZone(ctx, scenario.noFire, ALERT, 'NO FIRE');
		for (const t of scenario.targets) {
			const [x, y] = toScreen(t.lat, t.lon);
			ctx.strokeStyle = AMBER;
			ctx.globalAlpha = blink;
			ctx.lineWidth = 1.6;
			ctx.beginPath();
			ctx.moveTo(x, y - 8);
			ctx.lineTo(x + 7, y + 5);
			ctx.lineTo(x - 7, y + 5);
			ctx.closePath();
			ctx.stroke();
			ctx.globalAlpha = 1;
			ctx.lineWidth = 3.5;
			ctx.strokeStyle = 'rgba(2, 10, 8, 0.92)';
			ctx.strokeText(`${t.name} ${t.psi}PSI`, x + 10, y + 3);
			ctx.fillStyle = AMBER;
			ctx.fillText(`${t.name} ${t.psi}PSI`, x + 10, y + 3);
		}
		for (const p of scenario.protected) {
			const [x, y] = toScreen(p.lat, p.lon);
			ctx.strokeStyle = FLASH;
			ctx.lineWidth = 1.4;
			ctx.strokeRect(x - 5, y - 5, 10, 10);
			ctx.beginPath();
			ctx.moveTo(x - 5, y - 5);
			ctx.lineTo(x + 5, y + 5);
			ctx.moveTo(x + 5, y - 5);
			ctx.lineTo(x - 5, y + 5);
			ctx.stroke();
			ctx.lineWidth = 3.5;
			ctx.strokeStyle = 'rgba(2, 10, 8, 0.92)';
			ctx.strokeText(`${p.name} <${p.psi}PSI`, x + 9, y + 3);
			ctx.fillStyle = FLASH;
			ctx.fillText(`${p.name} <${p.psi}PSI`, x + 9, y + 3);
		}
	}

	function drawBurst(ctx: CanvasRenderingContext2D, p: Placement, grow = 1) {
		const b = toBurst(scenario, p);
		const isSelected = p.slot === selected;
		const [x, y] = toScreen(b.lat, b.lon);
		const rings = ringsFor(b.weapon, b.kt, b.hobM, scenario.weather);

		if (showFallout) {
			const bands = falloutBands(b.weapon, b.kt, b.hobM, scenario.weather);
			bands.forEach((band, i) => {
				plumePath(ctx, b.lat, b.lon, band, grow);
				ctx.fillStyle = `rgba(185, 216, 115, ${[0.15, 0.08, 0.05, 0.025][i]})`;
				ctx.fill();
				ctx.strokeStyle = `rgba(185, 216, 115, ${[0.9, 0.6, 0.4, 0.25][i]})`;
				ctx.lineWidth = 1;
				ctx.stroke();
			});
		}

		if (showRings) {
			const emp = empKm(b.kt, b.hobM);
			if (emp > 0) {
				circlePath(ctx, b.lat, b.lon, emp * grow);
				ctx.strokeStyle = FLASH;
				ctx.setLineDash([2, 5]);
				ctx.lineWidth = 1.4;
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.fillStyle = 'rgba(160, 210, 255, 0.05)';
				ctx.fill();
			}
			const circles: [number, string, number, number[]][] = [
				[rings.thermal, 'rgba(255, 194, 74, 0.65)', 1, [3, 4]],
				[rings.psi1, 'rgba(134, 247, 176, 0.5)', 1, []],
				[rings.psi5, 'rgba(180, 250, 200, 0.9)', 1.3, []],
				[rings.psi20, FLASH, 1.5, []]
			];
			for (const [km, color, width, dash] of circles) {
				if (km <= 0) continue;
				const px = km * pxPerKm * grow;
				if (px < 1.5) continue;
				ctx.beginPath();
				ctx.arc(x, y, px, 0, 2 * Math.PI);
				ctx.strokeStyle = color;
				ctx.lineWidth = width;
				ctx.setLineDash(dash);
				ctx.stroke();
			}
			ctx.setLineDash([]);
			if (rings.fireball * pxPerKm > 1.5) {
				ctx.beginPath();
				ctx.arc(x, y, rings.fireball * pxPerKm * grow, 0, 2 * Math.PI);
				ctx.fillStyle = 'rgba(220, 239, 255, 0.55)';
				ctx.fill();
			}
		}

		// Track symbol, the bracket a Charactron tube would draw around a contact.
		const s = isSelected ? 10 : 7;
		ctx.strokeStyle = isSelected ? FLASH : PHOSPHOR;
		ctx.lineWidth = isSelected ? 2 : 1.4;
		ctx.beginPath();
		ctx.moveTo(x - s, y);
		ctx.lineTo(x, y - s);
		ctx.lineTo(x + s, y);
		ctx.lineTo(x, y + s);
		ctx.closePath();
		ctx.moveTo(x, y - 3);
		ctx.lineTo(x, y + 3);
		ctx.moveTo(x - 3, y);
		ctx.lineTo(x + 3, y);
		ctx.stroke();
		ctx.fillStyle = isSelected ? FLASH : PHOSPHOR;
		ctx.font = `${Math.max(10, size / 62)}px "Share Tech Mono", monospace`;
		ctx.fillText(`${String(p.slot + 1).padStart(2, '0')}`, x + s + 3, y - s + 2);
	}

	function drawWind(ctx: CanvasRenderingContext2D) {
		const r = Math.max(16, size / 26);
		const x = size * 0.14;
		const y = size * 0.14;
		const a = (scenario.weather.windBearing * Math.PI) / 180;
		ctx.strokeStyle = PHOSPHOR_DIM;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, 2 * Math.PI);
		ctx.stroke();
		ctx.strokeStyle = PHOSPHOR;
		ctx.lineWidth = 1.5;
		const tipX = x + Math.sin(a) * r;
		const tipY = y - Math.cos(a) * r;
		ctx.beginPath();
		ctx.moveTo(x - Math.sin(a) * r, y + Math.cos(a) * r);
		ctx.lineTo(tipX, tipY);
		ctx.moveTo(tipX, tipY);
		ctx.lineTo(tipX - Math.sin(a - 0.5) * r * 0.45, tipY + Math.cos(a - 0.5) * r * 0.45);
		ctx.moveTo(tipX, tipY);
		ctx.lineTo(tipX - Math.sin(a + 0.5) * r * 0.45, tipY + Math.cos(a + 0.5) * r * 0.45);
		ctx.stroke();
		ctx.fillStyle = PHOSPHOR;
		ctx.font = `${Math.max(9, size / 72)}px "Share Tech Mono", monospace`;
		ctx.textAlign = 'center';
		ctx.fillText(`${scenario.weather.windKmh} KM/H`, x, y + r + 12);
		ctx.textAlign = 'start';
	}

	// Strike playback.
	let playStart = 0;
	const STAGGER = 420;
	const GROW = 1500;
	let playing = $state(false);
	const playOrder = () => [...placements];
	const playLength = () => placements.length * STAGGER + GROW + 600;

	function drawPlayback(ctx: CanvasRenderingContext2D, now: number) {
		const t = now - playStart;
		let flash = 0;
		playOrder().forEach((p, i) => {
			const local = t - i * STAGGER;
			if (local < 0) return;
			const grow = 1 - Math.pow(1 - Math.min(1, local / GROW), 3);
			drawBurst(ctx, p, grow);
			flash = Math.max(flash, 1 - local / 260);
			const [x, y] = toScreen(p.lat, p.lon);
			const r = Math.max(10, 60 * (1 - Math.min(1, local / 500)));
			if (local < 500) {
				const g = ctx.createRadialGradient(x, y, 0, x, y, r);
				g.addColorStop(0, 'rgba(255, 255, 255, 1)');
				g.addColorStop(1, 'rgba(180, 220, 255, 0)');
				ctx.fillStyle = g;
				ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
			}
		});
		if (flash > 0) {
			ctx.fillStyle = `rgba(226, 240, 255, ${flash * 0.72})`;
			ctx.fillRect(0, 0, size, size);
		}
		if (t > playLength()) {
			playing = false;
			baseStale = true;
			onplayed();
		}
	}

	function ensureSweep(): HTMLCanvasElement {
		if (!sweepBuf) sweepBuf = document.createElement('canvas');
		const ratio = dpr();
		const px = Math.round(size * ratio);
		if (sweepBuf.width !== px) {
			sweepBuf.width = px;
			sweepBuf.height = px;
		}
		return sweepBuf;
	}

	function frame(now: number) {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;
		if (baseStale || !base) drawBase();
		const ratio = dpr();
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.clearRect(0, 0, size, size);

		ctx.save();
		ctx.beginPath();
		ctx.arc(size / 2, size / 2, size / 2 - 1, 0, 2 * Math.PI);
		ctx.clip();

		ctx.globalAlpha = 1;
		ctx.drawImage(base!, 0, 0, size, size);
		ctx.globalAlpha = 1;

		if (!reduced()) {
			// A rotating beam re-excites the phosphor: blue-white at the edge, decaying behind it.
			const angle = (now / 5200) * 2 * Math.PI;
			const buf = ensureSweep();
			const b = buf.getContext('2d')!;
			b.setTransform(1, 0, 0, 1, 0, 0);
			b.globalCompositeOperation = 'source-over';
			b.clearRect(0, 0, buf.width, buf.height);
			const g = b.createConicGradient(angle - Math.PI / 2, buf.width / 2, buf.height / 2);
			g.addColorStop(0, 'rgba(255, 255, 255, 0)');
			g.addColorStop(0.72, 'rgba(255, 255, 255, 0)');
			g.addColorStop(0.97, 'rgba(255, 255, 255, 0.3)');
			g.addColorStop(1, 'rgba(255, 255, 255, 0.55)');
			b.fillStyle = g;
			b.fillRect(0, 0, buf.width, buf.height);
			b.globalCompositeOperation = 'source-in';
			b.drawImage(base!, 0, 0);
			ctx.globalCompositeOperation = 'lighter';
			ctx.drawImage(buf, 0, 0, size, size);
			const beam = ctx.createConicGradient(angle - Math.PI / 2, size / 2, size / 2);
			beam.addColorStop(0, 'rgba(150, 200, 255, 0)');
			beam.addColorStop(0.9, 'rgba(120, 200, 255, 0)');
			beam.addColorStop(0.995, 'rgba(150, 215, 255, 0.11)');
			beam.addColorStop(1, 'rgba(210, 235, 255, 0.34)');
			ctx.fillStyle = beam;
			ctx.fillRect(0, 0, size, size);
			ctx.globalCompositeOperation = 'source-over';
		}

		drawObjectives(ctx, now);
		if (playing) {
			drawPlayback(ctx, now);
		} else {
			for (const p of placements) drawBurst(ctx, p);
		}
		drawWind(ctx);

		if (cursor && !playing) {
			const [x, y] = toScreen(cursor.lat, cursor.lon);
			ctx.strokeStyle = 'rgba(220, 239, 255, 0.8)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(x, y, 12, 0, 2 * Math.PI);
			ctx.moveTo(x - 18, y);
			ctx.lineTo(x - 6, y);
			ctx.moveTo(x + 6, y);
			ctx.lineTo(x + 18, y);
			ctx.moveTo(x, y - 18);
			ctx.lineTo(x, y - 6);
			ctx.moveTo(x, y + 6);
			ctx.lineTo(x, y + 18);
			ctx.stroke();
		}
		ctx.restore();
	}

	// Pointer input: the light gun.
	const SNAP_PX = 14;
	const pointers = new Map<number, { x: number; y: number }>();
	let dragSlot: number | null = null;
	let panning = false;
	let moved = false;
	let downAt = { x: 0, y: 0 };
	let pinchDist = 0;

	const localXY = (e: PointerEvent) => {
		const r = canvas.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};

	function aimAt(x: number, y: number): [number, number] {
		for (const t of scenario.targets) {
			const [sx, sy] = toScreen(t.lat, t.lon);
			if (Math.hypot(sx - x, sy - y) < SNAP_PX) return [t.lat, t.lon];
		}
		return fromScreen(x, y);
	}

	function insideScope(lat: number, lon: number) {
		const [x, y] = proj.forward(lat, lon);
		return Math.hypot(x, y) <= radius;
	}

	function hitBurst(x: number, y: number): number | null {
		for (const p of placements) {
			const [sx, sy] = toScreen(p.lat, p.lon);
			if (Math.hypot(sx - x, sy - y) < 16) return p.slot;
		}
		return null;
	}

	function pointerDown(e: PointerEvent) {
		canvas.setPointerCapture(e.pointerId);
		const pos = localXY(e);
		pointers.set(e.pointerId, pos);
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
			dragSlot = null;
			panning = false;
			return;
		}
		downAt = pos;
		moved = false;
		dragSlot = locked ? null : hitBurst(pos.x, pos.y);
		if (dragSlot !== null) onselect(dragSlot);
		panning = dragSlot === null;
	}

	function pointerMove(e: PointerEvent) {
		const pos = localXY(e);
		const [lat, lon] = aimAt(pos.x, pos.y);
		cursor = e.pointerType === 'mouse' && !pointers.size ? { lat, lon } : cursor;
		if (!pointers.has(e.pointerId)) return;
		const prev = pointers.get(e.pointerId)!;
		pointers.set(e.pointerId, pos);
		if (pointers.size === 2) {
			const [a, b] = [...pointers.values()];
			const d = Math.hypot(a.x - b.x, a.y - b.y);
			if (pinchDist > 0) zoomBy(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
			pinchDist = d;
			moved = true;
			return;
		}
		if (Math.hypot(pos.x - downAt.x, pos.y - downAt.y) > 4) moved = true;
		if (dragSlot !== null && moved) {
			if (insideScope(lat, lon)) onmove(dragSlot, lat, lon);
			cursor = { lat, lon };
		} else if (panning && moved && zoom > 1) {
			cx -= (pos.x - prev.x) / pxPerKm;
			cy += (pos.y - prev.y) / pxPerKm;
			clampPan();
		}
	}

	function pointerUp(e: PointerEvent) {
		const wasPinch = pointers.size > 1;
		pointers.delete(e.pointerId);
		if (wasPinch) return;
		const pos = localXY(e);
		if (!moved && dragSlot === null && !locked && !playing) {
			const [lat, lon] = aimAt(pos.x, pos.y);
			if (insideScope(lat, lon)) onplace(lat, lon);
		}
		dragSlot = null;
		panning = false;
	}

	function onWheel(e: WheelEvent) {
		e.preventDefault();
		const pos = { x: e.offsetX, y: e.offsetY };
		zoomBy(Math.exp(-e.deltaY * 0.0016), pos.x, pos.y);
	}

	onMount(() => {
		const ro = new ResizeObserver(() => {
			size = Math.max(240, wrap.clientWidth);
			const ratio = dpr();
			canvas.width = Math.round(size * ratio);
			canvas.height = Math.round(size * ratio);
			baseStale = true;
		});
		ro.observe(wrap);
		let raf = 0;
		const loop = (now: number) => {
			frame(now);
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => {
			ro.disconnect();
			cancelAnimationFrame(raf);
		};
	});

	$effect(() => {
		void zoom;
		void cx;
		void cy;
		void size;
		void damage;
		void showDensity;
		void layers;
		baseStale = true;
		// Bloom is costly, so it waits until the view stops moving.
		interacting = true;
		clearTimeout(settle);
		settle = window.setTimeout(() => {
			interacting = false;
			baseStale = true;
		}, 140);
	});

	$effect(() => {
		if (playToken > 0) {
			untrack(() => {
				if (reduced()) {
					baseStale = true;
					onplayed();
				} else {
					playStart = performance.now();
					playing = true;
				}
			});
		}
	});

	// Arrow keys beside the display. A press moves a step, holding keeps it moving.
	let heldTimer = 0;
	const stepFraction = 0.18;

	function nudge(dx: number, dy: number) {
		const visible = radius / zoom;
		cx += dx * visible * stepFraction;
		cy += dy * visible * stepFraction;
		clampPan();
	}

	function hold(action: () => void) {
		action();
		release();
		heldTimer = window.setInterval(action, 110);
	}

	function release() {
		clearInterval(heldTimer);
		heldTimer = 0;
	}

	/** Enter and Space arrive as clicks with no pointer behind them. */
	const keyboardClick = (e: MouseEvent, action: () => void) => {
		if (e.detail === 0) action();
	};

	const ZOOM_STEP = 1.35;
	const arrows: { label: string; glyph: string; dx: number; dy: number; area: string }[] = [
		{ label: 'North', glyph: '▲', dx: 0, dy: 1, area: 'n' },
		{ label: 'West', glyph: '◀', dx: -1, dy: 0, area: 'w' },
		{ label: 'East', glyph: '▶', dx: 1, dy: 0, area: 'e' },
		{ label: 'South', glyph: '▼', dx: 0, dy: -1, area: 's' }
	];

	const readout = $derived.by(() => {
		if (!cursor) return 'LIGHT GUN STANDBY';
		const ns = cursor.lat >= 0 ? 'N' : 'S';
		const ew = cursor.lon >= 0 ? 'E' : 'W';
		return `${Math.abs(cursor.lat).toFixed(3)}${ns} ${Math.abs(cursor.lon).toFixed(3)}${ew}`;
	});
</script>

<div class="frame">
	<div class="tube" bind:this={wrap}>
		<canvas
			bind:this={canvas}
			id="nucle-scope"
			style:width="{size}px"
			style:height="{size}px"
			aria-label="Situation display. Click to aim the selected warhead."
			onpointerdown={pointerDown}
			onpointermove={pointerMove}
			onpointerup={pointerUp}
			onpointercancel={pointerUp}
			onpointerleave={() => (cursor = null)}
			onwheel={onWheel}
		></canvas>
		<div class="glass" aria-hidden="true"></div>
	</div>
	<div class="pad">
		<div class="zooms">
			<button
				class="padkey"
				aria-label="Zoom in"
				onpointerdown={() => hold(() => zoomBy(ZOOM_STEP))}
				onpointerup={release}
				onpointerleave={release}
				onclick={(e) => keyboardClick(e, () => zoomBy(ZOOM_STEP))}>+</button
			>
			<button
				class="padkey"
				aria-label="Zoom out"
				onpointerdown={() => hold(() => zoomBy(1 / ZOOM_STEP))}
				onpointerup={release}
				onpointerleave={release}
				onclick={(e) => keyboardClick(e, () => zoomBy(1 / ZOOM_STEP))}>−</button
			>
		</div>
		<div class="arrows">
			{#each arrows as a (a.area)}
				<button
					class="padkey"
					style:grid-area={a.area}
					aria-label="Move map view {a.label}"
					onpointerdown={() => hold(() => nudge(a.dx, a.dy))}
					onpointerup={release}
					onpointerleave={release}
					onclick={(e) => keyboardClick(e, () => nudge(a.dx, a.dy))}>{a.glyph}</button
				>
			{/each}
			<button class="padkey home" style:grid-area="c" aria-label="Recenter map" onclick={recenter}>●</button>
		</div>
	</div>
</div>
<div class="readout">
	<span class="coords">{readout}</span>
	<span class="credit">
		<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OPENSTREETMAP</a>
		<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OPENFREEMAP</a>
		<a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OPENMAPTILES</a>
	</span>
	<output>{zoom >= 10 ? Math.round(zoom) : Math.round(zoom * 10) / 10}X</output>
</div>

<style>
	.frame {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 12px;
		align-items: center;
	}
	.pad {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
	}
	.zooms {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.arrows {
		display: grid;
		grid-template-areas:
			'. n .'
			'w c e'
			'. s .';
		grid-template-columns: repeat(3, 34px);
		grid-template-rows: repeat(3, 34px);
		gap: 3px;
	}
	.padkey {
		appearance: none;
		width: 34px;
		height: 34px;
		padding: 0;
		border: 1px solid #14191b;
		border-radius: 2px;
		font: 600 15px var(--crt);
		color: #d6dac8;
		cursor: pointer;
		touch-action: none;
		background: linear-gradient(180deg, #4a5252, #2d3334);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.2),
			0 2px 0 #0e1213;
	}
	.zooms .padkey {
		width: 46px;
		height: 40px;
		font-size: 24px;
	}
	.padkey:hover {
		color: #fff;
	}
	.padkey:active {
		transform: translateY(2px);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12);
		color: var(--amber);
	}
	.home {
		font-size: 10px;
		color: var(--legend-dim);
	}
	@media (max-width: 900px) {
		.frame {
			grid-template-columns: minmax(0, 1fr);
		}
		.pad {
			flex-direction: row;
			justify-content: center;
			gap: 28px;
		}
		.zooms {
			flex-direction: row;
		}
	}
	.tube {
		position: relative;
		width: 100%;
		aspect-ratio: 1;
		border-radius: 50%;
		background: radial-gradient(circle at 50% 48%, #0d1f1b 0%, #071311 62%, #020706 100%);
		box-shadow:
			inset 0 0 40px 10px rgba(0, 0, 0, 0.75),
			inset 0 0 90px rgba(90, 200, 160, 0.08);
		overflow: hidden;
	}
	canvas {
		display: block;
		border-radius: 50%;
		touch-action: none;
		cursor: crosshair;
	}
	.glass {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		pointer-events: none;
		background:
			radial-gradient(ellipse 58% 30% at 34% 16%, rgba(205, 230, 255, 0.11), transparent 70%),
			radial-gradient(circle at 50% 50%, transparent 74%, rgba(0, 0, 0, 0.38) 100%),
			repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.07) 0 1px, transparent 1px 3px);
	}
	.readout {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 4px 16px;
		margin-top: 8px;
		font: 13px 'Share Tech Mono', monospace;
		letter-spacing: 0.08em;
		color: var(--phosphor);
	}
	.coords {
		text-shadow: 0 0 6px rgba(134, 247, 176, 0.6);
	}
	.credit {
		display: flex;
		flex-wrap: wrap;
		gap: 0 10px;
		font-size: 10px;
	}
	.credit a {
		color: var(--legend-dim);
		text-decoration: none;
	}
	.credit a:hover {
		color: var(--flash);
		text-decoration: underline;
	}
</style>
