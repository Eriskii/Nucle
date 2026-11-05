import type { Placement } from './scenario';

// Cookies only, as a first pass with no backend. A cookie holds about 4 KB,
// so the ledger keeps a rolling window of recent days in a compact form.

const HISTORY = 'nucle_hist';
const RUN = 'nucle_run';
const SEEN = 'nucle_seen';
const THEME = 'nucle_theme';
const SOUND = 'nucle_sound';
const MAX_DAYS = 150;
const YEAR_S = 34560000; // 400 days, the longest browsers will honour.

export interface HistoryEntry {
	day: number;
	rating: number;
	passed: boolean;
	value: number;
	wargames: number;
}

export interface SavedRun {
	day: number;
	wargamesUsed: number;
	done: boolean;
	placements: Placement[];
}

function readCookie(name: string): string | null {
	for (const part of document.cookie.split('; ')) {
		const eq = part.indexOf('=');
		if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
	}
	return null;
}

function writeCookie(name: string, value: string) {
	document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${YEAR_S}; Path=/; SameSite=Lax`;
}

export function loadHistory(): HistoryEntry[] {
	const raw = readCookie(HISTORY);
	if (!raw) return [];
	const out: HistoryEntry[] = [];
	for (const row of raw.split(';')) {
		const [day, rating, passed, value, wargames] = row.split(':').map(Number);
		if (Number.isFinite(day)) out.push({ day, rating, passed: passed === 1, value, wargames });
	}
	return out;
}

export function saveResult(entry: HistoryEntry) {
	const rows = loadHistory().filter((e) => e.day !== entry.day);
	rows.push(entry);
	rows.sort((a, b) => a.day - b.day);
	const encoded = rows
		.slice(-MAX_DAYS)
		.map((e) => [e.day, e.rating, e.passed ? 1 : 0, +e.value.toPrecision(4), e.wargames].join(':'))
		.join(';');
	writeCookie(HISTORY, encoded);
}

export function loadRun(day: number): SavedRun | null {
	const raw = readCookie(RUN);
	if (!raw) return null;
	const [d, used, done, ...rest] = raw.split('|');
	if (Number(d) !== day) return null;
	const placements = (rest[0] ?? '')
		.split(';')
		.filter(Boolean)
		.map((row): Placement => {
			const [slot, lat, lon, kt, hobM] = row.split(',').map(Number);
			return { slot, lat, lon, kt, hobM };
		});
	return { day, wargamesUsed: Number(used), done: done === '1', placements };
}

export function saveRun(run: SavedRun) {
	const rows = run.placements
		.map((p) => [p.slot, +p.lat.toFixed(5), +p.lon.toFixed(5), +p.kt.toPrecision(4), Math.round(p.hobM)].join(','))
		.join(';');
	writeCookie(RUN, `${run.day}|${run.wargamesUsed}|${run.done ? 1 : 0}|${rows}`);
}

export const loadThemeId = () => readCookie(THEME);
export const saveThemeId = (id: string) => writeCookie(THEME, id);

export const loadSoundOff = () => readCookie(SOUND) === 'off';
export const saveSoundOff = (off: boolean) => writeCookie(SOUND, off ? 'off' : 'on');

export const hasSeenOrders = () => readCookie(SEEN) === '1';
export const markOrdersSeen = () => writeCookie(SEEN, '1');

export interface Stats {
	played: number;
	passed: number;
	streak: number;
	best: number;
}

export function statsFrom(history: HistoryEntry[]): Stats {
	let streak = 0;
	for (let i = history.length - 1; i >= 0; i--) {
		const contiguous = i === history.length - 1 || history[i].day === history[i + 1].day - 1;
		if (!history[i].passed || !contiguous) break;
		streak++;
	}
	return {
		played: history.length,
		passed: history.filter((h) => h.passed).length,
		streak,
		best: history.reduce((m, h) => Math.max(m, h.rating), 0)
	};
}
