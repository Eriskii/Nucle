import type { TheatreKind } from './theatres';

/** Knots of [yield in kt, fraction of the yield from fission], in rising yield order. */
export type FissionCurve = [number, number][];

export interface Weapon {
	id: string;
	name: string;
	note: string;
	/** Yield range in kilotons. Equal values mean the device has no dial. */
	minKt: number;
	maxKt: number;
	/** Fission fraction across the dial. Read it through fissionFractionAt. */
	fission: FissionCurve;
	/** Game abstraction for long-lived activity, not a physical H+1 factor. See docs/EFFECTS.md. */
	salted?: number;
	/** Prompt radiation radius multiplier for enhanced-radiation designs. */
	enhanced?: number;
	/** Delivery forces a surface burst. */
	surfaceOnly?: boolean;
	theoretical?: boolean;
	tiers: TheatreKind[];
}

// Fission figures and their confidence are tabulated in docs/EFFECTS.md. Three kinds appear here:
// PUBLISHED: Sublette's archive states it for that device.
// GUIDE: Sublette's rule of thumb, 100% below 100 kt and 50/50 above, with no device-specific figure.
// INFERRED: low settings as fission-only because Sublette reads them as the primary alone, joined to
// the top setting in log yield. Real dials have a few fixed settings, so points between are invented.
const PURE: FissionCurve = [[1, 1]];
const HALF: FissionCurve = [[1, 0.5]];

export const WEAPONS: Weapon[] = [
	{ id: 'mk54', name: 'MK-54 DAVY CROCKETT', note: 'RECOILLESS RIFLE ROUND', minKt: 0.01, maxKt: 0.02, fission: PURE, tiers: ['city'] },
	{ id: 'w70', name: 'W70 MOD 3', note: 'NEUTRON WARHEAD', minKt: 1, maxKt: 1, fission: [[1, 0.4]], enhanced: 1.5, tiers: ['city'] },
	{ id: 'boy', name: 'LITTLE BOY', note: 'HIROSHIMA 1945', minKt: 15, maxKt: 15, fission: PURE, tiers: ['city'] },
	{ id: 'fat', name: 'FAT MAN', note: 'NAGASAKI 1945', minKt: 21, maxKt: 21, fission: PURE, tiers: ['city'] },
	{ id: 'b61', name: 'B61 MOD 12', note: 'DIAL-A-YIELD GRAVITY BOMB', minKt: 0.3, maxKt: 50, fission: [[0.3, 1], [1.5, 1], [50, 0.5]], tiers: ['city'] },
	{ id: 'w80', name: 'W80', note: 'CRUISE MISSILE WARHEAD', minKt: 5, maxKt: 150, fission: [[5, 1], [150, 0.5]], tiers: ['city', 'region'] },
	{ id: 'w76', name: 'W76', note: 'TRIDENT SLBM WARHEAD', minKt: 100, maxKt: 100, fission: HALF, tiers: ['city', 'region'] },
	{ id: 'w87', name: 'W87', note: 'MINUTEMAN III WARHEAD', minKt: 300, maxKt: 475, fission: HALF, tiers: ['city', 'region'] },
	{ id: 'w88', name: 'W88', note: 'TRIDENT II WARHEAD', minKt: 475, maxKt: 475, fission: HALF, tiers: ['city', 'region'] },
	{ id: 'ss25', name: 'RT-2PM TOPOL', note: 'ROAD-MOBILE ICBM', minKt: 800, maxKt: 800, fission: HALF, tiers: ['city', 'region'] },
	{ id: 'b83', name: 'B83', note: 'VARIABLE STRATEGIC BOMB', minKt: 1, maxKt: 1200, fission: [[1, 1], [1200, 0.5]], tiers: ['city', 'region'] },
	{ id: 'df5', name: 'DF-5', note: 'SILO ICBM WARHEAD', minKt: 4000, maxKt: 5000, fission: HALF, tiers: ['region', 'world'] },
	{ id: 'b53', name: 'B53', note: 'BUNKER BUSTER, 1962', minKt: 9000, maxKt: 9000, fission: HALF, tiers: ['city', 'region', 'world'] },
	{ id: 'bravo', name: 'CASTLE BRAVO', note: 'SURFACE TEST SHRIMP, 1954', minKt: 15000, maxKt: 15000, fission: [[1, 2 / 3]], surfaceOnly: true, tiers: ['region', 'world'] },
	{ id: 'ss18', name: 'R-36M SATAN', note: 'HEAVY ICBM SINGLE WARHEAD', minKt: 18000, maxKt: 25000, fission: HALF, tiers: ['region', 'world'] },
	{ id: 'pos', name: 'STATUS-6 POSEIDON', note: 'COASTAL TORPEDO', minKt: 2000, maxKt: 2000, fission: HALF, salted: 2, surfaceOnly: true, tiers: ['region'] },
	{ id: 'cob', name: 'COBALT SALTED DEVICE', note: 'THEORETICAL, SZILARD 1950', minKt: 1000, maxKt: 5000, fission: HALF, salted: 5, theoretical: true, tiers: ['city', 'region', 'world'] },
	{ id: 'ripple', name: 'RIPPLE TITAN II', note: 'UNBUILT CLEAN WARHEAD, 1962', minKt: 35000, maxKt: 35000, fission: [[1, 0.001]], theoretical: true, tiers: ['region', 'world'] },
	{ id: 'tsar', name: 'TSAR BOMBA', note: 'NOVAYA ZEMLYA 1961', minKt: 50000, maxKt: 50000, fission: [[1, 0.03]], tiers: ['region', 'world'] },
	{ id: 'tsar2', name: 'TSAR BOMBA FULL', note: 'AS DESIGNED, U-238 TAMPER', minKt: 100000, maxKt: 100000, fission: HALF, theoretical: true, tiers: ['region', 'world'] },
	{ id: 'gnomon', name: 'GNOMON', note: 'TELLER, UNBUILT 1954', minKt: 1000000, maxKt: 1000000, fission: HALF, theoretical: true, tiers: ['world'] },
	{ id: 'sundial', name: 'SUNDIAL', note: 'TELLER, UNBUILT 1954', minKt: 10000000, maxKt: 10000000, fission: HALF, theoretical: true, tiers: ['world'] }
];

export const weaponById = (id: string): Weapon => {
	const w = WEAPONS.find((x) => x.id === id);
	if (!w) throw new Error(`unknown weapon ${id}`);
	return w;
};

export const hasDial = (w: Weapon) => w.minKt !== w.maxKt;

/** Fission fraction at a dial setting, interpolated in log yield and held flat outside the knots. */
export function fissionFractionAt(w: Weapon, kt: number): number {
	const c = w.fission;
	if (kt <= c[0][0]) return c[0][1];
	for (let i = 1; i < c.length; i++) {
		if (kt <= c[i][0]) {
			const t = Math.log(kt / c[i - 1][0]) / Math.log(c[i][0] / c[i - 1][0]);
			return c[i - 1][1] + t * (c[i][1] - c[i - 1][1]);
		}
	}
	return c[c.length - 1][1];
}

export function formatYield(kt: number): string {
	if (kt >= 1000) return `${+(kt / 1000).toPrecision(3)} MT`;
	if (kt < 1) return `${+(kt * 1000).toPrecision(3)} T`;
	return `${+kt.toPrecision(3)} KT`;
}
