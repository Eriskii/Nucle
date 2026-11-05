import type { Lang } from '#lib/game/i18n.ts';

export type ThemeId = 'sage' | 'pvo' | 'paper';

/** Everything the scope needs to know to draw as a given piece of equipment. */
export interface Theme {
	id: ThemeId;
	name: string;
	lang: Lang;
	shape: 'round' | 'square';
	/** refresh: rewritten from a drum. ppi: rotating radar beam. none: it's paper. */
	motion: 'refresh' | 'ppi' | 'none';
	/** Light-emitting display, so bloom and additive flash apply. */
	emissive: boolean;
	font: string;
	/** Font for marks made by hand, where the theme has them. */
	hand: string;
	ink: string;
	flash: string;
	dim: string;
	place: string;
	placeText: string;
	target: string;
	alert: string;
	halo: string;
	grid: string;
	gridText: string;
	/** "r, g, b" for population marks. */
	dot: string;
	dotAlpha: number[];
	stipple: string;
	urban: string;
	river: string;
	lake: string;
	admin: string;
	minor: string;
	rail: string;
	road: string;
	border: string;
	coast: string;
	water: string;
	green: string;
	buildingFill: string;
	buildingEdge: string;
	runway: string;
	roadService: string;
	roadRgb: string;
	roadAlpha: number;
	roadCore: string;
	thermal: string;
	psi1: string;
	psi5: string;
	psi20: string;
	fireball: string;
	plume: string;
	empFill: string;
	damageHot: string;
	damageWarm: string;
	cursor: string;
}

