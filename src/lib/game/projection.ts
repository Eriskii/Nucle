import { EARTH_KM } from './effects';

const RAD = Math.PI / 180;

/** Azimuthal equidistant projection in km around the theatre centre. */
export class Projection {
	private sin0: number;
	private cos0: number;
	private lon0: number;

	constructor(lat: number, lon: number) {
		this.sin0 = Math.sin(lat * RAD);
		this.cos0 = Math.cos(lat * RAD);
		this.lon0 = lon * RAD;
	}

	forward(lat: number, lon: number): [number, number] {
		const p = lat * RAD;
		const dl = lon * RAD - this.lon0;
		const sinP = Math.sin(p);
		const cosP = Math.cos(p);
		const cosD = Math.cos(dl);
		const cosC = this.sin0 * sinP + this.cos0 * cosP * cosD;
		const c = Math.acos(Math.max(-1, Math.min(1, cosC)));
		const k = c < 1e-6 ? 1 : c / Math.sin(c);
		return [
			EARTH_KM * k * cosP * Math.sin(dl),
			EARTH_KM * k * (this.cos0 * sinP - this.sin0 * cosP * cosD)
		];
	}

	inverse(x: number, y: number): [number, number] {
		const rho = Math.hypot(x, y);
		if (rho < 1e-6) return [Math.asin(this.sin0) / RAD, this.lon0 / RAD];
		const c = rho / EARTH_KM;
		const sinC = Math.sin(c);
		const cosC = Math.cos(c);
		const lat = Math.asin(cosC * this.sin0 + (y * sinC * this.cos0) / rho);
		const lon = this.lon0 + Math.atan2(x * sinC, rho * this.cos0 * cosC - y * this.sin0 * sinC);
		return [lat / RAD, wrapLon(lon / RAD)];
	}
}

const wrapLon = (l: number) => ((l + 540) % 360) - 180;

/** Point reached from a start along a bearing, in degrees. */
export function destination(lat: number, lon: number, bearing: number, km: number): [number, number] {
	const d = km / EARTH_KM;
	const b = bearing * RAD;
	const p = lat * RAD;
	const sinOut = Math.sin(p) * Math.cos(d) + Math.cos(p) * Math.sin(d) * Math.cos(b);
	const out = Math.asin(Math.max(-1, Math.min(1, sinOut)));
	const dl = Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p), Math.cos(d) - Math.sin(p) * sinOut);
	return [out / RAD, wrapLon(lon + dl / RAD)];
}
