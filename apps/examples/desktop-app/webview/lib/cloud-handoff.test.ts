import { describe, expect, it } from "vitest";
import {
	buildHandoffWarningToast,
	isExpectedHandoffSourceActive,
	parseHandoffCommand,
	readHandoffReceipt,
	readPendingHandoffRecovery,
	shouldOpenHandoffInApp,
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

	it("accepts images only when a cloud command will consume them", () => {
		const image = new File(["image"], "screen.png", { type: "image/png" });
		const text = new File(["text"], "notes.txt", { type: "text/plain" });
		expect(validateHandoffAttachments([image], "inspect this")).toBeNull();
		expect(validateHandoffAttachments([image], "")).toContain("Add a command");
		expect(validateHandoffAttachments([text], "inspect this")).toContain(
			"notes.txt",
		);
	});

	it.each([
		[[3_932_160], null],
		[[3_932_161], "Each image"],
		[[3_145_728, 3_145_728], null],
		[[3_145_728, 3_145_729], "in total"],
		[[1, 1, 1, 1, 1], null],
		[[1, 1, 1, 1, 1, 1], "up to 5"],
	] as const)("validates cloud attachment limits for %j bytes", (sizes, error) => {
		const files = sizes.map(
			(size) =>
				new File([new Uint8Array(size)], "image.png", { type: "image/png" }),
		);
		const result = validateHandoffAttachments(files, "inspect");
		if (error) expect(result).toContain(error);
		else expect(result).toBeNull();
	});

	it("uses the existing image format detection for handoff", () => {
		expect(
			validateHandoffAttachments(
				[new File(["image"], "image.jfif")],
				"inspect",
			),
		).toBeNull();
		expect(
			validateHandoffAttachments(
				[new File(["image"], "image.svg", { type: "image/svg+xml" })],
				"inspect",
			),
		).toContain("image.svg");
	});

	it("reads completed handoff metadata into a receipt", () => {
		expect(
			readHandoffReceipt({
				handoff: {
					status: "complete",
					toCloudSessionId: "cloud-1",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
				},
			}),
		).toEqual({
			targetSessionId: "cloud-1",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-1",
		});
		expect(readHandoffReceipt({ handoff: { status: "pending" } })).toBeNull();
	});

	it("reads pending handoff metadata into restart recovery", () => {
		expect(
			readPendingHandoffRecovery({
				handoff: {
					status: "pending",
					toCloudSessionId: "cloud-pending",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-pending",
				},
			}),
		).toEqual({
			targetSessionId: "cloud-pending",
			dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-pending",
		});
		expect(
			readPendingHandoffRecovery({
				handoff: {
					status: "complete",
					toCloudSessionId: "cloud-complete",
					dashboardUrl: "https://app.cline.bot/agents?sessionId=cloud-complete",
				},
			}),
		).toBeNull();
	});

	it("only focuses an in-app target while its source is still active", () => {
		expect(shouldOpenHandoffInApp("in_app", true)).toBe(true);
		expect(shouldOpenHandoffInApp("in_app", false)).toBe(false);
		expect(shouldOpenHandoffInApp("external", true)).toBe(false);
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
	it("returns no toast for a clean completion payload", () => {
		expect(buildHandoffWarningToast({})).toBeNull();
		expect(buildHandoffWarningToast({ warning: "   " })).toBeNull();
	});
});
