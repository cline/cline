import { describe, expect, it, vi } from "vitest";
import { __test__, reconnectConfiguredConnectors } from "./connectors";

const mocks = vi.hoisted(() => ({
	reconnectPersistedConnectors: vi.fn(async () => []),
}));

vi.mock("@cline/core", async (importOriginal) => ({
	...(await importOriginal<typeof import("@cline/core")>()),
	reconnectPersistedConnectors: mocks.reconnectPersistedConnectors,
}));

describe("connector launch command", () => {
	it("uses Bun conditions when launching the source CLI from Bun", () => {
		expect(
			__test__.buildCliConnectCommand(["telegram", "--bot-token", "token"], {
				execPath: "/Users/test/.bun/bin/bun",
				cliPath: "/repo/apps/cli/src/index.ts",
				exists: () => true,
			}),
		).toEqual({
			launcher: "/Users/test/.bun/bin/bun",
			childArgs: [
				"--conditions=development",
				"/repo/apps/cli/src/index.ts",
				"connect",
				"telegram",
				"--bot-token",
				"token",
			],
		});
	});

	it("uses compiled CLI subcommands without Bun flags", () => {
		expect(
			__test__.buildCliConnectCommand(["telegram", "--bot-token", "token"], {
				execPath: "/Applications/Cline/bin/cline",
				cliPath: "/repo/apps/cli/src/index.ts",
				exists: () => true,
			}),
		).toEqual({
			launcher: "/Applications/Cline/bin/cline",
			childArgs: ["connect", "telegram", "--bot-token", "token"],
		});
	});

	it("uses Bun conditions when launching the source CLI from Node", () => {
		expect(
			__test__.buildCliConnectCommand(["telegram", "--bot-token", "token"], {
				execPath: "/usr/local/bin/node",
				cliPath: "/repo/apps/cli/src/index.ts",
				exists: () => true,
			}),
		).toEqual({
			launcher: "bun",
			childArgs: [
				"--conditions=development",
				"/repo/apps/cli/src/index.ts",
				"connect",
				"telegram",
				"--bot-token",
				"token",
			],
		});
	});

	it("detects Windows Node when launching the source CLI", () => {
		expect(
			__test__.buildCliConnectCommand(["telegram", "--bot-token", "token"], {
				execPath: "node.exe",
				cliPath: "C:\\repo\\apps\\cli\\src\\index.ts",
				exists: () => true,
			}),
		).toEqual({
			launcher: "bun",
			childArgs: [
				"--conditions=development",
				"C:\\repo\\apps\\cli\\src\\index.ts",
				"connect",
				"telegram",
				"--bot-token",
				"token",
			],
		});
	});

	it("strips terminal color codes from connector command failures", () => {
		expect(
			__test__.normalizeConnectorError(
				"\u001B[31merror:\u001B[0m error: unknown option '--conditions=development'",
				"connector start failed",
			),
		).toBe("unknown option '--conditions=development'");
	});

	it("turns Telegram unauthorized responses into a token validation message", () => {
		expect(
			__test__.normalizeConnectorError(
				"\u001B[31merror:\u001B[0m Telegram getMe failed (401 Unauthorized): Unauthorized",
				"connector start failed",
			),
		).toBe(
			"Telegram rejected this bot token. Copy the token from @BotFather and try again.",
		);
	});

	it("delegates persisted reconnects through the core package boundary", async () => {
		const log = vi.fn();

		await reconnectConfiguredConnectors(log);

		expect(mocks.reconnectPersistedConnectors).toHaveBeenCalledOnce();
		expect(mocks.reconnectPersistedConnectors).toHaveBeenCalledWith(
			expect.objectContaining({
				start: expect.any(Function),
				isActive: expect.any(Function),
				log,
			}),
		);
	});
});
