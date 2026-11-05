import { BLUR_FRAG, COMPOSITE_FRAG, RESOLVE_FRAG, SCENE_FRAG } from './blastShader.ts';
import { compile, FULLSCREEN_VERT, noiseTexture, uniforms } from './gl.ts';

/** Everything the burst scene shows at one moment, in kilometres. */
export interface SceneState {
	width: number;
	height: number;
	/** Pixels per km, and where ground zero sits in CSS pixels from the left and from the bottom. */
	ppk: number;
	centreX: number;
	groundY: number;
	t: number;
	churn: number;
	hob: number;
	fire: [radius: number, alt: number, temp: number, opacity: number];
	pulse: number;
	cap: [alt: number, radius: number, half: number, drift: number];
	capLook: [opacity: number, heat: number, rise: number, pileus: number];
	stem: [base: number, neck: number, opacity: number, top: number];
	shock: [slant: number, ground: number, strength: number, wilson: number];
	dust: [front: number, height: number, opacity: number, outer: number];
	rings: [psi5: number, burn: number, fires: number, flash: number];
	fall: [amount: number, reach: number, slant: number];
	weather: [overcast: number, rain: number, snow: number];
	trail: { kind: number; head: [number, number]; tail: [number, number]; width: number };
	grade: number;
}

interface Target {
	fb: WebGLFramebuffer;
	tex: WebGLTexture;
	w: number;
	h: number;
}

/** Renders the burst scene to its canvas. Throws if WebGL2 isn't there, so the caller can keep the plain drawing. */
export class BlastEngine {
	private gl: WebGL2RenderingContext;
	private scene: WebGLProgram;
	private blur: WebGLProgram;
	private comp: WebGLProgram;
	private su;
	private bu;
	private cu;
	private noise: WebGLTexture;
	private vao: WebGLVertexArrayObject;
	private main: Target | null = null;
	/** Past frames, blended in to average out the ray jitter while the picture holds roughly still. */
	private histA: Target | null = null;
	private histB: Target | null = null;
	private resolve: WebGLProgram;
	private ru;
	private frame = 0;
	private lastT = NaN;
	private bloomA: Target | null = null;
	private bloomB: Target | null = null;
	private encode: number;
	private internal: number;
	private format: number;
	private type: number;

	constructor(private canvas: HTMLCanvasElement) {
		const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
		if (!gl) throw new Error('WebGL2 unavailable');
		this.gl = gl;
		// Float targets give true highlights to bloom. Without them, the range is squeezed into 8 bits.
		const float = !!gl.getExtension('EXT_color_buffer_float');
		this.encode = float ? 1 : 8;
		this.internal = float ? gl.RGBA16F : gl.RGBA8;
		this.format = gl.RGBA;
		this.type = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
		this.scene = compile(gl, FULLSCREEN_VERT, SCENE_FRAG);
		this.blur = compile(gl, FULLSCREEN_VERT, BLUR_FRAG);
		this.comp = compile(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
		this.resolve = compile(gl, FULLSCREEN_VERT, RESOLVE_FRAG);
		this.ru = uniforms(gl, this.resolve);
		this.su = uniforms(gl, this.scene);
		this.bu = uniforms(gl, this.blur);
		this.cu = uniforms(gl, this.comp);
		this.noise = noiseTexture(gl);
		this.vao = gl.createVertexArray() as WebGLVertexArrayObject;
		gl.bindVertexArray(this.vao);
	}

	private target(w: number, h: number): Target {
		const { gl } = this;
		const tex = gl.createTexture() as WebGLTexture;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, this.internal, w, h, 0, this.format, this.type, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		const fb = gl.createFramebuffer() as WebGLFramebuffer;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
		return { fb, tex, w, h };
	}

	private resize(w: number, h: number, bufW: number, bufH: number) {
		const { gl } = this;
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
		}
		if (this.main?.w === bufW && this.main.h === bufH) return;
		for (const t of [this.main, this.histA, this.histB, this.bloomA, this.bloomB]) {
			if (t) {
				gl.deleteTexture(t.tex);
				gl.deleteFramebuffer(t.fb);
			}
		}
		this.main = this.target(bufW, bufH);
		this.histA = this.target(bufW, bufH);
		this.histB = this.target(bufW, bufH);
		this.lastT = NaN;
		const bw = Math.max(2, bufW >> 2);
		const bh = Math.max(2, bufH >> 2);
		this.bloomA = this.target(bw, bh);
		this.bloomB = this.target(bw, bh);
	}

