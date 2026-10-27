/** Real Hub dispatch, with scripted turns; no Cloud REST or model invocation. */
import { startTestHub, type TestHub } from "@cline/hub-testkit";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTestHubSession } from "../session/__testing__/test-hub-handle";
import { SessionConnection } from "../session/session-connection";
import { SessionConnectionController } from "./controller";

let hub: TestHub | undefined;
const clients: { dispose(): void }[] = [];
afterEach(async () => {
	for (const client of clients.splice(0)) client.dispose();
	await hub?.close();
	vi.restoreAllMocks();
});
async function owner() {
	if (!hub) throw new Error("Test Hub missing");
	const connection = new SessionConnection({
		handle: await resolveTestHubSession(hub),
	});
	clients.push(connection);
	await connection.start();
	await connection.sendInput("Create shared conversation");
	return connection;
}
async function mobile() {
	if (!hub) throw new Error("Test Hub missing");
	const handle = await resolveTestHubSession(hub);
	const controller = new SessionConnectionController(
		{ mode: "cloud", url: hub.url, reasoning: "high" },
		{},
		handle,
	);
	clients.push(controller);
	await controller.start();
	return { controller, handle };
}
async function otherClientChoosesLow(connection: SessionConnection) {
	const sessionId = connection.handle.hubSessionId;
	if (!sessionId) throw new Error("Shared session missing");
	await connection.handle.client.command(
		"session.update_connection",
		{
			sessionId,
			updates: {
				thinking: true,
				reasoningEffort: "low",
				thinkingBudgetTokens: null,
			},
		},
		sessionId,
	);
}

describe("reasoning ownership across clients", () => {
	it("ignores saved mobile High when reopening an existing session", async () => {
		hub = await startTestHub();
		const first = await owner();
		const update = vi.spyOn(hub.runtimeHost, "updateSessionConnection");
		await otherClientChoosesLow(first);
		const { controller } = await mobile();
		expect(controller.getSnapshot().pendingReasoning).toBeUndefined();
		await controller.sendInput("Keep the current session setting");
		expect(update).toHaveBeenCalledTimes(1);
		expect(update.mock.calls[0]?.[1]).toMatchObject({ reasoningEffort: "low" });
	});
	it("applies an explicit choice once, then preserves a newer other-client setting", async () => {
		hub = await startTestHub();
		const first = await owner();
		const { controller } = await mobile();
		const update = vi.spyOn(hub.runtimeHost, "updateSessionConnection");
		controller.setReasoningChoice("high");
		expect(controller.getSnapshot().pendingReasoning).toBe("high");
		await controller.sendInput("Apply my explicit choice");
		expect(update.mock.calls[0]?.[1]).toMatchObject({
			reasoningEffort: "high",
		});
		expect(controller.getSnapshot().pendingReasoning).toBeUndefined();
		await otherClientChoosesLow(first);
		await controller.sendInput("Keep the newer setting");
		expect(update).toHaveBeenCalledTimes(2);
		expect(update.mock.calls[1]?.[1]).toMatchObject({ reasoningEffort: "low" });
	});
	it("retains a rejected explicit choice through reconnect until acknowledgement", async () => {
		hub = await startTestHub();
		await owner();
		const { controller, handle } = await mobile();
		const original = handle.client.command.bind(handle.client);
		let rejectUpdate = true;
		vi.spyOn(handle.client, "command").mockImplementation((...args) => {
			if (args[0] === "session.update_connection" && rejectUpdate) {
				rejectUpdate = false;
				return Promise.reject(new Error("temporary connection loss"));
			}
			return original(...args);
		});
		controller.setReasoningChoice("none");
		await controller.sendInput("Wait for settings acknowledgement");
		expect(controller.getSnapshot().pendingReasoning).toBe("none");
		await controller.reconnect();
		expect(controller.getSnapshot().pendingReasoning).toBe("none");
		await controller.sendInput("Retry with the explicit choice");
		expect(controller.getSnapshot().pendingReasoning).toBeUndefined();
	});
	it("does not consume a newer edit while an earlier update is being acknowledged", async () => {
		hub = await startTestHub();
		await owner();
		const { controller, handle } = await mobile();
		const original = handle.client.command.bind(handle.client);
		vi.spyOn(handle.client, "command").mockImplementation(async (...args) => {
			const reply = await original(...args);
			if (args[0] === "session.update_connection")
				controller.setReasoningChoice("low");
			return reply;
		});
		controller.setReasoningChoice("high");
		await controller.sendInput("Send High while another edit arrives");
		expect(controller.getSnapshot().pendingReasoning).toBe("low");
	});
	it("uses a saved new-conversation default for the first send only", async () => {
		hub = await startTestHub();
		const update = vi.spyOn(hub.runtimeHost, "updateSessionConnection");
		const { controller } = await mobile();
		expect(controller.getSnapshot().pendingReasoning).toBe("high");
		await controller.sendInput("New conversation");
		await controller.sendInput("Continue");
		expect(update).toHaveBeenCalledTimes(1);
		expect(controller.getSnapshot().pendingReasoning).toBeUndefined();
	});
});
