<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type { TheatreMeta } from '#lib/game/data.ts';
	import { falloutBands, falloutField, ringsFor, empKm, type PlumeBand } from '#lib/game/effects.ts';
	import { fmtPressure, fmtWind, placeName, UI, type Lang } from '#lib/game/i18n.ts';
	import { destination, Projection } from '#lib/game/projection.ts';
	import { toBurst, weatherFor, type Placement, type Scenario, type Zone } from '#lib/game/scenario.ts';
	import type { PopGrid } from '#lib/game/sim.ts';
	import type { TheatreKind } from '#lib/game/theatres.ts';
	import Instruments from './Instruments.svelte';
	import type { LocalWeather } from '#lib/game/weatherfield.ts';
	import type { Theme } from './themes.ts';
	import { BUILDING_TILE_Z, MAX_TILE_Z, MIN_TILE_Z, tileBudget, TileStore, tileZoomFor, type TileLayer } from './tiles.ts';

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

	// Controls set where the view is headed, and each frame glides toward it.
	let goalZoom = 1;
	let goalX = 0;
	let goalY = 0;
	let lastStep = 0;

	function clampGoal() {
		const limit = radius * (1 - 1 / goalZoom);
		goalX = Math.max(-limit, Math.min(limit, goalX));
		goalY = Math.max(-limit, Math.min(limit, goalY));
	}

	function stepView(now: number) {
		const dt = Math.min(50, now - lastStep);
		lastStep = now;
		if (zoom === goalZoom && cx === goalX && cy === goalY) return;
		const f = reduced() ? 1 : 1 - Math.exp(-dt / 75);
		const logZoom = Math.log(zoom) + (Math.log(goalZoom) - Math.log(zoom)) * f;
		const settled = Math.abs(logZoom - Math.log(goalZoom)) < 0.002 && Math.hypot(goalX - cx, goalY - cy) * pxPerKm < 0.4;
		zoom = settled ? goalZoom : Math.exp(logZoom);
		cx = settled ? goalX : cx + (goalX - cx) * f;
		cy = settled ? goalY : cy + (goalY - cy) * f;
	}

	function zoomBy(f: number, px = size / 2, py = size / 2) {
		const base = ((size / 2) * 0.97) / radius;
		const next = Math.max(1, Math.min(maxZoom, goalZoom * f));
		const worldX = (px - size / 2) / (base * goalZoom) + goalX;
		const worldY = -(py - size / 2) / (base * goalZoom) + goalY;
		goalZoom = next;
		goalX = worldX - (px - size / 2) / (base * next);
		goalY = worldY + (py - size / 2) / (base * next);
		clampGoal();
	}

	function recenter() {
		goalZoom = 1;
		goalX = 0;
		goalY = 0;
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
	interface View {
		cx: number;
		cy: number;
		k: number;
	}
	let base: HTMLCanvasElement | null = null;
	let baseView: View = { cx: 0, cy: 0, k: 1 };
	// The previous map stays up and fades out, so no redraw ever snaps in.
	let prevBase: HTMLCanvasElement | null = null;
	let prevView: View = baseView;
	let spareBase: HTMLCanvasElement | null = null;
	let fadeStart = 0;
	const FADE_MS = 110;
	// Maps render past the visible edge so that moving never exposes a blank.
	const margin = () => Math.round(size * 0.25);
	// On a slow connection, stop waiting and show what has arrived so far.
	const SLOW_NETWORK_MS = 2500;
	let waitingSince = 0;
	let lastCheck = 0;
	let lastBuilt = 0;
	// A copy of the whole disc, kept behind whatever is current. When a detailed map
	// shrinks during a zoom out, this is what shows around it instead of nothing.
	let backdrop: HTMLCanvasElement | null = null;
	let backdropView: View = baseView;
	let sweepBuf: HTMLCanvasElement | null = null;
	let baseStale = true;
	let interacting = false;
	let settle = 0;

	function drawLines(ctx: CanvasRenderingContext2D, lines: Line[], color: string, width: number, dash: number[] = []) {
		const halfKm = (size / 2 + margin()) / pxPerKm;
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

	/** The finest tile level the view can afford, which is finer than its scale needs. */
	function tileView(): { layers: TileLayer[]; covered: boolean; complete: boolean } | null {
		const tiles = storeFor();
		if (!tiles.available) return null;
		const [centreLat] = fromScreen(size / 2, size / 2);
		const edge: [number, number][] = [];
		const M = margin();
		const span = size + 2 * M;
		for (let i = 0; i <= 8; i++) {
			for (let j = 0; j <= 8; j++) edge.push(fromScreen((i / 8) * span - M, (j / 8) * span - M));
		}
		// Web Mercator tiles can't cover the pole or wrap around the hemisphere view.
		const lons = edge.map((e) => e[1]);
		if (edge.some((e) => Math.abs(e[0]) > 80) || Math.max(...lons) - Math.min(...lons) > 170) return null;
		const viewKm = ((size / 2 + M) / pxPerKm) * Math.SQRT2;
		const keep = (lat: number, lon: number, halfKm: number) => {
			const [x, y] = proj.forward(lat, lon);
			return Math.hypot(x - cx, y - cy) <= viewKm + halfKm;
		};
		const display = tileZoomFor(pxPerKm, centreLat);
		for (let z = Math.min(MAX_TILE_Z, display + 4); z >= MIN_TILE_Z; z--) {
			const wanted = tiles.tilesFor(z, edge, keep);
			if (wanted.length <= tileBudget(z)) return tiles.view(z, wanted);
		}
		return null;
	}

	/** Draws tiles in km coordinates, so stroke widths are given in km too. */
	function drawTiles(ctx: CanvasRenderingContext2D, layers: TileLayer[], ratio: number) {
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
		// Everything scales with the display, not the tile level, so there's no step
		// in brightness when a finer level of tiles lands.
		const scale = Math.log2(k);
		const near = Math.max(0, Math.min(1, (scale + 2) / 8));
		const buildings = buildingFade();
		ctx.save();
		const M = margin();
		ctx.setTransform(ratio * k, 0, 0, -ratio * k, ratio * (M + size / 2 - cx * k), ratio * (M + size / 2 + cy * k));
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		for (const { tile: t, clip } of layers) {
			ctx.save();
			ctx.clip(t.frame);
			if (clip) ctx.clip(clip);
			ctx.fillStyle = theme.green;
			ctx.fill(t.green);
			ctx.fillStyle = theme.water;
			ctx.fill(t.water);
			ctx.strokeStyle = theme.lake;
			ctx.lineWidth = px(1.2);
			ctx.stroke(t.waterways);

			if (t.z >= BUILDING_TILE_Z && buildings > 0) {
				ctx.globalAlpha = buildings;
				ctx.fillStyle = theme.buildingFill;
				ctx.fill(t.buildings);
				ctx.strokeStyle = theme.buildingEdge;
				ctx.lineWidth = px(1);
				ctx.stroke(t.buildings);
				ctx.globalAlpha = 1;
			}
			ctx.strokeStyle = theme.runway;
			ctx.lineWidth = road(1.3, 20);
			ctx.stroke(t.runways);
			// Road hierarchy tightens with distance: from afar only highways stand out,
			// and streets read as a fine texture until they have room to be lines.
			ctx.globalAlpha = 0.05 + 0.95 * near * near * near;
			casedRoad(t.roads.service, theme.roadService, 0.4 + 0.5 * near, 6);
			ctx.globalAlpha = 1;
			casedRoad(t.roads.minor, `rgba(${theme.roadRgb}, ${0.1 + 0.75 * near * near * near})`, 0.5 + 0.5 * near, 10);
			casedRoad(t.roads.mid, `rgba(${theme.roadRgb}, ${0.24 + 0.71 * near * near})`, 0.7 + 0.6 * near, 16);
			casedRoad(t.roads.major, `rgba(${theme.roadRgb}, ${0.5 + 0.5 * near})`, 0.9 + 0.9 * near, 26);
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
			ctx.lineWidth = px(1.2 + 0.5 * near);
			ctx.stroke(t.shore);
			// A pond earns an outline once it's a few pixels across.
			const pondFade = Math.max(0, Math.min(1, (k * 1.5 - 8) / 24));
			if (pondFade > 0) {
				ctx.globalAlpha = pondFade;
				ctx.lineWidth = px(1);
				ctx.stroke(t.ponds);
				ctx.globalAlpha = 1;
			}
			ctx.restore();
		}
		ctx.restore();
	}

	/** Buildings resolve gradually as their tiles become legible, from 0 to 1. */
	const buildingFade = () => Math.max(0, Math.min(1, Math.log2(pxPerKm) - 5.6));

	function drawBase() {
		const previous = base;
		base = spareBase ?? document.createElement('canvas');
		spareBase = prevBase;
		prevBase = previous;
		prevView = baseView;
		baseView = { cx, cy, k: pxPerKm };
		fadeStart = previous && !reduced() ? performance.now() : 0;
		lastBuilt = performance.now();
		waitingSince = 0;
		const ratio = dpr();
		const M = margin();
		base.width = Math.round((size + 2 * M) * ratio);
		base.height = Math.round((size + 2 * M) * ratio);
		const ctx = base.getContext('2d')!;
		ctx.scale(ratio, ratio);
		ctx.translate(M, M);
		ctx.clearRect(-M, -M, size + 2 * M, size + 2 * M);
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
		const viewKm = ((size / 2 + M) / pxPerKm) * Math.SQRT2;
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
				if (x < -M - cellPx || y < -M - cellPx || x > size + M + cellPx || y > size + M + cellPx) continue;
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
		const stippleAlpha = 1 - buildingFade();
		if (showDensity && cellPx > STIPPLE_FROM_PX && stippleAlpha > 0) {
			ctx.globalAlpha = stippleAlpha;
			const logMax = Math.log1p(Math.max(...sampleMax()));
			const cellH = meta.step * 111.2 * scale;
			const cellW = cellH * Math.max(0.2, Math.cos((scenario.theatre.lat * Math.PI) / 180));
			const area = cellW * cellH;
			ctx.fillStyle = theme.stipple;
			for (let i = 0; i < grid.n; i++) {
				const x = screenX(i);
				const y = screenY(i);
				if (x < -M - cellW || y < -M - cellH || x > size + M + cellW || y > size + M + cellH) continue;
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
			ctx.globalAlpha = 1;
		}

		// Finer layers fade in with zoom so the wide view stays readable.
		const fade = (from: number, to: number) => Math.max(0, Math.min(1, (zoom - from) / (to - from)));
		const minorIn = isCity ? fade(1.2, 3) : fade(1.5, 4);
		// The baked map holds until streamed tiles cover this view.
		if (!streamed?.covered) {
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
		if (streamed) drawTiles(ctx, streamed.layers, ratio);

		// Damage from the last run, painted over the dots as hot phosphor.
		if (damage) {
			const dot = Math.max(1.4, cellPx * 0.8);
			for (let i = 0; i < grid.n; i++) {
				const d = damage[i];
				if (d < 0.05) continue;
				const x = screenX(i);
				const y = screenY(i);
				if (x < -M - cellPx || y < -M - cellPx || x > size + M + cellPx || y > size + M + cellPx) continue;
				const soften = cellPx > STIPPLE_FROM_PX ? 0.42 : 1;
				ctx.fillStyle = d > 0.6 ? `rgba(${theme.damageHot}, ${(0.5 + d * 0.5) * soften})` : `rgba(${theme.damageWarm}, ${(0.2 + d) * soften})`;
				ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
			}
		}

		// A soft second pass gives everything the bloom of a real CRT.
		if (theme.emissive && 'filter' in ctx) {
			const copy = document.createElement('canvas');
			copy.width = base.width;
			copy.height = base.height;
			copy.getContext('2d')!.drawImage(base, 0, 0);
			ctx.save();
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalCompositeOperation = 'lighter';
			ctx.filter = `blur(${2.2 * ratio}px)`;
			ctx.globalAlpha = 0.32;
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
			if (x < -M || y < -M || x > size + M || y > size + M) continue;
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
		if (goalZoom === 1 && zoom === 1) {
			backdrop ??= document.createElement('canvas');
			backdrop.width = base.width;
			backdrop.height = base.height;
			backdrop.getContext('2d')!.drawImage(base, 0, 0);
			backdropView = baseView;
		}
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

	function plumePath(ctx: CanvasRenderingContext2D, lat: number, lon: number, band: PlumeBand, reach = 1, lengthKm = 0) {
		const bearing = weatherFor(scenario, lat, lon).windBearing;
		const spread = Math.min(1, reach * 1.4);
		// With real weather it follows the winds it meets. Reach grows it along that line as the strike plays.
		const track = scenario.field && lengthKm > 0 ? scenario.field.track(lat, lon, lengthKm) : null;
		const plot = (along: number, cross: number, first: boolean) => {
			const a = along * reach;
			const c = cross * spread;
			const az = bearing + (Math.atan2(c, a) * 180) / Math.PI;
			const [la, lo] = track ? track.point(a, -c) : destination(lat, lon, az, Math.hypot(a, c));
			const [x, y] = toScreen(la, lo);
			if (first) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		};
		ctx.beginPath();
		// Up one side of the wind axis and back down the other. A hot contour can be two islands.
		for (const run of band.runs) {
			run.forEach(([along, half], i) => plot(along, half, i === 0));
			for (let i = run.length - 2; i > 0; i--) plot(run[i][0], -run[i][1], false);
			ctx.closePath();
		}
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
		ctx.font = fontOf(Math.max(11.5, size / 50), theme.hand);
		outlined(ctx, `${tag} ${placeName(zone, lang)}`, x + 6, y - 6, color);
	}

	function drawObjectives(ctx: CanvasRenderingContext2D, now: number) {
		const blink = reduced() || !theme.emissive ? 1 : 0.65 + 0.35 * Math.sin(now / 280);
		ctx.font = fontOf(Math.max(12.5, size / (theme.emissive ? 50 : 42)), theme.hand);
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
			h.strokeStyle = `rgba(${theme.plume}, 0.8)`;
			h.lineWidth = 1.3;
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
		const local = weatherFor(scenario, b.lat, b.lon);
		const rings = ringsFor(b.weapon, b.kt, b.hobM, local);

		const paper = !theme.emissive;
		if (showFallout) {
			const bands = falloutBands(b.weapon, b.kt, b.hobM, local);
			const plumeKm = falloutField(b.weapon, b.kt, b.hobM, local)?.downKm ?? 0;
			// The map is dimmed under the widest contour, so streets can't compete with what's on top of them.
			if (bands.length) {
				plumePath(ctx, b.lat, b.lon, bands[bands.length - 1], grow, plumeKm);
				ctx.fillStyle = `rgba(${theme.veil}, ${paper ? 0.6 : 0.68})`;
				ctx.fill();
			}
			for (let i = bands.length - 1; i >= 0; i--) {
				plumePath(ctx, b.lat, b.lon, bands[i], grow, plumeKm);
				if (paper) {
					// Hatched by hand, with the hottest contour hatched closest.
					if (i <= 1) {
						const pat = hatchPattern(ctx);
						if (pat) {
							ctx.fillStyle = pat;
							ctx.fill();
						}
					}
				} else {
					ctx.fillStyle = `rgba(${theme.plume}, ${[0.2, 0.13, 0.09, 0.07][i]})`;
					ctx.fill();
				}
				ctx.strokeStyle = `rgba(${theme.veil}, 0.85)`;
				ctx.lineWidth = paper ? 3.5 : 3.2;
				ctx.stroke();
				ctx.strokeStyle = `rgba(${theme.plume}, ${[1, 0.9, 0.8, 0.7][i]})`;
				ctx.lineWidth = paper ? 2 : 1.4;
				ctx.stroke();
			}
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
				[rings.thermal, theme.thermal, 1.4, [3, 4]],
				[rings.psi1, theme.psi1, 1.3, []],
				[rings.psi5, theme.psi5, 1.6, []],
				[rings.psi20, theme.psi20, 1.8, []]
			];
			const reach = Math.max(rings.thermal, rings.psi1) * pxPerKm * grow;
			if (reach > 1.5) {
				ctx.beginPath();
				ctx.arc(x, y, reach, 0, 2 * Math.PI);
				ctx.fillStyle = `rgba(${theme.veil}, ${paper ? 0.22 : 0.34})`;
				ctx.fill();
			}
			circles.forEach(([km, color, width, dash], i) => {
				if (km <= 0) return;
				// On paper a ring is drawn around its compass, not grown from the centre.
				const px = km * pxPerKm * (paper ? 1 : grow);
				if (px < 1.5) return;
				if (paper) {
					pencilRing(ctx, x, y, px, p.slot * 1.7 + i, grow);
				} else {
					ctx.beginPath();
					ctx.arc(x, y, px, 0, 2 * Math.PI);
				}
				const line = paper ? width + 1 : width;
				ctx.setLineDash([]);
				ctx.strokeStyle = `rgba(${theme.veil}, 0.85)`;
				ctx.lineWidth = line + 2.4;
				ctx.stroke();
				ctx.setLineDash(paper && dash.length ? [5, 5] : dash);
				ctx.strokeStyle = color;
				ctx.lineWidth = line;
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
			ctx.font = fontOf(Math.max(14, size / 44), theme.marker);
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

	/** The weather stations: where the wind is blowing and how damp the air is, across the map. */
	function drawStations(ctx: CanvasRenderingContext2D) {
		if (!scenario.field) return;
		ctx.font = fontOf(Math.max(9.5, size / 70));
		ctx.textAlign = 'left';
		for (const st of scenario.field.stations) {
			const [x, y] = toScreen(st.lat, st.lon);
			if (x < 0 || y < 0 || x > size || y > size) continue;
			const len = 5 + Math.min(16, Math.hypot(st.u, st.v) / 5);
			const a = Math.atan2(st.u, st.v);
			const dx = Math.sin(a) * len;
			const dy = -Math.cos(a) * len;
			ctx.strokeStyle = theme.dim;
			ctx.lineWidth = 1.2;
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x + dx, y + dy);
			ctx.moveTo(x + dx, y + dy);
			ctx.lineTo(x + dx - Math.sin(a - 0.5) * 5, y + dy + Math.cos(a - 0.5) * 5);
			ctx.moveTo(x + dx, y + dy);
			ctx.lineTo(x + dx - Math.sin(a + 0.5) * 5, y + dy + Math.cos(a + 0.5) * 5);
			ctx.stroke();
			outlined(ctx, `${Math.round(st.humidity * 100)}%`, x + 4, y + 11, theme.gridText);
		}
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
		ctx.font = fontOf(Math.max(9, size / 72), theme.hand);
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

	/** Where a map built for one view lands in the current view. */
	function mapRect(v: View): [number, number, number] {
		const span = (size + 2 * margin()) * (pxPerKm / v.k);
		return [size / 2 + (v.cx - cx) * pxPerKm - span / 2, size / 2 - (v.cy - cy) * pxPerKm - span / 2, span];
	}

	function drawMap(ctx: CanvasRenderingContext2D, map: HTMLCanvasElement, v: View) {
		const [x, y, s] = mapRect(v);
		ctx.drawImage(map, x, y, s, s);
	}

	function coversView(v: View) {
		const [x, y, span] = mapRect(v);
		return x <= 0 && y <= 0 && x + span >= size && y + span >= size;
	}

	/**
	 * The map on screen stays put, stretched to the current view, until its
	 * replacement is ready. Building earlier would show a coarser fallback and then
	 * refill it, which reads as a flash, so each change of view fades in only once.
	 */
	function updateBase(now: number) {
		if (!base) {
			drawBase();
			return;
		}
		if (!baseStale) {
			waitingSince = 0;
			return;
		}
		if (!waitingSince) waitingSince = now;
		// A map that no longer fills the view can't wait for anything.
		if (!coversView(baseView)) {
			if (now - lastBuilt > 120) drawBase();
			return;
		}
		if (interacting) {
			// Only rebuild mid-gesture if the stretched map no longer fills the view.
			const off = Math.max(Math.abs(cx - baseView.cx), Math.abs(cy - baseView.cy)) * pxPerKm;
			const stretch = pxPerKm / baseView.k;
			if (now - lastBuilt > 300 && (stretch < 0.8 || stretch > 1.5 || off > margin() * 0.6)) drawBase();
			return;
		}
		if (now - fadeStart < FADE_MS || now - lastCheck < 120) return;
		lastCheck = now;
		const next = tileView();
		if (!next || next.complete || now - waitingSince > SLOW_NETWORK_MS) drawBase();
	}

	function frame(now: number) {
		const ctx = canvas?.getContext('2d');
		if (!ctx) return;
		stepView(now);
		updateBase(now);
		const ratio = dpr();
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.clearRect(0, 0, size, size);

		ctx.save();
		if (theme.shape === 'round') {
			ctx.beginPath();
			ctx.arc(size / 2, size / 2, size / 2 - 1, 0, 2 * Math.PI);
			ctx.clip();
		}

		if (backdrop && !coversView(baseView)) {
			const [x, y, span] = mapRect(baseView);
			const around = new Path2D();
			around.rect(0, 0, size, size);
			around.rect(x, y, span, span);
			ctx.save();
			ctx.clip(around, 'evenodd');
			drawMap(ctx, backdrop, backdropView);
			ctx.restore();
		}

		// A plain crossfade dims whatever both maps share, and holding either one at
		// full strength brightens the mix. This curve splits the difference, and at
		// this length the small change that's left reads as a settle, not a flash.
		const t = fadeStart && prevBase ? Math.min(1, (now - fadeStart) / FADE_MS) : 1;
		if (t < 1 && prevBase) {
			ctx.globalAlpha = Math.pow(1 - t, 0.7);
			drawMap(ctx, prevBase, prevView);
			ctx.globalAlpha = Math.pow(t, 0.7);
		}
		drawMap(ctx, base!, baseView);
		ctx.globalAlpha = 1;

		// SAGE has no sweep. Its tubes are rewritten from the display drum, so traces
		// brighten together then sag toward the next pass.
		let rewrite = 1;
		if (theme.motion === 'refresh' && !reduced()) {
			const phase = (now % DRUM_MS) / DRUM_MS;
			rewrite = Math.exp(-3.2 * phase);
			ctx.globalCompositeOperation = 'lighter';
			ctx.globalAlpha = 0.05 * Math.exp(-7 * phase);
			drawMap(ctx, base!, baseView);
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
			const [mx, my, ms] = mapRect(baseView);
			b.drawImage(base!, mx * ratio, my * ratio, ms * ratio, ms * ratio);
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

		ctx.globalAlpha = theme.motion === 'refresh' ? 0.86 + 0.14 * rewrite : 1;
		if (showFallout) drawStations(ctx);
		if (playing) {
			drawPlayback(ctx, now);
		} else {
			for (const p of placements) drawBurst(ctx, p);
		}
		// After the bursts, because a plume dims what's beneath it.
		drawObjectives(ctx, now);
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
			// A drag follows the hand exactly, so no glide here.
			goalX -= (pos.x - prev.x) / pxPerKm;
			goalY += (pos.y - prev.y) / pxPerKm;
			clampGoal();
			cx = goalX;
			cy = goalY;
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
		for (const f of ['12px "Open GOST Type B"', '12px "Overpass Mono"', '12px "Routed Gothic"', '12px "Architects Daughter"', '12px "Rock Salt"']) {
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
		// A full build waits until the view stops moving.
		interacting = true;
		clearTimeout(settle);
		settle = window.setTimeout(() => {
			interacting = false;
			baseStale = true;
		}, 140);
	});

	// The backdrop is only true to the look and data it was drawn with.
	$effect(() => {
		void size;
		void damage;
		void showDensity;
		void theme;
		void lang;
		backdrop = null;
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
	const stepFraction = 0.1;

	function nudge(dx: number, dy: number) {
		const visible = radius / goalZoom;
		goalX += dx * visible * stepFraction;
		goalY += dy * visible * stepFraction;
		clampGoal();
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

	const ZOOM_STEP = 1.22;
	const arrows: { label: string; glyph: string; dx: number; dy: number; area: string }[] = [
		{ label: 'North', glyph: '▲', dx: 0, dy: 1, area: 'n' },
		{ label: 'West', glyph: '◀', dx: -1, dy: 0, area: 'w' },
		{ label: 'East', glyph: '▶', dx: 1, dy: 0, area: 'e' },
		{ label: 'South', glyph: '▼', dx: 0, dy: -1, area: 's' }
	];

	// The instruments read the weather at the selected warhead, or at the middle of the map before one is placed.
	const here = $derived.by(() => {
		const p = placements.find((q) => q.slot === selected);
		return p ? weatherFor(scenario, p.lat, p.lon) : scenario.weather;
	});
	// Point anywhere to read the air there.
	const airReadout = $derived.by(() => {
		if (!scenario.field || !cursor) return '';
		const w = scenario.field.at(cursor.lat, cursor.lon);
		return ` · ${Math.round(w.humidity * 100)}% · ${w.tempC}°C · ${String(w.windBearing).padStart(3, '0')}° ${fmtWind(w.windKmh, lang)}`;
	});

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
		<Instruments
			{lang}
			totalKt={placements.reduce((sum, p) => sum + p.kt, 0)}
			windBearing={here.windBearing}
			windKmh={here.windKmh}
			humidity={scenario.field ? (here as LocalWeather).humidity : null}
		/>
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
			{#if theme.id === 'sage'}<span class="expansion">EXPANSION</span>{/if}
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
		<div class="credit">
			<span>{lang === 'ru' ? 'ДАННЫЕ КАРТЫ' : 'MAP DATA'}</span>
			<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OPENSTREETMAP</a>
			<a href="https://openfreemap.org" target="_blank" rel="noreferrer">OPENFREEMAP</a>
			<a href="https://www.openmaptiles.org/" target="_blank" rel="noreferrer">© OPENMAPTILES</a>
		</div>
	</div>
</div>
<div class="readout">
	<span class="coords">{readout}{airReadout}</span>
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
		gap: 14px;
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
	/* On the real console each key has a white rule running across the panel to the tube's rim. */
	:global([data-theme='sage']) .padkey {
		position: relative;
	}
	@media (min-width: 901px) {
		:global([data-theme='sage']) .zooms .padkey::before,
		:global([data-theme='sage']) .arrows .padkey[style*='w']::before {
			content: '';
			position: absolute;
			right: 100%;
			top: 50%;
			width: 90px;
			height: 1px;
			background: rgba(232, 234, 228, 0.7);
			pointer-events: none;
		}
	}
	.expansion {
		font: 10px var(--engraved);
		letter-spacing: 0.12em;
		text-align: center;
		color: var(--text);
		text-shadow: var(--text-shadow);
	}
	.padkey:hover {
		filter: brightness(1.12);
	}
	.padkey:active {
		transform: translateY(4px);
		box-shadow: var(--key-pressed);
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
			align-items: center;
		}
		.pad {
			flex-wrap: wrap;
		}
		.pad .credit {
			flex-direction: row;
			flex-wrap: wrap;
			justify-content: center;
			gap: 0 10px;
			width: 100%;
			padding: 4px 8px;
			background: var(--gauge-case);
		}
	}
	.tube {
		position: relative;
		z-index: 1;
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
	/* Coordinates and zoom change as you play, so they sit in a lit window rather than on the metal. */
	.readout {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 4px 16px;
		margin-top: 10px;
		padding: 4px 10px;
		border-radius: 2px;
		font: 13px var(--crt);
		letter-spacing: 0.08em;
		color: var(--well-ink);
		background: var(--well-face);
		box-shadow: var(--well-shadow);
	}
	.coords {
		text-shadow: var(--readout-glow);
	}
	/* A small riveted data plate, as on any piece of equipment. Its words never change. */
	.credit {
		display: flex;
		flex-direction: column;
		gap: 1px;
		width: 112px;
		padding: 5px 7px 5px 11px;
		border: 1px solid var(--gauge-rim);
		border-radius: 2px;
		font: 8.5px/1.35 var(--crt);
		letter-spacing: 0.02em;
		color: var(--gauge-plate-ink);
		background:
			radial-gradient(circle 1.6px at 5px 8px, var(--gauge-rim) 99%, transparent),
			radial-gradient(circle 1.6px at 5px calc(100% - 8px), var(--gauge-rim) 99%, transparent),
			var(--gauge-case);
		box-shadow: 0 1px 2px var(--gauge-drop);
	}
	.credit span {
		font-weight: 700;
	}
	.credit a {
		color: inherit;
		text-decoration: none;
	}
	.credit a:hover {
		text-decoration: underline;
	}
</style>
