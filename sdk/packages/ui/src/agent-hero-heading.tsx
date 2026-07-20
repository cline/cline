import { useEffect, useState } from "react";
import { cx } from "./utils.js";

const DEFAULT_VERBS = ["build", "create", "fix", "know"] as const;

export interface AgentHeroHeadingProps {
	className?: string;
	cycleMs?: number;
	verbs?: readonly string[];
}

/** The shared Cline welcome heading used by agent start surfaces. */
export function AgentHeroHeading({
	className,
	cycleMs = 2600,
	verbs = DEFAULT_VERBS,
}: AgentHeroHeadingProps) {
	const availableVerbs = verbs.filter((verb) => verb.trim().length > 0);
	const [verbIndex, setVerbIndex] = useState(0);

	useEffect(() => {
		if (availableVerbs.length <= 1) return;
		const reduceMotion =
			typeof window.matchMedia === "function" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches;
		if (reduceMotion) return;
		const interval = window.setInterval(() => {
			setVerbIndex((current) => (current + 1) % availableVerbs.length);
		}, cycleMs);
		return () => window.clearInterval(interval);
	}, [availableVerbs.length, cycleMs]);

	const verb = availableVerbs[verbIndex % availableVerbs.length] ?? "build";

	return (
		<h1 className={cx("cline-ui-hero-heading", className)}>
			<span className="cline-ui-sr-only">What would you like to build?</span>
			<span aria-hidden="true">
				What would you like to{" "}
				<span className="cline-ui-hero-heading__word" key={verb}>
					{verb.split("").map((character, index) => (
						<span
							className="cline-ui-hero-heading__character"
							// biome-ignore lint/suspicious/noArrayIndexKey: the keyed word remounts as a unit and character positions never reorder
							key={`${verb}-${index}`}
							style={{ animationDelay: `${index * 45}ms` }}
						>
							{character}
						</span>
					))}
				</span>
				?
			</span>
		</h1>
	);
}
