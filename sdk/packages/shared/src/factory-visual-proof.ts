import type {
	FactoryArtifact,
	FactoryRunState,
	FactoryTaskConfig,
} from "./factory";

/**
 * Whether a delivered change to the UI carries a screenshot and a recording.
 * Derived on read from the card's config and its run state; never stored.
 */
export type FactoryVisualProof =
	| { status: "not_required" }
	| {
			status: "shown" | "missing";
			screenshots: FactoryArtifact[];
			recordings: FactoryArtifact[];
			/** Why proof is missing: one plain sentence. */
			reason?: string;
	  };

const UI_EXTENSIONS = [
	".tsx",
	".jsx",
	".vue",
	".svelte",
	".astro",
	".html",
	".css",
	".scss",
	".sass",
	".less",
];

/** Whether any changed path is one a person sees rendered (markup, styles, components). */
export function factoryPathsTouchUi(paths: readonly string[]): boolean {
	return paths.some((path) => {
		const lower = path.toLowerCase();
		return UI_EXTENSIONS.some((extension) => lower.endsWith(extension));
	});
}

/**
 * Proof is required when the workflow does not turn it off and either the
 * scoper said the change alters what a person sees (`visualProofPlan`), the
 * candidate changed UI files (factoryPathsTouchUi), or, for a card scoped
 * without an answer, a plan check is a UI check. Before a candidate exists
 * this is `not_required`: there is nothing delivered to judge yet, and a
 * person only sees the result for delivered cards. `missing` still returns
 * whatever media exists. The tester's absence is read from the candidate
 * (`verification`), which records what ran.
 */
export function factoryVisualProof(
	config: Pick<
		FactoryTaskConfig,
		"visualProof" | "visualProofPlan" | "agents" | "verificationProfile"
	>,
	state: Pick<FactoryRunState, "candidate">,
): FactoryVisualProof {
	const candidate = state.candidate;
	if (config.visualProof === false || !candidate)
		return { status: "not_required" };
	const plan = config.visualProofPlan;
	const required =
		plan?.needed ||
		factoryPathsTouchUi(candidate.changedPaths ?? []) ||
		(!plan && candidate.checks.some((check) => check.kind === "ui"));
	if (!required) return { status: "not_required" };
	const artifacts = [
		...(candidate.verification?.artifacts ?? []),
		...candidate.checks.flatMap((check) => check.artifacts),
	];
	const screenshots = artifacts.filter((artifact) =>
		artifact.mimeType.startsWith("image/"),
	);
	const recordings = artifacts.filter((artifact) =>
		artifact.mimeType.startsWith("video/"),
	);
	if (screenshots.length && recordings.length)
		return { status: "shown", screenshots, recordings };
	const reason = !candidate.verification
		? "The tester did not run for this card."
		: !config.verificationProfile
			? "This project has no app setup for the tester."
			: (candidate.verification.captureNote ??
				(screenshots.length
					? "The tester took screenshots but no recording."
					: "The tester did not capture the app."));
	return { status: "missing", screenshots, recordings, reason };
}
