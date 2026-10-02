import { describe, expect, it } from "vitest";
import {
	HUB_COMMAND_NAMES,
	HUB_EVENT_NAMES,
	hubCommands,
	validateHubCommandPayload,
} from ".";

describe("validateHubCommandPayload", () => {
	it("rejects a payload missing a required field with a readable message", () => {
		const result = validateHubCommandPayload("approval.respond", {
			approved: true,
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.issues).toEqual([
			expect.objectContaining({ path: "approvalId" }),
		]);
		expect(result.message).toMatch(
			/^Invalid approval\.respond payload: approvalId: /,
		);
	});

	it("rejects a mistyped field", () => {
		const result = validateHubCommandPayload("session.search", {
			query: 42,
		});
		expect(result.ok).toBe(false);
	});

	it("passes unknown fields through so newer clients stay compatible", () => {
		expect(
			validateHubCommandPayload("approval.respond", {
				approvalId: "approval-1",
				approved: true,
				addedInAFutureRelease: { anything: true },
			}),
		).toEqual({ ok: true });
	});

	it("treats a missing payload as empty", () => {
		expect(validateHubCommandPayload("client.list", undefined)).toEqual({
			ok: true,
		});
	});

	it("leaves commands without a contract to the dispatcher", () => {
		expect(validateHubCommandPayload("not.a.command", { x: 1 })).toEqual({
			ok: true,
		});
	});
});

describe("hub contract registry", () => {
	it("declares each command and event once with a description", () => {
		expect(new Set(HUB_COMMAND_NAMES).size).toBe(HUB_COMMAND_NAMES.length);
		expect(new Set(HUB_EVENT_NAMES).size).toBe(HUB_EVENT_NAMES.length);
		for (const name of HUB_COMMAND_NAMES) {
			expect(hubCommands[name].description, name).toMatch(/\S/);
		}
	});
});
