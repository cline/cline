"use client";

import { useMemo } from "react";

interface Star {
	left: string;
	top: string;
	size: number;
	delay: string;
	duration: string;
	opacity: number;
	color: string;
}

// Big blurred gradient blobs that slowly drift/rotate to fake an aurora.
const BLOBS = [
	{
		id: "periwinkle-left",
		position: "left-[-20%] bottom-[-40%] w-[70%] h-[80%]",
		gradient:
			"radial-gradient(ellipse at center, color-mix(in oklab, var(--brand-periwinkle) 64%, transparent), transparent 70%)",
		duration: "11s",
		delay: "0s",
		reverse: false,
	},
	{
		id: "violet-right",
		position: "right-[-15%] bottom-[-40%] w-[65%] h-[85%]",
		gradient:
			"radial-gradient(ellipse at center, color-mix(in oklab, var(--brand-violet) 58%, transparent), transparent 70%)",
		duration: "12.5s",
		delay: "-12s",
		reverse: true,
	},
] as const;

function seededUnit(index: number, salt: number): number {
	let value =
		Math.imul(index + 1, 0x9e3779b1) ^ Math.imul(salt + 1, 0x85ebca6b);
	value ^= value >>> 16;
	value = Math.imul(value, 0x7feb352d);
	value ^= value >>> 15;
	value = Math.imul(value, 0x846ca68b);
	value ^= value >>> 16;
	return (value >>> 0) / 0x1_0000_0000;
}

/**
 * A decorative aurora background built entirely from CSS: blurred gradient
 * blobs drifting on keyframe animations, plus twinkling star dots. No canvas,
 * no WebGL, no per-frame JS. Absolutely positioned to fill its nearest
 * positioned parent; pointer events pass through.
 *
 * Keyframes (`aurora-drift`, `aurora-twinkle`) live in app/globals.css.
 */
export function AuroraBackground({ starCount = 48 }: { starCount?: number }) {
	// The field is deterministic so server and browser markup always agree.
	const stars = useMemo<Star[]>(
		() =>
			Array.from({ length: starCount }, (_, index) => {
				// Squared skew biases stars toward the bottom, where the glow lives.
				const r = seededUnit(index, 1);
				const sizeRoll = seededUnit(index, 3);
				return {
					left: `${seededUnit(index, 2) * 100}%`,
					top: `${100 - (1 - r * r) * 45}%`,
					size: sizeRoll < 0.14 ? 4 : sizeRoll < 0.52 ? 3 : 2,
					delay: `${seededUnit(index, 4) * -5}s`,
					duration: `${3.5 + seededUnit(index, 5) * 3.5}s`,
					opacity: 0.35 + seededUnit(index, 6) * 0.6,
					color:
						seededUnit(index, 7) > 0.78
							? "var(--brand-cyan)"
							: "color-mix(in oklab, white 92%, var(--brand-lilac))",
				};
			}),
		[starCount],
	);

	return (
		<div
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 overflow-hidden"
		>
			<div
				className="aurora-horizon absolute inset-x-[-8%] bottom-[-3%] h-[40%] opacity-60 blur-3xl"
				style={{
					background:
						"linear-gradient(90deg, color-mix(in oklab, var(--brand-lilac) 58%, transparent), color-mix(in oklab, var(--brand-magenta) 62%, transparent) 42%, color-mix(in oklab, var(--brand-periwinkle) 72%, transparent) 78%, color-mix(in oklab, var(--brand-cyan) 58%, transparent))",
				}}
			/>
			<div
				className="aurora-current absolute bottom-[3%] left-[-45%] h-[30%] w-[125%] opacity-50 blur-[46px]"
				style={{
					animationDelay: "-2s",
					animationDuration: "9s",
					background:
						"linear-gradient(105deg, transparent 12%, color-mix(in oklab, var(--brand-magenta) 66%, transparent) 38%, color-mix(in oklab, var(--brand-periwinkle) 72%, transparent) 58%, transparent 82%)",
				}}
			/>
			<div
				className="aurora-current aurora-current-reverse absolute bottom-[-5%] right-[-42%] h-[34%] w-[120%] opacity-45 blur-[52px]"
				style={{
					animationDelay: "-6s",
					animationDuration: "12s",
					background:
						"linear-gradient(75deg, transparent 10%, color-mix(in oklab, var(--brand-cyan) 62%, transparent) 42%, color-mix(in oklab, var(--brand-violet) 70%, transparent) 64%, transparent 88%)",
				}}
			/>
			{BLOBS.map((blob) => (
				<div
					key={blob.id}
					className={`aurora-motion absolute blur-3xl ${blob.reverse ? "aurora-motion-reverse" : ""} ${blob.position}`}
					style={{
						background: blob.gradient,
						animationDuration: blob.duration,
						animationDelay: blob.delay,
					}}
				/>
			))}
			{stars.map((s) => (
				<span
					key={`${s.left}-${s.top}`}
					className="aurora-star absolute rounded-[1px]"
					style={{
						left: s.left,
						top: s.top,
						width: s.size,
						height: s.size,
						background: s.color,
						opacity: s.opacity,
						animationDelay: s.delay,
						animationDuration: s.duration,
					}}
				/>
			))}
		</div>
	);
}
