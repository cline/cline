import { describe, expect, it } from "vitest";
import {
	factoryCandidateSchema,
	factoryTaskConfigSchema,
	factoryVerificationProfileSchema,
} from "./factory";
import {
	factoryPathsTouchUi,
	factoryVisualProof,
} from "./factory-visual-proof";

const shot = { label: "Home", path: "proof/home.png", mimeType: "image/png" };
const video = {
	label: "Walkthrough",
	path: "proof/walk.webm",
	mimeType: "video/webm",
};
const profile = {
	profile: factoryVerificationProfileSchema.parse({
		schemaVersion: 1,
		environment: { start: "bun run dev" },
		exercise: "Open the home page.",
	}),
	hash: "a".repeat(64),
	origin: "repository" as const,
};
const config = (extra: Record<string, unknown> = {}) =>
	factoryTaskConfigSchema.parse({
		verificationProfile: profile,
		visualProofPlan: { needed: true, reason: "Changes the home page" },
		...extra,
	});
const candidate = (
	artifacts: unknown[] | undefined,
	extra: Record<string, unknown> = {},
) =>
	factoryCandidateSchema.parse({
		commit: "c",
		checks: [],
		reviews: [],
		...(artifacts
			? {
					verification: {
						sessionId: "tester",
						artifacts,
						review: { verdict: "pass", summary: "Looked", findings: [] },
					},
				}
			: {}),
		...extra,
	});

describe("factoryPathsTouchUi", () => {
	it("recognises markup, component and style files", () => {
		expect(factoryPathsTouchUi(["src/a.ts", "README.md"])).toBe(false);
		expect(factoryPathsTouchUi(["src/a.ts", "web/Button.TSX"])).toBe(true);
		expect(factoryPathsTouchUi(["styles/site.scss"])).toBe(true);
	});
});

describe("factoryVisualProof", () => {
	it("is not required when the workflow turns it off, nothing was built, or nothing a person sees changed", () => {
		const built = { candidate: candidate([]) };
		expect(factoryVisualProof(config({ visualProof: false }), built)).toEqual({
			status: "not_required",
		});
		expect(factoryVisualProof(config(), {})).toEqual({
			status: "not_required",
		});
		expect(
			factoryVisualProof(
				config({ visualProofPlan: { needed: false, reason: "API only" } }),
				{ candidate: candidate([], { changedPaths: ["src/api.ts"] }) },
			),
		).toEqual({ status: "not_required" });
	});

	it("is required by UI files the commit changed even when the scoper said no", () => {
		expect(
			factoryVisualProof(
				config({ visualProofPlan: { needed: false, reason: "API only" } }),
				{ candidate: candidate([], { changedPaths: ["web/page.css"] }) },
			).status,
		).toBe("missing");
	});

	it("is required by a UI check when the scoper did not answer", () => {
		const uiCheck = {
			name: "Screens",
			kind: "ui",
			command: "bun run shots",
			status: "passed",
			exitCode: 0,
			output: "",
			artifacts: [shot],
		};
		expect(
			factoryVisualProof(config({ visualProofPlan: undefined }), {
				candidate: candidate([video], { checks: [uiCheck] }),
			}),
		).toEqual({ status: "shown", screenshots: [shot], recordings: [video] });
	});

	it("says why proof is missing, first reason that applies", () => {
		const reason = (
			proofConfig: ReturnType<typeof config>,
			built: ReturnType<typeof candidate>,
		) => {
			const proof = factoryVisualProof(proofConfig, { candidate: built });
			return proof.status === "missing" ? proof.reason : proof.status;
		};
		expect(reason(config(), candidate(undefined))).toBe(
			"The tester did not run for this card.",
		);
		expect(
			reason(config({ verificationProfile: undefined }), candidate([])),
		).toBe("This project has no app setup for the tester.");
		expect(
			reason(
				config(),
				candidate([shot], {
					verification: {
						sessionId: "tester",
						artifacts: [shot],
						captureNote: "The browser could not reach the app.",
						review: { verdict: "pass", summary: "Looked", findings: [] },
					},
				}),
			),
		).toBe("The browser could not reach the app.");
		expect(reason(config(), candidate([shot]))).toBe(
			"The tester took screenshots but no recording.",
		);
		expect(reason(config(), candidate([]))).toBe(
			"The tester did not capture the app.",
		);
	});

	it("returns the media it has when proof is missing", () => {
		expect(
			factoryVisualProof(config(), { candidate: candidate([shot]) }),
		).toMatchObject({ status: "missing", screenshots: [shot], recordings: [] });
	});
});
