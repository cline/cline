import { describe, expect, it } from "vitest";
import type { CloudStartJob } from "@/state/cloud-starts";
import { isCloudStartRecoveryCandidate } from "./cloud-start-recovery";
import type { SessionRow } from "./session-rows";

const job: CloudStartJob = {
	id: "unknown-create",
	phase: "error",
	recovery: "check-sessions",
	target: {
		id: "cloud-target",
		mode: "cloud",
		repoUrl: "https://github.com/cline/cline.git",
		label: "cline/cline",
		modelId: "cline/model",
		organizationId: "org-1",
	},
	message: "Finish mobile parity",
	createdAt: 1,
	error: "The create result is unknown.",
};

function row(overrides: Partial<SessionRow> = {}): SessionRow {
	return {
		key: "cloud-row",
		kind: "session",
		title: "Finish mobile parity",
		location: { kind: "cloud", name: "cline/cline" },
		online: true,
		descriptor: {
			mode: "cloud",
			url: "https://api.cline.bot/api/v1/session/remote-1",
			remoteSessionId: "remote-1",
			organizationId: "org-1",
		},
		...overrides,
	};
}

describe("isCloudStartRecoveryCandidate", () => {
	it("requires the unknown-create job's account and repository", () => {
		expect(isCloudStartRecoveryCandidate(job, row())).toBe(true);
		expect(
			isCloudStartRecoveryCandidate(
				job,
				row({
					descriptor: {
						...row().descriptor,
						organizationId: "org-2",
					},
				}),
			),
		).toBe(false);
		expect(
			isCloudStartRecoveryCandidate(job, {
				...row(),
				location: { kind: "cloud", name: "cline/other" },
			}),
		).toBe(false);
	});

	it("never grants recovery authority to an ordinary failed job", () => {
		expect(
			isCloudStartRecoveryCandidate({ ...job, recovery: undefined }, row()),
		).toBe(false);
	});
	it("does not lose the saved request by launching an ended workspace", () => {
		for (const status of ["expired", "failed", "stopped"] as const) {
			expect(isCloudStartRecoveryCandidate(job, row({ status }))).toBe(false);
		}
	});
});
