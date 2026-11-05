// The burst scene: an orthographic side view through a volume, in kilometres, at true scale. Geometry comes in
// as uniforms from the effects model. The look (noise, colour, how billows roll) is artistic, not computed.

export const SCENE_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;

uniform sampler3D uNoise;
uniform vec2 uRes;
uniform vec3 uView;        // km per pixel at this resolution, centre x px, ground y px from the bottom
uniform float uT;          // seconds from detonation, negative before
uniform float uChurn;      // slow animation clock for the billows
uniform float uHob;
uniform vec4 uFire;        // radius km, altitude km, temperature 0-1, opacity
uniform float uPulse;      // thermal pulse 0-1
uniform vec4 uCap;         // altitude, radius, half thickness, drift km
uniform vec4 uCapLook;     // opacity, heat 0-1, rise 0-1, pileus 0-1
uniform vec4 uStem;        // base radius, neck radius, opacity, top km
uniform vec4 uShock;       // slant radius km, ground range km, strength 0-1, wilson opacity
uniform vec4 uDust;        // front km, height km, opacity, outer limit km
uniform vec4 uRings;       // 5 psi km, burn km, fires 0-1, flash 0-1
uniform vec4 uFall;        // amount 0-1, fall reach km, drift rate km per km, unused
uniform vec3 uWeather;     // overcast, rain, snow
uniform vec4 uTrailHead;   // x, alt, width km, kind (0 none, 1 vapour, 2 plasma, 3 wake)
uniform vec2 uTrailTail;   // x, alt
uniform float uEncode;
uniform float uQuality;
uniform float uFrame;

const float E_KM = 6371.0;
const vec3 SUN = normalize(vec3(-0.62, 0.66, -0.42));
const vec3 SUN_RGB = vec3(1.0, 0.93, 0.82) * 3.2;

