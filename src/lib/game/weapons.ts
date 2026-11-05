import type { TheatreKind } from './theatres';

export interface Weapon {
	id: string;
	name: string;
	note: string;
	/** Yield range in kilotons. Equal values mean the device has no dial. */
	minKt: number;
	maxKt: number;
	/** Fraction of the yield from fission, which drives fallout. */
	fission: number;
	/** Fallout multiplier for salted designs. */
	salted?: number;
	/** Prompt radiation radius multiplier for enhanced-radiation designs. */
	enhanced?: number;
	/** Delivery forces a surface burst. */
	surfaceOnly?: boolean;
	theoretical?: boolean;
	tiers: TheatreKind[];
}

export const WEAPONS: Weapon[] = [
	{ id: 'w54', name: 'W54 DAVY CROCKETT', note: 'RECOILLESS RIFLE ROUND', minKt: 0.01, maxKt: 0.02, fission: 1, tiers: ['city'] },
	{ id: 'w70', name: 'W70 MOD 3', note: 'NEUTRON WARHEAD', minKt: 1, maxKt: 1, fission: 0.25, enhanced: 2.2, tiers: ['city'] },
	{ id: 'boy', name: 'LITTLE BOY', note: 'HIROSHIMA 1945', minKt: 15, maxKt: 15, fission: 1, tiers: ['city'] },
	{ id: 'fat', name: 'FAT MAN', note: 'NAGASAKI 1945', minKt: 21, maxKt: 21, fission: 1, tiers: ['city'] },
	{ id: 'b61', name: 'B61 MOD 12', note: 'DIAL-A-YIELD GRAVITY BOMB', minKt: 0.3, maxKt: 50, fission: 0.5, tiers: ['city'] },
	{ id: 'w80', name: 'W80', note: 'CRUISE MISSILE WARHEAD', minKt: 5, maxKt: 150, fission: 0.5, tiers: ['city', 'region'] },
	{ id: 'w76', name: 'W76', note: 'TRIDENT SLBM WARHEAD', minKt: 100, maxKt: 100, fission: 0.5, tiers: ['city', 'region'] },
	{ id: 'w87', name: 'W87', note: 'MINUTEMAN III WARHEAD', minKt: 300, maxKt: 475, fission: 0.5, tiers: ['city', 'region'] },
	{ id: 'w88', name: 'W88', note: 'TRIDENT II WARHEAD', minKt: 475, maxKt: 475, fission: 0.5, tiers: ['city', 'region'] },
	{ id: 'ss25', name: 'RT-2PM TOPOL', note: 'ROAD-MOBILE ICBM', minKt: 800, maxKt: 800, fission: 0.5, tiers: ['city', 'region'] },
	{ id: 'b83', name: 'B83', note: 'VARIABLE STRATEGIC BOMB', minKt: 1, maxKt: 1200, fission: 0.4, tiers: ['city', 'region'] },
	{ id: 'df5', name: 'DF-5', note: 'SILO ICBM WARHEAD', minKt: 4000, maxKt: 5000, fission: 0.5, tiers: ['region', 'world'] },
	{ id: 'b53', name: 'B53', note: 'BUNKER BUSTER, 1962', minKt: 9000, maxKt: 9000, fission: 0.5, tiers: ['city', 'region', 'world'] },
	{ id: 'bravo', name: 'CASTLE BRAVO', note: 'SURFACE TEST SHRIMP, 1954', minKt: 15000, maxKt: 15000, fission: 0.67, surfaceOnly: true, tiers: ['region', 'world'] },
	{ id: 'ss18', name: 'R-36M SATAN', note: 'HEAVY ICBM SINGLE WARHEAD', minKt: 18000, maxKt: 25000, fission: 0.5, tiers: ['region', 'world'] },
	{ id: 'pos', name: 'STATUS-6 POSEIDON', note: 'COASTAL TORPEDO', minKt: 2000, maxKt: 2000, fission: 0.6, salted: 2, surfaceOnly: true, tiers: ['region'] },
	{ id: 'cob', name: 'COBALT SALTED DEVICE', note: 'THEORETICAL, SZILARD 1950', minKt: 1000, maxKt: 5000, fission: 0.5, salted: 5, theoretical: true, tiers: ['city', 'region', 'world'] },
	{ id: 'tsar', name: 'TSAR BOMBA', note: 'NOVAYA ZEMLYA 1961', minKt: 50000, maxKt: 50000, fission: 0.03, tiers: ['region', 'world'] },
	{ id: 'tsar2', name: 'TSAR BOMBA FULL', note: 'AS DESIGNED, U-238 TAMPER', minKt: 100000, maxKt: 100000, fission: 0.5, theoretical: true, tiers: ['region', 'world'] },
	{ id: 'gnomon', name: 'GNOMON', note: 'TELLER, UNBUILT 1954', minKt: 1000000, maxKt: 1000000, fission: 0.4, theoretical: true, tiers: ['world'] },
	{ id: 'sundial', name: 'SUNDIAL', note: 'TELLER, UNBUILT 1954', minKt: 10000000, maxKt: 10000000, fission: 0.4, theoretical: true, tiers: ['world'] }
];

export const weaponById = (id: string): Weapon => {
	const w = WEAPONS.find((x) => x.id === id);
	if (!w) throw new Error(`unknown weapon ${id}`);
	return w;
};

export const hasDial = (w: Weapon) => w.minKt !== w.maxKt;

export function formatYield(kt: number): string {
	if (kt >= 1000) return `${+(kt / 1000).toPrecision(3)} MT`;
	if (kt < 1) return `${+(kt * 1000).toPrecision(3)} T`;
	return `${+kt.toPrecision(3)} KT`;
}
