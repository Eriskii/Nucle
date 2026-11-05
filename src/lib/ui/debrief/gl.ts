// Small WebGL2 helpers shared by the burst scene and the weapon view.

export function compile(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
	const make = (type: number, src: string) => {
		const s = gl.createShader(type);
		if (!s) throw new Error('could not create shader');
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
		return s;
	};
	const p = gl.createProgram();
	if (!p) throw new Error('could not create program');
	gl.attachShader(p, make(gl.VERTEX_SHADER, vert));
	gl.attachShader(p, make(gl.FRAGMENT_SHADER, frag));
	gl.linkProgram(p);
	if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
	return p;
}

export const FULLSCREEN_VERT = `#version 300 es
out vec2 vUv;
void main() {
	vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
	vUv = p;
	gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Uniform setter that caches locations and ignores uniforms the compiler removed. */
export function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram) {
	const cache = new Map<string, WebGLUniformLocation | null>();
	const at = (name: string) => {
		if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
		return cache.get(name) ?? null;
	};
	return {
		f: (name: string, ...v: number[]) => {
			const l = at(name);
			if (!l) return;
			if (v.length === 1) gl.uniform1f(l, v[0]);
			else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
			else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
			else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
		},
		fv: (name: string, v: Float32Array) => {
			const l = at(name);
			if (l) gl.uniform1fv(l, v);
		},
		v2: (name: string, v: Float32Array) => {
			const l = at(name);
			if (l) gl.uniform2fv(l, v);
		},
		v3: (name: string, v: Float32Array) => {
			const l = at(name);
			if (l) gl.uniform3fv(l, v);
		},
		i: (name: string, v: number) => {
			const l = at(name);
			if (l) gl.uniform1i(l, v);
		}
	};
}

const fract = (x: number) => x - Math.floor(x);

/** Tiling Worley noise on a jittered grid, one octave. Returns 1 at a cell centre, falling toward 0. */
function worley(x: number, y: number, z: number, cells: number): number {
	const px = x * cells;
	const py = y * cells;
	const pz = z * cells;
	const ix = Math.floor(px);
	const iy = Math.floor(py);
	const iz = Math.floor(pz);
	let best = 9;
	for (let k = -1; k <= 1; k++) {
		for (let j = -1; j <= 1; j++) {
			for (let i = -1; i <= 1; i++) {
				const cx = (ix + i + cells) % cells;
				const cy = (iy + j + cells) % cells;
				const cz = (iz + k + cells) % cells;
				const h = cx * 127.1 + cy * 311.7 + cz * 74.7 + cells * 19.19;
				const dx = ix + i + fract(Math.sin(h) * 43758.5453) - px;
				const dy = iy + j + fract(Math.sin(h + 1.3) * 43758.5453) - py;
				const dz = iz + k + fract(Math.sin(h + 2.7) * 43758.5453) - pz;
				best = Math.min(best, dx * dx + dy * dy + dz * dz);
			}
		}
	}
	return Math.max(0, 1 - Math.sqrt(best));
}

/** Tiling value noise, one octave. */
function value(x: number, y: number, z: number, cells: number): number {
	const px = x * cells;
	const py = y * cells;
	const pz = z * cells;
	const ix = Math.floor(px);
	const iy = Math.floor(py);
	const iz = Math.floor(pz);
	const s = (t: number) => t * t * (3 - 2 * t);
	const fx = s(px - ix);
	const fy = s(py - iy);
	const fz = s(pz - iz);
	const v = (a: number, b: number, c: number) => {
		const h = ((a + cells) % cells) * 12.9898 + ((b + cells) % cells) * 78.233 + ((c + cells) % cells) * 37.719 + cells;
		return fract(Math.sin(h) * 43758.5453);
	};
	const mix = (a: number, b: number, t: number) => a + (b - a) * t;
	return mix(
		mix(mix(v(ix, iy, iz), v(ix + 1, iy, iz), fx), mix(v(ix, iy + 1, iz), v(ix + 1, iy + 1, iz), fx), fy),
		mix(mix(v(ix, iy, iz + 1), v(ix + 1, iy, iz + 1), fx), mix(v(ix, iy + 1, iz + 1), v(ix + 1, iy + 1, iz + 1), fx), fy),
		fz
	);
}

/**
 * A tiling 3D texture. R is billows (inverted Worley over value noise), G is fine Worley for eroding edges.
 * Sampling this is what makes volumetric clouds cheap enough to run live.
 */
export function noiseTexture(gl: WebGL2RenderingContext, size = 64): WebGLTexture {
	const data = new Uint8Array(size * size * size * 2);
	let n = 0;
	for (let z = 0; z < size; z++) {
		for (let y = 0; y < size; y++) {
			for (let x = 0; x < size; x++) {
				const u = x / size;
				const v = y / size;
				const w = z / size;
				const billow = 0.6 * worley(u, v, w, 4) + 0.28 * worley(u, v, w, 8) + 0.12 * worley(u, v, w, 16);
				const soft = 0.5 * value(u, v, w, 4) + 0.3 * value(u, v, w, 8) + 0.2 * value(u, v, w, 16);
				const fine = 0.65 * worley(u, v, w, 12) + 0.35 * worley(u, v, w, 24);
				// Stretched so a threshold near 0.5 cuts real lobes out of it.
				data[n++] = Math.round(255 * Math.max(0, Math.min(1, (0.72 * billow + 0.38 * soft - 0.42) / 0.42)));
				data[n++] = Math.round(255 * fine);
			}
		}
	}
	const tex = gl.createTexture();
	if (!tex) throw new Error('could not create texture');
	gl.bindTexture(gl.TEXTURE_3D, tex);
	gl.texImage3D(gl.TEXTURE_3D, 0, gl.RG8, size, size, size, 0, gl.RG, gl.UNSIGNED_BYTE, data);
	gl.generateMipmap(gl.TEXTURE_3D);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
	gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
	return tex;
}

/** Keeps a live render near a frame budget by trading resolution, and renders crisp when the picture holds still. */
export class Governor {
	scale = 1;
	private ema = 0;
	constructor(
		private budgetMs = 28,
		private min = 0.4
	) {}
	note(ms: number) {
		this.ema = this.ema === 0 ? ms : this.ema * 0.85 + ms * 0.15;
		if (this.ema > this.budgetMs * 1.15) this.scale = Math.max(this.min, this.scale * 0.92);
		else if (this.ema < this.budgetMs * 0.6) this.scale = Math.min(1, this.scale * 1.02);
	}
}
