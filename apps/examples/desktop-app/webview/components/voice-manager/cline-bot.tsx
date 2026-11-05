import { useId } from "react";
import { cn } from "@/lib/utils";

export type ClineBotState =
	| "idle"
	| "connecting"
	| "listening"
	| "thinking"
	| "speaking"
	| "error";

// Coordinates below are in the 1024px space the head/body art was cut from.
const STYLES = `
.cline-bot { overflow: visible; --bot-eye: #eef1fa; --bot-light: transparent; }
.cline-bot[data-state="connecting"] { --bot-eye: #9aa3b5; --bot-light: #38bdf8; }
.cline-bot[data-state="listening"] { --bot-eye: #8ff5cf; --bot-light: #34d399; }
.cline-bot[data-state="thinking"] { --bot-eye: #ffd889; --bot-light: #fbbf24; }
.cline-bot[data-state="speaking"] { --bot-eye: #d6ccff; --bot-light: #a78bfa; }
.cline-bot[data-state="error"] { --bot-eye: #ff9a9a; --bot-light: #f87171; }

.cline-bot-float { animation: cline-bot-float 3.2s ease-in-out infinite; }
.cline-bot-head { transform-box: view-box; transform-origin: 512px 700px; transition: transform 300ms ease; }
.cline-bot-body { transform-box: view-box; transform-origin: 512px 955px; }
.cline-bot-face { fill: var(--bot-eye); transition: fill 250ms ease; }
.cline-bot-eyes { transition: transform 300ms ease; }
.cline-bot-eye { transform-box: fill-box; transform-origin: center; animation: cline-bot-blink 4.6s infinite; transition: transform 200ms ease; }
.cline-bot-mouth { transform-box: fill-box; transform-origin: center; opacity: 0; transition: opacity 150ms ease; }
.cline-bot-light { fill: var(--bot-light); transition: fill 200ms ease; }
.cline-bot-shadow { transform-box: fill-box; transform-origin: center; animation: cline-bot-shadow 3.2s ease-in-out infinite; }

.cline-bot[data-state="connecting"] .cline-bot-light { animation: cline-bot-blip 0.6s ease-in-out infinite alternate; }
.cline-bot[data-state="listening"] .cline-bot-light { animation: cline-bot-pulse 1.4s ease-in-out infinite; }
.cline-bot[data-state="listening"] .cline-bot-head { animation: cline-bot-tilt 3s ease-in-out infinite; }
.cline-bot[data-state="listening"] .cline-bot-eyes { transform: translateY(-10px) scale(1.06); transform-box: fill-box; transform-origin: center; }
.cline-bot[data-state="thinking"] .cline-bot-light { animation: cline-bot-blip 0.35s ease-in-out infinite alternate; }
.cline-bot[data-state="thinking"] .cline-bot-eyes { animation: cline-bot-look 1.1s ease-in-out infinite; }
.cline-bot[data-state="thinking"] .cline-bot-eye { animation: none; transform: scaleY(0.6); }
.cline-bot[data-state="speaking"] .cline-bot-light { animation: cline-bot-pulse 0.5s ease-in-out infinite; }
.cline-bot[data-state="speaking"] .cline-bot-eye { animation: none; transform: scaleY(0.72); }
.cline-bot[data-state="speaking"] .cline-bot-mouth { opacity: 1; animation: cline-bot-talk 0.16s ease-in-out infinite alternate; }
.cline-bot[data-state="speaking"] .cline-bot-head { animation: cline-bot-nod 0.7s ease-in-out infinite alternate; }
.cline-bot[data-state="speaking"] .cline-bot-body { animation: cline-bot-bounce 0.35s ease-in-out infinite alternate; }
.cline-bot[data-state="error"] .cline-bot-eye { animation: none; transform: scaleY(0.22); }
.cline-bot[data-state="error"] .cline-bot-head { transform: rotate(-4deg); }

@keyframes cline-bot-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-36px); } }
@keyframes cline-bot-shadow { 0%, 100% { transform: scaleX(1); opacity: 1; } 50% { transform: scaleX(0.8); opacity: 0.7; } }
@keyframes cline-bot-blink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.08); } }
@keyframes cline-bot-tilt { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
@keyframes cline-bot-nod { from { transform: rotate(-2deg); } to { transform: rotate(2.5deg) translateY(6px); } }
@keyframes cline-bot-bounce { from { transform: scaleY(1); } to { transform: scaleY(1.04); } }
@keyframes cline-bot-look { 0%, 100% { transform: translateX(-34px); } 50% { transform: translateX(34px); } }
@keyframes cline-bot-talk { from { transform: scale(0.65, 0.5); } to { transform: scale(1, 1.9); } }
@keyframes cline-bot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
@keyframes cline-bot-blip { from { opacity: 1; } to { opacity: 0.15; } }

@media (prefers-reduced-motion: reduce) {
	.cline-bot * { animation: none !important; }
}
`;

export function ClineBot({
	state,
	className,
}: {
	state: ClineBotState;
	className?: string;
}) {
	const id = useId().replace(/:/g, "");
	return (
		<svg
			aria-hidden="true"
			className={cn("cline-bot", className)}
			data-state={state}
			viewBox="112 30 800 960"
		>
			<style>{STYLES}</style>
			<defs>
				<filter height="200%" id={`${id}-glow`} width="200%" x="-50%" y="-50%">
					<feGaussianBlur result="blur" stdDeviation="14" />
					<feMerge>
						<feMergeNode in="blur" />
						<feMergeNode in="SourceGraphic" />
					</feMerge>
				</filter>
				<filter
					height="300%"
					id={`${id}-shadow`}
					width="160%"
					x="-30%"
					y="-100%"
				>
					<feGaussianBlur stdDeviation="16" />
				</filter>
			</defs>
			<ellipse
				className="cline-bot-shadow"
				cx="512"
				cy="972"
				fill="black"
				filter={`url(#${id}-shadow)`}
				opacity="0.09"
				rx="170"
				ry="16"
			/>
			<g className="cline-bot-float">
				<image
					className="cline-bot-body"
					height="255"
					href="/voice-manager/body.webp"
					width="740"
					x="142"
					y="700"
				/>
				<g className="cline-bot-head">
					<image
						height="652"
						href="/voice-manager/head.webp"
						width="740"
						x="142"
						y="56"
					/>
					<circle
						className="cline-bot-light"
						cx="512"
						cy="147"
						filter={`url(#${id}-glow)`}
						r="44"
					/>
					<g className="cline-bot-face" filter={`url(#${id}-glow)`}>
						<g className="cline-bot-eyes">
							<rect
								className="cline-bot-eye"
								height="150"
								rx="31"
								width="62"
								x="383"
								y="322"
							/>
							<rect
								className="cline-bot-eye"
								height="150"
								rx="31"
								width="62"
								x="579"
								y="322"
							/>
						</g>
						<rect
							className="cline-bot-mouth"
							height="22"
							rx="11"
							width="96"
							x="464"
							y="540"
						/>
					</g>
				</g>
			</g>
		</svg>
	);
}
