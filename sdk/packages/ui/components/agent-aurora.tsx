"use client";

interface AuroraStar {
	color: string;
	delay: string;
	duration: string;
	left: string;
	opacity: number;
	size: number;
	top: string;
}

const BLOBS = [
	{
		delay: "0s",
		gradient:
			"radial-gradient(ellipse at center, color-mix(in oklab, var(--brand-periwinkle) 64%, transparent), color-mix(in oklab, var(--brand-periwinkle) 30%, transparent) 42%, transparent 70%)",
		id: "periwinkle-left",
		position: "left",
		duration: "11s",
	},
	{
		delay: "-12s",
		gradient:
			"radial-gradient(ellipse at center, color-mix(in oklab, var(--brand-violet) 58%, transparent), color-mix(in oklab, var(--brand-violet) 27%, transparent) 42%, transparent 70%)",
		id: "violet-right",
		position: "right",
		duration: "12.5s",
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

const STARS = Array.from({ length: 32 }, (_, index): AuroraStar => {
	const vertical = seededUnit(index, 1);
	const size = seededUnit(index, 3);
	return {
		color:
			seededUnit(index, 7) > 0.78
				? "var(--brand-cyan)"
				: "color-mix(in oklab, white 92%, var(--brand-lilac))",
		delay: `${seededUnit(index, 4) * -5}s`,
		duration: `${3.5 + seededUnit(index, 5) * 3.5}s`,
		left: `${seededUnit(index, 2) * 100}%`,
		opacity: 0.35 + seededUnit(index, 6) * 0.6,
		size: size < 0.14 ? 4 : size < 0.52 ? 3 : 2,
		top: `${100 - (1 - vertical * vertical) * 45}%`,
	};
});

/** Decorative layer that fills its nearest positioned ancestor. */
export function AgentAurora() {
	return (
		<div aria-hidden="true" className="cline-ui-agent-aurora">
			<div className="cline-ui-agent-aurora__horizon cline-ui-agent-aurora__soft-band" />
			<div className="cline-ui-agent-aurora__current cline-ui-agent-aurora__current--left cline-ui-agent-aurora__soft-band" />
			<div className="cline-ui-agent-aurora__current cline-ui-agent-aurora__current--right cline-ui-agent-aurora__soft-band" />
			{BLOBS.map((blob) => (
				<div
					className={`cline-ui-agent-aurora__blob cline-ui-agent-aurora__blob--${blob.position}`}
					key={blob.id}
					style={{
						animationDelay: blob.delay,
						animationDuration: blob.duration,
						background: blob.gradient,
					}}
				/>
			))}
			{STARS.map((star) => (
				<span
					className="cline-ui-agent-aurora__star"
					key={`${star.left}-${star.top}`}
					style={{
						animationDelay: star.delay,
						animationDuration: star.duration,
						background: star.color,
						height: star.size,
						left: star.left,
						opacity: star.opacity,
						top: star.top,
						width: star.size,
					}}
				/>
			))}
		</div>
	);
}
