import { describe, expect, test } from "bun:test";
import {
	COMPUTER_USE_BROWSER_SERVER_NAME,
	COMPUTER_USE_DESKTOP_SERVER_NAME,
	isAllowedPeekabooTool,
	PEEKABOO_ALLOWED_TOOL_NAMES,
	PLAYWRIGHT_MCP_ARGS,
	default as plugin,
	resolveComputerUseBackend,
} from "./index";

describe("computer-use routing", () => {
	test("keeps browser and desktop tools in distinct namespaces", () => {
		expect(COMPUTER_USE_BROWSER_SERVER_NAME).toBe("computer-use-browser");
		expect(COMPUTER_USE_DESKTOP_SERVER_NAME).toBe("computer-use-desktop");
	});

	test("configures Playwright for isolated visual browser control", () => {
		expect(PLAYWRIGHT_MCP_ARGS).toContain("--isolated");
		expect(PLAYWRIGHT_MCP_ARGS).toContain("--image-responses");
		expect(PLAYWRIGHT_MCP_ARGS).toContain("vision");
	});
});

describe("computer-use backend selection", () => {
	test("uses Peekaboo on macOS", () => {
		expect(resolveComputerUseBackend("darwin", "")).toBe("peekaboo");
	});

	test("uses the portable backend on Windows and Linux", () => {
		expect(resolveComputerUseBackend("win32", "")).toBe("portable");
		expect(resolveComputerUseBackend("linux", "")).toBe("portable");
	});

	test("allows the portable override on macOS", () => {
		expect(resolveComputerUseBackend("darwin", "portable")).toBe("portable");
	});

	test("rejects Peekaboo on other platforms", () => {
		expect(() => resolveComputerUseBackend("win32", "peekaboo")).toThrow(
			"only supported on macOS",
		);
	});

	test("rejects unrecognized backend overrides", () => {
		expect(() => resolveComputerUseBackend("darwin", "unknown")).toThrow(
			"must be 'peekaboo' or 'portable'",
		);
	});

	test("validates the backend override during plugin setup", () => {
		const previousOverride = process.env.CLINE_COMPUTER_USE_BACKEND;
		process.env.CLINE_COMPUTER_USE_BACKEND = "unknown";

		try {
			type PluginSetup = NonNullable<typeof plugin.setup>;
			expect(() =>
				plugin.setup?.(
					{} as Parameters<PluginSetup>[0],
					{} as Parameters<PluginSetup>[1],
				),
			).toThrow("must be 'peekaboo' or 'portable'");
		} finally {
			if (previousOverride === undefined) {
				delete process.env.CLINE_COMPUTER_USE_BACKEND;
			} else {
				process.env.CLINE_COMPUTER_USE_BACKEND = previousOverride;
			}
		}
	});
});

describe("Peekaboo tool policy", () => {
	test("allows every verified native UI tool", () => {
		for (const name of PEEKABOO_ALLOWED_TOOL_NAMES) {
			expect(
				isAllowedPeekabooTool(`${COMPUTER_USE_DESKTOP_SERVER_NAME}__${name}`),
			).toBe(true);
		}
	});

	test("blocks nested AI and other excluded tools", () => {
		for (const name of [
			"agent",
			"analyze",
			"browser",
			"capture",
			"clipboard",
		]) {
			expect(
				isAllowedPeekabooTool(`${COMPUTER_USE_DESKTOP_SERVER_NAME}__${name}`),
			).toBe(false);
		}
	});

	test("fails closed for future Peekaboo tools", () => {
		expect(
			isAllowedPeekabooTool(`${COMPUTER_USE_DESKTOP_SERVER_NAME}__future_tool`),
		).toBe(false);
	});

	test("does not affect tools from other providers", () => {
		expect(isAllowedPeekabooTool("run_commands")).toBe(true);
		expect(isAllowedPeekabooTool("another-server__click")).toBe(true);
	});
});
