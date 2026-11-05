import type { Look } from '#lib/game/weaponlooks.ts';
import { compile, FULLSCREEN_VERT, noiseTexture, uniforms } from './gl.ts';
import { WEAPON_FRAG } from './weaponShader.ts';

export interface WeaponPose {
	yaw: number;
	pitch: number;
	/** Camera distance in lengths of the weapon. */
	distance: number;
	/** Point looked at, as a share of the weapon's length from the nose. */
	aim: number;
	flight: number;
	altKm: number;
	speedMs: number;
	time: number;
	chute: number;
	plasma: number;
	white: number;
	grade: number;
	roll: number;
}

/** Draws one weapon's casing to a canvas. Throws if WebGL2 isn't there. */
export class WeaponEngine {
	private gl: WebGL2RenderingContext;
	private program: WebGLProgram;
	private u;
	private noise: WebGLTexture;
	private vao: WebGLVertexArrayObject;
	private look: Look | null = null;

	constructor(private canvas: HTMLCanvasElement) {
		const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
		if (!gl) throw new Error('WebGL2 unavailable');
		this.gl = gl;
		this.program = compile(gl, FULLSCREEN_VERT, WEAPON_FRAG);
		this.u = uniforms(gl, this.program);
		this.noise = noiseTexture(gl, 40);
		this.vao = gl.createVertexArray() as WebGLVertexArrayObject;
	}

	setLook(look: Look, lengthM: number, diameterM: number) {
		const { gl, u } = this;
		gl.useProgram(this.program);
		this.look = look;
		const prof = new Float32Array(32);
		look.profile.forEach(([t, r], i) => {
			prof[i * 2] = t * lengthM;
			prof[i * 2 + 1] = r * diameterM;
		});
		u.v2('uProf', prof);
		u.i('uCount', look.profile.length);
		u.f('uLength', lengthM);
		const f = look.fins;
		u.f('uFins', f ? (f.kind === 'box' ? 2 : 1) : 0, f ? f.start * lengthM : 0, f ? f.span * diameterM : 0, f ? f.thick * diameterM : 0);
		u.f('uTar', look.tar ? 1 : 0);
		const bands = look.bands;
		const pick = (i: number) => bands[Math.min(i, bands.length - 1)];
		u.f('uBandEnd', pick(0).end, pick(1).end, pick(2).end, 1);
		const cols = new Float32Array(12);
		for (let i = 0; i < 4; i++) cols.set(pick(i).colour, i * 3);
		u.v3('uBandCol', cols);
		u.f('uBandRough', pick(0).rough, pick(1).rough, pick(2).rough, pick(3).rough);
		u.f('uBandMetal', pick(0).metal, pick(1).metal, pick(2).metal, pick(3).metal);
	}

	render(pose: WeaponPose, width: number, height: number, dpr: number, lengthM: number) {
		const { gl, u } = this;
		if (!this.look) return;
		const w = Math.max(2, Math.round(width * dpr));
		const h = Math.max(2, Math.round(height * dpr));
		if (this.canvas.width !== w || this.canvas.height !== h) {
			this.canvas.width = w;
			this.canvas.height = h;
		}
		gl.viewport(0, 0, w, h);
		gl.useProgram(this.program);
		gl.bindVertexArray(this.vao);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_3D, this.noise);
		u.i('uNoise', 0);
		u.f('uRes', w, h);
		u.f('uCam', pose.yaw, pose.pitch, pose.distance * lengthM);
		u.f('uTarget', pose.aim * lengthM, 0, 0);
		u.f('uFlight', pose.flight);
		u.f('uAir', pose.altKm, pose.speedMs, pose.time);
		u.f('uChute', pose.chute);
		u.f('uPlasma', pose.plasma);
		u.f('uGrade', pose.grade);
		u.f('uWhite', pose.white);
		u.f('uRoll', pose.roll);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
	}

	destroy() {
		this.gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}
