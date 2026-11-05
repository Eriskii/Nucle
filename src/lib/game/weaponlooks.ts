// What each weapon's outside looks like, for the 3D view. Outlines are traced by eye from public photographs, with
// lengths and diameters taken from weaponfacts.ts. Colours follow museum displays and photographs, and several rest on
// a single display (the report says so). Little Boy has no agreed colour: the Dayton display is olive, the casing at
// the Imperial War Museum dark grey. This is the external shell only.

export interface Band {
	/** Share of the length, from the nose, where this paint section ends. */
	end: number;
	colour: [number, number, number];
	rough: number;
	metal: number;
}

export interface Look {
	/** Outline from nose to tail: share of length, radius as a share of diameter. Up to 16 points. */
	profile: [number, number][];
	bands: Band[];
	fins?: { kind: 'cruciform' | 'box'; start: number; span: number; thick: number };
	/** Black sealing tar blotched over the seams, as on the Nagasaki bomb. */
	tar?: boolean;
}

const OLIVE: [number, number, number] = [0.085, 0.095, 0.035];
const DARK_OLIVE: [number, number, number] = [0.05, 0.058, 0.026];
const STEEL: [number, number, number] = [0.56, 0.57, 0.58];
const WHITE: [number, number, number] = [0.72, 0.72, 0.69];
const GREY: [number, number, number] = [0.15, 0.16, 0.17];
const BLACK: [number, number, number] = [0.018, 0.018, 0.02];
const CARBON: [number, number, number] = [0.04, 0.04, 0.045];
const MILITARY: [number, number, number] = [0.045, 0.075, 0.04];
const MUSTARD: [number, number, number] = [0.34, 0.23, 0.03];
const PALE: [number, number, number] = [0.46, 0.5, 0.54];

const paint = (colour: [number, number, number], end = 1, rough = 0.5): Band => ({ end, colour, rough, metal: 0 });
const metal = (colour: [number, number, number], end = 1, rough = 0.38): Band => ({ end, colour, rough, metal: 1 });

const RV: Look = {
	profile: [[0, 0], [0.015, 0.035], [0.05, 0.075], [1, 0.5]],
	bands: [paint(CARBON, 0.05, 0.42), paint(CARBON, 0.94, 0.62), paint(GREY, 1, 0.5)]
};

const missile = (colour: [number, number, number], nose: [number, number, number]): Look => ({
	profile: [[0, 0], [0.012, 0.09], [0.035, 0.26], [0.07, 0.42], [0.09, 0.5], [0.97, 0.5], [1, 0.46]],
	bands: [paint(nose, 0.09, 0.42), paint(colour, 0.4, 0.48), paint(colour, 0.72, 0.52), paint(colour, 1, 0.56)]
});

