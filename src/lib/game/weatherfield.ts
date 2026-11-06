import { EARTH_KM, type Precip, type Weather } from './effects';
import { PlumeTrack } from './plumetrack';

// Real weather on a historical date, from static/data/weather-<map>.json. Built once by scripts/build-weather.ts, so a
// puzzle is the same for everyone. ERA5 reanalysis, by way of Open-Meteo. Between stations the wind and humidity are
// blended, so each burst feels the weather at its own ground zero.

/** Reported at 100 m, while the game's wind stands for the lowest few km. ERA5's upper winds aren't in this source. An estimate. */
const WIND_TO_LOW_LEVELS = 1.5;
const MIN_WIND_KMH = 5;
const RAD = Math.PI / 180;

export interface LocalWeather extends Weather {
	/** Relative humidity at the ground, 0 to 1. */
	humidity: number;
	tempC: number;
	/** The date this weather is from. */
	date: string;
}

export interface Station {
	lat: number;
	lon: number;
	tempC: number;
	humidity: number;
	precip: Precip;
	/** Toward east and toward north, km/h. */
	u: number;
	v: number;
}

export interface WeatherFile {
	hour: number;
	days: { date: string; rows: (number | null)[][] }[];
}

/** WMO weather code and cloud cover to the game's kinds of weather. */
export function precipFrom(code: number, cloud: number, humidity: number): Precip {
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'SNOW';
	if (code >= 51) return 'RAIN';
	if (code === 45 || code === 48 || (humidity >= 85 && cloud < 80)) return 'HAZE';
	return cloud >= 70 ? 'OVERCAST' : 'CLEAR';
}

const distance = (aLat: number, aLon: number, bLat: number, bLon: number) => {
	const dLat = (bLat - aLat) * RAD;
	const dLon = (bLon - aLon) * RAD;
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
	return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
};

export class WeatherField {
	readonly stations: Station[];
	private cache = new Map<string, LocalWeather>();
	private tracks = new Map<string, PlumeTrack>();

	constructor(
		readonly date: string,
		rows: (number | null)[][]
	) {
		this.stations = rows
			.filter((r) => r.every((x) => x !== null))
			.map((row) => {
				const [lat, lon, tempC, rh, code, cloud, kmh, from] = row as number[];
				const toward = (from + 180) * RAD;
				const speed = Math.max(MIN_WIND_KMH, kmh * WIND_TO_LOW_LEVELS);
				return { lat, lon, tempC, humidity: rh / 100, precip: precipFrom(code, cloud, rh), u: speed * Math.sin(toward), v: speed * Math.cos(toward) };
			});
		if (!this.stations.length) throw new Error(`no weather for ${date}`);
	}

	/** A fallout plume's centre line from a ground zero, carried along by the winds it meets. */
	track(lat: number, lon: number, lengthKm: number): PlumeTrack {
		const key = `${lat.toFixed(4)}|${lon.toFixed(4)}|${lengthKm.toFixed(1)}`;
		let found = this.tracks.get(key);
		if (!found) {
			found = new PlumeTrack(lat, lon, lengthKm, (a, o) => this.at(a, o).windBearing);
			if (this.tracks.size > 2000) this.tracks.clear();
			this.tracks.set(key, found);
		}
		return found;
	}

	/** The weather at a point, blended from the four nearest stations. Rain, snow and cloud come from the nearest. */
	at(lat: number, lon: number): LocalWeather {
		const key = `${lat.toFixed(2)}|${lon.toFixed(2)}`;
		const hit = this.cache.get(key);
		if (hit) return hit;
		const near = this.stations
			.map((s) => ({ s, km: distance(lat, lon, s.lat, s.lon) }))
			.sort((a, b) => a.km - b.km)
			.slice(0, 4);
		let sum = 0;
		let u = 0;
		let v = 0;
		let humidity = 0;
		let tempC = 0;
		for (const { s, km } of near) {
			const w = 1 / Math.pow(Math.max(km, 1), 2);
			sum += w;
			u += s.u * w;
			v += s.v * w;
			humidity += s.humidity * w;
			tempC += s.tempC * w;
		}
		u /= sum;
		v /= sum;
		const local: LocalWeather = {
			precip: near[0].s.precip,
			windBearing: Math.round((((Math.atan2(u, v) / RAD) % 360) + 360) % 360),
			windKmh: Math.max(MIN_WIND_KMH, Math.round(Math.hypot(u, v))),
			humidity: Math.round((humidity / sum) * 100) / 100,
			tempC: Math.round(tempC / sum),
			date: this.date
		};
		if (this.cache.size > 5000) this.cache.clear();
		this.cache.set(key, local);
		return local;
	}
}
