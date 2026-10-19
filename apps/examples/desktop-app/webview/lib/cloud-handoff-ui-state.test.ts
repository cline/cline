import { expect, it } from "vitest";
import { cloudHandoffUiReducer } from "./cloud-handoff-ui-state";

it("keeps the cloud link across local sends until dismissed or another handoff starts", () => {
	const start = { type: "start", sourceSessionId: "local" } as const;
	const state = cloudHandoffUiReducer({}, start);
	const complete = cloudHandoffUiReducer(state, {
		type: "complete",
		sourceSessionId: "local",
		sessionId: "cloud",
		dashboardUrl: "https://app.cline.bot/agents/cloud",
	});
	expect(complete.local).toMatchObject({
		status: "complete",
		sessionId: "cloud",
	});
	expect(
		cloudHandoffUiReducer(complete, {
			type: "local_prompt_delivered",
			sourceSessionId: "local",
		}),
	).toEqual(complete);
	expect(
		cloudHandoffUiReducer(complete, {
			type: "dismiss",
			sourceSessionId: "local",
		}),
	).toEqual({});
	expect(cloudHandoffUiReducer(complete, start)).toEqual(state);
});

it("retains failed input until restored and clears it after a local send", () => {
	const attachments = [
		new File(["image"], "screen.png", { type: "image/png" }),
	];
	const failed = cloudHandoffUiReducer(
		{},
		{
			type: "failed",
			sourceSessionId: "local",
			message: "Summary failed",
			retryDraft: "continue",
			retryAttachments: attachments,
		},
	);
	const restored = cloudHandoffUiReducer(failed, {
		type: "retry_restored",
		sourceSessionId: "local",
	});
	expect(
		cloudHandoffUiReducer(failed, {
			type: "local_prompt_delivered",
			sourceSessionId: "local",
		}),
	).toEqual(failed);
	expect(restored.local).toEqual({
		status: "retry_restored",
		message: "Summary failed",
		retryDraft: "continue",
		retryAttachments: attachments,
	});
	expect(
		cloudHandoffUiReducer(restored, {
			type: "local_prompt_delivered",
			sourceSessionId: "local",
		}),
	).toEqual({});
});
