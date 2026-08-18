"use client";

import type { BotShape } from "@/lib/bots";
import { cn } from "@/lib/utils";

/**
 * A bot's visual identity: a colored shape with two eyes. The shape + color
 * pair is the bot's "face" across the roster, chat header, and dialogs.
 */
export function BotAvatar({
	shape,
	color,
	className,
}: {
	shape: BotShape;
	color: string;
	className?: string;
}) {
	return (
		<svg
			aria-hidden="true"
			className={cn("size-6 shrink-0", className)}
			viewBox="0 0 32 32"
		>
			<ShapePath color={color} shape={shape} />
			{/* Eyes with catchlights so dark colors still read as a face. */}
			<circle cx="12" cy="16" fill="rgba(0,0,0,0.72)" r="2.6" />
			<circle cx="20" cy="16" fill="rgba(0,0,0,0.72)" r="2.6" />
			<circle cx="12.9" cy="15.1" fill="rgba(255,255,255,0.92)" r="0.9" />
			<circle cx="20.9" cy="15.1" fill="rgba(255,255,255,0.92)" r="0.9" />
		</svg>
	);
}

function ShapePath({ shape, color }: { shape: BotShape; color: string }) {
	switch (shape) {
		case "circle":
			return <circle cx="16" cy="16" fill={color} r="14" />;
		case "square":
			return (
				<rect fill={color} height="26" rx="6" width="26" x="3" y="3" />
			);
		case "triangle":
			// Slightly wider than tall so the eyes fit on the lower half.
			return <path d="M16 2.5 30.5 27.5 Q31 29 29 29 H3 Q1 29 1.5 27.5 Z" fill={color} />;
		case "diamond":
			return (
				<path
					d="M16 1.5 29.5 14 Q31.5 16 29.5 18 L16 30.5 2.5 18 Q0.5 16 2.5 14 Z"
					fill={color}
				/>
			);
		case "hexagon":
			return (
				<path
					d="M16 2 27.5 8.5 Q28.5 9 28.5 10 V22 Q28.5 23 27.5 23.5 L16 30 4.5 23.5 Q3.5 23 3.5 22 V10 Q3.5 9 4.5 8.5 Z"
					fill={color}
				/>
			);
		case "star":
			return (
				<path
					d="M16 1.5 20.2 10.6 30 11.8 22.8 18.6 24.7 28.5 16 23.6 7.3 28.5 9.2 18.6 2 11.8 11.8 10.6 Z"
					fill={color}
				/>
			);
	}
}
