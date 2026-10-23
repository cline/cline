import { describe, expect, it } from "vitest";
import {
	clearPendingHomeMessage,
	descriptorAfterHomeSubmission,
	descriptorWithResolvedSession,
	readPendingHomeMessage,
	readPendingHomeSubmission,
	stagePendingHomeMessage,
	stagePendingHomeSubmission,
	updatePendingHomeAttachments,
} from "./pending-home-message";

describe("pending Home messages", () => {
	it("retains first-create authority across a failed lazy create until a session is pinned", () => {
		const fresh = {
			mode: "cloud" as const,
			url: "https://session.cline.bot",
			allowInitialCreate: true,
			pendingInitialMessage: "First request",
		};
		const beforeCreate = descriptorAfterHomeSubmission(fresh);
		expect(beforeCreate).toMatchObject({ allowInitialCreate: true });
		expect(beforeCreate).not.toHaveProperty("pendingInitialMessage");
		expect(
			descriptorAfterHomeSubmission(fresh, "canonical-task"),
		).not.toHaveProperty("allowInitialCreate");
		expect(
			descriptorWithResolvedSession(fresh, "canonical-task", true),
		).not.toHaveProperty("allowInitialCreate");
	});
	it("keeps prompt text behind an opaque id until chat consumes it", () => {
		const text = "Do not put this prompt in navigation state";
		const id = stagePendingHomeMessage(text);
		expect(id).not.toContain(text);
		expect(readPendingHomeMessage(id)).toBe(text);
		clearPendingHomeMessage(id);
		expect(readPendingHomeMessage(id)).toBeUndefined();
	});

	it("does not resurrect a consumed durable prompt while pinning its session", () => {
		expect(
			descriptorWithResolvedSession(
				{
					mode: "cloud",
					url: "https://session.cline.bot",
					pendingInitialMessage: "Send exactly once",
				},
				"inner-1",
				true,
			),
		).toEqual({
			mode: "cloud",
			url: "https://session.cline.bot",
			hubSessionId: "inner-1",
		});
	});

	it("pins a process-local Home launch after its session resolves", () => {
		expect(
			descriptorAfterHomeSubmission(
				{ mode: "local", url: "ws://192.168.1.2:4242" },
				"inner-local-1",
			),
		).toEqual({
			mode: "local",
			url: "ws://192.168.1.2:4242",
			hubSessionId: "inner-local-1",
		});
	});

	it("forces a durable clear retry after memory was already updated", () => {
		const alreadyClearedInMemory = {
			mode: "cloud" as const,
			url: "https://session.cline.bot",
		};
		expect(
			descriptorAfterHomeSubmission(alreadyClearedInMemory, undefined, true),
		).toEqual(alreadyClearedInMemory);
	});

	it("keeps image attachments out of navigation state with the prompt", () => {
		const id = stagePendingHomeSubmission({
			text: "",
			attachments: { userImages: ["data:image/jpeg;base64,/9j/"] },
		});
		expect(readPendingHomeSubmission(id)).toEqual({
			text: "",
			attachments: { userImages: ["data:image/jpeg;base64,/9j/"] },
		});
	});

	it("forgets an image removed before its target connection is ready", () => {
		const id = stagePendingHomeSubmission({
			text: "Inspect this",
			attachments: { userImages: ["data:image/jpeg;base64,/9j/"] },
		});
		updatePendingHomeAttachments(id, []);
		expect(readPendingHomeSubmission(id)).toEqual({ text: "Inspect this" });
	});

	it("bounds abandoned navigation messages", () => {
		const ids = Array.from({ length: 9 }, (_, index) =>
			stagePendingHomeMessage(`message ${index}`),
		);
		expect(readPendingHomeMessage(ids[0] ?? "")).toBeUndefined();
		expect(readPendingHomeMessage(ids[8] ?? "")).toBe("message 8");
	});
});
