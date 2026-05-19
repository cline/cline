import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpOAuthProviderContext } from "./oauth";

describe("mcp oauth", () => {
	const tempRoots: string[] = [];

	afterEach(async () => {
		await Promise.all(
			tempRoots.map((directory) =>
				rm(directory, { recursive: true, force: true }),
			),
		);
		tempRoots.length = 0;
	});

	async function createSettingsFile(): Promise<string> {
		const tempRoot = await mkdtemp(join(tmpdir(), "core-mcp-oauth-"));
		tempRoots.push(tempRoot);
		const filePath = join(tempRoot, "cline_mcp_settings.json");
		await writeFile(
			filePath,
			JSON.stringify(
				{
					mcpServers: {
						linear: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.linear.app/mcp",
							},
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);
		return filePath;
	}

	it("tracks the most recent generated OAuth state", async () => {
		const settingsPath = await createSettingsFile();
		const context = createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});

		expect(context.getLastOAuthState()).toBeUndefined();

		const createState = context.provider.state;
		if (!createState) {
			throw new Error("Expected OAuth provider to expose state generator.");
		}

		const firstState = createState();
		expect(context.getLastOAuthState()).toBe(firstState);

		const secondState = createState();
		expect(secondState).not.toBe(firstState);
		expect(context.getLastOAuthState()).toBe(secondState);
	});

	it("does not write redirect state when creating a provider context", async () => {
		const settingsPath = await createSettingsFile();
		const before = await readFile(settingsPath, "utf8");

		createMcpOAuthProviderContext({
			settingsPath,
			serverName: "linear",
			redirectUrl: "http://127.0.0.1:1456/mcp/oauth/callback",
		});

		await expect(readFile(settingsPath, "utf8")).resolves.toBe(before);
	});
});
