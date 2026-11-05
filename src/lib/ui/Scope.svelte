<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { TheatreMeta } from '#lib/game/data.ts';
	import { falloutBands, ringsFor, empKm, type PlumeBand } from '#lib/game/effects.ts';
	import { fmtPressure, fmtWind, placeName, UI, type Lang } from '#lib/game/i18n.ts';
	import { destination, Projection } from '#lib/game/projection.ts';
	import { toBurst, type Placement, type Scenario, type Zone } from '#lib/game/scenario.ts';
	import type { PopGrid } from '#lib/game/sim.ts';
	import type { TheatreKind } from '#lib/game/theatres.ts';
	import type { Theme } from './themes.ts';
	import { MAX_TILE_Z, MIN_TILE_Z, TileStore, tileZoomFor, type Tile } from './tiles.ts';

	interface Props {
		theme: Theme;
		lang: Lang;
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
		theme,
		lang,
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

	const L = $derived(UI[lang]);
	const fontOf = (px: number, family = theme.font) => `${px}px ${family}`;

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
				ctx.strokeStyle = theme.roadCore;
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
			ctx.fillStyle = theme.green;
			ctx.fill(t.green);
			ctx.fillStyle = theme.water;
			ctx.fill(t.water);
			ctx.strokeStyle = theme.lake;
			ctx.lineWidth = px(1.2);
			ctx.stroke(t.waterways);

			if (t.z >= BUILDINGS_FROM_Z) {
				ctx.fillStyle = theme.buildingFill;
				ctx.fill(t.buildings);
				ctx.strokeStyle = theme.buildingEdge;
				ctx.lineWidth = px(1);
				ctx.stroke(t.buildings);
			}
			ctx.strokeStyle = theme.runway;
			ctx.lineWidth = road(1.3, 20);
			ctx.stroke(t.runways);
			// Road hierarchy tightens with distance: from afar only highways stand out.
			const near = Math.max(0, Math.min(1, (t.z - MIN_TILE_Z) / (MAX_TILE_Z - MIN_TILE_Z)));
			if (t.z >= BUILDINGS_FROM_Z) casedRoad(t.roads.service, theme.roadService, 0.9, 6);
			casedRoad(t.roads.minor, `rgba(${theme.roadRgb}, ${0.16 + 0.69 * near * near})`, 0.6 + 0.4 * near, 10);
			casedRoad(t.roads.mid, `rgba(${theme.roadRgb}, ${0.34 + 0.61 * near})`, 0.8 + 0.5 * near, 16);
			casedRoad(t.roads.major, `rgba(${theme.roadRgb}, ${0.62 + 0.38 * near})`, 1.1 + 0.7 * near, 26);
			ctx.strokeStyle = theme.rail;
			ctx.lineWidth = px(1.1);
			ctx.setLineDash([px(5), px(3)]);
			ctx.stroke(t.rail);
			ctx.strokeStyle = theme.border;
			ctx.lineWidth = px(1.3);
			ctx.setLineDash([px(4), px(3)]);
			ctx.stroke(t.borders);
			ctx.setLineDash([]);
			ctx.strokeStyle = theme.coast;
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
		ctx.strokeStyle = theme.grid;
		ctx.lineWidth = 1;
		ctx.fillStyle = theme.gridText;
		ctx.font = fontOf(Math.max(9, size / 66));
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

		if (theme.shape === 'square') {
			ctx.save();
			ctx.strokeStyle = theme.gridText;
			ctx.setLineDash([9, 5]);
			ctx.beginPath();
			ctx.arc(originX, originY, radius * pxPerKm, 0, 2 * Math.PI);
			ctx.stroke();
			ctx.restore();
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
				buckets.forEach((pts, b) => {
					ctx.fillStyle = `rgba(${theme.dot}, ${theme.dotAlpha[b]})`;
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
			ctx.fillStyle = theme.stipple;
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
		const minorIn = isCity ? fade(1.2, 3) : fade(1.5, 4);
		// The baked map holds until the streamed tiles for this view have arrived.
		if (!streamed?.complete) {
			drawLines(ctx, layers.urban, theme.urban, 1);
			drawLines(ctx, layers.rivers, theme.river, 1.1);
			drawLines(ctx, layers.lakes, theme.lake, 1.2);
			if (layers.admin.length) drawLines(ctx, layers.admin, theme.admin, 1, [2, 4]);
			if (minorIn > 0) drawLines(ctx, layers.minorRoads, theme.minor, 1);
			drawLines(ctx, layers.rail, theme.rail, 1, [5, 3]);
			drawLines(ctx, layers.roads, theme.road, 1.1);
			drawLines(ctx, layers.borders, theme.border, 1.3, [5, 3]);
			drawLines(ctx, layers.coast, theme.coast, 1.7);
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
				ctx.fillStyle = d > 0.6 ? `rgba(${theme.damageHot}, ${(0.5 + d * 0.5) * soften})` : `rgba(${theme.damageWarm}, ${(0.2 + d) * soften})`;
				ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
			}
		}

		// A soft second pass gives everything the bloom of a real CRT.
		if (theme.emissive && 'filter' in ctx && !interacting) {
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
		ctx.font = fontOf(fontPx);
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
			const name = placeName(m, lang);
			const w = name.length * fontPx * 0.56;
			if (!claim(x - 4, y - fontPx * 1.1, w + 14, fontPx * 2)) continue;
			ctx.fillStyle = theme.place;
			ctx.fillRect(x - 2, y - 2, 4, 4);
			// A dark outline keeps text legible on top of dense streets.
			ctx.lineJoin = 'round';
			ctx.lineWidth = 3.5;
			ctx.strokeStyle = theme.halo;
			ctx.strokeText(name, x + 6, y + fontPx * 0.32);
			ctx.fillStyle = theme.placeText;
			ctx.fillText(name, x + 6, y + fontPx * 0.32);
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

	/** Text with an outline in the display's background, legible over anything. */
	function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
		ctx.lineJoin = 'round';
		ctx.lineWidth = 3.5;
		ctx.strokeStyle = theme.halo;
		ctx.strokeText(text, x, y);
		ctx.fillStyle = color;
		ctx.fillText(text, x, y);
	}

	function drawZone(ctx: CanvasRenderingContext2D, zone: Zone, color: string, tag: string) {
		circlePath(ctx, zone.lat, zone.lon, zone.km);
		ctx.strokeStyle = color;
		ctx.lineWidth = theme.emissive ? 1.2 : 2;
		ctx.setLineDash([7, 5]);
		ctx.stroke();
		ctx.setLineDash([]);
		const [x, y] = toScreen(zone.lat, zone.lon);
		ctx.font = fontOf(Math.max(11.5, size / 50));
		outlined(ctx, `${tag} ${placeName(zone, lang)}`, x + 6, y - 6, color);
	}

	function drawObjectives(ctx: CanvasRenderingContext2D, now: number) {
		const blink = reduced() || !theme.emissive ? 1 : 0.65 + 0.35 * Math.sin(now / 280);
		ctx.font = fontOf(Math.max(11.5, size / 50));
		if (scenario.targetZone) drawZone(ctx, scenario.targetZone, theme.target, L.tgt);
		if (scenario.exclusion) drawZone(ctx, scenario.exclusion, theme.flash, L.clean);
		if (scenario.noFire) drawZone(ctx, scenario.noFire, theme.alert, L.noFire);
		for (const t of scenario.targets) {
			const [x, y] = toScreen(t.lat, t.lon);
			ctx.strokeStyle = theme.target;
			ctx.globalAlpha = blink;
			ctx.lineWidth = theme.emissive ? 1.6 : 2.2;
			ctx.beginPath();
			ctx.moveTo(x, y - 8);
			ctx.lineTo(x + 7, y + 5);
			ctx.lineTo(x - 7, y + 5);
			ctx.closePath();
			ctx.stroke();
			ctx.globalAlpha = 1;
			outlined(ctx, `${placeName(t, lang)} ${fmtPressure(t.psi, lang)}`, x + 10, y + 3, theme.target);
		}
		for (const p of scenario.protected) {
			const [x, y] = toScreen(p.lat, p.lon);
			ctx.strokeStyle = theme.flash;
			ctx.lineWidth = theme.emissive ? 1.4 : 2;
			ctx.strokeRect(x - 5, y - 5, 10, 10);
			ctx.beginPath();
			ctx.moveTo(x - 5, y - 5);
			ctx.lineTo(x + 5, y + 5);
			ctx.moveTo(x + 5, y - 5);
			ctx.lineTo(x - 5, y + 5);
			ctx.stroke();
			outlined(ctx, `${placeName(p, lang)} <${fmtPressure(p.psi, lang)}`, x + 9, y + 3, theme.flash);
		}
	}

	/** A slightly unsteady circle, the way a grease pencil follows a compass. */
	function pencilRing(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, reveal: number) {
		const steps = Math.max(24, Math.min(90, Math.round(r / 3)));
		const wobble = Math.min(2.2, 0.6 + r * 0.006);
		ctx.beginPath();
		for (let i = 0; i <= steps * reveal; i++) {
			const a = (i / steps) * 2 * Math.PI + seed;
			const n = Math.sin(a * 3 + seed * 7) * 0.6 + Math.sin(a * 7 + seed * 3) * 0.4;
			const rr = r + n * wobble;
			const px = x + Math.cos(a) * rr;
			const py = y + Math.sin(a) * rr;
			if (i === 0) ctx.moveTo(px, py);
			else ctx.lineTo(px, py);
		}
	}

	let hatch: CanvasPattern | null = null;
	let hatchFor = '';
	function hatchPattern(ctx: CanvasRenderingContext2D): CanvasPattern | null {
		if (!hatch || hatchFor !== theme.plume) {
			const c = document.createElement('canvas');
			c.width = 12;
			c.height = 12;
			const h = c.getContext('2d')!;
			h.strokeStyle = `rgba(${theme.plume}, 0.55)`;
			h.lineWidth = 1.1;
			h.beginPath();
			h.moveTo(-3, 15);
			h.lineTo(15, -3);
			h.moveTo(-3, 3);
			h.lineTo(3, -3);
			h.moveTo(9, 15);
			h.lineTo(15, 9);
			h.stroke();
			hatch = ctx.createPattern(c, 'repeat');
			hatchFor = theme.plume;
		}
		return hatch;
	}

	function drawBurst(ctx: CanvasRenderingContext2D, p: Placement, grow = 1) {
		const b = toBurst(scenario, p);
		const isSelected = p.slot === selected;
		const [x, y] = toScreen(b.lat, b.lon);
		const rings = ringsFor(b.weapon, b.kt, b.hobM, scenario.weather);

		const paper = !theme.emissive;
		if (showFallout) {
			const bands = falloutBands(b.weapon, b.kt, b.hobM, scenario.weather);
			bands.forEach((band, i) => {
				plumePath(ctx, b.lat, b.lon, band, grow);
				if (paper) {
					// Hatched by hand, with the hottest contour hatched closest.
					if (i <= 1) {
						const pat = hatchPattern(ctx);
						if (pat) {
							ctx.fillStyle = pat;
							ctx.fill();
						}
					}
					ctx.strokeStyle = `rgba(${theme.plume}, ${[0.95, 0.8, 0.6, 0.4][i]})`;
					ctx.lineWidth = 1.5;
				} else {
					ctx.fillStyle = `rgba(${theme.plume}, ${[0.15, 0.08, 0.05, 0.025][i]})`;
					ctx.fill();
					ctx.strokeStyle = `rgba(${theme.plume}, ${[0.9, 0.6, 0.4, 0.25][i]})`;
					ctx.lineWidth = 1;
				}
				ctx.stroke();
			});
		}

		if (showRings) {
			const emp = empKm(b.kt, b.hobM);
			if (emp > 0) {
				circlePath(ctx, b.lat, b.lon, emp * grow);
				ctx.strokeStyle = theme.flash;
				ctx.setLineDash([2, 5]);
				ctx.lineWidth = paper ? 2 : 1.4;
				ctx.stroke();
				ctx.setLineDash([]);
				ctx.fillStyle = theme.empFill;
				ctx.fill();
			}
			const circles: [number, string, number, number[]][] = [
				[rings.thermal, theme.thermal, 1, [3, 4]],
				[rings.psi1, theme.psi1, 1, []],
				[rings.psi5, theme.psi5, 1.3, []],
				[rings.psi20, theme.psi20, 1.5, []]
			];
			circles.forEach(([km, color, width, dash], i) => {
				if (km <= 0) return;
				// On paper a ring is drawn around its compass, not grown from the centre.
				const px = km * pxPerKm * (paper ? 1 : grow);
				if (px < 1.5) return;
				ctx.strokeStyle = color;
				if (paper) {
					pencilRing(ctx, x, y, px, p.slot * 1.7 + i, grow);
					ctx.lineWidth = width + 1;
					ctx.setLineDash(dash.length ? [5, 5] : []);
				} else {
					ctx.beginPath();
					ctx.arc(x, y, px, 0, 2 * Math.PI);
					ctx.lineWidth = width;
					ctx.setLineDash(dash);
				}
				ctx.stroke();
			});
			ctx.setLineDash([]);
			if (rings.fireball * pxPerKm > 1.5) {
				ctx.beginPath();
				ctx.arc(x, y, rings.fireball * pxPerKm * grow, 0, 2 * Math.PI);
				ctx.fillStyle = theme.fireball;
				ctx.fill();
			}
		}

		const s = isSelected ? 10 : 7;
		const mark = isSelected ? theme.flash : theme.ink;
		ctx.strokeStyle = mark;
		if (paper) {
			// A planner's ground zero: a pencilled circle and cross, with a number.
			ctx.lineWidth = isSelected ? 2.6 : 2;
			pencilRing(ctx, x, y, s, p.slot * 2.3, 1);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(x - s - 3, y - s - 3);
			ctx.lineTo(x + s + 3, y + s + 3);
			ctx.moveTo(x + s + 3, y - s - 3);
			ctx.lineTo(x - s - 3, y + s + 3);
			ctx.stroke();
			ctx.font = fontOf(Math.max(19, size / 34), theme.hand);
			outlined(ctx, `${p.slot + 1}`, x + s + 5, y - s + 1, mark);
			return;
		}
		// Track symbol, the character a Charactron tube stamps through its mask.
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
		ctx.fillStyle = mark;
		ctx.font = fontOf(Math.max(10, size / 62));
		ctx.fillText(`${String(p.slot + 1).padStart(2, '0')}`, x + s + 3, y - s + 2);
	}

	function drawWind(ctx: CanvasRenderingContext2D) {
		const r = Math.max(16, size / 26);
		const x = size * 0.14;
		const y = size * 0.14;
		const a = (scenario.weather.windBearing * Math.PI) / 180;
		ctx.strokeStyle = theme.dim;
		ctx.lineWidth = 1;
		ctx.beginPath();
		ctx.arc(x, y, r, 0, 2 * Math.PI);
		ctx.stroke();
		ctx.strokeStyle = theme.ink;
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
		ctx.font = fontOf(Math.max(9, size / 72));
		ctx.textAlign = 'center';
		outlined(ctx, fmtWind(scenario.weather.windKmh, lang), x, y + r + 12, theme.ink);
		ctx.textAlign = 'start';
	}

	const DRUM_MS = 2400;

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
			if (!theme.emissive) return;
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
		if (theme.shape === 'round') {
			ctx.beginPath();
			ctx.arc(size / 2, size / 2, size / 2 - 1, 0, 2 * Math.PI);
			ctx.clip();
		}

		ctx.drawImage(base!, 0, 0, size, size);

		// SAGE has no sweep. Its tubes are rewritten from the display drum, so traces
		// brighten together then sag toward the next pass.
		let rewrite = 1;
		if (theme.motion === 'refresh' && !reduced()) {
			const phase = (now % DRUM_MS) / DRUM_MS;
			rewrite = Math.exp(-3.2 * phase);
			ctx.globalCompositeOperation = 'lighter';
			ctx.globalAlpha = 0.24 * Math.exp(-7 * phase);
			ctx.drawImage(base!, 0, 0, size, size);
			ctx.globalAlpha = 1;
			ctx.globalCompositeOperation = 'source-over';
		}

		if (theme.motion === 'ppi' && !reduced()) {
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
			beam.addColorStop(0, 'rgba(190, 255, 170, 0)');
			beam.addColorStop(0.9, 'rgba(170, 255, 150, 0)');
			beam.addColorStop(0.995, 'rgba(190, 255, 170, 0.11)');
			beam.addColorStop(1, 'rgba(230, 255, 210, 0.34)');
			ctx.fillStyle = beam;
			ctx.fillRect(0, 0, size, size);
			ctx.globalCompositeOperation = 'source-over';
		}

		ctx.globalAlpha = theme.motion === 'refresh' ? 0.74 + 0.26 * rewrite : 1;
		drawObjectives(ctx, now);
		if (playing) {
			drawPlayback(ctx, now);
		} else {
			for (const p of placements) drawBurst(ctx, p);
		}
		ctx.globalAlpha = 1;
		drawWind(ctx);

		if (cursor && !playing) {
			const [x, y] = toScreen(cursor.lat, cursor.lon);
			ctx.strokeStyle = theme.cursor;
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
		// Canvas text only uses a font once it has loaded.
		document.fonts?.ready.then(() => (baseStale = true));
		for (const f of ['12px "PT Mono"', '12px "Share Tech Mono"', '12px "Courier Prime"', '12px "Reenie Beanie"']) {
			document.fonts?.load(f, 'AЯ1').then(() => (baseStale = true));
		}
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
		void theme;
		void lang;
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
		if (!cursor) return theme.id === 'paper' ? 'PLOTTING SHEET' : L.standby;
		const ns = cursor.lat >= 0 ? (lang === 'ru' ? 'С' : 'N') : lang === 'ru' ? 'Ю' : 'S';
		const ew = cursor.lon >= 0 ? (lang === 'ru' ? 'В' : 'E') : lang === 'ru' ? 'З' : 'W';
		return `${Math.abs(cursor.lat).toFixed(3)}${ns} ${Math.abs(cursor.lon).toFixed(3)}${ew}`;
	});
</script>

<div class="frame" data-shape={theme.shape}>
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
		{#if theme.id === 'sage'}
			<span class="grease" aria-hidden="true">EX {String(scenario.day).padStart(3, '0')}</span>
		{/if}
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
		border: var(--key-border);
		border-radius: var(--key-radius);
		font: 600 15px var(--crt);
		color: var(--key-text);
		cursor: pointer;
		touch-action: none;
		background: var(--key-face);
		box-shadow: var(--key-shadow);
	}
	.zooms .padkey {
		width: 46px;
		height: 40px;
		font-size: 24px;
	}
	.padkey:hover {
		filter: brightness(1.12);
	}
	.padkey:active {
		transform: translateY(2px);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
	}
	.home {
		font-size: 10px;
		opacity: 0.8;
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
		background: var(--tube-face);
		box-shadow: var(--tube-shadow);
		overflow: hidden;
	}
	.grease {
		position: absolute;
		left: 62%;
		top: 84%;
		font: 25px 'Reenie Beanie', cursive;
		color: rgba(120, 175, 255, 0.72);
		transform: rotate(-7deg);
		pointer-events: none;
	}
	[data-shape='square'] .tube {
		border-radius: 0;
	}
	[data-shape='square'] canvas {
		border-radius: 0;
		mix-blend-mode: multiply;
	}
	[data-shape='square'] .glass {
		display: none;
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
		background: var(--tube-glass);
	}
	.readout {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 4px 16px;
		margin-top: 8px;
		font: 13px var(--crt);
		letter-spacing: 0.08em;
		color: var(--readout);
	}
	.coords {
		text-shadow: var(--readout-glow);
	}
	.credit {
		display: flex;
		flex-wrap: wrap;
		gap: 0 10px;
		font-size: 11px;
	}
	.credit a {
		color: var(--readout);
		opacity: 0.85;
		text-decoration: none;
	}
	.credit a:hover {
		color: var(--flash);
		text-decoration: underline;
	}
</style>