	/** `scale` is the share of device resolution the expensive scene pass runs at. */
	render(s: SceneState, scale: number, dpr: number) {
		const { gl } = this;
		const w = Math.max(2, Math.round(s.width * dpr));
		const h = Math.max(2, Math.round(s.height * dpr));
		const bw = Math.max(2, Math.round(w * scale));
		const bh = Math.max(2, Math.round(h * scale));
		this.resize(w, h, bw, bh);
		const main = this.main as Target;
		const a = this.bloomA as Target;
		const b = this.bloomB as Target;
		const u = this.su;

		gl.bindVertexArray(this.vao);
		gl.disable(gl.BLEND);
		gl.useProgram(this.scene);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_3D, this.noise);
		u.i('uNoise', 0);
		const pxScale = bw / s.width;
		u.f('uRes', bw, bh);
		u.f('uView', 1 / (s.ppk * pxScale), s.centreX * pxScale, s.groundY * pxScale);
		u.f('uT', s.t);
		u.f('uChurn', s.churn);
		u.f('uHob', s.hob);
		u.f('uFire', ...s.fire);
		u.f('uPulse', s.pulse);
		u.f('uCap', ...s.cap);
		u.f('uCapLook', ...s.capLook);
		u.f('uStem', ...s.stem);
		u.f('uShock', ...s.shock);
		u.f('uDust', ...s.dust);
		u.f('uRings', ...s.rings);
		u.f('uFall', s.fall[0], s.fall[1], s.fall[2], 0);
		u.f('uWeather', ...s.weather);
		u.f('uTrailHead', s.trail.head[0], s.trail.head[1], s.trail.width, s.trail.kind);
		u.f('uTrailTail', ...s.trail.tail);
		u.f('uEncode', this.encode);
		u.f('uQuality', scale > 0.7 ? 1 : 0.5);
		u.f('uFrame', this.frame++ % 240);
		gl.bindFramebuffer(gl.FRAMEBUFFER, main.fb);
		gl.viewport(0, 0, bw, bh);
		gl.drawArrays(gl.TRIANGLES, 0, 3);

		// Average with earlier frames unless time has jumped, when the old picture would ghost.
		const jump = !Number.isFinite(this.lastT) || Math.abs(s.t - this.lastT) > Math.max(0.2, Math.abs(s.t) * 0.03);
		this.lastT = s.t;
		const hist = this.histA as Target;
		const next = this.histB as Target;
		gl.useProgram(this.resolve);
		gl.bindFramebuffer(gl.FRAMEBUFFER, next.fb);
		gl.viewport(0, 0, bw, bh);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, main.tex);
		this.ru.i('uNew', 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, hist.tex);
		this.ru.i('uOld', 1);
		this.ru.f('uKeep', jump ? 0 : 0.82);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		this.histA = next;
		this.histB = hist;
		gl.activeTexture(gl.TEXTURE0);

		// Bloom: bright parts only, blurred wide at quarter size.
		gl.useProgram(this.blur);
		this.bu.i('uTex', 0);
		const pass = (from: WebGLTexture, to: Target, dx: number, dy: number, threshold: number) => {
			gl.bindFramebuffer(gl.FRAMEBUFFER, to.fb);
			gl.viewport(0, 0, to.w, to.h);
			gl.bindTexture(gl.TEXTURE_2D, from);
			this.bu.f('uDir', dx / to.w, dy / to.h);
			this.bu.f('uThreshold', threshold);
			gl.drawArrays(gl.TRIANGLES, 0, 3);
		};
		pass(next.tex, a, 1.5, 0, 1.1 / this.encode);
		pass(a.tex, b, 0, 1.5, 0);
		pass(b.tex, a, 4, 0, 0);
		pass(a.tex, b, 0, 4, 0);

		gl.useProgram(this.comp);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, w, h);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, next.tex);
		this.cu.i('uScene', 0);
		gl.activeTexture(gl.TEXTURE1);
		gl.bindTexture(gl.TEXTURE_2D, b.tex);
		this.cu.i('uBloom', 1);
		this.cu.f('uEncode', this.encode);
		this.cu.f('uGrade', s.grade);
		this.cu.f('uSeed', s.churn % 97);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.activeTexture(gl.TEXTURE0);
	}

	destroy() {
		this.gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}
