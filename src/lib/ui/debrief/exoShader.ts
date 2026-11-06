// A high burst seen from space, side on. The burst height, the heated layer, the pulse footprint and where heat burns
// come from the model. The look of the debris and the aurora is illustration, after accounts of Starfish Prime.

export const EXO_FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;

uniform sampler3D uNoise;
uniform vec2 uRes;
uniform vec2 uView;      // km per pixel, ground point's height in pixels
uniform float uH;        // burst height km
uniform float uLayerKm;
uniform vec4 uFire;      // radius km, temperature 0-1, shell opacity, flash 0-1
uniform vec4 uLayer;     // reach km, brightness, heat on ground 0-1, heat reach km
uniform vec3 uPulse;     // front km along the ground, footprint km, front brightness
uniform vec2 uAurora;    // strength 0-1, spread km
uniform float uChurn;
uniform float uGrade;
uniform float uFade;     // resolution-independent frame seed

const float R = 6371.0;

float sm(float a, float b, float x) { return smoothstep(a, b, x); }
float n3(vec3 p) { return texture(uNoise, p).r; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

vec3 heatColour(float t) {
	return mix(mix(vec3(0.9, 0.16, 0.04), vec3(1.0, 0.62, 0.2), sm(0.0, 0.5, t)), vec3(1.0, 0.97, 0.9), sm(0.5, 1.0, t));
}

void main() {
	vec2 px = vUv * uRes;
	float kmPerPx = uView.x;
	vec2 p = vec2((px.x - uRes.x * 0.5) * kmPerPx, (px.y - uView.y) * kmPerPx);
	vec2 c = vec2(p.x, p.y + R);
	float d = length(c);
	float alt = d - R;
	float arc = atan(c.x, c.y) * R;
	float aa = kmPerPx * 1.5;

	// Stars, which only show above the air.
	vec3 col = vec3(0.004, 0.006, 0.014);
	vec2 cell = floor(px / 3.0);
	float star = hash(cell);
	if (star > 0.992) col += vec3(0.9, 0.92, 1.0) * (star - 0.992) * 90.0 * hash(cell + 7.0) * sm(0.0, 300.0, alt);

	// The night-side air along the limb.
	float limb = exp(-max(alt, 0.0) / 42.0);
	col += vec3(0.05, 0.13, 0.3) * limb * 0.55;

	// The heated layer: a lens of glowing air under the burst, where X-rays and fast neutrons stop.
	if (uLayer.y > 0.0) {
		float wid = max(16.0, kmPerPx * 2.4);
		float across = exp(-pow((alt - uLayerKm) / wid, 2.0));
		float reach = sm(uLayer.x, uLayer.x * 0.45, abs(arc));
		float tex = 0.72 + 0.56 * n3(vec3(arc * 0.0016, alt * 0.012, uChurn * 0.03));
		col += heatColour(0.2 + 0.6 * uLayer.y) * across * reach * tex * uLayer.y * 2.6;
	}

	// Aurora: the charged debris runs along the magnetic field, so curtains stand over the footprint, with a second
	// patch far off along the field line. Red high up, from oxygen, and green lower down.
	if (uAurora.x > 0.0 && alt > 60.0) {
		for (int i = 0; i < 3; i++) {
			float k = float(i);
			float at = (k - 1.0) * uAurora.y * 0.62 + uAurora.y * 0.12 * sin(k * 2.4);
			float lean = alt * 0.28;
			float dx = (arc - at - lean) / (uAurora.y * 0.2 + kmPerPx);
			float sheet = exp(-dx * dx);
			float rays = 0.45 + 0.9 * n3(vec3(arc * 0.0045 + k * 0.3, alt * 0.0006, uChurn * 0.018 + k));
			rays *= rays;
			float green = sm(95.0, 120.0, alt) * sm(260.0, 150.0, alt);
			float red = sm(150.0, 240.0, alt) * sm(760.0, 330.0, alt);
			col += (vec3(0.14, 1.0, 0.42) * green * 1.2 + vec3(0.95, 0.1, 0.16) * red) * sheet * rays * uAurora.x * 0.9;
		}
	}

	// Earth, in front of the air behind it.
	float earth = sm(aa, -aa, alt);
	if (earth > 0.0) {
		float depth = sqrt(max(0.0, 1.0 - pow(p.x / R, 2.0)));
		vec3 ground = vec3(0.012, 0.022, 0.05) + vec3(0.022, 0.03, 0.022) * n3(vec3(arc * 0.0009, alt * 0.004, 0.3));
		float city = n3(vec3(arc * 0.008, alt * 0.09, 0.71));
		float lights = sm(0.56, 0.74, city) * sm(-1400.0, -24.0, alt) * 0.9;
		// Where the pulse has passed, the grid goes out.
		float out_ = sm(uPulse.x, uPulse.x * 0.94, abs(arc)) * sm(uPulse.y * 1.02, uPulse.y * 0.96, abs(arc));
		ground += vec3(1.0, 0.72, 0.36) * lights * (1.0 - out_) * 1.1;
		// Heat from the layer, where it is strong enough to burn.
		ground += heatColour(0.35) * uLayer.z * sm(uLayer.w, uLayer.w * 0.5, abs(arc)) * sm(-90.0, 0.0, alt) * 1.2;
		col = mix(col, ground * (0.5 + 0.5 * depth), earth);
		// The pulse's own footprint, drawn as the rim it travels along.
		float rim = exp(-pow(alt / max(kmPerPx * 3.0, 4.0), 2.0));
		col += vec3(0.75, 0.86, 1.0) * rim * sm(uPulse.y * 1.01, uPulse.y * 0.98, abs(arc)) * sm(uPulse.x + kmPerPx * 20.0, uPulse.x - kmPerPx * 10.0, abs(arc)) * uPulse.z * 0.8;
	}

	// The air's thin bright line against space, lit by the flash.
	col += vec3(0.45, 0.65, 1.0) * exp(-pow((alt - 18.0) / 22.0, 2.0)) * uFire.w * 0.7;

	// The debris cloud and its light.
	vec2 q = p - vec2(0.0, uH);
	float r = length(q);
	float rf = max(uFire.x, kmPerPx * 1.5);
	float glow = rf * rf / (r * r + rf * rf * 0.35);
	col += heatColour(uFire.y) * glow * (0.14 + uFire.w * 2.2) * sm(0.0, 0.02, uFire.z + uFire.w);
	if (r < rf * 1.3) {
		float a = atan(q.y, q.x);
		float n = n3(vec3(cos(a) * 0.22 + 0.5, sin(a) * 0.22 + 0.5, r / rf * 0.14 + uChurn * 0.008));
		float shell = sm(1.0, 0.72, r / rf) * (0.3 + 1.1 * sm(0.3, 1.0, r / rf));
		col += heatColour(uFire.y) * shell * (0.45 + 0.95 * n) * uFire.z * 1.8;
	}

	// The flash on the lens of the camera.
	col += vec3(1.0, 0.98, 0.92) * uFire.w * uFire.w * 0.14;

	col = 1.0 - exp(-col * 1.5);
	if (uGrade > 0.5) {
		float l = dot(col, vec3(0.3, 0.59, 0.11));
		col = mix(vec3(0.13, 0.1, 0.07), vec3(0.95, 0.88, 0.72), l);
	}
	col += (hash(px + uFade) - 0.5) / 255.0;
	outColor = vec4(col, 1.0);
}
`;