export const LOOKS: Record<string, Look> = {
	mk54: {
		profile: [[0, 0], [0.03, 0.2], [0.1, 0.42], [0.22, 0.5], [0.42, 0.49], [0.54, 0.33], [0.62, 0.17], [0.66, 0.13], [1, 0.11]],
		bands: [paint(DARK_OLIVE, 0.2, 0.3), paint(DARK_OLIVE, 0.6, 0.3), paint(BLACK, 1, 0.42)],
		fins: { kind: 'cruciform', start: 0.72, span: 0.42, thick: 0.01 }
	},
	w70: {
		profile: [[0, 0], [0.04, 0.08], [0.25, 0.26], [0.62, 0.46], [0.72, 0.5], [1, 0.5]],
		bands: [paint(WHITE, 0.3), paint(WHITE, 0.7), paint(GREY, 1)]
	},
	boy: {
		profile: [[0, 0.1], [0.012, 0.3], [0.04, 0.43], [0.09, 0.49], [0.14, 0.5], [0.58, 0.5], [0.61, 0.42], [0.72, 0.4], [1, 0.4]],
		bands: [paint(OLIVE, 0.14, 0.52), paint(OLIVE, 0.58, 0.58), paint(DARK_OLIVE, 1, 0.6)],
		fins: { kind: 'box', start: 0.72, span: 0.47, thick: 0.012 }
	},
	fat: {
		profile: [[0, 0], [0.02, 0.2], [0.07, 0.38], [0.15, 0.48], [0.24, 0.5], [0.38, 0.49], [0.5, 0.42], [0.6, 0.31], [0.67, 0.24], [1, 0.2]],
		bands: [paint(MUSTARD, 0.2, 0.62), paint(MUSTARD, 0.5, 0.66), paint(MUSTARD, 0.67, 0.66), paint(MUSTARD, 1, 0.6)],
		fins: { kind: 'box', start: 0.67, span: 0.48, thick: 0.01 },
		tar: true
	},
	b61: {
		profile: [[0, 0], [0.015, 0.12], [0.05, 0.3], [0.11, 0.43], [0.18, 0.5], [0.78, 0.5], [0.87, 0.42], [0.93, 0.28], [1, 0.26]],
		bands: [paint(BLACK, 0.05, 0.4), metal(PALE, 0.78, 0.34), metal(PALE, 1, 0.42)],
		fins: { kind: 'cruciform', start: 0.82, span: 0.95, thick: 0.012 }
	},
	w80: {
		profile: [[0, 0.1], [0.04, 0.22], [0.2, 0.34], [0.55, 0.46], [0.7, 0.5], [1, 0.5]],
		bands: [metal(STEEL, 0.55, 0.4), metal(STEEL, 1, 0.5)]
	},
	w76: RV,
	w87: RV,
	w88: RV,
	ss25: missile(MILITARY, MILITARY),
	lance: {
		profile: [[0, 0], [0.03, 0.2], [0.09, 0.42], [0.13, 0.5], [1, 0.5]],
		bands: [paint(WHITE, 0.3, 0.25), paint(BLACK, 0.33, 0.3), paint(WHITE, 0.84, 0.25), paint(BLACK, 1, 0.35)],
		fins: { kind: 'cruciform', start: 0.86, span: 1.25, thick: 0.02 }
	},
	agm86: {
		profile: [[0, 0.04], [0.02, 0.24], [0.07, 0.42], [0.14, 0.5], [0.9, 0.5], [0.98, 0.3], [1, 0.2]],
		bands: [paint(PALE, 0.14, 0.4), paint(PALE, 0.9, 0.42), paint(GREY, 1, 0.5)],
		fins: { kind: 'cruciform', start: 0.82, span: 1.5, thick: 0.015 }
	},
	b83: {
		profile: [[0, 0], [0.012, 0.14], [0.05, 0.34], [0.12, 0.46], [0.18, 0.5], [0.8, 0.5], [0.88, 0.42], [1, 0.34]],
		bands: [paint(WHITE, 0.18, 0.22), paint(WHITE, 0.8, 0.22), paint(WHITE, 1, 0.3)],
		fins: { kind: 'cruciform', start: 0.84, span: 0.85, thick: 0.012 }
	},
	df5: {
		...missile(WHITE, WHITE),
		bands: [paint(WHITE, 0.3, 0.32), paint(BLACK, 0.34, 0.4), paint(WHITE, 1, 0.34)]
	},
	b53: {
		profile: [[0, 0.04], [0.02, 0.24], [0.07, 0.4], [0.16, 0.49], [0.22, 0.5], [0.72, 0.5], [0.88, 0.43], [1, 0.36]],
		bands: [metal(STEEL, 0.22, 0.42), metal(STEEL, 0.72, 0.44), metal(GREY, 1, 0.5)],
		fins: { kind: 'cruciform', start: 0.8, span: 0.72, thick: 0.012 }
	},
	bravo: {
		profile: [[0, 0], [0.008, 0.28], [0.03, 0.44], [0.07, 0.5], [0.94, 0.5], [0.98, 0.42], [1, 0.1]],
		bands: [metal(STEEL, 0.5, 0.28), metal(STEEL, 1, 0.32)]
	},
	ss18: {
		...missile(BLACK, BLACK),
		bands: [paint(BLACK, 0.38, 0.72), metal(STEEL, 0.4, 0.42), paint(BLACK, 1, 0.72)]
	},
	pos: {
		profile: [[0, 0.04], [0.012, 0.22], [0.045, 0.42], [0.1, 0.5], [0.84, 0.5], [0.95, 0.24], [1, 0.1]],
		bands: [paint(GREY, 0.3, 0.45), paint([0.17, 0.045, 0.025], 0.36, 0.45), paint(GREY, 0.85, 0.5), metal(GREY, 1, 0.5)],
		fins: { kind: 'cruciform', start: 0.9, span: 0.75, thick: 0.015 }
	},
	ripple: {
		profile: [[0, 0.1], [0.02, 0.17], [0.7, 0.42], [0.88, 0.5], [1, 0.5]],
		bands: [paint(CARBON, 0.05, 0.42), paint(CARBON, 0.88, 0.6), paint(GREY, 1, 0.5)]
	},
	tsar: {
		profile: [[0, 0.03], [0.018, 0.2], [0.07, 0.38], [0.2, 0.5], [0.68, 0.5], [0.86, 0.42], [1, 0.3]],
		bands: [paint(BLACK, 0.18, 0.5), paint([0.18, 0.19, 0.2], 0.68, 0.5), paint(BLACK, 1, 0.5)],
		fins: { kind: 'cruciform', start: 0.8, span: 0.62, thick: 0.012 }
	}
};
LOOKS.tsar2 = LOOKS.tsar;
