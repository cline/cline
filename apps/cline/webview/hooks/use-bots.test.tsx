// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBotRegistry } from "./use-bots";

const { invokeMock, isTauriAvailableMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
	isTauriAvailableMock: vi.fn(() => true),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: invokeMock,
	},
	isTauriAvailable: isTauriAvailableMock,
}));

type UseBotsHook = ReturnType<typeof useBotRegistry>;

let container: HTMLDivElement;
let root: Root;
let current: UseBotsHook;

function HookHarness() {
	current = useBotRegistry();
	return null;
}

async function flush() {
	await act(async () => {
		await Promise.resolve();
		await Promise.resolve();
	});
}

beforeEach(() => {
	Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
	invokeMock.mockReset();
	isTauriAvailableMock.mockReset();
	isTauriAvailableMock.mockReturnValue(true);
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	container.remove();
	vi.restoreAllMocks();
});

describe("useBotRegistry", () => {
	it("seeds the default bot before the mount fetch resolves, then adopts the real state", async () => {
		let resolveGetBotsState: (value: unknown) => void = () => undefined;
		invokeMock.mockImplementation((command: string) => {
			if (command === "get_bots_state") {
				return new Promise((resolve) => {
					resolveGetBotsState = resolve;
				});
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<HookHarness />);
		});

		expect(current.bots).toEqual([{ id: "cline", name: "Cline" }]);
		expect(current.activeBotId).toBe("cline");

		await act(async () => {
			resolveGetBotsState({
				bots: [
					{ id: "cline", name: "Cline" },
					{ id: "research", name: "Research" },
				],
				activeBotId: "research",
			});
			await Promise.resolve();
		});

		expect(current.bots).toEqual([
			{ id: "cline", name: "Cline" },
			{ id: "research", name: "Research" },
		]);
		expect(current.activeBotId).toBe("research");
	});

	it("creates then switches to a new bot, in order, adopting the server-returned summary", async () => {
		invokeMock.mockImplementation((command: string, args?: unknown) => {
			if (command === "get_bots_state") {
				return Promise.resolve({
					bots: [{ id: "cline", name: "Cline" }],
					activeBotId: "cline",
				});
			}
			if (command === "create_bot") {
				return Promise.resolve({ id: "marketing", name: "Marketing" });
			}
			if (command === "switch_active_bot") {
				expect((args as { botId: string }).botId).toBe("marketing");
				return Promise.resolve("marketing");
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();

		const created = await act(async () => current.createBot("Marketing"));

		expect(created).toEqual({ id: "marketing", name: "Marketing" });
		expect(current.activeBotId).toBe("marketing");
		expect(current.bots).toEqual([
			{ id: "cline", name: "Cline" },
			{ id: "marketing", name: "Marketing" },
		]);

		const createOrder = invokeMock.mock.calls
			.map((call) => call[0])
			.filter((command) => command === "create_bot" || command === "switch_active_bot");
		expect(createOrder).toEqual(["create_bot", "switch_active_bot"]);
	});

	it("passes the icon through to create_bot when given", async () => {
		invokeMock.mockImplementation((command: string) => {
			if (command === "get_bots_state") {
				return Promise.resolve({
					bots: [{ id: "cline", name: "Cline" }],
					activeBotId: "cline",
				});
			}
			if (command === "create_bot") {
				return Promise.resolve({
					id: "marketing",
					name: "Marketing",
					icon: "/bot-icons/cline-bot.png",
				});
			}
			if (command === "switch_active_bot") {
				return Promise.resolve("marketing");
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();

		const created = await act(async () =>
			current.createBot("Marketing", undefined, "/bot-icons/cline-bot.png"),
		);

		expect(invokeMock).toHaveBeenCalledWith(
			"create_bot",
			expect.objectContaining({ icon: "/bot-icons/cline-bot.png" }),
		);
		expect(created.icon).toBe("/bot-icons/cline-bot.png");
	});

	it("passes the system prompt through to create_bot when given", async () => {
		invokeMock.mockImplementation((command: string) => {
			if (command === "get_bots_state") {
				return Promise.resolve({
					bots: [{ id: "cline", name: "Cline" }],
					activeBotId: "cline",
				});
			}
			if (command === "create_bot") {
				return Promise.resolve({ id: "recipes", name: "Recipes" });
			}
			if (command === "switch_active_bot") {
				return Promise.resolve("recipes");
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();

		await act(async () =>
			current.createBot(
				"Recipes",
				undefined,
				undefined,
				"You manage recipes.",
			),
		);

		expect(invokeMock).toHaveBeenCalledWith(
			"create_bot",
			expect.objectContaining({ systemPrompt: "You manage recipes." }),
		);
	});

	it("does not mutate local state when creation is rejected (e.g. the 5-bot cap)", async () => {
		invokeMock.mockImplementation((command: string) => {
			if (command === "get_bots_state") {
				return Promise.resolve({
					bots: [{ id: "cline", name: "Cline" }],
					activeBotId: "cline",
				});
			}
			if (command === "create_bot") {
				return Promise.reject(new Error("maximum of 5 bots reached"));
			}
			throw new Error(`unexpected command: ${command}`);
		});

		await act(async () => {
			root.render(<HookHarness />);
		});
		await flush();

		await expect(
			act(async () => current.createBot("One too many")),
		).rejects.toThrow("maximum of 5 bots reached");

		expect(current.bots).toEqual([{ id: "cline", name: "Cline" }]);
		expect(current.activeBotId).toBe("cline");
	});
});
