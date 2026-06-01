import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMcpManagerFooterText, toggleMcpServer } from "./mcp-manager-dialog";

interface SetMcpServerDisabledOptions {
	filePath?: string;
	name: string;
	disabled: boolean;
}

interface TestMcpSettings {
	mcpServers?: Record<string, { disabled?: boolean }>;
}

vi.mock("@cline/core", () => ({
	resolveDefaultMcpSettingsPath: () =>
		process.env.CLINE_MCP_SETTINGS_PATH ?? "cline_mcp_settings.json",
	setMcpServerDisabled: (options: SetMcpServerDisabledOptions) => {
		const filePath =
			options.filePath ??
			process.env.CLINE_MCP_SETTINGS_PATH ??
			"cline_mcp_settings.json";
		const settings = JSON.parse(readFileSync(filePath, "utf8")) as {
			mcpServers?: Record<string, { disabled?: boolean }>;
		};
		const server = settings.mcpServers?.[options.name];
		if (!server) {
			throw new Error(`Unknown MCP server: ${options.name}`);
		}
		if (options.disabled) {
			server.disabled = true;
		} else {
			delete server.disabled;
		}
		writeFileSync(filePath, `${JSON.stringify(settings, null, 2)}\n`);
	},
}));

vi.mock("@opentui-ui/dialog/react", () => ({
	useDialogKeyboard: () => undefined,
}));

async function readSettings(filePath: string): Promise<TestMcpSettings> {
	return JSON.parse(await readFile(filePath, "utf8")) as TestMcpSettings;
}

describe("mcp manager dialog helpers", () => {
	const tempRoots: string[] = [];
	const envSnapshot = {
		CLINE_MCP_SETTINGS_PATH: process.env.CLINE_MCP_SETTINGS_PATH,
	};

	afterEach(async () => {
		process.env.CLINE_MCP_SETTINGS_PATH = envSnapshot.CLINE_MCP_SETTINGS_PATH;
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	it("uses the loaded server path when toggling", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-mcp-manager-"));
		tempRoots.push(tempRoot);
		const loadedPath = join(tempRoot, "loaded.json");
		const currentDefaultPath = join(tempRoot, "current-default.json");
		process.env.CLINE_MCP_SETTINGS_PATH = currentDefaultPath;
		const settings = {
			mcpServers: {
				docs: {
					transport: {
						type: "stdio",
						command: "node",
					},
				},
			},
		};
		await writeFile(loadedPath, `${JSON.stringify(settings, null, 2)}\n`);
		await writeFile(
			currentDefaultPath,
			`${JSON.stringify(settings, null, 2)}\n`,
		);

		const result = toggleMcpServer({
			name: "docs",
			path: loadedPath,
			enabled: true,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.server.enabled).toBe(false);
		}
		expect((await readSettings(loadedPath)).mcpServers?.docs?.disabled).toBe(
			true,
		);
		expect(
			(await readSettings(currentDefaultPath)).mcpServers?.docs?.disabled,
		).toBeUndefined();
	});

	it("returns a visible error message when toggling fails", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "cli-mcp-manager-"));
		tempRoots.push(tempRoot);
		const result = toggleMcpServer({
			name: "docs",
			path: join(tempRoot, "missing-mcp-settings.json"),
			enabled: true,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.message).toContain('Unable to toggle MCP server "docs"');
		}
	});

	it("keeps the footer focused on toggling", () => {
		expect(getMcpManagerFooterText(true)).toBe(
			"Space toggle selected, Esc to go back",
		);
		expect(getMcpManagerFooterText(true)).not.toContain("delete");
		expect(getMcpManagerFooterText(false)).toBe("Esc to go back");
	});
});
