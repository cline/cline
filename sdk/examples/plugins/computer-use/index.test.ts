import { describe, expect, test } from "bun:test";
import {
	COMPUTER_USE_BROWSER_SERVER_NAME,
	COMPUTER_USE_DESKTOP_SERVER_NAME,
	COMPUTER_USE_MCP_TIMEOUT_SECONDS,
	enforcePeekabooBackgroundPolicy,
	isAllowedPeekabooTool,
	isAllowedPlaywrightTool,
	PEEKABOO_ALLOWED_TOOL_NAMES,
	PEEKABOO_MCP_ARGS,
	PEEKABOO_MCP_ENV,
	PEEKABOO_VERSION,
	PLAYWRIGHT_BLOCKED_TOOL_NAMES,
	PLAYWRIGHT_MCP_ARGS,
	PORTABLE_COMPUTER_USE_TOOL_NAMES,
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
		expect(PEEKABOO_VERSION).toBe("4.2.2");
		expect(PEEKABOO_MCP_ARGS).toContain("--no-remote");
		expect(PEEKABOO_MCP_ENV).toEqual({
			PEEKABOO_CAPTURE_ENGINE: "classic",
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

	test("enforces local-file exfiltration blocks in the hook", () => {
		for (const name of ["browser_file_upload", "browser_drop"]) {
			const result = plugin.hooks?.beforeTool?.({
				toolCall: {
					toolName: `${COMPUTER_USE_BROWSER_SERVER_NAME}__${name}`,
				},
			} as never);

			expect(result).toEqual({
				skip: true,
				reason: expect.stringContaining("local workspace/output files"),
			});
		}
	});
});

describe("Peekaboo hook enforcement", () => {
	test("applies the allowlist and background policy through beforeTool", () => {
		const disallowed = plugin.hooks?.beforeTool?.({
			toolCall: {
				toolName: `${COMPUTER_USE_DESKTOP_SERVER_NAME}__agent`,
			},
			input: {},
		} as never);
		expect(disallowed).toEqual({
			skip: true,
			reason: expect.stringContaining("not allowlisted"),
		});

		const backgroundViolation = plugin.hooks?.beforeTool?.({
			toolCall: {
				toolName: `${COMPUTER_USE_DESKTOP_SERVER_NAME}__window`,
			},
			input: { action: "close", app: "Slack" },
		} as never);
		expect(backgroundViolation).toEqual({
			skip: true,
			reason: expect.stringContaining("background-only macOS"),
		});

		const allowed = plugin.hooks?.beforeTool?.({
			toolCall: {
				toolName: `${COMPUTER_USE_DESKTOP_SERVER_NAME}__inspect_ui`,
			},
			input: { app_target: "Slack" },
		} as never);
		expect(allowed).toBeUndefined();

		for (const name of PORTABLE_COMPUTER_USE_TOOL_NAMES) {
			expect(
				plugin.hooks?.beforeTool?.({
					toolCall: {
						toolName: `${COMPUTER_USE_DESKTOP_SERVER_NAME}__${name}`,
					},
					input: {},
				} as never),
			).toBeUndefined();
		}
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
			"action",
			"agent",
			"analyze",
			"browser",
			"capture",
			"clipboard",
			"dialog",
			"drag",
			"move",
			"paste",
			"press",
			"see",
			"sleep",
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
			["window", { action: "close", app: "Slack" }],
			["window", { action: "minimize", app: "Slack" }],
			["window", { action: "maximize", app: "Slack" }],
			["window", { action: "move", app: "Slack", x: 0, y: 0 }],
			["window", { action: "resize", app: "Slack", width: 800, height: 600 }],
			["window", { action: "set-bounds", app: "Slack" }],
			["app", { action: "launch", name: "Slack" }],
			["app", { action: "quit", name: "Slack" }],
			["app", { action: "hide", name: "Slack" }],
			["menu", { action: "click", app: "Slack", path: "File > Quit" }],
			["menu", { action: "list-all", app: "Slack" }],
			["space", { action: "switch", to: 2 }],
			["space", { action: "move-window", app: "Safari", to_current: true }],
			["dock", { action: "hide" }],
			["dock", { action: "launch", app: "Slack" }],
			["inspect_ui", { app_target: "Slack", web_focus: true }],
			["click", { on: "elem_1", foreground: true }],
			["click", { on: "elem_1", snapshot: "snapshot-1", right: true }],
			["click", { on: "elem_1", snapshot: "snapshot-1", double: true }],
			["click", { on: "elem_1", snapshot: "snapshot-1", middle: true }],
			["click", { on: "elem_1", snapshot: "snapshot-1", triple: true }],
			["scroll", { direction: "down" }],
			["scroll", { on: "elem_4", direction: "down" }],
			[
				"scroll",
				{
					on: "elem_4",
					snapshot: "snapshot-1",
					direction: "down",
					smooth: true,
				},
			],
			[
				"scroll",
				{
					on: "elem_4",
					snapshot: "snapshot-1",
					direction: "down",
					delay: 1,
				},
			],
			["set_value", { on: "elem_2", value: "hello" }],
			["type", { snapshot: "snapshot-1", text: "hello" }],
			["type", { on: "elem_2", text: "hello" }],
			[
				"verify_state",
				{
					app: "Slack",
					predicates: [{ kind: "window_exists", expected: true }],
					final_screenshot: true,
				},
			],
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
			["app", { action: "list" }],
			["window", { action: "list", app: "Slack" }],
			["inspect_ui", { app_target: "Slack", web_focus: false }],
			["click", { on: "elem_1", snapshot: "snapshot-1" }],
			[
				"scroll",
				{
					on: "elem_4",
					snapshot: "snapshot-1",
					direction: "down",
					smooth: false,
					delay: 0,
				},
			],
			["set_value", { on: "elem_2", snapshot: "snapshot-1", value: "hello" }],
			[
				"type",
				{
					on: "elem_2",
					snapshot: "snapshot-1",
					text: "hello",
				},
			],
			[
				"verify_state",
				{
					app: "Slack",
					predicates: [{ kind: "window_exists", expected: true }],
				},
			],
			["menu", { action: "list", app: "Slack" }],
			["space", { action: "list" }],
			["dock", { action: "list" }],
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

	test("blocks unsafe background capture options", () => {
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
			[
				"image",
				{ app_target: "Slack", capture_focus: "background", format: "data" },
			],
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

	test("blocks nested image AI and filesystem writes", () => {
		for (const [name, input] of [
			["image", { question: "What is visible?", capture_focus: "background" }],
			["image", { path: "/tmp/capture.png", capture_focus: "background" }],
		] as const) {
			expect(
				enforcePeekabooBackgroundPolicy(
					`${COMPUTER_USE_DESKTOP_SERVER_NAME}__${name}`,
					input,
				),
			).toEqual({
				skip: true,
				reason: expect.stringContaining("Blocked Peekaboo capability"),
			});
		}
	});
});
