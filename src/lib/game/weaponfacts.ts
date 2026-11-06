// External, public-record facts for the report's weapon pages. Sizes are outer dimensions, drawn next to a
// person for scale. Confidence: published means a primary or archive page states it, secondary means
// Wikipedia or similar, uncertain means sources conflict or the figure is a press report.

export type OutlineKind = 'shell' | 'warhead' | 'gun' | 'fat' | 'slim' | 'cone' | 'missile' | 'device' | 'torpedo' | 'heavy';
export type Confidence = 'published' | 'secondary' | 'uncertain';

export interface WeaponFacts {
	/** What the drawing shows, when that isn't the weapon's own casing. */
	drawn?: 'missile' | 'warhead' | 'rv' | 'round';
	outline?: OutlineKind;
	lengthM?: number;
	diameterM?: number;
	massKg?: number;
	massNote?: 'conflict' | 'approx';
	year: string;
	source: string;
	confidence: Confidence;
}

const SUB = 'https://nuclearweaponarchive.org/Usa/Weapons/';
const WP = 'https://en.wikipedia.org/wiki/';

export const WEAPON_FACTS: Record<string, WeaponFacts> = {
	mk54: { drawn: 'round', outline: 'shell', lengthM: 0.79, diameterM: 0.28, massKg: 34, year: '1961', source: `${WP}Davy_Crockett_(nuclear_device)`, confidence: 'secondary' },
	w70: { drawn: 'warhead', outline: 'warhead', lengthM: 1.04, diameterM: 0.46, massKg: 122, year: '1981–83', source: `${SUB}Allbombs.html`, confidence: 'secondary' },
	boy: { outline: 'gun', lengthM: 3.05, diameterM: 0.71, massKg: 4040, massNote: 'conflict', year: '1945', source: 'https://nuclearweaponarchive.org/Usa/Med/Lbfm.html', confidence: 'published' },
	fat: { outline: 'fat', lengthM: 3.25, diameterM: 1.53, massKg: 4670, year: '1945', source: 'https://nuclearweaponarchive.org/Usa/Med/Lbfm.html', confidence: 'published' },
	b61: { outline: 'slim', lengthM: 3.59, diameterM: 0.34, massKg: 320, year: '1967', source: `${SUB}B61.html`, confidence: 'published' },
	w80: { drawn: 'warhead', outline: 'warhead', lengthM: 0.8, diameterM: 0.3, massKg: 132, year: '1981', source: `${WP}W80_(nuclear_warhead)`, confidence: 'secondary' },
	w76: { drawn: 'rv', outline: 'cone', lengthM: 1.3, diameterM: 0.4, massKg: 164, massNote: 'conflict', year: '1978', source: `${SUB}W76.html`, confidence: 'uncertain' },
	w87: { drawn: 'rv', outline: 'cone', lengthM: 1.75, diameterM: 0.55, massKg: 363, massNote: 'approx', year: '1986', source: `${SUB}W87.html`, confidence: 'published' },
	w88: { drawn: 'rv', outline: 'cone', lengthM: 1.75, diameterM: 0.55, massKg: 363, massNote: 'approx', year: '1989', source: `${SUB}W88.html`, confidence: 'published' },
	ss25: { drawn: 'missile', outline: 'missile', lengthM: 23.5, diameterM: 2.17, massKg: 50100, year: '1985', source: `${WP}RT-2PM_Topol`, confidence: 'secondary' },
	b83: { outline: 'slim', lengthM: 3.68, diameterM: 0.46, massKg: 1090, year: '1983', source: `${WP}B83_nuclear_bomb`, confidence: 'published' },
	df5: { drawn: 'missile', outline: 'missile', lengthM: 32.6, diameterM: 3.35, massKg: 183000, year: '1971', source: `${WP}DF-5`, confidence: 'secondary' },
	b53: { outline: 'heavy', lengthM: 3.8, diameterM: 1.27, massKg: 4010, year: '1962', source: `${WP}B53_nuclear_bomb`, confidence: 'published' },
	bravo: { outline: 'device', lengthM: 4.56, diameterM: 1.37, massKg: 10660, year: '1954', source: 'https://nuclearweaponarchive.org/Usa/Tests/Castle.html', confidence: 'published' },
	ss18: { drawn: 'missile', outline: 'missile', lengthM: 32.6, diameterM: 3.05, massKg: 209600, year: '1975', source: `${WP}R-36_(missile)`, confidence: 'secondary' },
	pos: { outline: 'torpedo', lengthM: 20, diameterM: 1.8, massKg: 100000, massNote: 'approx', year: '2015', source: `${WP}Poseidon_(unmanned_underwater_vehicle)`, confidence: 'uncertain' },
	cob: { year: '1950', source: `${WP}Cobalt_bomb`, confidence: 'secondary' },
	ripple: { drawn: 'rv', outline: 'cone', lengthM: 4.3, diameterM: 2.5, massKg: 2720, massNote: 'approx', year: '1962', source: 'https://doi.org/10.1162/jcws_a_01011', confidence: 'uncertain' },
	sodium: { year: '1950s', source: `${WP}Salted_bomb`, confidence: 'secondary' },
	gold: { year: '1950s', source: `${WP}Salted_bomb`, confidence: 'secondary' },
	tsar: { outline: 'heavy', lengthM: 8, diameterM: 2.1, massKg: 27000, year: '1961', source: 'https://nuclearweaponarchive.org/Russia/TsarBomba.html', confidence: 'published' },
	tsar2: { outline: 'heavy', lengthM: 8, diameterM: 2.1, massKg: 27000, year: '1961', source: 'https://nuclearweaponarchive.org/Russia/TsarBomba.html', confidence: 'published' },
	gnomon: { year: '1954', source: `${WP}Sundial_(weapon)`, confidence: 'secondary' },
	sundial: { year: '1954', source: `${WP}Sundial_(weapon)`, confidence: 'secondary' }
};
