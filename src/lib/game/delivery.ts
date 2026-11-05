// How each weapon reaches its burst point, for the report's timeline. Release heights and fall times for Little Boy,
// Fat Man (planned height) and Tsar Bomba are published. Reentry starts from the generic 100 km and 6.7 km/s. No source
// was found for B61, B83 or B53 release heights or descent rates, so those are illustrative, and the flight between
// is a simple drag model tuned to the published fall times, which is an estimate throughout.

export type DeliveryKind = 'gravity' | 'retarded' | 'reentry' | 'cruise' | 'rocket' | 'shell' | 'torpedo' | 'emplaced' | 'unbuilt';

export interface Delivery {
	kind: DeliveryKind;
	/** The aircraft, launcher or missile, in English. */
	carrier?: string;
	/** Height the weapon starts from in this view, metres. */
	startM: number;
	/** Speed at the start of the view, m/s. */
	speedMs: number;
	/** Steepness of the flight path at the start: 0 is level, 90 is straight down. */
	diveDeg: number;
	/** Speed it settles at falling, m/s. */
	terminalMs?: number;
	/** True when the start height and descent are placeholders with no source behind them. */
	illustrative?: boolean;
}

const G = 9.81;

export const DELIVERY: Record<string, Delivery> = {
	mk54: { kind: 'shell', carrier: 'M29 recoilless rifle', startM: 400, speedMs: 100, diveDeg: 25, illustrative: true },
	w70: { kind: 'rocket', carrier: 'MGM-52 Lance', startM: 30000, speedMs: 1000, diveDeg: 55, illustrative: true },
	boy: { kind: 'gravity', carrier: 'B-29 Enola Gay', startM: 9470, speedMs: 145, diveDeg: 0, terminalMs: 520 },
	fat: { kind: 'gravity', carrier: 'B-29 Bockscar', startM: 9140, speedMs: 145, diveDeg: 0, terminalMs: 480 },
	b61: { kind: 'retarded', carrier: 'strike aircraft', startM: 1500, speedMs: 250, diveDeg: 0, terminalMs: 40, illustrative: true },
	w80: { kind: 'cruise', carrier: 'AGM-86B', startM: 100, speedMs: 245, diveDeg: 0, illustrative: true },
	w76: { kind: 'reentry', carrier: 'Trident II', startM: 100000, speedMs: 6700, diveDeg: 25 },
	w87: { kind: 'reentry', carrier: 'Minuteman III', startM: 100000, speedMs: 6700, diveDeg: 25 },
	w88: { kind: 'reentry', carrier: 'Trident II', startM: 100000, speedMs: 6700, diveDeg: 25 },
	ss25: { kind: 'reentry', carrier: 'RT-2PM Topol', startM: 100000, speedMs: 6700, diveDeg: 25 },
	b83: { kind: 'retarded', carrier: 'B-2', startM: 2000, speedMs: 240, diveDeg: 0, terminalMs: 40, illustrative: true },
	df5: { kind: 'reentry', carrier: 'DF-5', startM: 100000, speedMs: 6700, diveDeg: 25 },
	b53: { kind: 'retarded', carrier: 'B-52', startM: 9000, speedMs: 220, diveDeg: 0, terminalMs: 60, illustrative: true },
	bravo: { kind: 'emplaced', carrier: 'shot cab on Namu reef', startM: 2, speedMs: 0, diveDeg: 0 },
	ss18: { kind: 'reentry', carrier: 'R-36M', startM: 100000, speedMs: 6700, diveDeg: 25 },
	pos: { kind: 'torpedo', carrier: 'Status-6', startM: 0, speedMs: 36, diveDeg: 0, illustrative: true },
	cob: { kind: 'unbuilt', startM: 0, speedMs: 0, diveDeg: 0 },
	ripple: { kind: 'reentry', carrier: 'Titan II', startM: 100000, speedMs: 6700, diveDeg: 25 },
	tsar: { kind: 'retarded', carrier: 'Tu-95', startM: 10500, speedMs: 200, diveDeg: 0, terminalMs: 35 },
	tsar2: { kind: 'retarded', carrier: 'Tu-95', startM: 10500, speedMs: 200, diveDeg: 0, terminalMs: 35 },
	gnomon: { kind: 'unbuilt', startM: 0, speedMs: 0, diveDeg: 0 },
	sundial: { kind: 'unbuilt', startM: 0, speedMs: 0, diveDeg: 0 }
};

export interface FlightPoint {
	/** Seconds before detonation, as a negative number. */
	t: number;
	altM: number;
	/** Horizontal position relative to ground zero, metres. Negative is before arriving. */
	xM: number;
	speedMs: number;
	/** Direction of travel below level, degrees. */
	diveDeg: number;
}

