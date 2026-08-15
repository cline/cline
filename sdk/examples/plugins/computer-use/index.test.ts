import { describe, expect, test } from "bun:test";
import {
	COMPUTER_USE_ALLOW_FOREGROUND_ENV,
	COMPUTER_USE_BROWSER_SERVER_NAME,
	COMPUTER_USE_DESKTOP_SERVER_NAME,
	COMPUTER_USE_MCP_TIMEOUT_SECONDS,
	enforcePeekabooBackgroundPolicy,
	isAllowedPeekabooTool,
	isAllowedPlaywrightTool,
	isForegroundComputerUseAllowed,
	PEEKABOO_ALLOWED_TOOL_NAMES,
	PEEKABOO_MCP_ARGS,
	PEEKABOO_MCP_ENV,
	PLAYWRIGHT_BLOCKED_TOOL_NAMES,
	PLAYWRIGHT_MCP_ARGS,
	default as plugin,
	resolveComputerUseBackend,
} from "./index";

describe("computer-use routing", () => {
	test("keeps browser and desktop tools in distinct namespaces", () => {
		expect(COMPUTER_USE_BROWSER_SERVER_NAME).toBe("computer-use-browser");
		expect(COMPUTER_USE_DESKTOP_SERVER_NAME).toBe("computer-use-desktop");
	});

	test("allows computer-use MCP startup and actions to settle", () => {
		expect(COMPUTER_USE_MCP_TIMEOUT_SECONDS).toBe(60);
	});

	test("configures Playwright for isolated visual browser control", () => {
		expect(PLAYWRIGHT_MCP_ARGS).toContain("--isolated");
		expect(PLAYWRIGHT_MCP_ARGS).toContain("--image-responses");
		expect(PLAYWRIGHT_MCP_ARGS).toContain("vision");
		expect(PLAYWRIGHT_MCP_ARGS).toContain("full");
	});

	test("configures Peekaboo for deterministic local capture", () => {
		expect(PEEKABOO_MCP_ARGS).toContain("--no-remote");
		expect(PEEKABOO_MCP_ENV).toEqual({
			PEEKABOO_CAPTURE_ENGINE: "classic",
			PEEKABOO_ALLOW_LEGACY_CAPTURE: "true",
		});
	});
});

