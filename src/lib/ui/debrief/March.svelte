<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import type { March } from '#lib/game/debrief.ts';
	import { rngFor } from '#lib/game/rng.ts';
	import type { Fmt } from './fmt.ts';

	interface Labels {
		title: (map: string) => string;
		legend: (perMm: string, perFigure: string) => string;
		reached: string;
		survive: string;
		untouched: (n: string) => string;
		dead: string;
		causes: Record<string, string>;
		table: string;
		when: (cause: string, s: number | null) => string;
		replay: string;
		readout: (cause: string, deaths: string, share: string, weapons: string) => string;
		hint: string;
		desc: (deaths: string, injured: string) => string;
		injured: string;
		scored: (n: string) => string;
		injuredRead: (total: string, blast: string, burns: string, sickness: string) => string;
		key: { living: string; hurt: string; doomed: string; figure: string };
	}

	interface Props {
		march: March;
		places: { name: string; deaths: number }[];
		day: number;
		map: string;
		F: Fmt;
		labels: Labels;
	}

	let { march, places, day, map, F, labels }: Props = $props();

	let host = $state<HTMLElement | null>(null);
	let canvas = $state<HTMLCanvasElement | null>(null);
	let width = $state(0);
	let hovered = $state<number | null>(null);
	let done = $state(false);
	let scale = $state({ perMm: '', perFigure: '' });

	const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const DURATION = 10000;
	/** The line first advances across the page, then the piles fill. Shares of the run. */
	const REVEAL = 0.13;
	const STARTS: Record<string, [number, number]> = { radiation: [0.12, 0.42], burns: [0.15, 0.5], blast: [0.22, 0.56], firestorm: [0.34, 0.5], fallout: [0.5, 0.5], cancer: [0.66, 0.34], injured: [0.3, 0.7] };
	const NICE = [1, 2, 5];
	const WALKER = 8;

	interface Point {
		x: number;
		y: number;
	}
	interface Strand {
		index: number;
		width: number;
		/** From the wound to the field. */
		drop: Point[];
		/** The whole walk: along the dark stripe, then down the wound. */
		walk: Point[];
		length: number;
		walkers: number;
	}
	interface Slot extends Point {
		size: number;
		alpha: number;
	}
	interface Column {
		strands: Strand[];
		start: number;
		span: number;
		figures: number;
		drawn: number;
		slots: Slot[];
		x: number;
		w: number;
	}

	let columns: Column[] = [];
	let layout: { h: number; unit: number; fieldTop: number; fieldBottom: number; labelY: number; narrow: boolean } | null = null;
	let poses: HTMLCanvasElement[] = [];
	let hurtPoses: HTMLCanvasElement[] = [];
	let walker: HTMLCanvasElement | null = null;
	let backdrop: HTMLCanvasElement | null = null;
	let pile: HTMLCanvasElement | null = null;
	let raf = 0;
	let started = 0;
	let observer: IntersectionObserver | null = null;
	let colours: Record<string, string> = {};
	const ratio = () => Math.min(window.devicePixelRatio || 1, 2);

	function offscreen(w: number, h: number) {
		const c = document.createElement('canvas');
		c.width = Math.round(w * ratio());
		c.height = Math.round(h * ratio());
		c.getContext('2d')!.scale(ratio(), ratio());
		return c;
	}

	function polyLength(path: Point[]) {
		let sum = 0;
		for (let i = 1; i < path.length; i++) sum += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
		return sum;
	}

	function along(path: Point[], length: number, u: number): Point {
		let left = u * length;
		for (let i = 1; i < path.length; i++) {
			const a = path[i - 1];
			const b = path[i];
			const seg = Math.hypot(b.x - a.x, b.y - a.y);
			if (left <= seg) return seg ? { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg } : a;
			left -= seg;
		}
		return path[path.length - 1];
	}

	function yOn(path: Point[], x: number) {
		for (let i = 1; i < path.length; i++) {
			if (x <= path[i].x) return path[i - 1].y + ((path[i].y - path[i - 1].y) * (x - path[i - 1].x)) / Math.max(path[i].x - path[i - 1].x, 1e-6);
		}
		return path[path.length - 1].y;
	}

	/** Figures in receding rows, from large at the front to small at the horizon. Null if they don't all fit. */
	function fieldSlots(x: number, w: number, count: number, top: number, bottom: number, big: number): Slot[] | null {
		const out: Slot[] = [];
		const small = 2.6;
		for (let y = bottom; out.length < count; ) {
			const depth = (y - top) / (bottom - top);
			if (depth < 0.02) return null;
			const size = small + (big - small) * Math.pow(depth, 1.25);
			const rowW = w * (0.34 + 0.66 * depth);
			const fits = Math.max(1, Math.floor(rowW / (size * 0.86)));
			const n = Math.min(fits, count - out.length);
			const centre = x + w / 2;
			for (let k = 0; k < n; k++) out.push({ x: centre + (k - (n - 1) / 2) * size * 0.86, y: y - size / 2, size, alpha: 0.42 + 0.58 * depth });
			y -= size * 0.98;
		}
		return out;
	}

	function person(c: number, colour: string, pose: number) {
		const s = offscreen(c, c);
		const x = s.getContext('2d')!;
		x.fillStyle = colour;
		x.strokeStyle = colour;
		x.lineCap = 'round';
		const limb = (w: number, ...p: number[]) => {
			x.lineWidth = w * c;
			x.beginPath();
			for (let i = 0; i < p.length; i += 2) (i ? x.lineTo : x.moveTo).call(x, p[i] * c, p[i + 1] * c);
			x.stroke();
		};
		const head = (hx: number, hy: number) => {
			x.beginPath();
			x.arc(hx * c, hy * c, c * 0.13, 0, Math.PI * 2);
			x.fill();
		};
		if (pose === 0) {
			head(0.5, 0.16);
			limb(0.24, 0.5, 0.36, 0.5, 0.62);
			limb(0.1, 0.42, 0.62, 0.38, 0.95);
			limb(0.1, 0.58, 0.62, 0.62, 0.95);
		} else if (pose === 1) {
			head(0.58, 0.2);
			limb(0.24, 0.54, 0.38, 0.42, 0.62);
			limb(0.1, 0.42, 0.62, 0.62, 0.95);
			limb(0.1, 0.38, 0.62, 0.2, 0.92);
		} else {
			head(0.2, 0.76);
			limb(0.24, 0.34, 0.8, 0.62, 0.84);
			limb(0.1, 0.62, 0.84, 0.92, 0.9);
		}
		return s;
	}

	function build() {
		if (!canvas || !host || width < 10) return;
		const css = getComputedStyle(host);
		for (const name of ['live', 'dead', 'wound', 'doomed', 'hurt', 'halo', 'ink', 'soft', 'rule']) colours[name] = css.getPropertyValue(`--march-${name}`).trim();
		const mono = css.getPropertyValue('--d-mono').trim();

		const narrow = width < 620;
		const stations = march.stations;
		// The injured leave last, into a field of their own. They aren't one of the arrivals of death.
		const hurtTotal = march.injuries.total >= 0.5 ? march.injuries.total : 0;
		const columnsOf = [...stations.map((s) => ({ cause: s.cause as string, count: s.deaths, byWeapon: s.byWeapon })), ...(hurtTotal ? [{ cause: 'injured', count: hurtTotal, byWeapon: [{ index: -1, deaths: hurtTotal }] }] : [])];
		const n = columnsOf.length;
		const bandZone = narrow ? 200 : 282;
		const fieldTop = bandZone + (narrow ? 30 : 42);
		const fieldBottom = fieldTop + (narrow ? 210 : 320);
		const labelY = fieldBottom + (narrow ? 15 : 18);
		const tableTop = labelY + (narrow ? 48 : 54);
		const tableBottom = tableTop + 82;
		const h = tableBottom + 28;

		canvas.width = Math.round(width * ratio());
		canvas.height = Math.round(h * ratio());
		canvas.style.height = `${h}px`;

		// Like the Minard map, width is people, to one scale from start to finish.
		const maxBand = narrow ? 72 : 112;
		const perPx = march.reached / maxBand;
		const left = 0;
		const right = width;
		const colW = (width - 12) / Math.max(n, 1);
		const stationX = columnsOf.map((_, i) => 6 + (i + 0.5) * colW);

		const rng = rngFor(day, 'march');
		const lift = (x: number) => bandZone * (0.74 - 0.28 * ((x - left) / (right - left)));
		const jitter = () => (rng() - 0.5) * bandZone * 0.22;
		const stripe = (dead: number) => (dead < 0.5 ? 0 : Math.max(1.6, dead / perPx));
		const knots: { x: number; y: number; w: number; dark: number; hurt: number }[] = [];
		let alive = march.reached;
		let doomed = march.deaths;
		let hurt = hurtTotal;
		const here = (x: number, y: number) => ({ x, y, w: alive / perPx, dark: stripe(doomed), hurt: stripe(hurt) });
		knots.push(here(left, lift(left) + jitter()));
		columnsOf.forEach((c, i) => {
			const x = stationX[i];
			const prev = i ? stationX[i - 1] : left;
			knots.push(here(prev + (x - prev) * (0.42 + rng() * 0.24), lift(x - 20) + jitter()));
			knots.push(here(x - 3, lift(x) + jitter()));
			const yAt = knots[knots.length - 1].y;
			alive -= c.count;
			if (c.cause === 'injured') hurt = 0;
			else doomed -= c.count;
			knots.push(here(x + 7, yAt - 1));
		});
		knots.push(here(right, lift(right) + jitter()));

		const top = knots.map((k) => ({ x: k.x, y: k.y - k.w / 2 }));
		const bottom = knots.map((k) => ({ x: k.x, y: k.y + k.w / 2 }));
		const stripeTop = knots.map((k) => ({ x: k.x, y: k.y + k.w / 2 - k.dark }));
		const stripeMid = knots.map((k) => ({ x: k.x, y: k.y + k.w / 2 - k.dark / 2 }));
		const hurtTop = knots.map((k) => ({ x: k.x, y: k.y + k.w / 2 - k.dark - k.hurt }));
		const hurtMid = knots.map((k) => ({ x: k.x, y: k.y + k.w / 2 - k.dark - k.hurt / 2 }));

		// One figure stands for the fewest people that lets every column fit its field and stay countable.
		const big = narrow ? 10 : 17;
		const fieldFor = (unit: number) => {
			const out: (Slot[] | null)[] = columnsOf.map((s, i) => fieldSlots(6 + i * colW + 5, colW - 10, Math.max(1, Math.round(s.count / unit)), fieldTop, fieldBottom, big));
			const total = out.reduce((sum, a) => sum + (a?.length ?? 0), 0);
			return out.every(Boolean) && total <= 3600 ? (out as Slot[][]) : null;
		};
		let unit = 1;
		let slots: Slot[][] | null = fieldFor(1);
		for (let decade = 1; !slots; decade *= 10) {
			for (const m of NICE) {
				unit = m * decade;
				slots = fieldFor(unit);
				if (slots) break;
			}
		}
		const chosen = slots;

		columns = columnsOf.map((s, i) => {
			const knotIndex = 2 + i * 3;
			const k = knots[knotIndex];
			const x = 6 + i * colW + 5;
			const w = colW - 10;
			const cx = x + w / 2;
			const y0 = k.y + k.w / 2 - 0.5;
			const yEnd = Math.min(...chosen[i].map((p) => p.y - p.size / 2)) - 3;
			const totalW = s.byWeapon.reduce((sum, wp) => sum + Math.max(1.3, wp.deaths / perPx), 0);
			const swing = Math.min(w * 0.3, 44);
			const side = rng() < 0.5 ? -1 : 1;
			const y1 = y0 + (yEnd - y0) * (0.2 + rng() * 0.08);
			const y2 = y0 + (yEnd - y0) * (0.52 + rng() * 0.08);
			const x1 = stationX[i] + side * swing * (0.45 + rng() * 0.5);
			const x2 = cx - side * swing * (0.25 + rng() * 0.5);
			const topRow = chosen[i].filter((p) => p.y - p.size / 2 <= yEnd + 12);
			const fan = Math.max(6, topRow.length ? Math.max(...topRow.map((p) => p.x)) - Math.min(...topRow.map((p) => p.x)) : 6) * 0.72;
			let across = -totalW / 2;
			const strands: Strand[] = s.byWeapon.map((wp, j) => {
				const sw = Math.max(1.3, wp.deaths / perPx);
				const off = across + sw / 2;
				across += sw;
				const fanAt = s.byWeapon.length > 1 ? (j / (s.byWeapon.length - 1) - 0.5) * fan : 0;
				const spread = s.byWeapon.length > 1 ? (j - (s.byWeapon.length - 1) / 2) * Math.min(14, 40 / s.byWeapon.length) : 0;
				const drop: Point[] = [
					{ x: stationX[i] + off, y: y0 },
					{ x: x1 + off, y: y1 },
					{ x: x2 + off + spread, y: y2 + spread * 0.5 },
					{ x: cx + fanAt, y: yEnd }
				];
				const walk = [...(s.cause === 'injured' ? hurtMid : stripeMid).slice(0, knotIndex + 1), ...drop];
				return { index: wp.index, width: sw, drop, walk, length: polyLength(walk), walkers: Math.max(4, Math.round((64 * wp.deaths) / Math.max(s.count, 1))) };
			});
			const [start, span] = STARTS[s.cause];
			return { strands, start, span, figures: chosen[i].length, drawn: 0, slots: chosen[i], x, w };
		});

		layout = { h, unit, fieldTop, fieldBottom, labelY, narrow };
		scale = { perMm: F.count(perPx * 3.78), perFigure: F.count(unit) };
		poses = [0, 1, 2].map((p) => person(36, colours.dead, p));
		hurtPoses = [0, 1, 2].map((p) => person(36, colours.hurt, p));
		walker = person(WALKER * 2, colours.live, 0);
		pile = offscreen(width, h);

		// Everything that doesn't move.
		backdrop = offscreen(width, h);
		const b = backdrop.getContext('2d')!;
		b.lineJoin = 'miter';

		// The horizon the rows recede to, and the lines dropped from the march to the table.
		b.strokeStyle = colours.soft;
		b.lineWidth = 0.7;
		b.beginPath();
		b.moveTo(6, fieldTop);
		b.lineTo(width - 6, fieldTop);
		b.stroke();
		b.strokeStyle = colours.rule;
		b.lineWidth = 1;
		stationX.forEach((sx) => {
			b.beginPath();
			b.moveTo(sx, 14);
			b.lineTo(sx, tableBottom);
			b.stroke();
		});

		const edge = (p: Point[]) => {
			const out: Point[] = [];
			for (let i = 0; i < p.length - 1; i++) {
				out.push(p[i]);
				const steps = Math.floor((p[i + 1].x - p[i].x) / 13);
				for (let k = 1; k < steps; k++) {
					const t = k / steps;
					out.push({ x: p[i].x + (p[i + 1].x - p[i].x) * t, y: p[i].y + (p[i + 1].y - p[i].y) * t + (rng() - 0.5) * 1.9 });
				}
			}
			out.push(p[p.length - 1]);
			return out;
		};
		const shape = (upper: Point[], lower: Point[]) => {
			b.beginPath();
			upper.forEach((p, i) => (i ? b.lineTo(p.x, p.y) : b.moveTo(p.x, p.y)));
			[...lower].reverse().forEach((p) => b.lineTo(p.x, p.y));
			b.closePath();
		};

		// The people in reach.
		const upperEdge = edge(top);
		const lowerEdge = edge(bottom);
		shape(upperEdge, lowerEdge);
		b.fillStyle = colours.live;
		b.fill();
		// Lithographer's hatching along the march.
		b.save();
		shape(upperEdge, lowerEdge);
		b.clip();
		b.strokeStyle = colours.rule;
		b.lineWidth = 0.7;
		for (let f = 0.08; f < 1; f += 0.075) {
			b.beginPath();
			knots.forEach((k, i) => {
				const y = k.y - k.w / 2 + k.w * f;
				i ? b.lineTo(k.x, y) : b.moveTo(k.x, y);
			});
			b.stroke();
		}
		b.restore();

		// The ones who will die are already in the column, a dark vein along its underside until each hazard takes them.
		if (hurtTotal) {
			const hurtEnd = 2 + (n - 1) * 3 + 1;
			shape(edge(hurtTop.slice(0, hurtEnd + 1)), edge(stripeTop.slice(0, hurtEnd + 1)));
			b.fillStyle = colours.hurt;
			b.fill();
		}
		const veinEnd = 2 + (stations.length - 1) * 3 + 1;
		const veinTop = edge(stripeTop.slice(0, veinEnd + 1));
		const veinBottom = lowerEdge.filter((p) => p.x <= knots[veinEnd].x);
		shape(veinTop, veinBottom);
		b.fillStyle = colours.doomed;
		b.fill();
		b.strokeStyle = colours.wound;
		b.lineWidth = 1;
		b.beginPath();
		veinTop.forEach((p, i) => (i ? b.lineTo(p.x, p.y) : b.moveTo(p.x, p.y)));
		b.stroke();
		shape(upperEdge, lowerEdge);
		b.strokeStyle = colours.soft;
		b.lineWidth = 0.9;
		b.stroke();

		// The wounds. Each hazard's dead tear away and fray into a strand per warhead.
		columns.forEach((col, c) => {
			const hurtColumn = columnsOf[c].cause === 'injured';
			const trace = (s: Strand) => {
				b.beginPath();
				s.drop.forEach((p, i) => (i ? b.lineTo(p.x, p.y) : b.moveTo(p.x, p.y)));
			};
			col.strands.forEach((s) => {
				trace(s);
				b.strokeStyle = hurtColumn ? colours.soft : colours.wound;
				b.lineWidth = s.width + (hurtColumn ? 1.2 : 2.2);
				b.stroke();
			});
			col.strands.forEach((s) => {
				trace(s);
				b.strokeStyle = hurtColumn ? colours.hurt : colours.dead;
				b.lineWidth = s.width;
				b.stroke();
			});
			// Warhead numbers where the strands have parted, on the outside of the outer ones.
			if (!narrow && col.strands.length > 1) {
				b.font = `10px ${mono}`;
				b.lineJoin = 'round';
				col.strands.forEach((s, j) => {
					const first = j < col.strands.length / 2;
					const at = s.drop[3];
					const mid = { x: s.drop[2].x + (at.x - s.drop[2].x) * 0.55, y: s.drop[2].y + (at.y - s.drop[2].y) * 0.55 };
					b.textAlign = first ? 'right' : 'left';
					const tx = mid.x + (first ? -1 : 1) * (s.width / 2 + 4);
					b.strokeStyle = colours.halo;
					b.lineWidth = 3;
					b.strokeText(`№${s.index + 1}`, tx, mid.y + 3);
					b.fillStyle = colours.ink;
					b.fillText(`№${s.index + 1}`, tx, mid.y + 3);
				});
				b.lineJoin = 'miter';
			}
			if (hurtColumn) return;
			// Blood let into the paper around the tear.
			const p0 = col.strands[0].drop[0];
			b.fillStyle = colours.wound;
			for (let k = 0; k < 26; k++) {
				const a = rng() * Math.PI * 2;
				const r = 3 + rng() * rng() * 34;
				b.globalAlpha = 0.25 + rng() * 0.55;
				b.beginPath();
				b.arc(p0.x + Math.cos(a) * r, p0.y + 5 + Math.abs(Math.sin(a)) * r, 0.5 + rng() * 1.3, 0, Math.PI * 2);
				b.fill();
			}
			b.globalAlpha = 1;
		});

		// Towns along the route, with what each lost, as the original names them.
		const room = right - left - (narrow ? 70 : 130);
		const named = places.slice(0, narrow ? 2 : 5);
		b.textAlign = 'center';
		named.forEach((p, i) => {
			const x = left + (narrow ? 34 : 80) + (room * (i + 0.5)) / named.length;
			const y = yOn(top, x);
			b.strokeStyle = colours.soft;
			b.lineWidth = 0.8;
			b.beginPath();
			b.moveTo(x, y);
			b.lineTo(x, y - 11);
			b.stroke();
			b.fillStyle = colours.ink;
			b.font = `italic ${narrow ? 9.5 : 11}px ${mono}`;
			b.fillText(p.name, x, y - 26);
			b.fillStyle = colours.wound;
			b.font = `700 ${narrow ? 9.5 : 11}px ${mono}`;
			b.fillText(F.count(p.deaths), x, y - 14);
		});

		// Figures written on the band.
		b.textAlign = 'left';
		b.fillStyle = colours.ink;
		// Above the band, because the dark vein can fill most of it.
		b.font = `700 ${narrow ? 11 : 14}px ${mono}`;
		const reachedText = F.count(march.reached);
		b.fillText(reachedText, left + 3, top[0].y - 7);
		const reachedW = b.measureText(reachedText).width;
		b.font = `${narrow ? 9.5 : 11.5}px ${mono}`;
		b.fillText(labels.reached, left + 3 + reachedW + 6, top[0].y - 7);
		// Who walks off the end of the sheet. Lettered across the band if there's room, otherwise above it.
		b.textAlign = 'right';
		b.lineJoin = 'round';
		const endTop = top[top.length - 1].y;
		const endH = bottom[bottom.length - 1].y - endTop;
		const endY = endH > 34 ? endTop + endH / 2 : endTop - 20;
		b.strokeStyle = colours.halo;
		b.lineWidth = 3;
		b.font = `700 ${narrow ? 10.5 : 13}px ${mono}`;
		const unhurt = F.count(march.survivors - hurtTotal);
		b.strokeText(unhurt, width - 8, endY);
		b.fillText(unhurt, width - 8, endY);
		b.font = `${narrow ? 10 : 12}px ${mono}`;
		b.strokeText(labels.survive, width - 8, endY + 14);
		b.fillText(labels.survive, width - 8, endY + 14);
		b.lineJoin = 'miter';

		// The table below: how many are dead by each arrival.
		b.textAlign = 'left';
		let tableFont = 11.5;
		b.font = `700 ${tableFont}px ${mono}`;
		while (tableFont > 6 && b.measureText(labels.table).width > width - 22) {
			tableFont -= 0.5;
			b.font = `700 ${tableFont}px ${mono}`;
		}
		b.fillStyle = colours.ink;
		b.fillText(labels.table, 10, tableTop - 8);
		b.strokeStyle = colours.soft;
		b.lineWidth = 1;
		b.strokeRect(9.5, tableTop + 0.5, width - 19, tableBottom - tableTop);
		const tableY = (dead: number) => tableTop + 10 + (1 - dead / Math.max(march.deaths, 1)) * (tableBottom - tableTop - 20);
		const stepped: Point[] = [{ x: 10, y: tableY(0) }];
		let cumulative = 0;
		stations.forEach((st, i) => {
			stepped.push({ x: stationX[i], y: tableY(cumulative) });
			cumulative += st.deaths;
			stepped.push({ x: stationX[i] + 10, y: tableY(cumulative) });
		});
		stepped.push({ x: width - 10, y: tableY(cumulative) });
		b.beginPath();
		stepped.forEach((p, i) => (i ? b.lineTo(p.x, p.y) : b.moveTo(p.x, p.y)));
		b.lineTo(width - 10, tableBottom);
		b.lineTo(10, tableBottom);
		b.closePath();
		b.fillStyle = colours.doomed;
		b.globalAlpha = 0.16;
		b.fill();
		b.globalAlpha = 1;
		b.strokeStyle = colours.dead;
		b.lineWidth = 2;
		b.beginPath();
		stepped.forEach((p, i) => (i ? b.lineTo(p.x, p.y) : b.moveTo(p.x, p.y)));
		b.stroke();
		cumulative = 0;
		b.font = `${narrow ? 9.5 : 11}px ${mono}`;
		stations.forEach((st, i) => {
			cumulative += st.deaths;
			b.fillStyle = colours.ink;
			b.textAlign = i === n - 1 && narrow ? 'right' : 'left';
			const tx = i === n - 1 && narrow ? width - 14 : stationX[i] + 14;
			const lineY = tableY(cumulative);
			b.fillText(F.count(cumulative), tx, lineY - 5 < tableTop + 11 ? lineY + 13 : lineY - 5);
			b.fillStyle = colours.soft;
			b.textAlign = 'center';
			b.fillText(labels.when(st.cause, st.byS), Math.max(46, Math.min(width - 46, stationX[i])), tableBottom + 15);
		});

		// Column names.
		b.textAlign = 'center';
		b.fillStyle = colours.ink;
		columns.forEach((col, i) => {
			b.font = `700 ${narrow ? 10.5 : 12.5}px ${mono}`;
			b.fillText(columnsOf[i].cause === 'injured' ? labels.injured : labels.causes[columnsOf[i].cause], col.x + col.w / 2, labelY);
		});
	}

	function reset() {
		columns.forEach((col) => (col.drawn = 0));
		if (pile && layout) pile.getContext('2d')!.clearRect(0, 0, width, layout.h);
		done = false;
	}

	const progress = (col: Column, t: number) => {
		const u = Math.max(0, Math.min(1, (t - col.start) / col.span));
		// Slow at first, then too fast to follow.
		return Math.pow(u, 2.6);
	};

	function paint(t: number) {
		if (!canvas || !layout || !backdrop || !pile || !walker) return;
		const ctx = canvas.getContext('2d')!;
		const dpr = ratio();
		const { h, narrow, fieldTop, fieldBottom, labelY } = layout;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, h);

		// The line advances across the sheet first, as a march would.
		const advance = Math.min(1, t / REVEAL);
		ctx.save();
		ctx.beginPath();
		ctx.rect(0, 0, width * advance, h);
		ctx.clip();
		ctx.drawImage(backdrop, 0, 0, width, h);
		ctx.restore();

		const p = pile.getContext('2d')!;
		let total = 0;
		let hurtNow = 0;
		const mono = getComputedStyle(canvas).getPropertyValue('--d-mono');
		columns.forEach((col, i) => {
			const f = progress(col, t);
			const want = Math.round(col.figures * f);
			const dead = i < march.stations.length;
			for (; col.drawn < want; col.drawn++) {
				const s = col.slots[col.drawn];
				p.globalAlpha = s.alpha;
				// Most stand in the rows. Every so often one has already fallen.
				const pose = (col.drawn * 2654435761) % 11 === 0 ? 2 : (col.drawn * 2654435761) % 5 === 0 ? 1 : 0;
				p.drawImage((dead ? poses : hurtPoses)[pose], s.x - s.size / 2, s.y - s.size / 2, s.size, s.size);
			}
			p.globalAlpha = 1;
			if (dead) total += march.stations[i].deaths * f;
			else hurtNow = march.injuries.total * f;
		});
		ctx.drawImage(pile, 0, 0, width, h);

		// People walking along the dark vein and down each wound while its field is still filling.
		columns.forEach((col) => {
			const f = progress(col, t);
			if (t < col.start * 0.4 || f >= 1) return;
			col.strands.forEach((s) => {
				const spread = Math.max(0, s.width / 2 - 2);
				for (let k = 0; k < s.walkers; k++) {
					const u = ((t * DURATION) / 3400 + k / s.walkers + (k % 7) * 0.011) % 1;
					const at = along(s.walk, s.length, u);
					const off = (((k * 37) % 11) / 5 - 1) * spread;
					ctx.drawImage(walker!, at.x + off - WALKER / 2, at.y - WALKER / 2, WALKER, WALKER);
				}
			});
		});

		columns.forEach((col, i) => {
			if (hovered === i) {
				ctx.strokeStyle = colours.wound;
				ctx.lineWidth = 1.5;
				ctx.strokeRect(col.x + 0.5, fieldTop - 2, col.w, fieldBottom - fieldTop + 4);
			}
			ctx.textAlign = 'center';
			ctx.font = `700 ${narrow ? 12 : 16}px ${mono}`;
			ctx.fillStyle = colours.ink;
			const count = i < march.stations.length ? march.stations[i].deaths : march.injuries.total;
			ctx.fillText(F.count(count * progress(col, t)), col.x + col.w / 2, labelY + (narrow ? 17 : 21));
		});

		// The running totals, in the clear corner above where the band starts low.
		ctx.textAlign = 'left';
		ctx.font = `700 ${narrow ? 22 : 36}px ${mono}`;
		ctx.fillStyle = colours.wound;
		const deadText = F.count(total);
		ctx.fillText(deadText, 2, narrow ? 24 : 36);
		const after = ctx.measureText(deadText).width + (narrow ? 5 : 9);
		ctx.font = `${narrow ? 10.5 : 12}px ${mono}`;
		ctx.fillStyle = colours.ink;
		ctx.fillText(labels.dead, 2 + after, narrow ? 24 : 36);
		if (march.deaths - march.scored >= 0.5) {
			ctx.fillText(labels.scored(F.count(march.scored)), 2, narrow ? 54 : 78);
		}
		if (march.injuries.total >= 0.5) {
			ctx.font = `700 ${narrow ? 13 : 19}px ${mono}`;
			ctx.fillStyle = colours.hurt;
			const hurtText = F.count(hurtNow);
			ctx.fillText(hurtText, 2, narrow ? 41 : 60);
			const beyond = ctx.measureText(hurtText).width + (narrow ? 5 : 8);
			ctx.font = `${narrow ? 10.5 : 12}px ${mono}`;
			ctx.fillStyle = colours.ink;
			ctx.fillText(labels.injured.toLowerCase(), 2 + beyond, narrow ? 41 : 60);
		}
	}

	function loop(now: number) {
		const t = Math.min(1, (now - started) / DURATION);
		paint(t);
		if (t < 1) raf = requestAnimationFrame(loop);
		else done = true;
	}

	function run() {
		cancelAnimationFrame(raf);
		reset();
		if (reduced) {
			paint(1);
			done = true;
			return;
		}
		started = performance.now();
		raf = requestAnimationFrame(loop);
	}

	let shown = false;
	function refresh() {
		build();
		reset();
		// A resize after the run starts just redraws the finished picture.
		paint(shown ? 1 : 0);
		if (shown) done = true;
	}

	onMount(() => {
		observer = new IntersectionObserver(
			(entries) => {
				if (shown || !entries[0].isIntersecting) return;
				shown = true;
				run();
			},
			{ threshold: 0.5 }
		);
		if (host) observer.observe(host);
	});
	onDestroy(() => {
		cancelAnimationFrame(raf);
		observer?.disconnect();
	});

	$effect(() => {
		void [width, march];
		if (width > 10) {
			cancelAnimationFrame(raf);
			// Only a new size or plan rebuilds it. Painting also reads the hover, which must not restart the run.
			untrack(refresh);
		}
	});

	function move(e: PointerEvent) {
		if (!canvas || !columns.length) return;
		const x = e.clientX - canvas.getBoundingClientRect().left;
		const i = columns.findIndex((col) => x >= col.x - 5 && x <= col.x + col.w + 5);
		hovered = i < 0 ? null : i;
		if (done) paint(1);
	}
	function leave() {
		hovered = null;
		if (done) paint(1);
	}

	const focus = $derived(hovered === null ? null : (march.stations[hovered] ?? null));
	const focusHurt = $derived(hovered !== null && hovered >= march.stations.length);