export interface Flight {
	delivery: Delivery;
	durationS: number;
	/** Seconds before detonation at which the weapon leaves its carrier, or 0 if it doesn't. */
	releaseS: number;
	/** Seconds before detonation at which a parachute opens, or 0. */
	chuteS: number;
	at(t: number): FlightPoint;
	/** How much of the delivery's start height had to be raised to sit above this burst. */
	raised: boolean;
}

const LEAD_S = 12;

/** Integrates from release down to the burst height, then measures time back from detonation. */
export function flightFor(id: string, hobM: number): Flight {
	const delivery = DELIVERY[id];
	const { kind } = delivery;
	const raised = delivery.startM < hobM + 300 && kind !== 'torpedo' && kind !== 'emplaced' && kind !== 'unbuilt';
	const start = raised ? hobM + Math.max(1500, hobM * 0.3) : delivery.startM;
	const pts: FlightPoint[] = [];

	if (kind === 'unbuilt' || kind === 'emplaced' || kind === 'torpedo') {
		// Nothing falls. It sits, or runs along the surface, for the last stretch.
		const duration = kind === 'torpedo' ? 45 : 12;
		const v = delivery.speedMs;
		for (let i = 0; i <= 40; i++) {
			const t = -duration * (1 - i / 40);
			pts.push({ t, altM: Math.max(hobM, delivery.startM), xM: v * t, speedMs: v, diveDeg: 0 });
		}
	} else {
		const dt = 0.05;
		const k = delivery.terminalMs ? G / (delivery.terminalMs * delivery.terminalMs) : 0;
		const falling = kind === 'gravity' || kind === 'retarded';
		const chuteAfter = kind === 'retarded' ? 2 : Infinity;
		const freeK = G / (320 * 320);
		const dive = (delivery.diveDeg * Math.PI) / 180;
		let vx = delivery.speedMs * Math.cos(dive);
		let vz = delivery.speedMs * Math.sin(dive);
		let z = start;
		let x = 0;
		let time = 0;
		const raw: { time: number; z: number; x: number; v: number; dive: number }[] = [];
		while (z > hobM && time < 1500) {
			raw.push({ time, z, x, v: Math.hypot(vx, vz), dive: (Math.atan2(vz, vx) * 180) / Math.PI });
			const v = Math.hypot(vx, vz);
			if (falling) {
				const drag = time >= chuteAfter ? k : kind === 'retarded' ? freeK : k;
				vx -= drag * v * vx * dt;
				vz += (G - drag * v * vz) * dt;
			} else if (kind === 'reentry') {
				// Thin air barely slows it until the last 30 km, when it sheds most of its speed.
				const rho = Math.exp(-z / 7200);
				const beta = 0.00028;
				vx -= beta * rho * v * vx * dt;
				vz += (G - beta * rho * v * vz) * dt;
			} else if (kind === 'rocket' || kind === 'shell') {
				vz += G * dt;
			} else {
				// A cruise missile holds height and speed until its final pop-up.
				vz = 0;
			}
			if (kind === 'cruise') {
				if (time > LEAD_S) break;
			}
			z -= vz * dt;
			x += vx * dt;
			time += dt;
		}
		const end = raw[raw.length - 1];
		for (let i = 0; i < raw.length; i += Math.max(1, Math.floor(raw.length / 240))) {
			const p = raw[i];
			pts.push({ t: p.time - end.time, altM: kind === 'cruise' ? Math.max(hobM, start) : p.z, xM: p.x - end.x, speedMs: p.v, diveDeg: p.dive });
		}
		pts.push({ t: 0, altM: Math.max(hobM, kind === 'cruise' ? start : hobM), xM: 0, speedMs: end.v, diveDeg: end.dive });
	}

	const fall = -pts[0].t;
	const carried = kind === 'gravity' || kind === 'retarded';
	// Bombs get a few seconds on the aircraft first, so the release itself can be seen.
	const durationS = fall + (carried ? LEAD_S : 0);
	return {
		delivery,
		durationS,
		releaseS: carried ? fall : 0,
		chuteS: kind === 'retarded' ? fall - 2 : 0,
		raised,
		at(t: number): FlightPoint {
			if (t <= pts[0].t) {
				const p = pts[0];
				if (!carried) return p;
				// Still aboard the aircraft, level, moving toward the release point.
				return { ...p, t, xM: p.xM + (t - p.t) * delivery.speedMs };
			}
			for (let i = 1; i < pts.length; i++) {
				if (t <= pts[i].t) {
					const a = pts[i - 1];
					const b = pts[i];
					const f = (t - a.t) / Math.max(b.t - a.t, 1e-6);
					return {
						t,
						altM: a.altM + (b.altM - a.altM) * f,
						xM: a.xM + (b.xM - a.xM) * f,
						speedMs: a.speedMs + (b.speedMs - a.speedMs) * f,
						diveDeg: a.diveDeg + (b.diveDeg - a.diveDeg) * f
					};
				}
			}
			return pts[pts.length - 1];
		}
	};
}
