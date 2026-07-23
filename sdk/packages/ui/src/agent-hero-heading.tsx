import { useEffect, useMemo, useState } from "react";
import { cx } from "./utils.js";

const DEFAULT_VERBS = ["build", "create", "fix", "know"] as const;
const DEFAULT_CYCLE_MS = 2600;
const MINIMUM_CYCLE_MS = 500;

function splitGraphemes(value: string): string[] {
	if (typeof Intl.Segmenter === "function") {
		return Array.from(
			new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value),
			({ segment }) => segment,
		);
	}
	return Array.from(value);
}

export interface AgentHeroHeadingProps {
	ariaLabel?: string;
	className?: string;
	cycleMs?: number;
	leadingText?: string;
	trailingText?: string;
	verbs?: readonly string[];
}

/** The shared Cline welcome heading used by agent start surfaces. */
export function AgentHeroHeading({
	ariaLabel,
	className,
	cycleMs = DEFAULT_CYCLE_MS,
	leadingText = "What would you like to ",
	trailingText = "?",
	verbs = DEFAULT_VERBS,
}: AgentHeroHeadingProps) {
	const availableVerbs = useMemo(
		() =>
			Array.from(
				new Set(
					verbs.map((verb) => verb.trim()).filter((verb) => verb.length > 0),
				),
			),
		[verbs],
	);
	const safeCycleMs = Number.isFinite(cycleMs)
		? Math.max(MINIMUM_CYCLE_MS, cycleMs)
		: DEFAULT_CYCLE_MS;
	const [verbIndex, setVerbIndex] = useState(0);

	useEffect(() => {
		if (availableVerbs.length <= 1) return;
		if (typeof window.matchMedia !== "function") return;
		const motionPreference = window.matchMedia(
			"(prefers-reduced-motion: reduce)",
		);
		let interval: number | undefined;
		const stopCycling = () => {
			if (interval === undefined) return;
			window.clearInterval(interval);
			interval = undefined;
		};
		const startCycling = () => {
			if (motionPreference.matches || interval !== undefined) return;
			interval = window.setInterval(() => {
				setVerbIndex((current) => (current + 1) % availableVerbs.length);
			}, safeCycleMs);
		};
		const handleMotionPreference = () => {
			if (motionPreference.matches) stopCycling();
			else startCycling();
		};

		startCycling();
		motionPreference.addEventListener("change", handleMotionPreference);
		return () => {
			motionPreference.removeEventListener("change", handleMotionPreference);
			stopCycling();
		};
	}, [availableVerbs.length, safeCycleMs]);

	const verb = availableVerbs[verbIndex % availableVerbs.length] ?? "build";
	const accessibleText =
		ariaLabel ?? `${leadingText}${availableVerbs[0] ?? "build"}${trailingText}`;

	return (
		<h1 className={cx("cline-ui-hero-heading", className)}>
			<span className="cline-ui-sr-only">{accessibleText}</span>
			<span aria-hidden="true">
				{leadingText}
				<span className="cline-ui-hero-heading__word" key={verb}>
					{splitGraphemes(verb).map((character, index) => (
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
				{trailingText}
			</span>
		</h1>
	);
}
