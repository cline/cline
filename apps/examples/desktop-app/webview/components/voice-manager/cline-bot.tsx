import { cn } from "@/lib/utils";

export type ClineBotState =
	| "idle"
	| "connecting"
	| "listening"
	| "thinking"
	| "speaking"
	| "error";

// The outline from the Cline logo (public/icon.svg), used as the robot's head.
const HEAD_OUTLINE =
	"M56.4998 8.99805L56.4999 5.29805H56.4998V8.99805ZM68.4998 20.708L72.1998 20.7081V20.708H68.4998ZM67.9929 25L64.3662 24.2671L63.4704 28.7H67.9929V25ZM84.4998 25L84.4998 21.3H84.4998V25ZM95.7 49.7998H92V51.2066L92.9346 52.258L95.7 49.7998ZM108.027 63.667L110.793 61.2088L110.792 61.2088L108.027 63.667ZM108.027 64.7305L110.792 67.1887L110.793 67.1883L108.027 64.7305ZM95.7 78.5977L92.9346 76.1394L92 77.1909V78.5977H95.7ZM95.7 92.2002L99.3999 92.2002V92.2002H95.7ZM84.4998 103.4V107.1H84.4998L84.4998 103.4ZM17.2996 92.2002H13.5996V92.2002L17.2996 92.2002ZM17.2996 78.5986H20.9996V77.1918L20.0649 76.1404L17.2996 78.5986ZM4.97144 64.7305L2.20602 67.1886L2.20611 67.1887L4.97144 64.7305ZM4.97144 63.667L7.73685 66.1251L7.73685 66.1251L4.97144 63.667ZM17.2996 49.7979L20.065 52.256L20.9996 51.2046V49.7979H17.2996ZM45.0066 25V28.7H49.5292L48.6333 24.267L45.0066 25ZM44.4998 20.708H40.7998V20.7081L44.4998 20.708ZM56.4998 8.99805L56.4996 12.698C61.1812 12.6982 64.7998 16.3247 64.7998 20.708H68.4998H72.1998C72.1998 12.0452 65.0728 5.29829 56.4999 5.29805L56.4998 8.99805ZM68.4998 20.708L64.7998 20.7079C64.7997 21.6154 64.6614 22.8066 64.3662 24.2671L67.9929 25L71.6196 25.7329C71.969 24.004 72.1997 22.2864 72.1998 20.7081L68.4998 20.708ZM67.9929 25V28.7H84.4998V25V21.3H67.9929V25ZM84.4998 25L84.4997 28.7C88.6419 28.7001 92 32.0582 92 36.2002H95.7H99.3999C99.3999 27.9712 92.7287 21.3001 84.4998 21.3L84.4998 25ZM95.7 36.2002H92V49.7998H95.7H99.3999V36.2002H95.7ZM95.7 49.7998L92.9346 52.258L105.262 66.1252L108.027 63.667L110.792 61.2088L98.4653 47.3416L95.7 49.7998ZM108.027 63.667L105.262 66.1251C104.285 65.026 104.285 63.371 105.261 62.2727L108.027 64.7305L110.793 67.1883C112.308 65.4837 112.308 62.9141 110.793 61.2088L108.027 63.667ZM108.027 64.7305L105.262 62.2722L92.9346 76.1394L95.7 78.5977L98.4653 81.0559L110.792 67.1887L108.027 64.7305ZM95.7 78.5977H92V92.2002H95.7H99.3999V78.5977H95.7ZM95.7 92.2002L92 92.2002C91.9999 96.3422 88.6418 99.7003 84.4997 99.7004L84.4998 103.4L84.4998 107.1C92.7287 107.1 99.3999 100.429 99.3999 92.2002L95.7 92.2002ZM84.4998 103.4V99.7004H28.4998V103.4V107.1H84.4998V103.4ZM28.4998 103.4V99.7004C24.3577 99.7004 20.9996 96.3423 20.9996 92.2002L17.2996 92.2002L13.5996 92.2002C13.5996 100.429 20.2707 107.1 28.4998 107.1V103.4ZM17.2996 92.2002H20.9996V78.5986H17.2996H13.5996V92.2002H17.2996ZM17.2996 78.5986L20.0649 76.1404L7.73676 62.2722L4.97144 64.7305L2.20611 67.1887L14.5342 81.0569L17.2996 78.5986ZM4.97144 64.7305L7.73685 62.2723C8.71353 63.3711 8.71353 65.0264 7.73685 66.1251L4.97144 63.667L2.20602 61.2088C0.690476 62.9138 0.690476 65.4836 2.20602 67.1886L4.97144 64.7305ZM4.97144 63.667L7.73685 66.1251L20.065 52.256L17.2996 49.7979L14.5341 47.3397L2.20602 61.2088L4.97144 63.667ZM17.2996 49.7979H20.9996V36.2002H17.2996H13.5996V49.7979H17.2996ZM17.2996 36.2002H20.9996C20.9996 32.0581 24.3576 28.7 28.4998 28.7V25V21.3C20.2707 21.3 13.5996 27.9712 13.5996 36.2002H17.2996ZM28.4998 25V28.7H45.0066V25V21.3H28.4998V25ZM45.0066 25L48.6333 24.267C48.3381 22.8066 48.1998 21.6154 48.1998 20.7079L44.4998 20.708L40.7998 20.7081C40.7998 22.2864 41.0305 24.0039 41.3799 25.733L45.0066 25ZM44.4998 20.708H48.1998C48.1998 16.3244 51.8182 12.698 56.4998 12.698V8.99805V5.29805C47.9264 5.29805 40.7998 12.0451 40.7998 20.708H44.4998Z";

