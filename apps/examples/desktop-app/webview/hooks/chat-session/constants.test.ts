// @vitest-environment jsdom

import { GENERATED_CLINE_RECOMMENDED_MODELS } from "@cline/llms/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/lib/desktop-client", () => ({ desktopClient: { invoke } }));

async function load() {
	vi.resetModules();
	return await import("./constants");
}

describe("live Cline default model", () => {
	beforeEach(() => {
		invoke.mockReset();
		window.localStorage.clear();
	});

	it("starts on the bundled free model and never waits on the feed", async () => {
		invoke.mockReturnValue(new Promise(() => {}));
		const c = await load();
		void c.loadLiveClineDefaultModelId();
		expect(c.getInitialChatConfig("local").model).toBe(
			GENERATED_CLINE_RECOMMENDED_MODELS.free?.[0]?.id,
		);
	});

	it("uses the live feed's first free model once it arrives", async () => {
		invoke.mockResolvedValue({ free: [{ id: "cline-free/live" }] });
		const c = await load();
		await c.loadLiveClineDefaultModelId();
		expect(c.getInitialChatConfig("local").model).toBe("cline-free/live");
	});

	it("keeps the bundled default when the feed fails", async () => {
		invoke.mockRejectedValue(new Error("offline"));
		const c = await load();
		expect(await c.loadLiveClineDefaultModelId()).toBeUndefined();
		expect(c.isUntouchedDefaultModel(c.getInitialChatConfig("local"))).toBe(true);
	});

	it("does not treat a remembered model as untouched", async () => {
		const c = await load();
		const { writeModelSelectionStorageToWindow } = await import(
			"@/lib/model-selection"
		);
		writeModelSelectionStorageToWindow({
			lastProvider: "cline",
			lastModelByProvider: { cline: "x/y" },
		});
		expect(c.isUntouchedDefaultModel(c.getInitialChatConfig("local"))).toBe(false);
	});

	it("does not treat a saved cloud model as untouched", async () => {
		const c = await load();
		const { writeModelSelectionStorageToWindow } = await import(
			"@/lib/model-selection"
		);
		writeModelSelectionStorageToWindow(
			{
				lastProvider: "cline",
				lastModelByProvider: {
					cline: GENERATED_CLINE_RECOMMENDED_MODELS.free?.[0]?.id ?? "",
				},
			},
			"cloud",
		);
		const cloud = c.getInitialChatConfig("local", { executionTarget: "cloud" });
		expect(c.isUntouchedDefaultModel(cloud)).toBe(false);
	});
});
