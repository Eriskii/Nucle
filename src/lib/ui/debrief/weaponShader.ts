// Renders a weapon's outer casing by sphere tracing: a surface of revolution from its profile, plus fins, a box tail,
// paint bands and wear. Used for the turntable in the device section and the tracking camera during its fall.
// Only external shape is modelled. Nothing here represents what is inside a weapon.

export const WEAPON_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;

uniform sampler3D uNoise;
uniform vec2 uRes;
uniform vec2 uProf[16];    // axial metres from the nose, radius metres
uniform int uCount;
uniform float uLength;
uniform vec4 uFins;        // kind (0 none, 1 cruciform, 2 box tail), start m from nose, span m, thickness m
uniform vec4 uBandEnd;     // axial fraction where bands 0-3 end
uniform vec3 uBandCol[4];
uniform vec4 uBandRough;
uniform vec4 uBandMetal;
uniform vec3 uCam;         // yaw, pitch, distance m
uniform vec3 uTarget;      // axial point the camera looks at
uniform float uFlight;     // 0 studio, 1 in the air
uniform vec3 uAir;         // altitude km, speed m/s, time
uniform float uChute;      // 0-1 parachute open
uniform float uPlasma;     // 0-1 reentry heating
uniform float uGrade;
uniform float uWhite;      // the flash taking over the frame
uniform float uTar;
uniform float uRoll;       // the weapon's tilt in frame, radians

const vec3 SUN = normalize(vec3(-0.5, 0.75, 0.45));

float sat(float x) { return clamp(x, 0.0, 1.0); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }

float bodyDist(vec3 p) {
	vec2 q = vec2(p.x, length(p.yz));
	float d = 1e9;
	bool inside = false;
	// Distance to the closed outline, with a crossing count to tell which side of it we are on.
	vec2 prev = vec2(uProf[0].x, 0.0);
	for (int i = 0; i <= uCount; i++) {
		vec2 cur = i < uCount ? uProf[i] : vec2(uProf[uCount - 1].x, 0.0);
		vec2 e = cur - prev;
		vec2 w = q - prev;
		float h = sat(dot(w, e) / max(dot(e, e), 1e-9));
		vec2 b = w - e * h;
		d = min(d, dot(b, b));
		if ((prev.x <= q.x) != (cur.x <= q.x)) {
			float r = prev.y + (q.x - prev.x) / (cur.x - prev.x) * (cur.y - prev.y);
			if (q.y < r) inside = !inside;
		}
		prev = cur;
	}
	d = sqrt(d);
	return inside ? -d : d;
}

