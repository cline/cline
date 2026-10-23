import { describe, expect, it, vi } from "vitest";
import { createCloudSessionHandle } from "./cloud-handle";
import { SessionConnectionController } from "./controller";

vi.mock("./cloud-handle", () => ({ createCloudSessionHandle: vi.fn() }));

describe("Cloud connection progress presentation", () => {
	it.each([
		false,
		true,
	])("uses readable copy throughout resuming=%s", async (resuming) => {
		const controller = new SessionConnectionController(
			{
				mode: "cloud",
				url: "https://qa.invalid/hub",
				remoteSessionId: "qa-session",
			},
			{ getAccessToken: async () => "test-token" },
		);
		const labels: Array<string | undefined> = [];
		vi.mocked(createCloudSessionHandle).mockImplementationOnce(
			async (options) => {
				for (const phase of [
					...(resuming ? ["resuming"] : []),
					"provisioning",
					"unknown_backend_phase",
					"ready",
				]) {
					options.onProgress?.({ status: "provisioning", phase });
					labels.push(controller.getSnapshot().status.progress);
				}
				throw new Error("End progress-only test before socket creation");
			},
		);
		await expect(controller.start()).rejects.toThrow("End progress-only test");
		expect(labels).toEqual([
			...(resuming ? ["Resuming your workspace…"] : []),
			resuming ? "Resuming your workspace…" : "Starting your workspace…",
			resuming ? "Resuming your workspace…" : "Starting your workspace…",
			"Opening your conversation…",
		]);
		controller.dispose();
	});
});
