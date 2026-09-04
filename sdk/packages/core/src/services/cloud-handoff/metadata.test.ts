import { describe, expect, it } from "vitest";
import {
	buildCloudHandoffDashboardUrl,
	clearCloudHandoffMetadata,
	cloudHandoffFingerprintsEqual,
	createCloudHandoffFingerprint,
	mergeCloudHandoffMetadata,
	readCloudHandoffMetadata,
} from "./metadata";

describe("cloud handoff metadata", () => {
	const fingerprint = createCloudHandoffFingerprint({
		repoUrl: " https://github.com/cline/cline ",
		branch: " main ",
		headSha: "A".repeat(40),
		modelId: " cloud/model ",
		workspaceRelativePath: "apps/desktop",
		mode: "plan",
	});

	it("merges, reads, and clears handoff metadata without losing siblings", () => {
		const merged = mergeCloudHandoffMetadata(
			{ title: "Local work", nested: { keep: true } },
			{
				toCloudSessionId: "ses-1",
				handedOffAt: "2026-08-18T12:00:00.000Z",
				status: "complete",
				innerSessionId: "inner-1",
				dashboardUrl: "https://staging-app.cline.bot/agents?sessionId=ses-1",
				fingerprint,
			},
		);

		expect(readCloudHandoffMetadata(merged)).toEqual({
			toCloudSessionId: "ses-1",
			handedOffAt: "2026-08-18T12:00:00.000Z",
			status: "complete",
			innerSessionId: "inner-1",
			dashboardUrl: "https://staging-app.cline.bot/agents?sessionId=ses-1",
			fingerprint,
		});
		expect(clearCloudHandoffMetadata(merged)).toEqual({
			title: "Local work",
			nested: { keep: true },
		});
	});

	it("rejects malformed envelopes and drops malformed optional fingerprints", () => {
		expect(readCloudHandoffMetadata({ handoff: { status: "complete" } })).toBe(
			undefined,
		);
		expect(
			readCloudHandoffMetadata({
				handoff: {
					toCloudSessionId: "ses-1",
					handedOffAt: "now",
					status: "pending",
					fingerprint: { repoUrl: "missing the rest" },
				},
			}),
		).toEqual({
			toCloudSessionId: "ses-1",
			handedOffAt: "now",
			status: "pending",
		});
	});

	it("compares fingerprints case-insensitively only for the Git SHA", () => {
		expect(
			cloudHandoffFingerprintsEqual(fingerprint, {
				...fingerprint,
				headSha: fingerprint.headSha.toLowerCase(),
			}),
		).toBe(true);
		expect(
			cloudHandoffFingerprintsEqual(fingerprint, {
				...fingerprint,
				branch: "other",
			}),
		).toBe(false);
		expect(
			cloudHandoffFingerprintsEqual(fingerprint, {
				...fingerprint,
				workspaceRelativePath: "apps/cli",
			}),
		).toBe(false);
		expect(
			cloudHandoffFingerprintsEqual(fingerprint, {
				...fingerprint,
				mode: "yolo",
			}),
		).toBe(false);
		expect(cloudHandoffFingerprintsEqual(undefined, undefined)).toBe(false);
	});

	it("preserves significant whitespace in workspace paths", () => {
		expect(
			createCloudHandoffFingerprint({
				repoUrl: "https://github.com/cline/cline",
				branch: "main",
				headSha: "a".repeat(40),
				modelId: "cloud/model",
				workspaceRelativePath: " leading/trailing ",
			}).workspaceRelativePath,
		).toBe(" leading/trailing ");
	});

	it("builds an environment-specific dashboard URL", () => {
		expect(
			buildCloudHandoffDashboardUrl(
				"https://staging-app.cline.bot/base",
				"ses-1",
			),
		).toBe("https://staging-app.cline.bot/agents?sessionId=ses-1");
	});

	it("rejects empty required fingerprint and session id fields", () => {
		expect(() =>
			createCloudHandoffFingerprint({
				repoUrl: "",
				branch: "main",
				headSha: "a".repeat(40),
				modelId: "model",
			}),
		).toThrow("cannot be empty");
		expect(() =>
			buildCloudHandoffDashboardUrl("https://app.cline.bot", " "),
		).toThrow("cannot be empty");
	});
});