describe("Playwright tool policy", () => {
	test("hard-blocks unsafe server-process code execution", () => {
		for (const name of PLAYWRIGHT_BLOCKED_TOOL_NAMES) {
			expect(
				isAllowedPlaywrightTool(`${COMPUTER_USE_BROWSER_SERVER_NAME}__${name}`),
			).toBe(false);
		}
	});

	test("allows bounded browser tools and unrelated providers", () => {
		expect(
			isAllowedPlaywrightTool(
				`${COMPUTER_USE_BROWSER_SERVER_NAME}__browser_click`,
			),
		).toBe(true);
		expect(
			isAllowedPlaywrightTool("another-server__browser_run_code_unsafe"),
		).toBe(true);
	});

	test("enforces the block in the beforeTool safety boundary", () => {
		const result = plugin.hooks?.beforeTool?.({
			toolCall: {
				toolName: `${COMPUTER_USE_BROWSER_SERVER_NAME}__browser_run_code_unsafe`,
			},
		} as never);

		expect(result).toEqual({
			skip: true,
			reason: expect.stringContaining("execute arbitrary code"),
		});
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

	test("blocks focus-stealing macOS actions by default", () => {
		for (const [name, input] of [
			["window", { action: "focus", app: "Slack" }],
			["app", { action: "launch", name: "Slack" }],
			["space", { action: "switch", to: 2 }],
			["move", { to: "100,200" }],
			["click", { on: "elem_1", foreground: true }],
		] as const) {
			expect(
				enforcePeekabooBackgroundPolicy(
					`${COMPUTER_USE_DESKTOP_SERVER_NAME}__${name}`,
					input,
				),
			).toEqual({
				skip: true,
				reason: expect.stringContaining("background-only macOS"),
			});
		}
	});

	test("blocks raw or insufficiently scoped background input", () => {
		for (const [name, input] of [
			["click", { coords: "100,200" }],
			["click", { on: "elem_1" }],
			["type", { text: "hello" }],
			["type", { on: "elem_1", snapshot: "snapshot-1", text: "hello" }],
			["hotkey", { keys: "cmd,k" }],
			["hotkey", { app: "Slack", keys: "cmd,k" }],
			["paste", { text: "hello" }],
			["paste", { pid: 123, text: "hello" }],
			["scroll", { direction: "down" }],
			["scroll", { on: "elem_4", direction: "down" }],
		] as const) {
			const result = enforcePeekabooBackgroundPolicy(
				`${COMPUTER_USE_DESKTOP_SERVER_NAME}__${name}`,
				input,
			);
			expect(result?.skip).toBe(true);
			expect(result?.reason).toContain("background-only macOS");
		}
	});

	test("allows direct background accessibility actions and safe captures", () => {
		for (const [name, input] of [
			["click", { on: "elem_1", snapshot: "snapshot-1" }],
			["set_value", { on: "elem_2", value: "hello" }],
			["perform_action", { on: "elem_3", action: "AXPress" }],
			["scroll", { on: "elem_4", snapshot: "snapshot-1", direction: "down" }],
			[
				"image",
				{
					app_target: "Slack",
					capture_focus: "background",
					format: "data",
					max_dimension: 1500,
				},
			],
		] as const) {
			expect(
				enforcePeekabooBackgroundPolicy(
					`${COMPUTER_USE_DESKTOP_SERVER_NAME}__${name}`,
					input,
				),
			).toBeUndefined();
		}
	});

	test("blocks background capture focus and dialog mutation bypasses", () => {
		for (const [name, input] of [
			["image", { app_target: "Slack" }],
			["image", { app_target: "Slack", capture_focus: "foreground" }],
			[
				"image",
				{ app_target: "Slack", capture_focus: "background", format: "png" },
			],
			[
				"image",
				{
					app_target: "Slack",
					capture_focus: "background",
					format: "data",
					max_dimension: 2000,
				},
			],
			["dialog", { action: "list", app: "Slack" }],
			["dialog", { action: "click", app: "Slack", button: "Save" }],
		] as const) {
			expect(
				enforcePeekabooBackgroundPolicy(
					`${COMPUTER_USE_DESKTOP_SERVER_NAME}__${name}`,
					input,
				),
			).toEqual({
				skip: true,
				reason: expect.stringContaining("background-only macOS"),
			});
		}
	});

	test("blocks nested image AI and filesystem writes even in foreground mode", () => {
		for (const [name, input] of [
			["image", { question: "What is visible?", capture_focus: "background" }],
			["image", { path: "/tmp/capture.png", capture_focus: "background" }],
			["see", { app_target: "Slack", path: "/tmp/capture.png" }],
		] as const) {
			expect(
				enforcePeekabooBackgroundPolicy(
					`${COMPUTER_USE_DESKTOP_SERVER_NAME}__${name}`,
					input,
					true,
				),
			).toEqual({
				skip: true,
				reason: expect.stringContaining("Blocked Peekaboo capability"),
			});
		}
	});

	test("supports an explicit foreground-control escape hatch", () => {
		expect(COMPUTER_USE_ALLOW_FOREGROUND_ENV).toBe(
			"CLINE_COMPUTER_USE_ALLOW_FOREGROUND",
		);
		expect(isForegroundComputerUseAllowed("true")).toBe(true);
		expect(isForegroundComputerUseAllowed("1")).toBe(true);
		expect(isForegroundComputerUseAllowed("false")).toBe(false);
		expect(
			enforcePeekabooBackgroundPolicy(
				`${COMPUTER_USE_DESKTOP_SERVER_NAME}__window`,
				{ action: "focus", app: "Slack" },
				true,
			),
		).toBeUndefined();
	});
});
