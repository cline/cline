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

/**
 * Colour stops approximating a Gaussian falloff.
 *
 * A two-stop `radial-gradient(color, transparent 70%)` ramps linearly, which
 * reads as a hard-edged disc — that is why these blobs used to be wrapped in
 * `filter: blur(64px)`. Blurring a ~1000px layer that also animates forces the
 * compositor to re-run a large-kernel convolution every frame, which pinned the
 * whole window at ~16fps and added ~150ms of presentation delay to every click
 * and keystroke in the app. Shaping the ramp directly in the gradient gives the
 * same soft glow for free, and leaves the layer compositor-only.
 */
const FALLOFF: readonly (readonly [number, number])[] = [
	[0, 1],
	[0.16, 0.95],
	[0.31, 0.82],
	[0.45, 0.64],
	[0.58, 0.45],
	[0.7, 0.28],
	[0.82, 0.14],
	[0.92, 0.05],
	[1, 0],
];

/** Builds a soft-edged radial gradient in `color` at `strength` peak opacity. */
function softGlow(color: string, strength: number, shape: string): string {
	const stops = FALLOFF.map(
		([position, alpha]) =>
			`color-mix(in oklab, ${color} ${(strength * alpha).toFixed(1)}%, transparent) ${(position * 100).toFixed(0)}%`,
	).join(", ");
	return `radial-gradient(${shape}, ${stops})`;
}

/**
 * Every gradient below reaches full transparency at its own element's edges,
 * so a layer can be translated or scaled without a hard boundary sliding into
 * view. Only the window edges ever clip a glow, which is what the blurred
 * version did too.
 */

// Big soft gradient blobs that slowly drift to fake an aurora.
const BLOBS = [
	{
		id: "periwinkle-left",
		position: "left-[-20%] bottom-[-40%] w-[70%] h-[80%]",
		gradient: softGlow(
			"var(--brand-periwinkle)",
			64,
			"ellipse closest-side at center",
		),
		duration: "11s",
		delay: "0s",
		reverse: false,
	},
	{
		id: "violet-right",
		position: "right-[-15%] bottom-[-40%] w-[65%] h-[85%]",
		gradient: softGlow(
			"var(--brand-violet)",
			58,
			"ellipse closest-side at center",
		),
		duration: "12.5s",
		delay: "-12s",
		reverse: true,
	},
] as const;

/**
 * The horizon glow was a single 90deg linear gradient softened by a 64px blur.
 * Overlapping ellipses reproduce the same left-to-right hue sweep and the same
 * vertical fade without a filter pass.
 */
const HORIZON_GRADIENT = [
	softGlow("var(--brand-lilac)", 58, "ellipse 34% 50% at 2% 50%"),
	softGlow("var(--brand-magenta)", 62, "ellipse 34% 50% at 40% 50%"),
	softGlow("var(--brand-periwinkle)", 72, "ellipse 36% 50% at 76% 50%"),
	softGlow("var(--brand-cyan)", 58, "ellipse 32% 50% at 104% 50%"),
].join(", ");

const CURRENT_GRADIENT = [
	softGlow("var(--brand-magenta)", 66, "ellipse 28% 50% at 36% 52%"),
	softGlow("var(--brand-periwinkle)", 72, "ellipse 28% 50% at 58% 44%"),
].join(", ");

const CURRENT_REVERSE_GRADIENT = [
	softGlow("var(--brand-cyan)", 62, "ellipse 28% 50% at 40% 44%"),
	softGlow("var(--brand-violet)", 70, "ellipse 28% 50% at 64% 52%"),
].join(", ");

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
 * A decorative aurora background built entirely from CSS gradients: soft
 * blobs drifting on keyframe animations, plus twinkling star dots. No canvas,
 * no WebGL, no per-frame JS, and deliberately no `filter`/`backdrop-filter` —
 * every animated property here (`transform`, `opacity`) can be handled by the
 * compositor without re-rasterising. Absolutely positioned to fill its nearest
 * positioned parent; pointer events pass through.
 *
 * Keyframes (`aurora-drift`, `aurora-twinkle`) live in app/globals.css, which
 * also pauses them inside `[inert]` subtrees so a full-screen view on top of
 * the chat pane does not keep paying for animation it cannot show.
 */
export function AuroraBackground({ starCount = 28 }: { starCount?: number }) {
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
			className="aurora-root pointer-events-none absolute inset-0 overflow-hidden"
		>
			<div
				className="aurora-horizon absolute inset-x-[-8%] bottom-[-34%] h-[84%] opacity-60"
				style={{ background: HORIZON_GRADIENT }}
			/>
			<div
				className="aurora-current absolute bottom-[-20%] left-[-45%] h-[66%] w-[125%] opacity-50"
				style={{
					animationDelay: "-2s",
					animationDuration: "9s",
					background: CURRENT_GRADIENT,
				}}
			/>
			<div
				className="aurora-current aurora-current-reverse absolute bottom-[-26%] right-[-42%] h-[70%] w-[120%] opacity-45"
				style={{
					animationDelay: "-6s",
					animationDuration: "12s",
					background: CURRENT_REVERSE_GRADIENT,
				}}
			/>
			{BLOBS.map((blob) => (
				<div
					key={blob.id}
					className={`aurora-motion absolute ${blob.reverse ? "aurora-motion-reverse" : ""} ${blob.position}`}
					style={{
						background: blob.gradient,
						animationDuration: blob.duration,
						animationDelay: blob.delay,
					}}
				/>
			))}
			<div className="aurora-starfield absolute inset-0">
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
		</div>
	);
}
