import { describe, expect, it } from "vitest";
import {
	buildHandoffWarningToast,
	isExpectedHandoffSourceActive,
	parseHandoffCommand,
	validateHandoffAttachments,
} from "./cloud-handoff";

describe("cloud handoff helpers", () => {
	it("parses the bare command and preserves an optional next command", () => {
		expect(parseHandoffCommand("/cloud")).toEqual({ nextCommand: "" });
		expect(parseHandoffCommand(" /CLOUD   continue the tests ")).toEqual({
			nextCommand: "continue the tests",
		});
		expect(parseHandoffCommand("/cloudish")).toBeNull();
		expect(parseHandoffCommand("please /cloud")).toBeNull();
	});

	it("accepts invocation images with or without an explicit follow-up", () => {
		const image = new File(["image"], "screen.png", { type: "image/png" });
		const text = new File(["text"], "notes.txt", { type: "text/plain" });
		expect(validateHandoffAttachments([image])).toBeNull();
		expect(validateHandoffAttachments([text])).toContain("notes.txt");
		expect(validateHandoffAttachments(Array(6).fill(image))).toContain(
			"up to 5",
		);
	});

	it("only restores a late handoff into the expected active chat thread", () => {
		expect(
			isExpectedHandoffSourceActive(undefined, "thread-b", "settings"),
		).toBe(true);
		expect(isExpectedHandoffSourceActive("thread-a", "thread-a", "chat")).toBe(
			true,
		);
		expect(isExpectedHandoffSourceActive("thread-a", "thread-b", "chat")).toBe(
			false,
		);
		expect(
			isExpectedHandoffSourceActive("thread-a", "thread-a", "settings"),
		).toBe(false);
	});
});

describe("handoff completion warnings", () => {
	it.each([
		"unqueued",
		"unconfirmed",
	] as const)("describes %s delivery without including the saved prompt", (warningKind) => {
		expect(
			buildHandoffWarningToast({ warning: "Could not send.", warningKind }),
		).toEqual({
			title: "Handoff completed with a warning",
			description:
				warningKind === "unqueued"
					? "Could not send. The prepared prompt was kept in the cloud session."
					: "Could not send.",
			...(warningKind === "unconfirmed" ? { variant: "destructive" } : {}),
		});
	});
	it("returns no toast for a clean completion payload", () => {
		expect(buildHandoffWarningToast({})).toBeNull();
		expect(buildHandoffWarningToast({ warning: "   " })).toBeNull();
	});
});
