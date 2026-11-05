// Every sound here is synthesized, and all of it comes from the room you're in:
// the air handling, the mains hum, and the machinery under your hands. There is
// no score and no explosion, because nobody at a console hears the target.

import type { ThemeId } from './themes.ts';

export type SoundEvent =
	| 'key'
	| 'toggle'
	| 'arrow'
	| 'select'
	| 'place'
	| 'erase'
	| 'slider'
	| 'wargame'
	| 'cover'
	| 'fire'
	| 'impact'
	| 'report';

interface Room {
	seconds: number;
	damp: number;
	wet: number;
}

const ROOMS: Record<ThemeId, Room> = {
	// A big, hard-floored operations room.
	sage: { seconds: 1.5, damp: 3200, wet: 0.2 },
	// A low concrete bunker: short, boxy and bright.
	pvo: { seconds: 0.85, damp: 4500, wet: 0.26 },
	// A carpeted staff office with soft furnishings.
	paper: { seconds: 0.35, damp: 2600, wet: 0.1 }
};

/** Room tone sits well under the controls, as it does once your ear adjusts. */
const AMBIENCE: Record<ThemeId, number> = { sage: 0.14, pvo: 0.17, paper: 0.3 };

/** Sets the mechanical sounds' level overall, relative to the room tone. */
const TRANSIENT_GAIN = 1.5;

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Soundscape {
	readonly ctx: BaseAudioContext;
	private master: GainNode;
	private dry: GainNode;
	private wet: GainNode;
	private verb: ConvolverNode;
	private white: AudioBuffer;
	private brown: AudioBuffer;
	private ambience: { gain: GainNode; stop: () => void } | null = null;
	private theme: ThemeId = 'sage';
	private timer = 0;
	private nextEvent = 0;
	private nextTick = 0;
	private lastSlider = -1;
	private muted = false;

	constructor(ctx: BaseAudioContext) {
		this.ctx = ctx;
		const limiter = ctx.createDynamicsCompressor();
		limiter.threshold.value = -9;
		limiter.ratio.value = 8;
		limiter.attack.value = 0.003;
		limiter.release.value = 0.2;
		this.master = ctx.createGain();
		this.master.gain.value = 0.9;
		this.dry = ctx.createGain();
		this.wet = ctx.createGain();
		this.verb = ctx.createConvolver();
		this.dry.connect(limiter);
		this.wet.connect(this.verb).connect(limiter);
		limiter.connect(this.master).connect(ctx.destination);
		this.white = this.noise((x) => x);
		let last = 0;
		this.brown = this.noise((x) => {
			last = (last + 0.02 * x) / 1.02;
			return last * 3.5;
		});
	}

	private noise(shape: (x: number) => number): AudioBuffer {
		const length = this.ctx.sampleRate * 4;
		const buf = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
		const d = buf.getChannelData(0);
		for (let i = 0; i < length; i++) d[i] = shape(Math.random() * 2 - 1);
		return buf;
	}

	/** A synthetic room: decaying noise, darkening over time as real surfaces do. */
	private impulse(room: Room): AudioBuffer {
		const rate = this.ctx.sampleRate;
		const length = Math.floor(rate * room.seconds);
		const buf = this.ctx.createBuffer(2, length, rate);
		for (let c = 0; c < 2; c++) {
			const d = buf.getChannelData(c);
			let low = 0;
			for (let i = 0; i < length; i++) {
				const t = i / length;
				const coef = Math.min(0.9, ((room.damp * (1 - t * 0.8)) / rate) * 6.28);
				low += coef * (Math.random() * 2 - 1 - low);
				d[i] = low * Math.pow(1 - t, 3) * (t < 0.004 ? t / 0.004 : 1);
			}
		}
		return buf;
	}

	setMuted(muted: boolean) {
		this.muted = muted;
		const t = this.ctx.currentTime;
		this.master.gain.cancelScheduledValues(t);
		this.master.gain.setTargetAtTime(muted ? 0 : 0.9, t, 0.05);
	}

	setTheme(id: ThemeId) {
		this.theme = id;
		const room = ROOMS[id];
		this.verb.buffer = this.impulse(room);
		this.wet.gain.value = room.wet;
		this.dry.gain.value = 1;
		const t = this.ctx.currentTime;
		if (this.ambience) {
			const old = this.ambience;
			old.gain.gain.setTargetAtTime(0, t, 0.25);
			setTimeout(old.stop, 1500);
		}
		this.ambience = this.buildAmbience(id);
		this.nextEvent = t + rand(2, 6);
		this.nextTick = t + 0.1;
	}

	/** Random room events and clocks. Only runs against a live audio context. */
	startScheduler() {
		clearInterval(this.timer);
		this.timer = window.setInterval(() => {
			if (this.muted) return;
			const now = this.ctx.currentTime;
			if (now >= this.nextEvent) {
				this.roomEvent(now + 0.05);
				this.nextEvent = now + rand(5, 16);
			}
			if (this.theme === 'paper') {
				// A mechanical wall clock.
				while (this.nextTick < now + 0.4) {
					this.wallClock(this.nextTick);
					this.nextTick += 1;
				}
			} else if (this.theme === 'pvo') {
				// The antenna drive's cam, one per rotation, matching the sweep on the scope.
				const period = 5.2;
				const phaseNow = performance.now() / 1000 / period;
				const until = (Math.ceil(phaseNow) - phaseNow) * period;
				if (until < 0.3 && now >= this.nextTick) {
					this.antennaCam(now + until);
					this.nextTick = now + until + 1;
				}
			}
		}, 150);
	}

	stop() {
		clearInterval(this.timer);
		this.ambience?.stop();
		this.ambience = null;
	}

	// --- building blocks ---

	private out(gain: GainNode, wetSend = 1) {
		gain.connect(this.dry);
		if (wetSend > 0) {
			const s = this.ctx.createGain();
			s.gain.value = wetSend;
			gain.connect(s).connect(this.wet);
		}
	}

	/** A short band of noise: the impact part of anything mechanical. */
	private burst(t: number, freq: number, q: number, level: number, decay: number, wet = 1, source = this.white) {
		const n = this.ctx.createBufferSource();
		n.buffer = source;
		const f = this.ctx.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = freq;
		f.Q.value = q;
		// Filtering noise discards energy in proportion to how narrow the band is, so
		// this restores it. `level` then means roughly the same at any bandwidth.
		const band = Math.max(freq / q, 40);
		const makeup = Math.min(TRANSIENT_GAIN * Math.sqrt(this.ctx.sampleRate / 2 / band), 26);
		const g = this.ctx.createGain();
		g.gain.setValueAtTime(level * makeup, t);
		g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
		n.connect(f).connect(g);
		this.out(g, wet);
		n.start(t, Math.random() * 3);
		n.stop(t + decay + 0.02);
	}

	/** Struck-object resonances: what makes a click sound like steel or bakelite. */
	private modes(t: number, partials: [number, number, number][], wet = 1) {
		for (const [freq, level, decay] of partials) {
			const o = this.ctx.createOscillator();
			o.frequency.value = freq * rand(0.985, 1.015);
			const g = this.ctx.createGain();
			g.gain.setValueAtTime(level, t);
			g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
			o.connect(g);
			this.out(g, wet);
			o.start(t);
			o.stop(t + decay + 0.02);
		}
	}

	/** A hum at mains frequency and its harmonics, as heard from a transformer. */
	private hum(fundamental: number, levels: number[], into: AudioNode, stops: (() => void)[]) {
		levels.forEach((level, i) => {
			const o = this.ctx.createOscillator();
			o.frequency.value = fundamental * (i + 1);
			const g = this.ctx.createGain();
			g.gain.value = level;
			o.connect(g).connect(into);
			o.start();
			stops.push(() => o.stop());
		});
	}

	/** Steady filtered noise, for air moving through ducts. */
	private air(source: AudioBuffer, type: BiquadFilterType, freq: number, q: number, level: number, into: AudioNode, stops: (() => void)[]) {
		const n = this.ctx.createBufferSource();
		n.buffer = source;
		n.loop = true;
		const f = this.ctx.createBiquadFilter();
		f.type = type;
		f.frequency.value = freq;
		f.Q.value = q;
		const g = this.ctx.createGain();
		g.gain.value = level;
		n.connect(f).connect(g).connect(into);
		n.start(0, Math.random() * 3);
		stops.push(() => n.stop());
		return g;
	}

	private buildAmbience(id: ThemeId) {
		const c = this.ctx;
		const gain = c.createGain();
		const t = c.currentTime;
		gain.gain.setValueAtTime(0, t);
		gain.gain.setTargetAtTime(AMBIENCE[id], t, 0.8);
		this.out(gain, 0.4);
		const stops: (() => void)[] = [];

		if (id === 'sage') {
			// The room exists to cool a vacuum tube computer, so air handling dominates.
			this.air(this.brown, 'lowpass', 320, 0.5, 0.3, gain, stops);
			this.air(this.brown, 'bandpass', 95, 0.8, 0.3, gain, stops);
			this.air(this.white, 'bandpass', 1100, 0.7, 0.0055, gain, stops);
			this.hum(60, [0.008, 0.016, 0.006, 0.002, 0.001], gain, stops);
		} else if (id === 'pvo') {
			// A smaller bunker on 50 Hz mains, with a ventilation fan beating audibly.
			const fan = this.air(this.brown, 'lowpass', 420, 0.6, 0.2, gain, stops);
			const beat = c.createOscillator();
			beat.frequency.value = 7.3;
			const depth = c.createGain();
			depth.gain.value = 0.05;
			beat.connect(depth).connect(fan.gain);
			beat.start();
			stops.push(() => beat.stop());
			this.air(this.white, 'bandpass', 1900, 1.1, 0.0035, gain, stops);
			this.hum(50, [0.012, 0.02, 0.009, 0.004, 0.002], gain, stops);
			// Neon indicator tubes put a faint, buzzing edge on the hum.
			this.hum(300, [0.0012, 0.0008, 0.0005], gain, stops);
		} else {
			// Quiet office: distant building air and a fluorescent ballast.
			this.air(this.brown, 'lowpass', 500, 0.4, 0.05, gain, stops);
			this.air(this.white, 'highpass', 3000, 0.4, 0.0008, gain, stops);
			this.hum(120, [0.0028, 0.0012, 0.0006], gain, stops);
		}
		return { gain, stop: () => stops.forEach((s) => s()) };
	}

	// --- things that happen in the room ---

	private roomEvent(t: number) {
		const roll = Math.random();
		if (this.theme === 'sage') {
			if (roll < 0.45) this.murmur(t, 0.03);
			else if (roll < 0.7) this.teleprinter(t, rand(1.2, 3), 0.035);
			else if (roll < 0.9) this.relayBank(t, rand(0.2, 0.6), 0.05);
			else this.phone(t, 0.016);
		} else if (this.theme === 'pvo') {
			if (roll < 0.35) this.morse(t);
			else if (roll < 0.6) this.murmur(t, 0.026);
			else if (roll < 0.85) this.steppers(t, rand(0.3, 0.8), 0.05);
			else this.teleprinter(t, rand(1, 2.4), 0.03);
		} else {
			if (roll < 0.4) this.typewriter(t, rand(1, 2.5), 0.02, false);
			else if (roll < 0.65) this.chairCreak(t);
			else if (roll < 0.85) this.murmur(t, 0.011);
			else this.pageTurn(t, 0.02);
		}
	}

	/** Conversation across a room: formant-shaped noise, too far off to make out. */
	private murmur(t: number, level: number) {
		const c = this.ctx;
		const n = c.createBufferSource();
		n.buffer = this.white;
		const f1 = c.createBiquadFilter();
		f1.type = 'bandpass';
		f1.Q.value = 3;
		const f2 = c.createBiquadFilter();
		f2.type = 'lowpass';
		f2.frequency.value = 1100;
		const g = c.createGain();
		g.gain.setValueAtTime(0, t);
		let at = t;
		const phrases = Math.floor(rand(4, 12));
		for (let i = 0; i < phrases; i++) {
			f1.frequency.setValueAtTime(rand(280, 780), at);
			g.gain.linearRampToValueAtTime(level * rand(0.4, 1), at + 0.05);
			at += rand(0.09, 0.26);
			g.gain.linearRampToValueAtTime(level * rand(0, 0.25), at);
			at += rand(0.02, 0.1);
		}
		g.gain.linearRampToValueAtTime(0, at + 0.1);
		n.connect(f1).connect(f2).connect(g);
		this.out(g, 2.4);
		n.start(t, Math.random() * 3);
		n.stop(at + 0.2);
	}

	private phone(t: number, level: number) {
		// A far-off telephone bell, struck about twenty times a second for each ring.
		for (let ring = 0; ring < 2; ring++) {
			const start = t + ring * 3;
			for (let i = 0; i < 36; i++) {
				this.modes(start + i * 0.05, [[1060, level, 0.08], [1720, level * 0.7, 0.06], [2670, level * 0.35, 0.04]], 3);
			}
		}
	}

	private morse(t: number) {
		// Signals leaking from a receiver at the next position, behind some static.
		const c = this.ctx;
		this.burst(t, 2400, 0.6, 0.008, 2.4, 0.4);
		const o = c.createOscillator();
		o.frequency.value = rand(720, 900);
		const f = c.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = o.frequency.value;
		f.Q.value = 5;
		const g = c.createGain();
		g.gain.setValueAtTime(0, t);
		let at = t + 0.05;
		const dit = 0.07;
		const groups = Math.floor(rand(3, 6));
		for (let word = 0; word < groups; word++) {
			const letters = Math.floor(rand(4, 6));
			for (let i = 0; i < letters; i++) {
				const long = Math.random() < 0.45;
				g.gain.setValueAtTime(0.014, at);
				at += long ? dit * 3 : dit;
				g.gain.setValueAtTime(0, at);
				at += dit;
			}
			at += dit * 3;
		}
		o.connect(f).connect(g);
		this.out(g, 1.2);
		o.start(t);
		o.stop(at + 0.1);
	}

	private wallClock(t: number) {
		this.burst(t, 1700, 3, 0.03, 0.022, 0.8);
		this.modes(t, [[920, 0.012, 0.03], [2300, 0.006, 0.015]], 0.8);
	}

	private antennaCam(t: number) {
		this.burst(t, 700, 2, 0.04, 0.05, 1.4);
		this.modes(t, [[340, 0.018, 0.09], [980, 0.008, 0.05]], 1.4);
	}

	private chairCreak(t: number) {
		const c = this.ctx;
		const n = c.createBufferSource();
		n.buffer = this.white;
		const f = c.createBiquadFilter();
		f.type = 'bandpass';
		f.Q.value = 14;
		f.frequency.setValueAtTime(rand(500, 800), t);
		f.frequency.linearRampToValueAtTime(rand(850, 1200), t + 0.5);
		const g = c.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(0.018, t + 0.1);
		g.gain.linearRampToValueAtTime(0.004, t + 0.3);
		g.gain.linearRampToValueAtTime(0.012, t + 0.42);
		g.gain.linearRampToValueAtTime(0, t + 0.6);
		n.connect(f).connect(g);
		this.out(g, 1.5);
		n.start(t, Math.random() * 3);
		n.stop(t + 0.65);
	}

	private pageTurn(t: number, level: number) {
		this.burst(t, 3200, 0.5, level, 0.14, 0.5);
		this.burst(t + 0.09, 2100, 0.6, level * 1.4, 0.18, 0.5);
		this.burst(t + 0.25, 900, 0.8, level * 0.8, 0.08, 0.5);
	}

	// --- machinery ---

	/** One armature pulling in, with the bounce that makes relays sound like relays. */
	private relay(t: number, level: number) {
		this.burst(t, rand(2800, 4200), 1.6, level, 0.012);
		this.burst(t + 0.006, rand(1400, 2100), 2, level * 0.6, 0.016);
		if (Math.random() < 0.5) this.burst(t + 0.014, rand(3000, 4600), 2, level * 0.3, 0.006);
	}

	private relayBank(t: number, seconds: number, level: number) {
		let at = t;
		while (at < t + seconds) {
			this.relay(at, level * rand(0.4, 1));
			at += rand(0.004, 0.05);
		}
	}

	/** Rotary stepping switches ratcheting through their contacts. */
	private steppers(t: number, seconds: number, level: number) {
		let at = t;
		while (at < t + seconds) {
			this.burst(at, 1250, 2.5, level, 0.016);
			this.modes(at, [[640, level * 0.25, 0.02]]);
			at += 0.028 + rand(0, 0.004);
		}
	}

	/** A teleprinter's motor and type bars, about ten characters a second. */
	private teleprinter(t: number, seconds: number, level: number) {
		const c = this.ctx;
		const motor = c.createOscillator();
		motor.type = 'sawtooth';
		motor.frequency.value = 58;
		const f = c.createBiquadFilter();
		f.type = 'lowpass';
		f.frequency.value = 420;
		const g = c.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(level * 0.4, t + 0.15);
		g.gain.setValueAtTime(level * 0.4, t + seconds);
		g.gain.linearRampToValueAtTime(0, t + seconds + 0.25);
		motor.connect(f).connect(g);
		this.out(g);
		motor.start(t);
		motor.stop(t + seconds + 0.3);
		let at = t + 0.12;
		while (at < t + seconds) {
			if (Math.random() > 0.08) {
				this.burst(at, rand(1500, 2900), 1.6, level, 0.028);
				this.burst(at + 0.008, rand(380, 620), 2, level * 0.9, 0.04);
				this.burst(at + 0.05, rand(3800, 5200), 3, level * 0.3, 0.009);
			}
			at += 0.1;
		}
	}

	/** A manual typewriter: human rhythm, hard strikes, and a bell near the margin. */
	private typewriter(t: number, seconds: number, level: number, carriage: boolean) {
		let at = t;
		while (at < t + seconds) {
			const hit = level * rand(0.75, 1.1);
			this.burst(at, rand(2000, 3400), 1.3, hit, 0.018);
			this.burst(at + 0.004, rand(260, 420), 1.6, hit * 1.1, 0.05);
			this.modes(at, [[rand(780, 1150), hit * 0.14, 0.03]]);
			at += Math.random() < 0.12 ? rand(0.2, 0.42) : rand(0.08, 0.17);
		}
		if (carriage) {
			this.modes(at, [[2750, level * 0.7, 0.5], [6300, level * 0.25, 0.3]]);
			for (let i = 0; i < 16; i++) this.burst(at + 0.22 + i * 0.022, 1800, 2, level * 0.28, 0.012);
			this.burst(at + 0.62, 420, 1.2, level * 1.6, 0.09);
		}
	}

	/** A mechanical desk calculator: motor, gears, and a carry on every digit. */
	private calculator(t: number, seconds: number, level: number) {
		const c = this.ctx;
		const motor = c.createOscillator();
		motor.type = 'square';
		motor.frequency.setValueAtTime(40, t);
		motor.frequency.linearRampToValueAtTime(92, t + 0.14);
		motor.frequency.setValueAtTime(92, t + seconds);
		motor.frequency.linearRampToValueAtTime(30, t + seconds + 0.2);
		const f = c.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = 340;
		f.Q.value = 0.9;
		const g = c.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(level * 0.42, t + 0.1);
		g.gain.setValueAtTime(level * 0.42, t + seconds);
		g.gain.linearRampToValueAtTime(0, t + seconds + 0.2);
		motor.connect(f).connect(g);
		this.out(g);
		motor.start(t);
		motor.stop(t + seconds + 0.25);
		for (let at = t + 0.1; at < t + seconds; at += 0.043) {
			this.burst(at, rand(1500, 2500), 2, level * rand(0.45, 1), 0.016);
			if (Math.random() < 0.28) this.burst(at, 620, 2, level, 0.03);
		}
		this.modes(t + seconds + 0.04, [[1950, level * 0.5, 0.4], [4700, level * 0.16, 0.2]]);
	}

	private cardPunch(t: number, seconds: number, level: number) {
		for (let at = t; at < t + seconds; at += 0.09) {
			this.burst(at, 240, 1.2, level, 0.05, 1, this.brown);
			this.burst(at + 0.004, 3000, 1.2, level * 0.45, 0.012);
			this.burst(at + 0.044, 1500, 2, level * 0.18, 0.01);
		}
	}

	/** An electric horn: two reeds slightly apart, through a metal trumpet. */
	private horn(t: number, seconds: number, freq: number, level: number) {
		const c = this.ctx;
		const shape = c.createWaveShaper();
		const curve = new Float32Array(257);
		for (let i = 0; i < 257; i++) {
			const x = (i - 128) / 128;
			curve[i] = Math.tanh(x * 3.5);
		}
		shape.curve = curve;
		const f = c.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = freq * 4.4;
		f.Q.value = 0.9;
		const g = c.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(level, t + 0.04);
		g.gain.setValueAtTime(level, t + seconds);
		g.gain.linearRampToValueAtTime(0, t + seconds + 0.08);
		shape.connect(f).connect(g);
		this.out(g, 2.6);
		for (const d of [1, 1.012]) {
			const o = c.createOscillator();
			o.type = 'sawtooth';
			o.frequency.value = freq * d;
			o.connect(shape);
			o.start(t);
			o.stop(t + seconds + 0.1);
		}
	}

	/** A motor siren running up from rest, the Soviet ревун alarm. */
	private howler(t: number, seconds: number, level: number) {
		const c = this.ctx;
		const o = c.createOscillator();
		o.type = 'sawtooth';
		o.frequency.setValueAtTime(90, t);
		o.frequency.exponentialRampToValueAtTime(610, t + seconds * 0.45);
		o.frequency.setValueAtTime(610, t + seconds * 0.8);
		o.frequency.exponentialRampToValueAtTime(190, t + seconds + 0.9);
		const f = c.createBiquadFilter();
		f.type = 'bandpass';
		f.frequency.value = 900;
		f.Q.value = 0.8;
		const g = c.createGain();
		g.gain.setValueAtTime(0, t);
		g.gain.linearRampToValueAtTime(level, t + seconds * 0.35);
		g.gain.setValueAtTime(level, t + seconds * 0.8);
		g.gain.linearRampToValueAtTime(0, t + seconds + 0.9);
		o.connect(f).connect(g);
		this.out(g, 2.8);
		o.start(t);
		o.stop(t + seconds + 1);
	}

	/** A grease pencil dragging on paper: a rough, unsteady, pitched squeak. */
	private pencil(t: number, seconds: number, level: number) {
		const c = this.ctx;
		const n = c.createBufferSource();
		n.buffer = this.white;
		const f = c.createBiquadFilter();
		f.type = 'bandpass';
		f.Q.value = 3.5;
		f.frequency.setValueAtTime(rand(1500, 2200), t);
		const g = c.createGain();
		g.gain.setValueAtTime(0, t);
		const step = 0.035;
		for (let at = t; at < t + seconds; at += step) {
			f.frequency.linearRampToValueAtTime(rand(1300, 2800), at + step);
			g.gain.linearRampToValueAtTime(level * 4 * rand(0.3, 1), at + step);
		}
		g.gain.linearRampToValueAtTime(0, t + seconds + 0.02);
		n.connect(f).connect(g);
		this.out(g, 0.4);
		n.start(t, Math.random() * 3);
		n.stop(t + seconds + 0.05);
	}

	private bellStrike(t: number, level: number) {
		this.modes(t, [[2650, level, 0.8], [3920, level * 0.5, 0.5], [6200, level * 0.25, 0.3]], 1.5);
	}

	// --- events ---

	play(event: SoundEvent) {
		const t = this.ctx.currentTime + 0.002;
		if (event === 'slider') {
			if (t - this.lastSlider < 0.045) return;
			this.lastSlider = t;
		}
		({ sage: this.playSage, pvo: this.playPvo, paper: this.playPaper })[this.theme].call(this, event, t);
	}

	private playSage(event: SoundEvent, t: number) {
		// Heavy pushbuttons in a steel console, with a relay answering each press.
		const press = (level: number) => {
			this.burst(t, 2300, 0.9, level, 0.02);
			this.burst(t, 330, 1.4, level * 1.2, 0.05);
			this.modes(t, [[720, level * 0.18, 0.09], [1630, level * 0.08, 0.05]]);
		};
		switch (event) {
			case 'key':
				press(0.2);
				this.relay(t + 0.024, 0.08);
				break;
			case 'toggle':
				press(0.2);
				this.relay(t + 0.02, 0.1);
				this.relay(t + 0.052, 0.06);
				break;
			case 'arrow':
				press(0.12);
				break;
			case 'select':
				press(0.17);
				this.relay(t + 0.03, 0.06);
				break;
			case 'place':
				// The light gun: a big trigger, then the console takes the message.
				this.burst(t, 1700, 1.1, 0.24, 0.018);
				this.burst(t + 0.002, 250, 1.3, 0.22, 0.05);
				this.burst(t + 0.05, 2600, 1.5, 0.08, 0.012);
				this.relayBank(t + 0.09, 0.12, 0.06);
				break;
			case 'erase':
				press(0.15);
				this.relayBank(t + 0.03, 0.08, 0.05);
				break;
			case 'slider':
				this.burst(t, 2100, 3, 0.2, 0.008);
				break;
			case 'wargame':
				press(0.2);
				this.relayBank(t + 0.03, 1.2, 0.07);
				this.cardPunch(t + 0.4, 1.1, 0.12);
				this.teleprinter(t + 1.6, 1.4, 0.06);
				break;
			case 'cover':
				// A sprung steel guard.
				this.burst(t, 3000, 1.2, 0.16, 0.012);
				this.burst(t + 0.008, 420, 1.2, 0.2, 0.06);
				this.modes(t, [[1180, 0.05, 0.16], [2740, 0.025, 0.09]]);
				break;
			case 'fire':
				this.burst(t, 180, 1, 0.5, 0.16, 1.4, this.brown);
				this.burst(t, 2100, 0.9, 0.24, 0.03);
				this.relayBank(t + 0.03, 1.8, 0.1);
				this.horn(t + 0.5, 1.1, 215, 0.14);
				this.horn(t + 1.9, 1.1, 215, 0.14);
				this.horn(t + 3.3, 1.1, 215, 0.14);
				break;
			case 'impact':
				this.bellStrike(t, 0.05);
				this.relayBank(t, 0.1, 0.06);
				break;
			case 'report':
				this.bellStrike(t, 0.05);
				this.bellStrike(t + 0.32, 0.05);
				this.teleprinter(t + 0.2, 4.5, 0.075);
				break;
		}
	}

	private playPvo(event: SoundEvent, t: number) {
		// Bakelite and sprung toggles, stepping switches behind the panel.
		const snap = (level: number) => {
			this.burst(t, 3400, 1.4, level, 0.008);
			this.burst(t + 0.002, 900, 1.6, level * 0.85, 0.024);
			this.modes(t, [[1450, level * 0.1, 0.03]]);
		};
		switch (event) {
			case 'key':
				snap(0.24);
				break;
			case 'toggle':
				snap(0.24);
				this.steppers(t + 0.03, 0.09, 0.05);
				break;
			case 'arrow':
				snap(0.13);
				break;
			case 'select':
				snap(0.19);
				this.steppers(t + 0.02, 0.14, 0.06);
				break;
			case 'place':
				snap(0.26);
				this.steppers(t + 0.05, 0.26, 0.07);
				this.relay(t + 0.34, 0.09);
				break;
			case 'erase':
				snap(0.18);
				this.steppers(t + 0.02, 0.12, 0.05);
				break;
			case 'slider':
				// A wafer switch, with nixie digits changing behind it.
				this.burst(t, 1500, 3, 0.2, 0.01);
				this.modes(t, [[820, 0.009, 0.014]]);
				break;
			case 'wargame':
				snap(0.24);
				this.steppers(t + 0.03, 1.5, 0.08);
				this.relayBank(t + 0.5, 1, 0.05);
				this.teleprinter(t + 1.6, 1.4, 0.06);
				break;
			case 'cover':
				this.burst(t, 2400, 1.1, 0.18, 0.016);
				this.burst(t + 0.01, 300, 1.2, 0.22, 0.08);
				this.modes(t, [[880, 0.05, 0.14]]);
				break;
			case 'fire':
				this.burst(t, 150, 1, 0.55, 0.2, 1.6, this.brown);
				this.burst(t, 1900, 0.9, 0.22, 0.03);
				this.steppers(t + 0.02, 1.4, 0.09);
				this.howler(t + 0.4, 3.4, 0.15);
				break;
			case 'impact':
				this.bellStrike(t, 0.045);
				this.steppers(t, 0.12, 0.06);
				break;
			case 'report':
				this.bellStrike(t, 0.045);
				this.teleprinter(t + 0.15, 4.5, 0.07);
				break;
		}
	}

	private playPaper(event: SoundEvent, t: number) {
		const tap = (level: number) => {
			this.burst(t, 700, 1.1, level, 0.03, 0.6);
			this.burst(t, 2600, 0.8, level * 0.24, 0.018, 0.6);
		};
		switch (event) {
			case 'key':
				tap(0.13);
				this.pageTurn(t, 0.012);
				break;
			case 'toggle':
				// Laying an acetate overlay on the sheet.
				this.burst(t, 4200, 0.6, 0.05, 0.1, 0.6);
				this.burst(t + 0.04, 2000, 0.7, 0.05, 0.14, 0.6);
				tap(0.08);
				break;
			case 'arrow':
				// Sliding the chart across the table.
				this.burst(t, 1100, 0.5, 0.05, 0.12, 0.5);
				break;
			case 'select':
				tap(0.1);
				break;
			case 'place':
				// A pencilled cross: two quick strokes and a tap of the point.
				this.burst(t, 1100, 1, 0.1, 0.018, 0.5);
				this.pencil(t + 0.015, 0.13, 0.045);
				this.pencil(t + 0.2, 0.12, 0.05);
				break;
			case 'erase':
				for (let i = 0; i < 4; i++) this.burst(t + i * 0.11, 1300, 0.7, 0.05, 0.09, 0.4);
				break;
			case 'slider':
				// A slide rule's cursor drawn along its scale.
				this.burst(t, 3300, 2, 0.07, 0.04, 0.3);
				break;
			case 'wargame':
				tap(0.11);
				this.calculator(t + 0.06, 1.6, 0.1);
				break;
			case 'cover':
				// A signature: a few fast strokes of a fountain pen.
				this.pageTurn(t, 0.02);
				for (const [at, len] of [
					[0.22, 0.16],
					[0.4, 0.1],
					[0.52, 0.2],
					[0.76, 0.08]
				] as const) {
					this.pencil(t + at, len, 0.018);
				}
				break;
			case 'fire':
				// A rubber stamp on an ink pad, then down on a wooden desk.
				this.burst(t, 400, 1.2, 0.07, 0.04, 0.5);
				this.burst(t + 0.26, 145, 1.1, 0.13, 0.12, 0.8, this.brown);
				this.burst(t + 0.26, 1300, 0.8, 0.14, 0.022, 0.8);
				this.modes(t + 0.26, [[188, 0.1, 0.11], [410, 0.05, 0.07]], 0.8);
				break;
			case 'impact':
				// Each ring drawn around its compass point.
				this.pencil(t, 0.85, 0.05);
				break;
			case 'report':
				this.typewriter(t, 3.4, 0.08, true);
				break;
		}
	}
}
