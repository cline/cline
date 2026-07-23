import { useMemo } from "react";
import { cx } from "./utils.js";

interface AuroraStar {
	delay: string;
	duration: string;
	left: string;
	size: number;
	top: string;
}

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

export interface AgentAuroraProps {
	className?: string;
	starCount?: number;
}

export function AgentAurora({ className, starCount = 36 }: AgentAuroraProps) {
	const stars = useMemo<AuroraStar[]>(
		() =>
			Array.from({ length: starCount }, (_, index) => {
				const vertical = seededUnit(index, 1);
				const size = seededUnit(index, 3);
				return {
					delay: `${seededUnit(index, 4) * -5}s`,
					duration: `${3.5 + seededUnit(index, 5) * 3.5}s`,
					left: `${seededUnit(index, 2) * 100}%`,
					size: size < 0.18 ? 4 : size < 0.55 ? 3 : 2,
					top: `${100 - (1 - vertical * vertical) * 48}%`,
				};
			}),
		[starCount],
	);

	return (
		<div aria-hidden="true" className={cx("cline-ui-aurora", className)}>
			<div className="cline-ui-aurora__horizon" />
			<div className="cline-ui-aurora__current cline-ui-aurora__current--left" />
			<div className="cline-ui-aurora__current cline-ui-aurora__current--right" />
			<div className="cline-ui-aurora__blob cline-ui-aurora__blob--left" />
			<div className="cline-ui-aurora__blob cline-ui-aurora__blob--right" />
			{stars.map((star) => (
				<span
					className="cline-ui-aurora__star"
					key={`${star.left}-${star.top}-${star.delay}-${star.duration}`}
					style={{
						animationDelay: star.delay,
						animationDuration: star.duration,
						height: star.size,
						left: star.left,
						top: star.top,
						width: star.size,
					}}
				/>
			))}
		</div>
	);
}
