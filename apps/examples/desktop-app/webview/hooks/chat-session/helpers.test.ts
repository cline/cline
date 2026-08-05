import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { inferHydratedChatStatus } from "./helpers";

function message(role: "user" | "assistant", content: string): ChatMessage {
	return {
		id: `${role}-${content}`,
		sessionId: "session-1",
		role,
		content,
		createdAt: 1,
	};
}

describe("inferHydratedChatStatus", () => {
	it("keeps a running session running after an assistant message", () => {
		expect(
			inferHydratedChatStatus("running", [
				message("user", "Inspect the repository"),
				message("assistant", "I will inspect it now."),
			]),
		).toBe("running");
	});

	it.each([
		["completed", "completed"],
		["failed", "failed"],
		["cancelled", "cancelled"],
		["idle", "idle"],
	] as const)("maps %s history state to %s", (history, expected) => {
		expect(inferHydratedChatStatus(history, [])).toBe(expected);
	});
});