export const THEMES: Record<ThemeId, Theme> = {
	// Museum records describe a yellow scope behind a filter, so traces read
	// yellow rather than the green of a radar repeater.
	sage: {
		id: 'sage',
		name: 'SAGE',
		lang: 'en',
		shape: 'round',
		motion: 'refresh',
		emissive: true,
		font: '"Share Tech Mono", monospace',
		hand: '"Reenie Beanie", cursive',
		ink: '#f3e58a',
		flash: '#f5f6ff',
		dim: 'rgba(243, 229, 138, 0.42)',
		place: '#f0d774',
		placeText: '#fff3b8',
		target: '#ff9a4a',
		alert: '#ff5b42',
		halo: 'rgba(12, 10, 2, 0.92)',
		grid: 'rgba(243, 229, 138, 0.2)',
		gridText: 'rgba(243, 229, 138, 0.75)',
		dot: '238, 224, 130',
		dotAlpha: [0.14, 0.26, 0.48, 0.85],
		stipple: 'rgba(238, 224, 130, 0.62)',
		urban: 'rgba(230, 205, 110, 0.5)',
		river: 'rgba(200, 225, 200, 0.62)',
		lake: 'rgba(200, 225, 200, 0.85)',
		admin: 'rgba(243, 229, 138, 0.38)',
		minor: 'rgba(240, 232, 180, 0.6)',
		rail: 'rgba(220, 225, 240, 0.6)',
		road: 'rgba(250, 244, 205, 0.75)',
		border: 'rgba(250, 236, 150, 0.8)',
		coast: '#f7e98e',
		water: 'rgba(150, 175, 130, 0.13)',
		green: 'rgba(160, 150, 70, 0.09)',
		buildingFill: 'rgba(243, 229, 138, 0.16)',
		buildingEdge: 'rgba(250, 240, 165, 0.95)',
		runway: 'rgba(245, 240, 215, 0.8)',
		roadService: 'rgba(225, 215, 165, 0.7)',
		roadRgb: '250, 244, 212',
		roadAlpha: 1,
		roadCore: '#100e04',
		thermal: 'rgba(255, 154, 74, 0.72)',
		psi1: 'rgba(243, 229, 138, 0.55)',
		psi5: 'rgba(250, 240, 170, 0.95)',
		psi20: '#f5f6ff',
		fireball: 'rgba(245, 246, 255, 0.55)',
		plume: '226, 235, 160',
		empFill: 'rgba(225, 230, 255, 0.05)',
		damageHot: '255, 248, 218',
		damageWarm: '255, 164, 74',
		cursor: 'rgba(245, 246, 255, 0.85)'
	},
	// A plan position indicator: rotating beam and long green-yellow persistence.
	pvo: {
		id: 'pvo',
		name: 'ПВО',
		lang: 'ru',
		shape: 'round',
		motion: 'ppi',
		emissive: true,
		font: '"PT Mono", monospace',
		hand: '"PT Mono", monospace',
		ink: '#a6e86c',
		flash: '#e6ffd0',
		dim: 'rgba(166, 232, 108, 0.42)',
		place: '#c7e85c',
		placeText: '#e4f7a8',
		target: '#ffb13b',
		alert: '#ff5a32',
		halo: 'rgba(3, 12, 3, 0.92)',
		grid: 'rgba(166, 232, 108, 0.26)',
		gridText: 'rgba(166, 232, 108, 0.8)',
		dot: '168, 232, 110',
		dotAlpha: [0.14, 0.26, 0.48, 0.85],
		stipple: 'rgba(168, 232, 110, 0.62)',
		urban: 'rgba(170, 215, 90, 0.5)',
		river: 'rgba(130, 220, 170, 0.6)',
		lake: 'rgba(130, 220, 170, 0.85)',
		admin: 'rgba(166, 232, 108, 0.4)',
		minor: 'rgba(200, 235, 165, 0.6)',
		rail: 'rgba(175, 225, 205, 0.6)',
		road: 'rgba(222, 245, 190, 0.78)',
		border: 'rgba(190, 240, 130, 0.8)',
		coast: '#b3f073',
		water: 'rgba(60, 150, 100, 0.14)',
		green: 'rgba(60, 120, 50, 0.09)',
		buildingFill: 'rgba(166, 232, 108, 0.17)',
		buildingEdge: 'rgba(195, 245, 145, 0.95)',
		runway: 'rgba(225, 245, 205, 0.8)',
		roadService: 'rgba(190, 225, 165, 0.7)',
		roadRgb: '228, 248, 200',
		roadAlpha: 1,
		roadCore: '#051005',
		thermal: 'rgba(255, 177, 59, 0.72)',
		psi1: 'rgba(166, 232, 108, 0.55)',
		psi5: 'rgba(205, 245, 160, 0.95)',
		psi20: '#e6ffd0',
		fireball: 'rgba(230, 255, 208, 0.55)',
		plume: '205, 225, 90',
		empFill: 'rgba(200, 255, 200, 0.05)',
		damageHot: '250, 255, 215',
		damageWarm: '255, 170, 60',
		cursor: 'rgba(230, 255, 208, 0.85)'
	},
	// A printed aeronautical chart, marked up by hand.
	paper: {
		id: 'paper',
		name: 'CHART',
		lang: 'en',
		shape: 'square',
		motion: 'none',
		emissive: false,
		font: '"Courier Prime", monospace',
		hand: '"Reenie Beanie", cursive',
		ink: '#3a3226',
		flash: '#a01d16',
		dim: 'rgba(58, 50, 38, 0.5)',
		place: '#2c261c',
		placeText: '#2c261c',
		target: '#b3201a',
		alert: '#b3201a',
		halo: 'rgba(240, 231, 208, 0.92)',
		grid: 'rgba(95, 80, 55, 0.28)',
		gridText: 'rgba(80, 66, 44, 0.85)',
		dot: '90, 76, 55',
		dotAlpha: [0.08, 0.16, 0.3, 0.55],
		stipple: 'rgba(90, 76, 55, 0.5)',
		urban: 'rgba(190, 150, 60, 0.75)',
		river: 'rgba(50, 110, 160, 0.75)',
		lake: 'rgba(50, 110, 160, 0.9)',
		admin: 'rgba(120, 70, 130, 0.5)',
		minor: 'rgba(170, 95, 60, 0.6)',
		rail: 'rgba(40, 36, 30, 0.75)',
		road: 'rgba(170, 70, 40, 0.8)',
		border: 'rgba(110, 50, 130, 0.8)',
		coast: '#23608f',
		water: 'rgba(110, 165, 200, 0.28)',
		green: 'rgba(120, 155, 90, 0.2)',
		buildingFill: 'rgba(80, 66, 50, 0.22)',
		buildingEdge: 'rgba(55, 45, 32, 0.9)',
		runway: 'rgba(60, 50, 40, 0.8)',
		roadService: 'rgba(150, 110, 80, 0.6)',
		roadRgb: '165, 75, 45',
		roadAlpha: 1,
		roadCore: '#efe6cf',
		thermal: 'rgba(205, 110, 25, 0.9)',
		psi1: 'rgba(40, 70, 150, 0.8)',
		psi5: 'rgba(170, 28, 22, 0.92)',
		psi20: 'rgba(120, 12, 10, 1)',
		fireball: 'rgba(120, 12, 10, 0.32)',
		plume: '40, 70, 150',
		empFill: 'rgba(40, 70, 150, 0.06)',
		damageHot: '150, 18, 12',
		damageWarm: '205, 110, 25',
		cursor: 'rgba(40, 34, 26, 0.85)'
	}
};

export const THEME_ORDER: ThemeId[] = ['sage', 'pvo', 'paper'];