float box2(vec2 p, vec2 b) {
	vec2 d = abs(p) - b;
	return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float finsDist(vec3 p) {
	if (uFins.x < 0.5) return 1e9;
	float start = uFins.y;
	float span = uFins.z;
	float th = uFins.w;
	vec2 yz = p.yz;
	float along = p.x - start;
	float chord = uLength - start;
	if (uFins.x < 1.5) {
		// Four swept plates, folded into one by symmetry.
		vec2 s = abs(yz);
		float rad = max(s.x, s.y);
		float side = min(s.x, s.y);
		float sweep = rad - span * sat(along / max(chord, 1e-3) + 0.05);
		float edge = max(max(-along, along - chord), sweep);
		return max(edge, side - th);
	}
	// A square shroud around four flat plates, the shape of the wartime box tails.
	float outer = box2(yz, vec2(span));
	float shell = abs(outer) - th;
	float wrap = max(shell, max(-(along - chord * 0.5), along - chord));
	vec2 s = abs(yz);
	float plate = max(max(-along, along - chord), max(max(s.x, s.y) - span, min(s.x, s.y) - th));
	return min(wrap, plate);
}

float chuteDist(vec3 p) {
	if (uChute <= 0.0) return 1e9;
	// A ribbon canopy trailing behind the tail, on rigging lines.
	float back = uLength * 2.8 * uChute;
	float r = uLength * 0.75 * uChute;
	vec3 c = p - vec3(uLength + back, 0.0, 0.0);
	float dome = abs(length(c) - r) - 0.03 * uLength * 0.5;
	dome = max(dome, -c.x);
	vec2 s = abs(p.yz);
	float t = sat((p.x - uLength) / max(back, 1e-3));
	float line = length(vec2(max(s.x, s.y) - r * t * 0.72, min(s.x, s.y))) - 0.006 * uLength;
	line = max(line, max(uLength - p.x, p.x - (uLength + back)));
	return min(dome, line);
}

vec2 scene(vec3 p) {
	float body = bodyDist(p);
	float fins = finsDist(p);
	float chute = chuteDist(p);
	if (chute < body && chute < fins) return vec2(chute, 2.0);
	return fins < body ? vec2(fins, 1.0) : vec2(body, 0.0);
}

vec3 normalAt(vec3 p, float e) {
	vec2 k = vec2(1.0, -1.0);
	return normalize(k.xyy * scene(p + k.xyy * e).x + k.yyx * scene(p + k.yyx * e).x + k.yxy * scene(p + k.yxy * e).x + k.xxx * scene(p + k.xxx * e).x);
}

vec3 envAt(vec3 d) {
	if (uFlight > 0.5) {
		float alt = uAir.x;
		vec3 top = mix(vec3(0.16, 0.34, 0.68), vec3(0.03, 0.06, 0.16), sat(alt / 40.0));
		vec3 low = mix(vec3(0.72, 0.8, 0.88), vec3(0.42, 0.56, 0.76), sat(alt / 30.0));
		float up = sat(d.y * 0.5 + 0.5);
		vec3 sky = mix(low, top, pow(up, 0.65));
		vec3 ground = mix(vec3(0.22, 0.26, 0.2), vec3(0.46, 0.55, 0.64), sat(alt / 18.0));
		sky = mix(ground, sky, sm(-0.03, 0.02, d.y));
		sky += vec3(1.0, 0.92, 0.8) * pow(sat(dot(d, SUN)), 200.0) * 9.0;
		return sky;
	}
	// A dark gallery with long soft lights overhead and a warm rim from one side.
	float strip = sm(0.82, 0.96, abs(sin(d.x * 4.2))) * sm(0.2, 0.75, d.y);
	// Bare metal shows only what it reflects, so the room needs enough in it to read as silver.
	vec3 c = vec3(0.1, 0.105, 0.115) + vec3(0.62, 0.63, 0.66) * pow(sat(d.y * 0.5 + 0.5), 1.6);
	c += vec3(1.5, 1.45, 1.35) * strip;
	c += vec3(0.8, 0.55, 0.3) * pow(sat(dot(d, normalize(vec3(0.9, 0.1, -0.5)))), 6.0) * 0.18;
	return c;
}

vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

float softShadow(vec3 p, vec3 l, float scale) {
	float res = 1.0;
	float t = scale * 0.01;
	for (int i = 0; i < 18; i++) {
		float h = scene(p + l * t).x;
		res = min(res, 10.0 * h / t);
		t += clamp(h, scale * 0.01, scale * 0.25);
		if (res < 0.01 || t > scale * 3.0) break;
	}
	return sat(res);
}

vec3 shade(vec3 p, vec3 rd, float id, float scale) {
	vec3 n = normalAt(p, scale * 0.0015);
	float axial = sat(p.x / uLength);
	vec3 base;
	float rough;
	float metal;
	if (id > 1.5) {
		// Canopy ribbons, alternating.
		base = fract(atan(p.y, p.z) * 2.546) < 0.5 ? vec3(0.82, 0.8, 0.72) : vec3(0.75, 0.3, 0.1);
		rough = 0.85;
		metal = 0.0;
	} else {
		float b = axial < uBandEnd.x ? 0.0 : axial < uBandEnd.y ? 1.0 : axial < uBandEnd.z ? 2.0 : 3.0;
		int i = int(b);
		base = uBandCol[i];
		rough = uBandRough[i];
		metal = uBandMetal[i];
		// Paint wear: scuffs on the high spots, darker streaks running back along the body.
		vec3 tc = vec3(p.x, p.y, p.z) / scale;
		float grime = texture(uNoise, tc * 1.3).r;
		float fine = texture(uNoise, tc * 9.0).g;
		float streak = texture(uNoise, vec3(p.x / scale * 0.6, p.yz / scale * 5.0)).r;
		base *= 0.78 + 0.32 * grime;
		base *= 0.9 + 0.14 * streak;
		rough = sat(rough + (fine - 0.5) * 0.3 + (grime - 0.5) * 0.25);
		float chip = sm(0.74, 0.86, texture(uNoise, tc * 3.1 + 0.3).r) * sm(0.45, 0.8, fine);
		base = mix(base, vec3(0.42, 0.41, 0.4), chip * 0.5);
		metal = mix(metal, 1.0, chip * 0.5);
		rough = mix(rough, 0.45, chip * 0.5);
		// Black sealing tar slapped over the seams by hand: irregular blotches, thickest at the joints.
		if (uTar > 0.5) {
			float near = 1e9;
			for (int k = 0; k < 3; k++) near = min(near, abs(axial - uBandEnd[k]));
			float blot = texture(uNoise, tc * 2.4 + 0.7).r + (0.09 - near) * 3.2;
			float tar = sm(0.72, 0.8, blot);
			base = mix(base, vec3(0.012), tar);
			rough = mix(rough, 0.28, tar);
		}
		// Seams and rivets where one section of the casing meets the next.
		float seam = 1e9;
		for (int k = 0; k < 3; k++) seam = min(seam, abs(axial - uBandEnd[k]));
		seam *= uLength;
		float seamLine = sm(0.012 * scale, 0.004 * scale, seam);
		float ang = atan(p.y, p.z);
		float rivets = sm(0.55, 0.9, sin(ang * 42.0)) * sm(0.04 * scale, 0.03 * scale, seam) * sm(0.012 * scale, 0.02 * scale, seam);
		base *= 1.0 - 0.72 * seamLine;
		base *= 1.0 - 0.28 * rivets;
		n = normalize(n + (vec3(fine) - 0.5) * 0.015);
	}
	vec3 v = -rd;
	vec3 r = reflect(rd, n);
	float ndv = sat(dot(n, v));
	vec3 f0 = mix(vec3(0.04), base, metal);
	vec3 fres = f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0) * (1.0 - rough * 0.7);
	vec3 col;
	vec3 env = envAt(normalize(mix(r, n, rough * rough)));
	float ao = sat(scene(p + n * scale * 0.04).x / (scale * 0.04));
	vec3 l = uFlight > 0.5 ? SUN : normalize(vec3(-0.4, 0.8, 0.45));
	float ndl = sat(dot(n, l));
	float sh = softShadow(p + n * scale * 0.004, l, scale);
	vec3 h = normalize(l + v);
	float spec = pow(sat(dot(n, h)), mix(380.0, 12.0, rough)) * (1.0 - rough * 0.6);
	vec3 lightCol = uFlight > 0.5 ? vec3(3.0, 2.8, 2.5) : vec3(2.3, 2.2, 2.05);
	vec3 amb = uFlight > 0.5 ? envAt(n) * 0.7 : vec3(0.1, 0.105, 0.12);
	col = base * (1.0 - metal) * (lightCol * ndl * sh + amb * (0.4 + 0.6 * ao));
	col += env * fres * (0.35 + 0.65 * ao);
	col += lightCol * spec * sh * mix(vec3(1.0), base, metal);
	return col;
}

