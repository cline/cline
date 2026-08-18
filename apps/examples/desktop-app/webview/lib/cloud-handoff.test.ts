import { describe, expect, it } from "vitest";
import {
	parseHandoffCommand,
	readHandoffReceipt,
	shouldOpenHandoffInApp,
	validateHandoffAttachments,
} from "./cloud-handoff";

describe("cloud handoff helpers", () => {
	it("parses the bare command and preserves an optional next command", () => {
		expect(parseHandoffCommand("/handoff")).toEqual({ nextCommand: "" });
		expect(parseHandoffCommand(" /HANDOFF   continue the tests ")).toEqual({
			nextCommand: "continue the tests",
		});
		expect(parseHandoffCommand("/handoffish")).toBeNull();
		expect(parseHandoffCommand("please /handoff")).toBeNull();
	});

	it("accepts images only when a cloud command will consume them", () => {
		const image = new File(["image"], "screen.png", { type: "image/png" });
		const text = new File(["text"], "notes.txt", { type: "text/plain" });
		expect(validateHandoffAttachments([image], "inspect this")).toBeNull();
		expect(validateHandoffAttachments([image], "")).toContain("Add a command");
		expect(validateHandoffAttachments([text], "inspect this")).toContain(
			"notes.txt",
		);
	});

	it("reads completed handoff metadata into a receipt", () => {
		expect(
			readHandoffReceipt({
				handoff: {
					status: "complete",
					targetSessionId: "cloud-1",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				},
			}),
		).toEqual({
			targetSessionId: "cloud-1",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
		expect(readHandoffReceipt({ handoff: { status: "pending" } })).toBeNull();
	});

	it("only focuses an in-app target while its source is still active", () => {
		expect(shouldOpenHandoffInApp("in_app", true)).toBe(true);
		expect(shouldOpenHandoffInApp("in_app", false)).toBe(false);
		expect(shouldOpenHandoffInApp("external", true)).toBe(false);
	});
});
