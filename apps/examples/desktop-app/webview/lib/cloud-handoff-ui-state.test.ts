import { expect, it } from "vitest";
import { cloudHandoffUiReducer } from "./cloud-handoff-ui-state";

it("keeps the cloud link until dismissed or another handoff starts", () => {
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
			type: "dismiss",
			sourceSessionId: "local",
		}),
	).toEqual({});
	const preparing = cloudHandoffUiReducer(complete, {
		type: "prepare",
		sourceSessionId: "local",
	});
	expect(preparing.local).toMatchObject({ ...complete.local, preparing: true });
	expect(cloudHandoffUiReducer(preparing, start)).toEqual(state);
});
