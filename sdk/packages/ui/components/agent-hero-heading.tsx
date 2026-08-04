"use client";

import { useEffect, useState } from "react";

const HERO_VERBS = ["build", "create", "fix", "know"] as const;
const HERO_CYCLE_MS = 5000;

export function AgentHeroHeading() {
	const [verbIndex, setVerbIndex] = useState(0);

	useEffect(() => {
		const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
		if (media?.matches) return;
		const interval = window.setInterval(() => {
			setVerbIndex((current) => (current + 1) % HERO_VERBS.length);
		}, HERO_CYCLE_MS);
		return () => window.clearInterval(interval);
	}, []);

	const verb = HERO_VERBS[verbIndex];

	return (
		<h1
			aria-label="What would you like to build?"
			className="cline-ui-agent-hero-heading"
		>
			<span aria-hidden="true">
				What would you like to{" "}
				<span className="cline-ui-agent-hero-heading__word" key={verb}>
					{verb.split("").map((character, index) => (
						<span
							className="cline-ui-agent-hero-heading__character"
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
