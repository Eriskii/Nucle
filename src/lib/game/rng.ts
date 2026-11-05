export type Rng = () => number;

/** Mulberry32, seeded from a day number and a stream name. */
export function rngFor(day: number, stream: string): Rng {
	let h = Math.imul(day + 1, 0x9e3779b1) >>> 0;
	for (let i = 0; i < stream.length; i++) {
		h = Math.imul(h ^ stream.charCodeAt(i), 0x01000193) >>> 0;
	}
	return () => {
		h = (h + 0x6d2b79f5) | 0;
		let t = Math.imul(h ^ (h >>> 15), 1 | h);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)];
export const between = (rng: Rng, a: number, b: number) => a + (b - a) * rng();
export const intBetween = (rng: Rng, a: number, b: number) => a + Math.floor(rng() * (b - a + 1));

export function shuffled<T>(rng: Rng, items: readonly T[]): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}
