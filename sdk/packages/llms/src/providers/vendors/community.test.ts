import { beforeEach, describe, expect, it, vi } from "vitest";
import { listOpenAICodexModels } from "./community";

const listModelsSpy = vi.fn();
const closeSpy = vi.fn();
const createCodexAppServerSpy = vi.fn(() => ({
	listModels: listModelsSpy,
	close: closeSpy,
}));

vi.mock("ai-sdk-provider-codex-cli", () => ({
	createCodexAppServer: (options: unknown) => createCodexAppServerSpy(options),
	createCodexExec: () => () => ({}),
}));

describe("listOpenAICodexModels", () => {
	beforeEach(() => {
		createCodexAppServerSpy.mockClear();
		listModelsSpy.mockReset();
		closeSpy.mockReset();
		listModelsSpy.mockResolvedValue({ models: [] });
		closeSpy.mockResolvedValue(undefined);
	});

	it("uses the codex executable on PATH by default", async () => {
		await listOpenAICodexModels();

		expect(createCodexAppServerSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultSettings: expect.objectContaining({
					codexPath: "codex",
				}),
			}),
		);
		expect(listModelsSpy).toHaveBeenCalledWith(["openai"]);
		expect(closeSpy).toHaveBeenCalled();
	});

	it("preserves an explicit codexPath override", async () => {
		await listOpenAICodexModels({ codexPath: "/tmp/custom-codex" });

		expect(createCodexAppServerSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				defaultSettings: expect.objectContaining({
					codexPath: "/tmp/custom-codex",
				}),
			}),
		);
	});
});