void main() {
	vec2 uv = (vUv * 2.0 - 1.0) * vec2(uRes.x / uRes.y, 1.0);
	float cy = cos(uCam.x);
	float sy = sin(uCam.x);
	float cp = cos(uCam.y);
	float sp = sin(uCam.y);
	vec3 ro = uTarget + vec3(sy * cp, sp, cy * cp) * uCam.z;
	vec3 f = normalize(uTarget - ro);
	vec3 r = normalize(cross(vec3(0.0, 1.0, 0.0), f));
	vec3 u = cross(f, r);
	vec3 rd = normalize(f * 2.4 + r * uv.x + u * uv.y);

	vec3 col;
	float scale = uLength;
	vec3 skyDir = rd;
	// Tilt the weapon rather than the camera, so the horizon stays level.
	if (uRoll != 0.0) {
		float c = cos(uRoll);
		float s = sin(uRoll);
		mat2 m = mat2(c, s, -s, c);
		ro -= uTarget;
		ro.xy = m * ro.xy;
		ro += uTarget;
		rd.xy = m * rd.xy;
	}

	// Background.
	if (uFlight > 0.5) {
		col = envAt(skyDir);
		// Cloud rushing past gives a sense of the fall.
		float alt = uAir.x;
		vec3 q = vec3(uv.x * 0.2, uv.y * 0.06 + uAir.z * uAir.y * 0.0006, alt * 0.02);
		float n = texture(uNoise, q).r * 0.7 + texture(uNoise, q * 3.0).r * 0.3;
		col = mix(col, vec3(0.94), sm(0.56, 0.82, n) * sm(16.0, 2.0, alt) * 0.5);
	} else {
		col = vec3(0.012, 0.013, 0.016) + vec3(0.02, 0.021, 0.024) * sat(1.0 - length(uv) * 0.55);
	}

	// Sphere trace.
	float t = max(0.01, uCam.z - scale * 4.0);
	float tMax = uCam.z + scale * 7.0;
	float hitId = -1.0;
	for (int i = 0; i < 90; i++) {
		vec2 h = scene(ro + rd * t);
		if (h.x < scale * 0.0006) {
			hitId = h.y;
			break;
		}
		t += h.x * 0.9;
		if (t > tMax) break;
	}

	// Studio floor, for the reflection and contact shadow under the plinth lights.
	if (uFlight < 0.5) {
		float floorY = -uProf[0].y - scale * 0.32;
		float maxR = 0.0;
		for (int i = 0; i < uCount; i++) maxR = max(maxR, uProf[i].y);
		floorY = -maxR - max(uFins.x > 0.5 ? uFins.z - maxR : 0.0, 0.0) - scale * 0.02;
		float fy = (floorY - ro.y) / rd.y;
		if (rd.y < 0.0 && fy > 0.0 && (hitId < 0.0 || fy < t)) {
			vec3 fp = ro + rd * fy;
			vec3 fr = reflect(rd, vec3(0.0, 1.0, 0.0));
			vec3 refl = envAt(fr) * 0.25;
			float rt = 0.0;
			float occ = 1.0;
			float hitR = -1.0;
			for (int i = 0; i < 40; i++) {
				vec2 h = scene(fp + fr * (rt + scale * 0.01));
				if (h.x < scale * 0.002) { hitR = h.y; break; }
				rt += h.x;
				if (rt > scale * 3.0) break;
			}
			if (hitR >= 0.0) refl = shade(fp + fr * (rt + scale * 0.01), fr, hitR, scale) * 0.5;
			float dist = length(fp.xz - uTarget.xz) / (scale * 1.5);
			float tex = texture(uNoise, vec3(fp.xz / scale * 0.9, 0.5)).r;
			float sh = softShadow(fp + vec3(0.0, scale * 0.004, 0.0), normalize(vec3(-0.3, 1.0, 0.3)), scale);
			vec3 floorCol = mix(vec3(0.035), vec3(0.05), tex) * (0.3 + 0.7 * sh);
			float fres = 0.04 + 0.96 * pow(1.0 - sat(-rd.y), 5.0);
			col = mix(floorCol + refl * (0.18 + fres * 0.5), col, sm(0.6, 1.5, dist));
			hitId = -1.0;
			t = 1e9;
		}
	}

	if (hitId >= 0.0) col = shade(ro + rd * t, rd, hitId, scale);

	// Reentry: the air ahead of the nose is compressed into glowing plasma, trailing back past the tail.
	if (uPlasma > 0.0) {
		float glow = 0.0;
		float step0 = (scale * 5.0) / 22.0;
		for (int i = 0; i < 22; i++) {
			vec3 p = ro + rd * (uCam.z - scale * 2.5 + float(i) * step0);
			float d = bodyDist(p);
			float back = sat((p.x + scale * 0.1) / (scale * 3.2));
			float wid = scale * (0.06 + 0.5 * back);
			float n = texture(uNoise, vec3(p.x / scale * 0.5 - uAir.z * 1.2, p.yz / scale * 1.5)).r;
			glow += exp(-max(d, 0.0) / wid) * (1.0 - back * 0.85) * (0.6 + 0.8 * n);
		}
		glow *= step0 / scale * uPlasma;
		col += vec3(4.0, 1.5, 0.45) * glow * 0.3 + vec3(3.0, 2.8, 2.6) * glow * glow * 0.05;
	}

	col = aces(col * (uFlight > 0.5 ? 0.85 : 1.1));
	vec2 dv = vUv - 0.5;
	col *= 1.0 - dot(dv, dv) * 0.7;
	if (uGrade > 0.5) {
		float l = pow(dot(col, vec3(0.3, 0.59, 0.11)), 0.9);
		col = mix(vec3(0.13, 0.08, 0.05), vec3(0.97, 0.92, 0.8), l);
	}
	col = pow(max(col, 0.0), vec3(1.0 / 2.2));
	col = mix(col, vec3(1.0), uWhite);
	outColor = vec4(col, 1.0);
}`;