</script>

<figure class="march" bind:this={host}>
	<figcaption>
		<b>{labels.title(map)}</b>
		<span>{labels.legend(scale.perMm, scale.perFigure)}</span>
		<ul class="key">
			<li><i class="live"></i>{labels.key.living}</li>
			{#if march.injuries.total >= 0.5}<li><i class="hurt"></i>{labels.key.hurt}</li>{/if}
			<li><i class="doomed"></i>{labels.key.doomed}</li>
		</ul>
	</figcaption>
	<div class="sheet" bind:clientWidth={width}>
		<canvas bind:this={canvas} style:width={`${width}px`} aria-label={labels.desc(F.count(march.deaths), F.count(march.injuries.total))} onpointermove={move} onpointerleave={leave}></canvas>
	</div>
	<div class="foot">
		<p aria-live="polite">
			{#if focusHurt}
				{labels.injuredRead(F.count(march.injuries.total), F.count(march.injuries.blast), F.count(march.injuries.burns), F.count(march.injuries.sickness))}
			{:else if focus}
				{labels.readout(labels.causes[focus.cause], F.count(focus.deaths), F.pct(focus.deaths / Math.max(march.deaths, 1)), focus.byWeapon.map((w) => `${w.index + 1}: ${F.count(w.deaths)}`).join(' · '))}
			{:else}
				{labels.hint} {march.untouched >= 1 ? labels.untouched(F.count(march.untouched)) : ''}
			{/if}
		</p>
		<button type="button" class="dkey" onclick={run}>{labels.replay}</button>
	</div>
</figure>

<style>
	/* An engraved plate: a double rule around title, map and table together. */
	.sheet {
		min-width: 0;
	}
	.march {
		box-sizing: border-box;
		scroll-margin-top: 70px;
		margin: 16px 0 22px;
		padding: 16px 12px 10px;
		min-width: 0;
		border: 3px double var(--d-fg);
		outline: 1px solid var(--d-rule);
		outline-offset: 3px;
		background: var(--d-surface);
	}
	figcaption {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 5px;
		margin-bottom: 10px;
		padding-bottom: 9px;
		border-bottom: 1px solid var(--d-rule);
		text-align: center;
	}
	figcaption b {
		font: 700 23px/1.2 var(--d-head);
		letter-spacing: 0.03em;
	}
	.key {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 3px 16px;
		margin: 2px 0 0;
		padding: 0;
		list-style: none;
		font-size: 12px;
	}
	.key li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.key i {
		width: 20px;
		height: 9px;
		box-shadow: inset 0 0 0 0.5px var(--march-soft);
	}
	.key .live {
		background: var(--march-live);
	}
	.key .hurt {
		background: var(--march-hurt);
	}
	.key .doomed {
		background: var(--march-doomed);
	}
	figcaption span {
		font-size: 12.5px;
		line-height: 1.4;
		color: var(--d-soft);
	}
	canvas {
		display: block;
		touch-action: pan-y;
	}
	.foot {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px solid var(--d-rule);
		font-size: 13px;
	}
	.foot p {
		margin: 0;
		min-height: 2.8em;
	}
</style>
