import { rngFor, shuffled } from './rng';
import { lowerIsBetter, type Scenario } from './scenario';

export interface BoardRow {
	name: string;
	value: number;
	you?: boolean;
	failed?: boolean;
}

const WINGS = [
	'RAND PROJECT STAFF',
	'CINCSAC WAR ROOM',
	'NORAD BATTLE STAFF',
	'OFFUTT PLANNERS',
	'HOLLOMAN TEST WING',
	'WHIZ KIDS, PENTAGON',
	'HIGH FRONTIER STUDY',
	'THULE NIGHT SHIFT',
	'GENERAL STAFF, MOSCOW',
	'CONELRAD DUTY OFFICER',
	'AWDREY TEST CREW',
	'LOOKING GLASS CREW'
];

/**
 * The day's board. With no backend these rows are simulated from the solver's
 * par, the same for everyone on the same day. The player's row slots in by score.
 */
export function boardFor(s: Scenario, you?: { value: number; passed: boolean }): BoardRow[] {
	const rng = rngFor(s.day, 'board');
	const names = shuffled(rng, WINGS);
	const factors = [1.04, 0.98, 0.93, 0.87, 0.81, 0.74, 0.66];
	const low = lowerIsBetter(s.kind);
	const rows: BoardRow[] = [{ name: 'COMMAND ESTIMATE', value: s.par }];
	factors.forEach((f, i) => {
		const jitter = f + (rng() - 0.5) * 0.03;
		rows.push({ name: names[i], value: low ? s.par / jitter : s.par * jitter });
	});
	rows.sort((a, b) => (low ? a.value - b.value : b.value - a.value));
	if (you) {
		const row: BoardRow = { name: 'YOU', value: you.value, you: true, failed: !you.passed };
		if (!you.passed) rows.push(row);
		else {
			const at = rows.findIndex((r) => (low ? you.value < r.value : you.value > r.value));
			rows.splice(at < 0 ? rows.length : at, 0, row);
		}
	}
	return rows;
}