const STYLES = `
.cline-bot { overflow: visible; }
.cline-bot-fill { fill: var(--background); }
.cline-bot-line { fill: var(--background); stroke: currentColor; stroke-width: 7.4; stroke-linejoin: round; }
.cline-bot-float { animation: cline-bot-float 3.2s ease-in-out infinite; }
.cline-bot-head { transform-box: view-box; transform-origin: 56.5px 103px; transition: transform 300ms ease; }
.cline-bot-arm-left { transform-box: view-box; transform-origin: 40.5px 111px; transition: transform 300ms ease; }
.cline-bot-arm-right { transform-box: view-box; transform-origin: 72.5px 111px; transition: transform 300ms ease; }
.cline-bot-torso { transform-box: view-box; transform-origin: 56.5px 153px; }
.cline-bot-eyes { transition: transform 300ms ease; }
.cline-bot-eye { transform-box: fill-box; transform-origin: center; animation: cline-bot-blink 4.6s infinite; transition: transform 200ms ease; }
.cline-bot-mouth { transform-box: fill-box; transform-origin: center; opacity: 0; transition: opacity 150ms ease; }
.cline-bot-light { opacity: 0; transition: opacity 200ms ease; }
.cline-bot-shadow { opacity: 0.1; transform-box: fill-box; transform-origin: center; animation: cline-bot-shadow 3.2s ease-in-out infinite; }

.cline-bot[data-state="connecting"] .cline-bot-light { animation: cline-bot-blip 0.6s ease-in-out infinite alternate; }
.cline-bot[data-state="listening"] .cline-bot-light { animation: cline-bot-pulse 1.4s ease-in-out infinite; }
.cline-bot[data-state="listening"] .cline-bot-head { animation: cline-bot-tilt 3s ease-in-out infinite; }
.cline-bot[data-state="thinking"] .cline-bot-light { animation: cline-bot-blip 0.3s ease-in-out infinite alternate; }
.cline-bot[data-state="thinking"] .cline-bot-eyes { animation: cline-bot-look 1.1s ease-in-out infinite; }
.cline-bot[data-state="thinking"] .cline-bot-eye { animation: none; transform: scaleY(0.6); }
.cline-bot[data-state="speaking"] .cline-bot-light { opacity: 1; }
.cline-bot[data-state="speaking"] .cline-bot-eye { animation: none; transform: scaleY(0.75); }
.cline-bot[data-state="speaking"] .cline-bot-mouth { opacity: 1; animation: cline-bot-talk 0.16s ease-in-out infinite alternate; }
.cline-bot[data-state="speaking"] .cline-bot-head { animation: cline-bot-nod 0.7s ease-in-out infinite alternate; }
.cline-bot[data-state="speaking"] .cline-bot-arm-right { animation: cline-bot-wave 0.6s ease-in-out infinite alternate; }
.cline-bot[data-state="speaking"] .cline-bot-torso { animation: cline-bot-bounce 0.35s ease-in-out infinite alternate; }
.cline-bot[data-state="error"] .cline-bot-eye { animation: none; transform: scaleY(0.3); }
.cline-bot[data-state="error"] .cline-bot-head { transform: rotate(-5deg); }
.cline-bot[data-state="error"] .cline-bot-arm-left,
.cline-bot[data-state="error"] .cline-bot-arm-right { transform: rotate(0deg) translateY(2px); }

@keyframes cline-bot-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes cline-bot-shadow { 0%, 100% { transform: scaleX(1); } 50% { transform: scaleX(0.8); } }
@keyframes cline-bot-blink { 0%, 93%, 100% { transform: scaleY(1); } 96% { transform: scaleY(0.1); } }
@keyframes cline-bot-tilt { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
@keyframes cline-bot-nod { from { transform: rotate(-2deg); } to { transform: rotate(2deg) translateY(1px); } }
@keyframes cline-bot-look { 0%, 100% { transform: translateX(-5px); } 50% { transform: translateX(5px); } }
@keyframes cline-bot-talk { from { transform: scale(0.7, 0.5); } to { transform: scale(1, 1.8); } }
@keyframes cline-bot-wave { from { transform: rotate(0deg); } to { transform: rotate(-35deg); } }
@keyframes cline-bot-bounce { from { transform: scaleY(1); } to { transform: scaleY(1.04); } }
@keyframes cline-bot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
@keyframes cline-bot-blip { from { opacity: 1; } to { opacity: 0; } }

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
	return (
		<svg
			aria-hidden="true"
			className={cn("cline-bot", className)}
			data-state={state}
			viewBox="-4 2 121 164"
		>
			<style>{STYLES}</style>
			<ellipse
				className="cline-bot-shadow"
				cx="56.5"
				cy="161"
				fill="currentColor"
				rx="22"
				ry="2.6"
			/>
			<g className="cline-bot-float">
				<path
					className="cline-bot-line cline-bot-arm-left"
					d="M40.5 110 C 30 111, 23.5 120, 23.5 129 C 23.5 134, 27 137, 32 136 C 37 135, 40.5 131, 40.5 125 Z"
				/>
				<path
					className="cline-bot-line cline-bot-arm-right"
					d="M72.5 110 C 83 111, 89.5 120, 89.5 129 C 89.5 134, 86 137, 81 136 C 76 135, 72.5 131, 72.5 125 Z"
				/>
				<g className="cline-bot-torso">
					<rect
						fill="currentColor"
						height="10"
						rx="5"
						width="11"
						x="42.5"
						y="145"
					/>
					<rect
						fill="currentColor"
						height="10"
						rx="5"
						width="11"
						x="59.5"
						y="145"
					/>
					<rect
						className="cline-bot-line"
						height="46"
						rx="8.5"
						width="36"
						x="38.5"
						y="96"
					/>
				</g>
				<g className="cline-bot-head">
					<circle className="cline-bot-fill" cx="56.5" cy="20.7" r="11.7" />
					<rect
						className="cline-bot-fill"
						height="78.4"
						rx="11.2"
						width="78.4"
						x="17.3"
						y="25"
					/>
					<polygon
						className="cline-bot-fill"
						points="17.3,49.8 4.97,64.2 17.3,78.6"
					/>
					<polygon
						className="cline-bot-fill"
						points="95.7,49.8 108,64.2 95.7,78.6"
					/>
					<path d={HEAD_OUTLINE} fill="currentColor" />
					<circle
						className="cline-bot-light"
						cx="56.5"
						cy="20.7"
						fill="currentColor"
						r="6"
					/>
					<g className="cline-bot-eyes" fill="currentColor">
						<rect
							className="cline-bot-eye"
							height="28.8"
							rx="4.8"
							width="9.6"
							x="37.3"
							y="47"
						/>
						<rect
							className="cline-bot-eye"
							height="28.8"
							rx="4.8"
							width="9.6"
							x="66.1"
							y="47"
						/>
					</g>
					<rect
						className="cline-bot-mouth"
						fill="currentColor"
						height="4.6"
						rx="2.3"
						width="13"
						x="50"
						y="85"
					/>
				</g>
			</g>
		</svg>
	);
}
