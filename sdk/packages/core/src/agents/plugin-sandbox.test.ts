import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentConfig, Tool, ToolContext } from "@clinebot/agents";
import { describe, expect, it } from "vitest";
import { loadSandboxedPlugins } from "./plugin-sandbox";

function createApiCapture() {
	const tools: Tool[] = [];
	const api = {
		registerTool: (tool: Tool) => tools.push(tool),
		registerCommand: () => {},
		registerShortcut: () => {},
		registerFlag: () => {},
		registerMessageRenderer: () => {},
		registerProvider: () => {},
	};
	return { tools, api };
}

describe("plugin-sandbox", () => {
	it("runs plugin hooks and tool contributions in sandbox process", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-"));
		try {
			const pluginPath = join(dir, "plugin.mjs");
			await writeFile(
				pluginPath,
				[
					"export default {",
					"  name: 'sandbox-test',",
					"  manifest: { capabilities: ['hooks','tools'], hookStages: ['input'] },",
					"  setup(api) {",
					"    api.registerTool({",
					"      name: 'sandbox_echo',",
					"      description: 'echo',",
					"      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },",
					"      execute: async (input) => ({ echoed: input.value }),",
					"    });",
					"  },",
					"  onInput(ctx) { return { overrideInput: String(ctx.input || '').toUpperCase() }; }",
					"};",
				].join("\n"),
				"utf8",
			);

			const sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
			});
			try {
				expect(sandboxed.extensions).toBeDefined();
				const extension = sandboxed.extensions?.[0];
				expect(extension?.name).toBe("sandbox-test");
				type AgentExtensionInputContext = Parameters<
					NonNullable<NonNullable<AgentConfig["extensions"]>[number]["onInput"]>
				>[0];
				const inputContext: AgentExtensionInputContext = {
					agentId: "agent-1",
					conversationId: "conv-1",
					parentAgentId: null,
					mode: "run",
					input: "hello",
				};
				const control = await extension?.onInput?.(inputContext);
				expect(control?.overrideInput).toBe("HELLO");

				const { tools, api } = createApiCapture();
				await extension?.setup?.(api);
				expect(tools.map((tool) => tool.name)).toContain("sandbox_echo");
				const echoTool = tools.find((tool) => tool.name === "sandbox_echo");
				expect(echoTool).toBeDefined();
				const result = await echoTool?.execute({ value: "ok" }, {
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				} as ToolContext);
				expect(result).toEqual({ echoed: "ok" });
			} finally {
				await sandboxed.shutdown();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("enforces hook timeout and cancels sandbox process", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-timeout-"));
		try {
			const pluginPath = join(dir, "plugin-timeout.mjs");
			await writeFile(
				pluginPath,
				[
					"export default {",
					"  name: 'sandbox-timeout',",
					"  manifest: { capabilities: ['hooks'], hookStages: ['input'] },",
					"  onInput() { return new Promise(() => {}); }",
					"};",
				].join("\n"),
				"utf8",
			);

			const sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
				hookTimeoutMs: 50,
			});
			const extension = sandboxed.extensions?.[0];
			await expect(
				extension?.onInput?.({
					agentId: "agent-1",
					conversationId: "conv-1",
					parentAgentId: null,
					mode: "run",
					input: "hello",
				}),
			).rejects.toThrow(/timed out/i);
			await sandboxed.shutdown();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("forwards sandbox plugin events to the host", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-events-"));
		try {
			const pluginPath = join(dir, "plugin-events.mjs");
			await writeFile(
				pluginPath,
				[
					"export default {",
					"  name: 'sandbox-events',",
					"  manifest: { capabilities: ['tools'] },",
					"  setup(api) {",
					"    api.registerTool({",
					"      name: 'emit_event',",
					"      description: 'emit host event',",
					"      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },",
					"      execute: async (input) => {",
					"        globalThis.__clinePluginHost?.emitEvent?.('test_event', { value: input.value });",
					"        return { ok: true };",
					"      },",
					"    });",
					"  },",
					"};",
				].join("\n"),
				"utf8",
			);

			const events: Array<{ name: string; payload?: unknown }> = [];
			const sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
				onEvent: (event) => {
					events.push(event);
				},
			});
			try {
				const extension = sandboxed.extensions?.[0];
				const { tools, api } = createApiCapture();
				await extension?.setup?.(api);
				const tool = tools.find((entry) => entry.name === "emit_event");
				await tool?.execute({ value: "hello" }, {
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				} as ToolContext);
				expect(events).toEqual([
					{
						name: "test_event",
						payload: { value: "hello" },
					},
				]);
			} finally {
				await sandboxed.shutdown();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("loads TypeScript plugins in the sandbox process", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-ts-"));
		try {
			const pluginPath = join(dir, "plugin-ts.ts");
			await writeFile(
				pluginPath,
				[
					"const TOOL_NAME: string = 'sandbox_ts_echo';",
					"export default {",
					"  name: 'sandbox-ts',",
					"  manifest: { capabilities: ['tools'] },",
					"  setup(api) {",
					"    api.registerTool({",
					"      name: TOOL_NAME,",
					"      description: 'echo',",
					"      inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },",
					"      execute: async (input) => ({ echoed: input.value }),",
					"    });",
					"  },",
					"};",
				].join("\n"),
				"utf8",
			);

			const sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
			});
			try {
				const extension = sandboxed.extensions?.[0];
				expect(extension?.name).toBe("sandbox-ts");
				const { tools, api } = createApiCapture();
				await extension?.setup?.(api);
				const tool = tools.find((entry) => entry.name === "sandbox_ts_echo");
				expect(tool).toBeDefined();
				const result = await tool?.execute({ value: "ok" }, {
					agentId: "agent-1",
					conversationId: "conv-1",
					iteration: 1,
				} as ToolContext);
				expect(result).toEqual({ echoed: "ok" });
			} finally {
				await sandboxed.shutdown();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("resolves plugin-local dependencies in the sandbox process", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-deps-"));
		try {
			const depDir = join(dir, "node_modules", "sandbox-local-dep");
			await mkdir(depDir, { recursive: true });
			await writeFile(
				join(depDir, "package.json"),
				JSON.stringify({
					name: "sandbox-local-dep",
					type: "module",
					exports: "./index.js",
				}),
				"utf8",
			);
			await writeFile(
				join(depDir, "index.js"),
				"export const depName = 'sandbox-local-dep';\n",
				"utf8",
			);
			const pluginPath = join(dir, "plugin-dep.ts");
			await writeFile(
				pluginPath,
				[
					"import { depName } from 'sandbox-local-dep';",
					"export default {",
					"  name: depName,",
					"  manifest: { capabilities: ['tools'] },",
					"};",
				].join("\n"),
				"utf8",
			);

			const sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
			});
			try {
				expect(sandboxed.extensions?.[0]?.name).toBe("sandbox-local-dep");
			} finally {
				await sandboxed.shutdown();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("prefers plugin-installed SDK packages in the sandbox process", async () => {
		const dir = await mkdtemp(join(tmpdir(), "core-plugin-sandbox-sdk-"));
		try {
			const depDir = join(dir, "node_modules", "@clinebot", "shared");
			await mkdir(depDir, { recursive: true });
			await writeFile(
				join(depDir, "package.json"),
				JSON.stringify({
					name: "@clinebot/shared",
					type: "module",
					exports: "./index.js",
				}),
				"utf8",
			);
			await writeFile(
				join(depDir, "index.js"),
				"export const sdkMarker = 'sandbox-plugin-installed-sdk';\n",
				"utf8",
			);
			const pluginPath = join(dir, "plugin-sdk.ts");
			await writeFile(
				pluginPath,
				[
					"import { sdkMarker } from '@clinebot/shared';",
					"export default {",
					"  name: sdkMarker,",
					"  manifest: { capabilities: ['tools'] },",
					"};",
				].join("\n"),
				"utf8",
			);

			const sandboxed = await loadSandboxedPlugins({
				pluginPaths: [pluginPath],
			});
			try {
				expect(sandboxed.extensions?.[0]?.name).toBe(
					"sandbox-plugin-installed-sdk",
				);
			} finally {
				await sandboxed.shutdown();
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
