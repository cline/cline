"use client";

import { useMemo } from "react";

interface Star {
	left: string;
	top: string;
	size: number;
	delay: string;
	duration: string;
	opacity: number;
}

// Big blurred gradient blobs that slowly drift/rotate to fake an aurora.
// Each entry is [positionClasses, gradient, animationDuration, animationDelay].
const BLOBS: Array<[string, string, string, string]> = [
	[
		"left-[-20%] bottom-[-40%] w-[70%] h-[80%]",
		"radial-gradient(ellipse at center, oklch(0.55 0.2 278 / 0.55), transparent 70%)",
		"16s",
		"0s",
	],
	[
		"left-[25%] bottom-[-50%] w-[60%] h-[90%]",
		"radial-gradient(ellipse at center, oklch(0.65 0.19 200 / 0.4), transparent 70%)",
		"22s",
		"-6s",
	],
	[
		"right-[-15%] bottom-[-40%] w-[65%] h-[85%]",
		"radial-gradient(ellipse at center, oklch(0.6 0.18 310 / 0.5), transparent 70%)",
		"19s",
		"-12s",
	],
	[
		"left-[10%] bottom-[-30%] w-[80%] h-[60%]",
		"radial-gradient(ellipse at center, oklch(0.75 0.13 340 / 0.35), transparent 70%)",
		"26s",
		"-3s",
	],
];

/**
 * A decorative aurora background built entirely from CSS: blurred gradient
 * blobs drifting on keyframe animations, plus twinkling star dots. No canvas,
 * no WebGL, no per-frame JS. Absolutely positioned to fill its nearest
 * positioned parent; pointer events pass through.
 *
 * Keyframes (`aurora-drift`, `aurora-twinkle`) live in app/globals.css.
 */
export function AuroraBackground({ starCount = 90 }: { starCount?: number }) {
	// Random star field, generated once per mount.
	const stars = useMemo<Star[]>(
		() =>
			Array.from({ length: starCount }, () => {
				// Squared skew biases stars toward the bottom, where the glow lives.
				const r = Math.random();
				return {
					left: `${Math.random() * 100}%`,
					top: `${100 - (1 - r * r) * 45}%`,
					size: Math.random() < 0.15 ? 3 : Math.random() < 0.5 ? 2 : 1,
					delay: `${Math.random() * 4}s`,
					duration: `${1.5 + Math.random() * 3.5}s`,
					opacity: 0.3 + Math.random() * 0.6,
				};
			}),
		[starCount],
	);

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			{BLOBS.map(([position, gradient, duration, delay], idx) => (
				<div
					key={`blob${idx}`}
					className={`absolute blur-3xl animate-[aurora-drift_linear_infinite] ${position}`}
					style={{
						background: gradient,
						animationDuration: duration,
						animationDelay: delay,
					}}
				/>
			))}
			{stars.map((s, idx) => (
				<span
					key={`star${idx}`}
					className="absolute rounded-none bg-[#b8f3ee] animate-[aurora-twinkle_ease-in-out_infinite]"
					style={{
						left: s.left,
						top: s.top,
						width: s.size,
						height: s.size,
						opacity: s.opacity,
						animationDelay: s.delay,
						animationDuration: s.duration,
					}}
				/>
			))}
		</div>
	);
}
