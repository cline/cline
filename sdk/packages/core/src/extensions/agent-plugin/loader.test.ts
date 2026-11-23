import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	AGENT_PLUGINS_V1_MANIFEST_SCHEMA,
	AGENT_PLUGINS_V1_MCP_SCHEMA,
	loadAgentPluginPackages,
} from "./loader";

const temporaryRoots: string[] = [];
const pluginRootPlaceholder = ["$", "{PLUGIN_ROOT}"].join("");
const pluginDataPlaceholder = ["$", "{PLUGIN_DATA}"].join("");

async function createTemporaryRoot(): Promise<string> {
	const root = await realpath(
		await mkdtemp(join(tmpdir(), "cline-agent-plugin-")),
	);
	temporaryRoots.push(root);
	return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await writeFile(path, JSON.stringify(value), "utf8");
}

async function createPlugin(
	root: string,
	name: string,
	extraManifest: Record<string, unknown> = {},
): Promise<string> {
	const pluginRoot = join(root, name);
	await mkdir(pluginRoot, { recursive: true });
	await writeJson(join(pluginRoot, "plugin.json"), {
		$schema: AGENT_PLUGINS_V1_MANIFEST_SCHEMA,
		name,
		...extraManifest,
	});
	return pluginRoot;
}

async function writeSkill(
	pluginRoot: string,
	directoryName: string,
	frontmatter: string,
	body = "",
): Promise<string> {
	const skillRoot = join(pluginRoot, "skills", directoryName);
	await mkdir(skillRoot, { recursive: true });
	await writeFile(
		join(skillRoot, "SKILL.md"),
		`---\n${frontmatter}\n---\n${body}`,
		"utf8",
	);
	return skillRoot;
}

