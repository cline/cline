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

	it("lets the provider resolve its bundled Codex CLI by default", async () => {
		await listOpenAICodexModels();

		const options = createCodexAppServerSpy.mock.calls[0]?.[0] as
			| { defaultSettings?: Record<string, unknown> }
			| undefined;
		expect(options?.defaultSettings).toBeDefined();
		expect(Object.hasOwn(options?.defaultSettings ?? {}, "codexPath")).toBe(
			false,
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
