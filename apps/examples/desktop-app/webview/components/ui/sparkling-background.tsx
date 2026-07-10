"use client";

import { useEffect, useRef } from "react";

const VERTEX_SHADER = `
attribute vec2 position;
void main() {
	gl_Position = vec4(position, 0.0, 1.0);
}
`;

// Aurora ribbons: layered sine-driven light streaks with fbm noise tails.
const FRAGMENT_SHADER = `
precision highp float;

uniform float iTime;
uniform vec2 iResolution;

#define NUM_OCTAVES 3

float rand(vec2 n) {
	return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float noise(vec2 p) {
	vec2 ip = floor(p);
	vec2 u = fract(p);
	u = u * u * (3.0 - 2.0 * u);
	float res = mix(
		mix(rand(ip), rand(ip + vec2(1.0, 0.0)), u.x),
		mix(rand(ip + vec2(0.0, 1.0)), rand(ip + vec2(1.0, 1.0)), u.x), u.y);
	return res * res;
}

float fbm(vec2 x) {
	float v = 0.0;
	float a = 0.3;
	vec2 shift = vec2(100.0);
	mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
	for (int i = 0; i < NUM_OCTAVES; ++i) {
		v += a * noise(x);
		x = rot * x * 2.0 + shift;
		a *= 0.4;
	}
	return v;
}

void main() {
	vec2 shake = vec2(sin(iTime * 1.2) * 0.005, cos(iTime * 2.1) * 0.005);
	vec2 p = ((gl_FragCoord.xy + shake * iResolution.xy) - iResolution.xy * 0.5) / iResolution.y * mat2(6.0, -4.0, 4.0, 6.0);
	vec2 v;
	vec4 o = vec4(0.0);

	float f = 2.0 + fbm(p + vec2(iTime * 5.0, 0.0)) * 0.5;

	for (float i = 0.0; i < 35.0; i++) {
		v = p + cos(i * i + (iTime + p.x * 0.08) * 0.025 + i * vec2(13.0, 11.0)) * 3.5
			+ vec2(sin(iTime * 3.0 + i) * 0.003, cos(iTime * 3.5 - i) * 0.003);
		float tailNoise = fbm(v + vec2(iTime * 0.5, i)) * 0.3 * (1.0 - (i / 35.0));
		vec4 auroraColors = vec4(
			0.1 + 0.3 * sin(i * 0.2 + iTime * 0.4),
			0.3 + 0.5 * cos(i * 0.3 + iTime * 0.5),
			0.7 + 0.3 * sin(i * 0.4 + iTime * 0.3),
			1.0
		);
		vec4 currentContribution = auroraColors * exp(sin(i * i + iTime * 0.8)) / length(max(v, vec2(v.x * f * 0.015, v.y * 1.5)));
		float thinnessFactor = smoothstep(0.0, 1.0, i / 35.0) * 0.6;
		o += currentContribution * (1.0 + tailNoise * 0.8) * thinnessFactor;
	}

	// tanh() isn't available in GLSL ES 1.0 — compute it from exp().
	vec4 x = pow(o / 100.0, vec4(1.6));
	vec4 e = exp(2.0 * x);
	o = (e - 1.0) / (e + 1.0);
	gl_FragColor = o * 1.5;
}
`;

function compile(
	gl: WebGLRenderingContext,
	type: number,
	source: string,
): WebGLShader | null {
	const shader = gl.createShader(type);
	if (!shader) return null;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		console.error(gl.getShaderInfoLog(shader));
		gl.deleteShader(shader);
		return null;
	}
	return shader;
}

interface GlSetup {
	program: WebGLProgram;
	buffer: WebGLBuffer | null;
	vs: WebGLShader;
	fs: WebGLShader;
	timeLoc: WebGLUniformLocation | null;
	resolutionLoc: WebGLUniformLocation | null;
}

function setupGl(gl: WebGLRenderingContext): GlSetup | null {
	const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
	const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
	if (!vs || !fs) return null;

	const program = gl.createProgram();
	if (!program) return null;
	gl.attachShader(program, vs);
	gl.attachShader(program, fs);
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		console.error(gl.getProgramInfoLog(program));
		return null;
	}
	// biome-ignore lint/correctness/useHookAtTopLevel: gl.useProgram is a WebGL API call, not a React hook
	gl.useProgram(program);

	// Fullscreen quad as a triangle strip.
	const buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(
		gl.ARRAY_BUFFER,
		new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
		gl.STATIC_DRAW,
	);
	const positionLoc = gl.getAttribLocation(program, "position");
	gl.enableVertexAttribArray(positionLoc);
	gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

	return {
		program,
		buffer,
		vs,
		fs,
		timeLoc: gl.getUniformLocation(program, "iTime"),
		resolutionLoc: gl.getUniformLocation(program, "iResolution"),
	};
}

/**
 * A decorative animated aurora background rendered with a raw WebGL fragment
 * shader (no three.js). Absolutely positioned to fill its nearest positioned
 * parent; pointer events pass through.
 */
export function SparkleBackground() {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		const gl = canvas.getContext("webgl", { antialias: true });
		if (!gl) return;

		const setup = setupGl(gl);
		if (!setup) return;
		const { program, buffer, vs, fs, timeLoc, resolutionLoc } = setup;

		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const resize = () => {
			const parent = canvas.parentElement;
			if (!parent) return;
			const width = parent.clientWidth;
			const height = parent.clientHeight;
			canvas.width = width * dpr;
			canvas.height = height * dpr;
			canvas.style.width = `${width}px`;
			canvas.style.height = `${height}px`;
			gl.viewport(0, 0, canvas.width, canvas.height);
			gl.uniform2f(resolutionLoc, canvas.width, canvas.height);
		};
		resize();
		const ro = new ResizeObserver(resize);
		if (canvas.parentElement) ro.observe(canvas.parentElement);

		let rafId = 0;
		const start = performance.now();
		const render = (now: number) => {
			gl.uniform1f(timeLoc, (now - start) / 1000);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
			rafId = requestAnimationFrame(render);
		};
		rafId = requestAnimationFrame(render);

		return () => {
			cancelAnimationFrame(rafId);
			ro.disconnect();
			gl.deleteBuffer(buffer);
			gl.deleteProgram(program);
			gl.deleteShader(vs);
			gl.deleteShader(fs);
		};
	}, []);

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden bg-black">
			<canvas ref={canvasRef} className="absolute inset-0" />
		</div>
	);
}
