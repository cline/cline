import { describe, expect, it, vi } from "vitest";
import type { CloudRuntimeState } from "../../runtime/cloud/runtime";
import {
	classifyCloudInput,
	dispatchCloudSessionCommand,
} from "./cloud-view-helpers";

function fixture() {
	const state = {
		target: { kind: "cloud", sessionId: "outer-A", scopeKey: "org-A" },
		session: {
			approvals: [
				{ approvalId: "server-approval", toolName: "execute_command" },
			],
			promptsInQueue: [
				{ id: "server-prompt", prompt: "@private.txt /skill", steer: false },
			],
		},
	} as CloudRuntimeState;
	const runtime = {
		getSnapshot: () => state,
		stop: vi.fn(async () => {}),
		respondApproval: vi.fn(async () => {}),
		updatePendingPrompt: vi.fn(async () => {}),
		removePendingPrompt: vi.fn(async () => {}),
	};
	return { state, runtime };
}

describe("cloud input and server-owned interactions", () => {
	it.each([
		"read @private.txt",
		"use /skill here",
		"!cat ~/.ssh/key",
		"fix /Users/me/main",
		"/Users/me/main/file.txt",
		"line one\nline two",
	])("preserves literal text: %s", (text) => {
		expect(classifyCloudInput(text)).toEqual({ argument: text });
	});
	it("recognizes unsupported local command syntax without submitting it", () => {
		expect(classifyCloudInput(" /plugins install x ")).toEqual({
			command: "plugins",
			argument: "install x",
		});
	});
	it("responds only to explicit decisions using the server approval ID", async () => {
		const { state, runtime } = fixture();
		await expect(
			dispatchCloudSessionCommand(runtime, state, "approve", "1"),
		).resolves.toBe(true);
		expect(runtime.respondApproval).toHaveBeenCalledWith(
			"server-approval",
			true,
		);
		await dispatchCloudSessionCommand(runtime, state, "reject", "1");
		expect(runtime.respondApproval).toHaveBeenLastCalledWith(
			"server-approval",
			false,
		);
	});
	it("detach and unrelated commands do not answer pending approvals", async () => {
		const { state, runtime } = fixture();
		for (const command of [
			"quit",
			"local",
			"cloud",
			"account",
			"model",
			"plugins",
		])
			await expect(
				dispatchCloudSessionCommand(runtime, state, command, ""),
			).resolves.toBe(false);
		expect(runtime.respondApproval).not.toHaveBeenCalled();
		expect(runtime.stop).not.toHaveBeenCalled();
	});
	it("rejects stale actions after switching targets before any mutation", async () => {
		const { state, runtime } = fixture();
		runtime.getSnapshot = () => ({
			...state,
			target: { kind: "cloud", sessionId: "outer-B", scopeKey: "org-B" },
		});
		await expect(
			dispatchCloudSessionCommand(runtime, state, "approve", "1"),
		).rejects.toThrow("session changed");
		expect(runtime.respondApproval).not.toHaveBeenCalled();
	});
	it("rejects missing approval indices without inventing a denial", async () => {
		const { state, runtime } = fixture();
		for (const argument of ["", "-1", "0", "2", "1.2", "1junk"])
			await expect(
				dispatchCloudSessionCommand(runtime, state, "reject", argument),
			).rejects.toThrow("approval number");
		expect(runtime.respondApproval).not.toHaveBeenCalled();
	});
	it("steers literal queued text and removes by server ID", async () => {
		const { state, runtime } = fixture();
		await dispatchCloudSessionCommand(runtime, state, "steer", "1");
		expect(runtime.updatePendingPrompt).toHaveBeenCalledWith(
			"server-prompt",
			"@private.txt /skill",
			"steer",
		);
		await dispatchCloudSessionCommand(runtime, state, "remove", "1");
		expect(runtime.removePendingPrompt).toHaveBeenCalledWith("server-prompt");
	});
	it("explicit Stop invokes one remote stop", async () => {
		const { state, runtime } = fixture();
		await dispatchCloudSessionCommand(runtime, state, "stop", "");
		expect(runtime.stop).toHaveBeenCalledTimes(1);
	});
});
