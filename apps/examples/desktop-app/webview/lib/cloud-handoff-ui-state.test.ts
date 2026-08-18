import { describe, expect, it } from "vitest";
import { cloudHandoffUiReducer } from "./cloud-handoff-ui-state";

describe("cloudHandoffUiReducer", () => {
	it("keeps a source locked across pane remounts and preserves its latest phase", () => {
		const creating = cloudHandoffUiReducer(
			{},
			{
				type: "progress",
				sourceSessionId: "local-1",
				phase: "creating",
			},
		);
		const provisioning = cloudHandoffUiReducer(creating, {
			type: "progress",
			sourceSessionId: "local-1",
			phase: "provisioning",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
		expect(provisioning["local-1"]).toMatchObject({
			status: "progress",
			phase: "provisioning",
		});
	});

	it("turns failed external progress into recovery without exposing in-app URLs", () => {
		const progress = cloudHandoffUiReducer(
			{},
			{
				type: "progress",
				sourceSessionId: "local-1",
				phase: "verifying",
				dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			},
		);
		const recovery = cloudHandoffUiReducer(progress, {
			type: "failed",
			sourceSessionId: "local-1",
			exposeRecovery: true,
			retryDraft: "/handoff continue",
		});
		expect(recovery["local-1"]).toEqual({
			status: "recovery",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
			retryDraft: "/handoff continue",
			retryAttachments: undefined,
		});
		expect(
			cloudHandoffUiReducer(recovery, {
				type: "retry_restored",
				sourceSessionId: "local-1",
			})["local-1"],
		).toEqual({
			status: "recovery",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
		expect(
			cloudHandoffUiReducer(progress, {
				type: "failed",
				sourceSessionId: "local-1",
				exposeRecovery: false,
			})["local-1"],
		).toEqual({
			status: "failed",
			retryDraft: undefined,
			retryAttachments: undefined,
		});
	});
});
