import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseStdioCommand } from "./index";
import { addServer, removeServer } from "./settings";

describe("MCP wizard settings", () => {
	const originalSettingsPath = process.env.CLINE_MCP_SETTINGS_PATH;
	const tempDirs: string[] = [];

	afterEach(async () => {
		process.env.CLINE_MCP_SETTINGS_PATH = originalSettingsPath;
		await Promise.all(
			tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
		);
		tempDirs.length = 0;
	});

	async function useTempSettingsPath(): Promise<string> {
		const dir = await mkdtemp(join(tmpdir(), "cline-mcp-settings-"));
		tempDirs.push(dir);
		const settingsPath = join(dir, "cline_mcp_settings.json");
		process.env.CLINE_MCP_SETTINGS_PATH = settingsPath;
		return settingsPath;
	}

	it("preserves unrelated top-level settings when writing servers", async () => {
		const settingsPath = await useTempSettingsPath();
		await writeFile(
			settingsPath,
			`${JSON.stringify(
				{
					otherSetting: true,
					mcpServers: {
						existing: { transport: { type: "stdio", command: "node" } },
					},
				},
				null,
				2,
			)}\n`,
		);

		addServer("added", { type: "stdio", command: "npx", args: ["server"] });
		removeServer("existing");

		const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as {
			otherSetting?: boolean;
			mcpServers?: Record<string, unknown>;
		};
		expect(parsed.otherSetting).toBe(true);
		expect(Object.keys(parsed.mcpServers ?? {})).toEqual(["added"]);
	});

	it("parses quoted stdio command arguments", () => {
		expect(
			parseStdioCommand('npx -y "@scope/server name" --root "my dir"'),
		).toEqual(["npx", "-y", "@scope/server name", "--root", "my dir"]);
	});
});