afterEach(async () => {
	await Promise.all(
		temporaryRoots
			.splice(0)
			.map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("loadAgentPluginPackages", () => {
	it("discovers packages and isolates invalid skill and MCP entries", async () => {
		const root = await createTemporaryRoot();
		const workspacePath = join(root, "workspace");
		const searchRoot = join(workspacePath, ".agents", "plugins");
		const pluginRoot = await createPlugin(searchRoot, "acme.tools", {
			description: "Portable tools",
			extensions: { "com.unknown.client": "left unvalidated" },
			futureField: true,
		});
		const validSkillRoot = await writeSkill(
			pluginRoot,
			"review-code",
			"name: review-code\ndescription: Review source code",
		);
		await writeSkill(
			pluginRoot,
			"broken",
			"name: wrong-name\ndescription: Invalid sibling",
			"Do not load this.",
		);
		await writeSkill(
			join(pluginRoot, "skills", "nested"),
			"too-deep",
			"name: too-deep\ndescription: Nested skill",
			"Do not discover recursively.",
		);
		await mkdir(join(pluginRoot, "bin"), { recursive: true });
		await writeFile(join(pluginRoot, "bin", "server"), "", "utf8");
		await writeJson(join(pluginRoot, "mcp.json"), {
			$schema: AGENT_PLUGINS_V1_MCP_SCHEMA,
			mcpServers: {
				local: {
					type: "stdio",
					command: "./bin/server",
					args: [
						"--root",
						pluginRootPlaceholder,
						`${pluginDataPlaceholder}/cache`,
					],
					env: { CONFIG: `${pluginRootPlaceholder}/config.json` },
					cwd: `${pluginDataPlaceholder}/work`,
				},
				remote: {
					type: "streamable-http",
					url: "https://example.com/mcp",
					headers: { "X-Tenant": "public" },
				},
				escape: {
					type: "stdio",
					command: "../outside",
				},
				insecure: {
					type: "sse",
					url: "http://example.com/events",
				},
			},
		});

		const report = await loadAgentPluginPackages({
			searchPaths: [searchRoot],
			pluginDataRoot: join(root, "data"),
		});

		expect(report.plugins).toHaveLength(1);
		expect(report.skills).toHaveLength(1);
		expect(report.skills[0]).toMatchObject({
			pluginName: "acme.tools",
			directoryPath: validSkillRoot,
			metadata: {
				name: "review-code",
				description: "Review source code",
			},
		});
		expect(report.mcpServers.map((server) => server.serverName)).toEqual([
			"local",
			"remote",
		]);
		const local = report.mcpServers.find(
			(server) => server.serverName === "local",
		);
		expect(local?.pluginDataPath).toBeDefined();
		expect(existsSync(local?.pluginDataPath ?? "")).toBe(false);
		expect(local?.registration.transport).toMatchObject({
			type: "stdio",
			command: join(pluginRoot, "bin", "server"),
			args: ["--root", pluginRoot, `${local?.pluginDataPath}/cache`],
			env: {
				CONFIG: `${pluginRoot}/config.json`,
				PLUGIN_ROOT: pluginRoot,
				PLUGIN_DATA: local?.pluginDataPath,
			},
			cwd: join(local?.pluginDataPath ?? "", "work"),
		});
		expect(report.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					level: "warning",
					scope: "manifest",
					message: expect.stringContaining("futureField"),
				}),
				expect.objectContaining({
					scope: "skill",
					componentName: "broken",
				}),
				expect.objectContaining({
					scope: "mcp-server",
					componentName: "escape",
				}),
				expect.objectContaining({
					scope: "mcp-server",
					componentName: "insecure",
				}),
			]),
		);
	});

	it("rejects fatal manifests without inspecting their components", async () => {
		const root = await createTemporaryRoot();
		const pluginRoot = await createPlugin(root, "invalid-plugin", {
			version: 42,
		});
		await writeSkill(
			pluginRoot,
			"hidden",
			"name: hidden\ndescription: Must not load",
			"Hidden instructions.",
		);

		const report = await loadAgentPluginPackages({ searchPaths: [root] });

		expect(report.plugins).toEqual([]);
		expect(report.skills).toEqual([]);
		expect(report.diagnostics).toEqual([
			expect.objectContaining({
				scope: "manifest",
				message: expect.stringContaining("version"),
			}),
		]);
	});

	it("keeps skills when the plugin MCP document is invalid", async () => {
		const root = await createTemporaryRoot();
		const pluginRoot = await createPlugin(root, "skills-only");
		await writeSkill(
			pluginRoot,
			"summarize",
			"name: summarize\ndescription: Summarize files",
			"Summarize the requested files.",
		);
		await writeJson(join(pluginRoot, "mcp.json"), {
			$schema: AGENT_PLUGINS_V1_MCP_SCHEMA,
			mcpServers: {},
			unknown: true,
		});

		const report = await loadAgentPluginPackages({ searchPaths: [root] });

		expect(report.skills.map((skill) => skill.metadata.name)).toEqual([
			"summarize",
		]);
		expect(report.mcpServers).toEqual([]);
		expect(report.diagnostics).toContainEqual(
			expect.objectContaining({ scope: "mcp" }),
		);
	});

	it("gives explicit package roots precedence over discovered duplicates", async () => {
		const root = await createTemporaryRoot();
		const discoveredRoot = join(root, "discovered");
		const explicitRoot = join(root, "explicit", "preferred");
		const discovered = await createPlugin(discoveredRoot, "duplicate");
		await mkdir(explicitRoot, { recursive: true });
		await writeJson(join(explicitRoot, "plugin.json"), {
			$schema: AGENT_PLUGINS_V1_MANIFEST_SCHEMA,
			name: "duplicate",
			description: "preferred",
		});
		await writeSkill(
			discovered,
			"ignored",
			"name: ignored\ndescription: Ignored skill",
			"Ignored.",
		);

		const report = await loadAgentPluginPackages({
			pluginPaths: [explicitRoot],
			searchPaths: [discoveredRoot],
		});

		expect(report.plugins[0].rootPath).toBe(explicitRoot);
		expect(report.skills).toEqual([]);
		expect(report.diagnostics).toContainEqual(
			expect.objectContaining({
				level: "warning",
				scope: "plugin",
				message: expect.stringContaining("duplicate"),
			}),
		);
	});

	it("skips disabled package components while preserving name precedence", async () => {
		const root = await createTemporaryRoot();
		const discoveredRoot = join(root, "discovered");
		const explicitRoot = join(root, "explicit", "preferred");
		const discovered = await createPlugin(discoveredRoot, "disabled-plugin");
		await mkdir(explicitRoot, { recursive: true });
		await writeJson(join(explicitRoot, "plugin.json"), {
			$schema: AGENT_PLUGINS_V1_MANIFEST_SCHEMA,
			name: "disabled-plugin",
		});
		await writeSkill(
			discovered,
			"must-not-load",
			"name: must-not-load\ndescription: Must not load",
		);
		await writeJson(join(explicitRoot, "mcp.json"), {
			$schema: AGENT_PLUGINS_V1_MCP_SCHEMA,
			mcpServers: "invalid but never inspected",
		});

		const report = await loadAgentPluginPackages({
			pluginPaths: [explicitRoot],
			searchPaths: [discoveredRoot],
			disabledPluginNames: ["disabled-plugin"],
		});

		expect(report.plugins).toEqual([]);
		expect(report.skills).toEqual([]);
		expect(report.mcpServers).toEqual([]);
		expect(report.diagnostics).toEqual([
			expect.objectContaining({
				level: "warning",
				scope: "plugin",
				pluginPath: discovered,
			}),
		]);
	});

	it.skipIf(process.platform === "win32")(
		"enforces the resolved package boundary for manifests, components, and skills",
		async () => {
			const root = await createTemporaryRoot();
			const outside = join(root, "outside");
			await mkdir(outside, { recursive: true });
			await writeJson(join(outside, "manifest.json"), {
				$schema: AGENT_PLUGINS_V1_MANIFEST_SCHEMA,
				name: "escaped-manifest",
			});
			const escapedManifest = join(root, "escaped-manifest");
			await mkdir(escapedManifest, { recursive: true });
			await symlink(
				join(outside, "manifest.json"),
				join(escapedManifest, "plugin.json"),
			);

			const escapedSkills = await createPlugin(root, "escaped-skills");
			const outsideSkills = join(outside, "skills");
			await writeSkill(
				outside,
				"external",
				"name: external\ndescription: External skill",
				"External.",
			);
			await symlink(outsideSkills, join(escapedSkills, "skills"));
			await writeJson(join(escapedSkills, "mcp.json"), {
				$schema: AGENT_PLUGINS_V1_MCP_SCHEMA,
				mcpServers: {},
			});

			const oneEscapedSkill = await createPlugin(root, "one-escaped-skill");
			const skillRoot = join(oneEscapedSkill, "skills", "external");
			await mkdir(skillRoot, { recursive: true });
			await symlink(
				join(outsideSkills, "external", "SKILL.md"),
				join(skillRoot, "SKILL.md"),
			);

			const report = await loadAgentPluginPackages({ searchPaths: [root] });

			expect(report.plugins.map((plugin) => plugin.manifest.name)).toEqual([
				"escaped-skills",
				"one-escaped-skill",
			]);
			expect(report.skills).toEqual([]);
			expect(report.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						pluginPath: escapedManifest,
						scope: "manifest",
					}),
					expect.objectContaining({
						pluginName: "escaped-skills",
						scope: "skills",
					}),
					expect.objectContaining({
						pluginName: "one-escaped-skill",
						scope: "skill",
					}),
				]),
			);
		},
	);
});
