import { afterEach, describe, expect, it, vi } from "vitest";
import { runPluginSlashCommand } from "./plugin-commands";
const mocks = vi.hoisted(() => ({ list: vi.fn(), run: vi.fn(), hub: vi.fn() }));
vi.mock("./hub-client", () => ({ hubPlugins: mocks.hub }));
afterEach(() => vi.resetAllMocks());
describe("direct Desktop plugin commands", () => {
	it.each([
		"local",
		"ssh-box",
	])("uses the owning %s Hub and preserves the workspace root and session", async (environment) => {
		mocks.hub.mockReturnValue(mocks);
		mocks.list.mockResolvedValue({ commands: [{ name: "goal" }] });
		mocks.run.mockResolvedValue({
			reply: "set",
			submitPrompt: "expanded instructions",
		});
		const input = {
			workspacePath: "/workspace",
			sessionId: "session",
			prompt: "/goal objective",
		};
		expect(await runPluginSlashCommand(environment, input)).toEqual({
			reply: "set",
			submitPrompt: "expanded instructions",
		});
		expect(mocks.hub).toHaveBeenCalledWith(environment);
		expect(mocks.list).toHaveBeenCalledWith({
			workspacePath: "/workspace",
			sessionId: "session",
		});
		expect(mocks.run).toHaveBeenCalledWith(input);
	});
	it("keeps skills and workflows usable when discovery fails, but surfaces a listed command failure", async () => {
		mocks.hub.mockReturnValue(mocks);
		mocks.list.mockRejectedValueOnce(new Error("closed"));
		const input = {
			workspacePath: "/workspace",
			sessionId: "session",
			prompt: "/goal",
		};
		expect(await runPluginSlashCommand("local", input)).toBeUndefined();
		mocks.list.mockResolvedValue({ commands: [{ name: "goal" }] });
		mocks.run.mockRejectedValue(new Error("plugin failed"));
		await expect(runPluginSlashCommand("local", input)).rejects.toThrow(
			"plugin failed",
		);
	});
	it.each([
		"/compact",
		"/fork",
		"/team",
		"ordinary text",
	])("leaves %s with its existing handler", async (prompt) => {
		expect(
			await runPluginSlashCommand("local", {
				workspacePath: "/workspace",
				prompt,
			}),
		).toBeUndefined();
		expect(mocks.hub).not.toHaveBeenCalled();
	});
});

it("never dispatches a turn from plugin instructions completed after Stop", async () => {
	mocks.hub.mockReturnValue(mocks);
	mocks.list.mockResolvedValue({ commands: [{ name: "goal" }] });
	let finish!: (value: unknown) => void;
	mocks.run.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	const controller = new AbortController();
	const result = runPluginSlashCommand(
		"local",
		{ workspacePath: "/workspace", sessionId: "session", prompt: "/goal" },
		controller.signal,
	);
	const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
	await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
	controller.abort();
	finish({ submitPrompt: "late instructions" });
	await rejected;
});