float sat(float x) { return clamp(x, 0.0, 1.0); }
float sm(float a, float b, float x) { return smoothstep(a, b, x); }
float smin(float a, float b, float k) { float h = sat(0.5 + 0.5 * (b - a) / k); return mix(b, a, h) - k * h * (1.0 - h); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec2 n3(vec3 p) { return texture(uNoise, p).rg; }

// Terrain drops away from ground zero as the Earth curves.
float dropAt(float x) { return x * x / (2.0 * E_KM); }

vec3 blackbody(float k) {
	// k from 0 (dull ember) to 1 (blue-white), a hand ramp through the blackbody colours.
	vec3 ember = vec3(0.55, 0.06, 0.01);
	vec3 orange = vec3(1.6, 0.52, 0.08);
	vec3 yellow = vec3(3.2, 2.0, 0.7);
	vec3 white = vec3(7.0, 6.4, 5.8);
	vec3 hot = vec3(12.0, 13.0, 16.0);
	vec3 c = mix(ember, orange, sm(0.0, 0.25, k));
	c = mix(c, yellow, sm(0.25, 0.55, k));
	c = mix(c, white, sm(0.55, 0.8, k));
	return mix(c, hot, sm(0.8, 1.0, k));
}

vec3 skyAt(float x, float alt) {
	float over = uWeather.x;
	vec3 zenith = mix(vec3(0.10, 0.25, 0.58), vec3(0.34, 0.37, 0.41), over);
	vec3 horizon = mix(vec3(0.70, 0.80, 0.90), vec3(0.58, 0.60, 0.62), over);
	float h = sat(1.0 - exp(-max(alt, 0.0) / 7.5));
	vec3 c = mix(horizon, zenith, pow(h, 0.7));
	// Thins to black: the view can reach the mesosphere on big yields.
	c *= exp(-max(alt - 14.0, 0.0) / 16.0);
	// A little warm haze low down, measured in pixels so it survives any scale.
	float px = alt / uView.x;
	c = mix(c, horizon * vec3(1.06, 1.0, 0.93), exp(-max(px, 0.0) / 34.0) * 0.5);
	// High thin cirrus, stretched along the wind.
	float cirrus = n3(vec3(x * 0.012 + uChurn * 0.002, alt * 0.09, 0.3)).r;
	float band = exp(-pow((alt - 9.5) / 2.2, 2.0));
	c = mix(c, vec3(1.0), sm(0.52, 0.8, cirrus) * band * (0.3 + 0.4 * over));
	return c * 1.05;
}

// ---- volumes ---------------------------------------------------------------------------------

// A rounded disc with a dome on top, measured in thicknesses of the cap in every direction. Scaling width and height
// separately would stretch every lump sideways into strata.
float capShape(vec3 q) {
	float r = length(q.xz);
	float disc = (length(vec2(max(r - max(uCap.y - uCap.z, 0.0), 0.0), q.y)) - uCap.z) / uCap.z;
	float dome = (length(vec2(r * 0.72, q.y - uCap.z * 0.35)) - uCap.z * 1.0) / uCap.z;
	return smin(disc, dome, 0.45);
}

// Noise coordinates turned around the ring, so the billows roll over the top and under, as they do in the films.
vec3 rollCoord(vec3 q) {
	float r = max(length(q.xz), 1e-4);
	vec2 dir = q.xz / r;
	vec2 a = vec2(r / uCap.y - 0.56, q.y / uCap.y);
	// No roll on the axis itself, or the noise tears there and leaves a spike on top of the cloud.
	float w = uChurn * 0.05 * sm(0.0, 0.4, r / uCap.y);
	float c = cos(w);
	float s = sin(w);
	a = vec2(c * a.x - s * a.y, s * a.x + c * a.y);
	return vec3(dir.x * (a.x + 0.56), a.y, dir.y * (a.x + 0.56));
}

float capDensity(vec3 p, bool detail, out float heat) {
	heat = 0.0;
	if (uCapLook.x <= 0.0) return 0.0;
	vec3 q = p - vec3(uCap.w, uCap.x, 0.0);
	float sd = capShape(q);
	if (sd > 1.0) return 0.0;
	// Lobes are sized by the cap's thickness, not its radius, so a wide cap gets many of them.
	vec3 c = rollCoord(q) * uCap.y / uCap.z;
	// Large lobes first, then cauliflower on the lobes. Billows push outward, so the outline is lumpy, not fuzzy.
	// The floors stop gaps between lobes cutting deep pits, which reads as rock rather than cloud.
	float big = max(n3(c * 0.2 + 0.1).r, 0.34);
	float mid = max(n3(c * 0.52 + 0.37).r, 0.3);
	sd += (0.5 - big) * 1.0 + (0.5 - mid) * 0.55;
	if (detail) {
		float f = max(n3(c * 1.4 + vec3(0.0, -uChurn * 0.002, 0.0)).r, 0.3);
		sd += (0.5 - f) * 0.2;
	}
	float d = sm(0.03, -0.1, sd);
	// Hot in the core early on, with the embers showing through gaps on the underside.
	heat = uCapLook.y * sm(0.25, -0.5, sd) * sm(1.0, -0.6, q.y / uCap.z);
	return d * 5.2 * uCapLook.x;
}

float pileus(vec3 p) {
	if (uCapLook.w <= 0.0) return 0.0;
	vec3 q = p - vec3(uCap.w, uCap.x + uCap.z * 1.02, 0.0);
	float r = length(vec3(q.x, q.y * 1.6, q.z));
	float shell = abs(r - uCap.y * 0.88) / (uCap.y * 0.05);
	float n = n3(q / uCap.y * 1.3).r * 0.7 + n3(q / uCap.y * 3.7).g * 0.4;
	return sm(1.0, 0.0, shell) * sm(0.15, 0.55, q.y / uCap.y + 0.25) * sm(0.5, 0.8, n) * uCapLook.w * 0.3;
}

float stemCentre(float y) { float t = sat(y / max(uStem.w, 1e-3)); return uCap.w * pow(t, 1.5); }

float stemDensity(vec3 p, bool detail) {
	if (uStem.z <= 0.0 || p.y > uStem.w * 1.04 || p.y < 0.0) return 0.0;
	float y = p.y / max(uStem.w, 1e-3);
	vec2 q = vec2(p.x - stemCentre(p.y), p.z);
	float rad = mix(uStem.x, uStem.y, sm(0.0, 0.28, y)) * (1.0 + 0.5 * sm(0.72, 1.0, y));
	float v = uChurn * 0.03;
	vec3 c = vec3(q.x / uCap.y, p.y / uCap.y * 0.4 - v, q.y / uCap.y);
	float big = n3(c * 1.5).r;
	float sd = length(q) / rad - 1.0 + (0.5 - big) * 0.9;
	if (detail) sd += (0.5 - n3(c * 4.5).r) * 0.4;
	return sm(0.05, -0.15, sd) * 22.0 * uStem.z;
}

// The ring that wraps the stem where rising moist air condenses.
float collar(vec3 p) {
	if (uCapLook.w <= 0.0 || uStem.z <= 0.0) return 0.0;
	float h = uStem.w * 0.62;
	vec2 q = vec2(length(vec2(p.x - stemCentre(h), p.z)) - uCap.y * 0.42, (p.y - h) * 2.2);
	float sd = length(q) / (uCap.y * 0.12) - 1.0;
	if (sd > 0.5) return 0.0;
	sd += (0.5 - n3(p / uCap.y * 1.8).r) * 1.6;
	return sm(0.1, -0.5, sd) * uCapLook.w * 0.22;
}

// Dust thrown up behind the shock, low and rolling.
float dustDensity(vec3 p, bool detail) {
	if (uDust.z <= 0.0) return 0.0;
	float r = length(p.xz);
	if (r > uDust.x * 1.05) return 0.0;
	float g = p.y + dropAt(r);
	float edge = uDust.x;
	float h = uDust.y * (0.55 + 0.45 * sm(edge, edge * 0.82, r));
	h *= sm(uDust.w, uDust.w * 0.45, r);
	if (g > h * 1.5 || g < -0.01) return 0.0;
	vec3 c = vec3(p.x, g * 3.0, p.z) / max(uDust.y * 2.4, 1e-3);
	float n = n3(c * 1.1 + vec3(uChurn * 0.006, 0.0, 0.0)).r;
	float sd = g / max(h, 1e-4) - 0.55 + (0.5 - n) * 1.5;
	if (detail) sd += (0.5 - n3(c * 3.4).r) * 0.5;
	return sm(0.05, -0.2, sd) * uDust.z * 5.0;
}

// Veils of debris trailing down from a drifting cap.
float falloutDensity(vec3 p) {
	if (uFall.x <= 0.0 || p.y > uCap.x || p.y < 0.0) return 0.0;
	float below = uCap.x - p.y;
	float cx = uCap.w - below * uFall.z;
	float across = length(vec2((p.x - cx) * 0.8, p.z)) / (uCap.y * (0.95 + below * 0.02));
	if (across > 1.1) return 0.0;
	if (below > uFall.y) return 0.0;
	vec3 c = vec3(p.x / uCap.y * 2.2, (p.y + uChurn * 0.02) * 0.04, p.z / uCap.y * 2.2);
	float streak = sm(0.4, 0.8, n3(c).r);
	return streak * sm(1.0, 0.45, across) * sm(uFall.y, uFall.y * 0.55, below) * uFall.x * 1.3;
}

// Thin condensation shell behind the shock in moist air, gone within seconds.
float wilson(vec3 p) {
	if (uShock.w <= 0.0 || uShock.x <= 0.0) return 0.0;
	vec3 q = p - vec3(0.0, uHob, 0.0);
	float r = length(q);
	float shell = abs(r - uShock.x * 0.86) / (uShock.x * 0.09);
	if (shell > 1.2) return 0.0;
	float n = n3(q / uShock.x * 1.1 + 0.4).r;
	return sm(1.0, 0.1, shell) * sm(0.1, 0.7, n) * uShock.w * 0.4 * sm(0.0, 0.05, p.y / uShock.x);
}

// The full-detail solid volumes, for finding the surface a ray enters and which way it faces.
float solidAt(vec3 p) {
	float h;
	return capDensity(p, true, h) + stemDensity(p, true) + dustDensity(p, true);
}

// Everything that scatters light, cheap version for shadow rays.
float lightDensity(vec3 p) {
	float h;
	float d = capDensity(p, false, h) + stemDensity(p, false);
	return d + dustDensity(p, false);
}

vec3 groundBounce(float k) { return mix(vec3(0.34, 0.31, 0.27), vec3(0.42, 0.56, 0.86), k); }

vec4 march(float x, float alt, float jitter) {
	// Which parts of the scene can this pixel's line of sight touch at all?
	// Bounds are tight so strides stay short: a thin stem shouldn't be marched as if it were as wide as the cap.
	float zMax = 0.0;
	vec2 capC = vec2(uCap.w, uCap.x);
	if (uCapLook.x > 0.0 && abs(alt - capC.y) < uCap.z * 2.4) {
		float reach = uCap.y * 1.45;
		float dx = x - capC.x;
		if (abs(dx) < reach) zMax = max(zMax, sqrt(reach * reach - dx * dx));
	}
	if (uStem.z > 0.0 && alt < uStem.w * 1.05) {
		float reach = uStem.x * 2.6;
		float dx = x - stemCentre(alt);
		if (abs(dx) < reach) zMax = max(zMax, sqrt(reach * reach - dx * dx));
	}
	if (uDust.z > 0.0 && alt < uDust.y * 1.6 + dropAt(x) * 0.0 && abs(x) < uDust.x * 1.05) {
		zMax = max(zMax, sqrt(max(uDust.x * uDust.x * 1.1 - x * x, 0.0)) + 0.01);
	}
	if (uFire.w > 0.0) {
		float reach = uFire.x * 1.25;
		vec2 c = vec2(x, alt - uFire.y);
		if (dot(c, c) < reach * reach) zMax = max(zMax, sqrt(reach * reach - dot(c, c)));
	}
	if (uFall.x > 0.0 && alt < uCap.x && abs(x - uCap.w) < uCap.y * 1.5 + uFall.y * uFall.z * 1.3) zMax = max(zMax, uCap.y * 1.3);
	if (uShock.w > 0.0) {
		vec2 c = vec2(x, alt - uHob);
		float d2 = dot(c, c);
		if (d2 < uShock.x * uShock.x) zMax = max(zMax, sqrt(uShock.x * uShock.x - d2));
	}
	if (zMax <= 0.0) return vec4(0.0);

	// Long strides through empty air, short ones once inside, so surfaces are crisp instead of dithered.
	const int STEPS = 58;
	float coarse = 2.0 * zMax / 26.0;
	float dz = coarse;
	bool inside = false;
	bool hasNormal = false;
	vec3 normal = vec3(0.0, 0.0, -1.0);
	vec3 col = vec3(0.0);
	float trans = 1.0;
	float scale = uCap.y > 0.0 ? uCap.y : 1.0;
	float extinction = 2.6 / max(max(scale, uFire.x), 1e-4);
	float z = -zMax + jitter * coarse;
	for (int i = 0; i < STEPS && z < zMax; i++) {
		vec3 p = vec3(x, alt, z);
		float heat;
		float cap = capDensity(p, true, heat);
		float st = stemDensity(p, true);
		float du = dustDensity(p, true);
		float pil = pileus(p) + collar(p);
		float wil = wilson(p);
		float fal = falloutDensity(p);
		float solid = cap + st + du;
		float total = solid + pil + wil + fal;

		// The fireball is a glowing body inside all this.
		vec3 emit = vec3(0.0);
		float fireD = 0.0;
		if (uFire.w > 0.0) {
			vec3 q = p - vec3(0.0, uFire.y, 0.0);
			float r = length(q) / uFire.x;
			if (r < 1.25) {
				vec3 nc = q / uFire.x * 0.42 + vec3(0.0, -uChurn * 0.012, 0.0);
				float n = n3(nc).r;
				float n2 = n3(nc * 2.6).r;
				float boil = (0.5 - n) * 0.26 + (0.5 - n2) * 0.14;
				// The first instant is a clean sphere: boiling and mottling grow as it cools.
				float rough = sat(1.2 - uFire.z);
				float sd = r - 1.0 + boil * rough;
				fireD = sm(0.03, -0.04, sd) * uFire.w * 7.0;
				float k = uFire.z * (0.92 + 0.12 * sm(0.0, -0.9, sd)) + (n + n2 - 1.0) * 0.28 * rough;
				emit += blackbody(sat(k)) * fireD * 1.7;
			}
		}
		if (heat > 0.0) {
			float n = n3(p / scale * 1.6).g;
			emit += blackbody(heat * 0.34 + n * 0.14) * cap * heat * heat * 1.6;
		}
		float absorb = total + fireD;
		if (!inside && absorb > 0.02) {
			inside = true;
			dz = coarse * 0.26;
			// Pin down where the ray entered. Without this the surface is only known to one stride, which shows as stipple.
			if (solid > 0.02) {
				float lo = z - coarse;
				float hi = z;
				for (int b = 0; b < 5; b++) {
					float m = 0.5 * (lo + hi);
					if (solidAt(vec3(x, alt, m)) > 0.5) hi = m;
					else lo = m;
				}
				z = hi;
				vec3 sp = vec3(x, alt, z);
				float e = max(scale * 0.05, uView.x * 2.0);
				vec3 g = vec3(
					solidAt(sp + vec3(e, 0.0, 0.0)) - solidAt(sp - vec3(e, 0.0, 0.0)),
					solidAt(sp + vec3(0.0, e, 0.0)) - solidAt(sp - vec3(0.0, e, 0.0)),
					solidAt(sp + vec3(0.0, 0.0, e)) - solidAt(sp - vec3(0.0, 0.0, e))
				);
				float gl = length(g);
				normal = gl > 1e-4 ? -g / gl : vec3(0.0, 0.0, -1.0);
				hasNormal = true;
				continue;
			}
		}
		if (absorb > 0.001 || dot(emit, emit) > 0.0) {
			// Sunlight, shadowed through the volume.
			float shade = 0.0;
			if (solid > 0.01) {
				float step0 = scale * 0.14;
				vec3 lp = p + SUN * step0 * jitter;
				for (int j = 0; j < 4; j++) {
					lp += SUN * step0;
					shade += lightDensity(lp) * step0;
					step0 *= 1.5;
				}
			}
			float sunT = exp(-shade * extinction * 0.42);
			float powder = 1.0 - exp(-max(solid, 0.1) * 0.9);
			// Soot-black and red-brown while hot, paling to grey and white as water condenses on the debris.
			vec3 sootTint = mix(vec3(0.66, 0.59, 0.53), vec3(0.20, 0.13, 0.09), sat(uCapLook.y * 1.3));
			vec3 dustTint = vec3(0.62, 0.48, 0.34);
			float wc = solid + 1e-4;
			vec3 albedo = (cap * sootTint + st * dustTint * 0.82 + du * dustTint) / wc;
			float up = sat(0.5 + 0.5 * p.y / max(alt + scale, 1e-3));
			vec3 ambient = groundBounce(sat(up)) * (0.2 + 0.16 * up) * (0.35 + 0.65 * sunT);
			// Facing the sun or away from it is what gives each billow its bright crown and dark crease.
			float facing = hasNormal ? sat(dot(normal, SUN) * 0.5 + 0.55) : 0.55;
			vec3 lit = albedo * (SUN_RGB * sunT * (0.3 + 0.7 * powder) * 0.72 * facing * facing + ambient * (0.45 + 0.55 * sat(normal.y * 0.5 + 0.5)));
			// A fireball lights the cloud around it as strongly as the sun does.
			if (uFire.w > 0.0) {
				vec3 toFire = vec3(0.0, uFire.y, 0.0) - p;
				float fd = max(dot(toFire, toFire), uFire.x * uFire.x * 0.25);
				lit += albedo * blackbody(uFire.z) * (uFire.x * uFire.x / fd) * 0.6 * uFire.w;
			}
			// Fires on the ground light the underside of the smoke.
			lit += albedo * vec3(1.2, 0.4, 0.1) * uRings.z * exp(-p.y / max(scale * 0.4, 1e-3)) * 0.7;
			// The thin white layers are bright water, not dirty cloud.
			vec3 water = (SUN_RGB * 0.42 + vec3(0.35, 0.42, 0.55)) * ((pil + wil) * 0.95);
			vec3 veil = vec3(0.34, 0.29, 0.24) * fal;
			vec3 scatter = (lit * solid + water + veil) / max(total, 1e-4);

			float a = 1.0 - exp(-absorb * dz * extinction * 1.6);
			col += trans * a * (total > 0.001 ? scatter : vec3(0.0));
			col += trans * emit / max(fireD + cap + 1e-3, 1e-3) * a;
			trans *= 1.0 - a;
			if (trans < 0.01) break;
		}
		z += dz;
	}
	return vec4(col, 1.0 - trans);
}

float flakes(vec2 p, vec2 size, float speed) {
	vec2 q = p / size;
	q.y += uChurn * speed;
	q.x += sin(q.y * 0.7) * 0.2;
	vec2 id = floor(q);
	float h = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
	vec2 f = fract(q) - 0.5 + (vec2(h, fract(h * 7.3)) - 0.5) * 0.7;
	return sm(0.2, 0.05, length(f)) * step(0.9, h);
}

// ---- things on the ground and in the air ------------------------------------------------------

vec3 groundColour(float x, float depthPx, float groundLit) {
	vec3 top = mix(vec3(0.20, 0.19, 0.14), vec3(0.16, 0.13, 0.10), sm(0.0, 1.0, abs(x) / max(uRings.x, 1e-3)));
	vec3 col = mix(top, vec3(0.05, 0.045, 0.04), sm(0.0, 30.0, depthPx));
	float strata = n3(vec3(x * 0.04, depthPx * 0.012, 0.2)).r;
	col *= 0.82 + 0.3 * strata;
	return col * (0.5 + groundLit);
}

float skyline(float x) {
	// City blocks at their true height, levelled where the shock has been hard enough.
	float block = floor(x / 0.09);
	float a = fract(sin(block * 12.9898) * 43758.5453);
	float b = fract(sin(block * 39.346) * 11043.17);
	float h = 0.012 + 0.03 * a + 0.16 * pow(b, 8.0);
	float gone = sm(uRings.x * 1.05, uRings.x * 0.6, abs(x)) * sm(abs(x), abs(x) + uRings.x * 0.08, uShock.y);
	return h * (1.0 - gone * 0.96);
}

void main() {
	vec2 px = vUv * uRes;
	float kmPerPx = uView.x;
	float x = (px.x - uView.y) * kmPerPx;
	float alt = (px.y - uView.z) * kmPerPx;
	float ground = -dropAt(x);
	float jitter = fract(ign(px) + uFrame * 0.61803399);

	// The shock bends the light passing through it, which is how it shows against a clear sky.
	float sx = x;
	float sa = alt;
	if (uShock.x > 0.0 && uShock.z > 0.0) {
		vec2 c = vec2(x, alt - uHob);
		float r = length(c);
		float w = max(kmPerPx * 2.4, uShock.x * 0.012);
		float bend = exp(-pow((r - uShock.x) / w, 2.0));
		vec2 n = c / max(r, 1e-4);
		sx += n.x * bend * w * 2.2 * uShock.z;
		sa += n.y * bend * w * 2.2 * uShock.z;
	}
	vec3 col = skyAt(sx, sa);

	// Overcast deck, torn open around the burst.
	if (uWeather.x > 0.0) {
		float deck = exp(-pow((alt - 2.6) / 1.2, 2.0));
		float n = n3(vec3(x * 0.03, alt * 0.14, uChurn * 0.0008)).r;
		float clear = uShock.y > 0.0 ? sm(uShock.y * 1.2, uShock.y * 0.8, abs(x)) : 0.0;
		col = mix(col, vec3(0.62, 0.64, 0.66), sm(0.32, 0.62, n) * deck * uWeather.x * (1.0 - clear * 0.85));
	}

	// Trails: vapour behind an aircraft, plasma behind a reentry vehicle.
	float kind = uTrailHead.w;
	if (kind > 0.5) {
		vec2 a = uTrailTail;
		vec2 b = uTrailHead.xy;
		vec2 ab = b - a;
		vec2 ap = vec2(x, alt) - a;
		float len2 = max(dot(ab, ab), 1e-6);
		float h = sat(dot(ap, ab) / len2);
		float d = length(ap - ab * h);
		float wid = max(uTrailHead.z, kmPerPx * 0.9);
		if (kind < 1.5) {
			float age = 1.0 - h;
			float spread = wid * (1.0 + age * 5.0);
			float n = n3(vec3(x * 0.3 / max(wid, 0.01) * 0.01, alt * 0.2, age * 0.8)).r;
			float a2 = exp(-pow(d / spread, 2.0)) * (0.8 - age * 0.45) * (0.5 + n);
			col = mix(col, vec3(1.0), sat(a2));
		} else if (kind < 2.5) {
			float glow = exp(-d / wid) * pow(h, 3.0);
			col += vec3(4.0, 1.7, 0.5) * glow * 1.6;
			col += vec3(8.0, 7.0, 6.0) * exp(-pow(length(vec2(x, alt) - b) / (wid * 1.6), 2.0));
			float smoke = exp(-pow(d / (wid * 2.4), 2.0)) * (1.0 - h) * 0.6;
			col = mix(col, vec3(0.8), smoke);
		}
	}

	// Sky goes white with the flash.
	col += vec3(2.2, 2.0, 1.8) * uRings.w;

	vec4 v = march(x, alt, jitter);

	// Direct glow of the fireball in the air around it, ahead of what bloom adds.
	if (uFire.w > 0.0) {
		float d = length(vec2(x, alt - uFire.y)) / max(uFire.x, 1e-4);
		col += blackbody(uFire.z) * exp(-max(d - 0.8, 0.0) * 1.3) * 0.28 * uFire.w;
	}

	col = col * (1.0 - v.a) + v.rgb;

	// Rain or snow in front of everything, on a jittered grid so it has no visible repeat.
	if (uWeather.y > 0.0 || uWeather.z > 0.0) {
		vec2 sp = px * 1.0 / uRes.y * 520.0;
		float rain = flakes(sp, vec2(5.0, 46.0), 0.55) + flakes(sp + 13.0, vec2(8.0, 70.0), 0.4);
		float snow = flakes(sp, vec2(9.0), 0.1) + flakes(sp + 41.0, vec2(15.0), 0.07);
		// Weather stays in the lower air. Up where the view reaches the stratosphere, flakes would read as stars.
		float low = sm(14.0, 6.0, alt);
		col = mix(col, vec3(0.78, 0.82, 0.88), sat(rain) * uWeather.y * 0.2 * low);
		col = mix(col, vec3(1.0), sat(snow) * uWeather.z * 0.4 * low);
	}

	// Ground, drawn last, with the buildings on top of it.
	float skylineH = skyline(x);
	if (alt < ground + skylineH) {
		float depthPx = (ground - alt) / kmPerPx;
		float lit = uRings.w * 1.6 + uPulse * 0.5 + 0.3;
		vec3 g;
		if (alt > ground) {
			float side = fract(x / 0.09);
			g = mix(vec3(0.11, 0.11, 0.12), vec3(0.2, 0.2, 0.21), side) * (0.7 + lit * 0.8);
		} else {
			g = groundColour(x, depthPx, lit);
		}
		// Fires across the burn ring.
		if (uRings.z > 0.0 && abs(x) < uRings.y && depthPx < 3.0) {
			float f = n3(vec3(x / max(uRings.y, 0.1) * 3.5, uChurn * 0.01, 0.4)).r;
			g += vec3(3.4, 1.1, 0.2) * sm(0.54, 0.72, f) * uRings.z * sm(3.0, 0.0, depthPx);
		}
		// Shadow of the cap sliding across the ground, away from the sun.
		float shadowX = uCap.w + uCap.x * (-SUN.x / SUN.y);
		float sh = uCapLook.x * sm(uCap.y * 1.2, uCap.y * 0.6, abs(x - shadowX));
		g *= 1.0 - 0.42 * sh;
		col = g;
	}

	outColor = vec4(col / uEncode, 1.0);
}`;

export const RESOLVE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uNew;
uniform sampler2D uOld;
uniform float uKeep;
void main() {
	outColor = vec4(mix(texture(uNew, vUv).rgb, texture(uOld, vUv).rgb, uKeep), 1.0);
}`;

export const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uThreshold;
void main() {
	vec3 c = vec3(0.0);
	float w[5] = float[](0.2270270, 0.1945946, 0.1216216, 0.0540540, 0.0162162);
	for (int i = 0; i < 5; i++) {
		vec2 o = uDir * float(i);
		c += texture(uTex, vUv + o).rgb * w[i];
		if (i > 0) c += texture(uTex, vUv - o).rgb * w[i];
	}
	if (uThreshold > 0.0) c = max(c - uThreshold, 0.0);
	outColor = vec4(c, 1.0);
}`;

export const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform float uEncode;
uniform float uGrade;      // 0 natural, 1 period photographic print
uniform float uSeed;
vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main() {
	vec3 c = texture(uScene, vUv).rgb * uEncode;
	vec3 bloom = texture(uBloom, vUv).rgb * uEncode;
	c += bloom * 0.9;
	c = aces(c * 0.72);
	vec2 d = vUv - 0.5;
	c *= 1.0 - dot(d, d) * 0.5;
	float g = fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
	if (uGrade > 0.5) {
		float l = dot(c, vec3(0.3, 0.59, 0.11));
		l = pow(l, 0.92);
		c = mix(vec3(0.15, 0.09, 0.05), vec3(0.98, 0.93, 0.8), l);
		c += g * 0.05;
	} else {
		c += g * 0.012;
	}
	outColor = vec4(pow(max(c, 0.0), vec3(1.0 / 2.2)), 1.0);
}`;
