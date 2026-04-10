import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const cliRoot = path.resolve(__dirname, "..");
const cliEntry = path.join(cliRoot, "src", "index.ts");
const cliPackage = JSON.parse(
	readFileSync(path.join(cliRoot, "package.json"), "utf8"),
) as { version: string };
const bunExec = process.env.BUN_EXEC_PATH ?? "bun";

type CliResult = ReturnType<typeof spawnSync>;

function asText(value: string | Buffer): string {
	return typeof value === "string" ? value : value.toString("utf8");
}

function parseJsonArrayFromOutput(output: string): unknown[] {
	const trimmed = output.trim();
	if (trimmed.length > 0) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (Array.isArray(parsed)) {
				return parsed;
			}
		} catch {
			// Fall through.
		}
	}

	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		try {
			const parsed = JSON.parse(lines[index] ?? "") as unknown;
			if (Array.isArray(parsed)) {
				return parsed;
			}
		} catch {
			// Ignore non-JSON lines.
		}
	}

	const start = output.indexOf("[");
	const end = output.lastIndexOf("]");
	if (start >= 0 && end > start) {
		const parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
		if (Array.isArray(parsed)) {
			return parsed;
		}
	}

	throw new Error("expected a JSON array in CLI output");
}

function runCli(
	args: string[],
	options?: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		stdin?: string;
		timeout?: number;
	},
): CliResult {
	return spawnSync(bunExec, [cliEntry, ...args], {
		cwd: options?.cwd ?? cliRoot,
		encoding: "utf8",
		input: options?.stdin,
		env: options?.env,
		timeout: options?.timeout ?? 90_000,
		maxBuffer: 10 * 1024 * 1024,
	});
}

describe("cli e2e", () => {
	const tempDirs: string[] = [];
	const createIsolatedEnv = (
		overrides: NodeJS.ProcessEnv = {},
	): NodeJS.ProcessEnv => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-data-"));
		const sessionDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-sessions-"));
		const teamDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-teams-"));
		tempDirs.push(homeDir, dataDir, sessionDir, teamDir);
		return {
			...process.env,
			HOME: homeDir,
			CLINE_DATA_DIR: dataDir,
			CLINE_SESSION_DATA_DIR: sessionDir,
			CLINE_TEAM_DATA_DIR: teamDir,
			CLINE_SESSION_BACKEND_MODE: "local",
			CLINE_PROVIDER_SETTINGS_PATH: path.join(
				dataDir,
				"settings",
				"providers.json",
			),
			CLINE_HOOKS_LOG_PATH: path.join(dataDir, "hooks", "hooks.jsonl"),
			...overrides,
		};
	};

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("prints help output", () => {
		const result = runCli(["--help"], { env: createIsolatedEnv() });
		expect(result.status).toBe(0);
		expect(asText(result.stderr)).toBe("");
		expect(asText(result.stdout)).toContain("Usage:");
		expect(asText(result.stdout)).toContain("--autoapprove [value]");
		expect(asText(result.stdout)).toContain("--auto-approve-all");
		expect(asText(result.stdout)).toContain("-T, --taskId <id>");
		expect(asText(result.stdout)).toContain("--sandbox");
		expect(asText(result.stdout)).toContain("--thinking");
		expect(asText(result.stdout)).toContain("--reasoning-effort");
		expect(asText(result.stdout)).toContain("--refresh-models");
		expect(asText(result.stdout)).toContain("Show current configuration");
	});

	it("prints version output", () => {
		const result = runCli(["--version"], { env: createIsolatedEnv() });
		expect(result.status).toBe(0);
		expect(asText(result.stdout).trim()).toBe(cliPackage.version);
	});

	it("prints version output via version command", () => {
		const result = runCli(["version"], { env: createIsolatedEnv() });
		expect(result.status).toBe(0);
		expect(asText(result.stdout).trim()).toBe(cliPackage.version);
	});

	it("exits promptly on success path without hanging", () => {
		const result = runCli(["version"], {
			env: createIsolatedEnv(),
			timeout: 10_000,
		});
		expect(result.signal).toBeNull();
		expect(result.status).toBe(0);
	});

	it("exits promptly on error path without hanging", () => {
		const result = runCli(["--timeout", "xml", "hello"], {
			env: createIsolatedEnv(),
			timeout: 10_000,
		});
		expect(result.signal).toBeNull();
		expect(result.status).toBe(1);
	});

	it("propagates subcommand exit codes through process.exit", () => {
		const result = runCli(["history", "--json"], {
			env: createIsolatedEnv(),
			timeout: 10_000,
		});
		expect(result.signal).toBeNull();
		expect(result.status).toBe(0);
	});

	it("rejects invalid timeout values", () => {
		const result = runCli(["--timeout", "xml", "hello"], {
			env: createIsolatedEnv(),
		});
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain("invalid timeout");
	});

	it("rejects json mode without prompt or piped input", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		tempDirs.push(homeDir);
		const result = runCli(["--json"], {
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
			},
		});
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain(
			"JSON output mode requires a prompt argument or piped stdin",
		);
	});

	it("rejects interactive mode with json output", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		tempDirs.push(homeDir);
		const result = runCli(["--json", "--interactive"], {
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
			},
		});
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain(
			"JSON output mode requires a prompt argument or piped stdin",
		);
	});

	it("returns an error for unknown config targets", () => {
		const result = runCli(["config", "unknown-target"], {
			env: createIsolatedEnv(),
		});
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain(
			'config requires one of: workflows, rules, skills, agents, plugins, hooks, mcp, tools (got "unknown-target")',
		);
	});

	it("returns an error for unknown rpc subcommands", () => {
		const result = runCli(["rpc", "nonesuch"], { env: createIsolatedEnv() });
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain(
			'unknown rpc subcommand "nonesuch"',
		);
	});

	it("returns an error for interactive auth when no TTY is available", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-data-"));
		tempDirs.push(homeDir, dataDir);
		const result = runCli(["auth"], {
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
				CLINE_DATA_DIR: dataDir,
			},
		});
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain(
			"interactive auth setup requires a TTY",
		);
	});

	it("lists sessions from isolated storage", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const sessionDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-sessions-"));
		tempDirs.push(homeDir, sessionDir);
		const result = runCli(["history", "--json", "--limit", "1"], {
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
				CLINE_SESSION_DATA_DIR: sessionDir,
			},
		});

		expect(result.status).toBe(0);
		const parsed = parseJsonArrayFromOutput(asText(result.stdout));
		expect(Array.isArray(parsed)).toBe(true);
	});

	it("prints empty history state from isolated storage", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const sessionDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-sessions-"));
		tempDirs.push(homeDir, sessionDir);
		const result = runCli(["history", "--limit", "5"], {
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
				CLINE_SESSION_DATA_DIR: sessionDir,
			},
		});

		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("No history found.");
	});

	it("returns an error when deleting a session without --session-id", () => {
		const result = runCli(["history", "delete"], {
			env: createIsolatedEnv(),
		});
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain(
			"history delete requires --session-id <id>",
		);
	});

	it("returns an error when taskId flag is provided without an id", () => {
		const result = runCli(["--taskId"], { env: createIsolatedEnv() });
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain("--taskId requires <id>");
	});

	it("lists enabled workflows in text mode", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workflows-"));
		tempDirs.push(workspace);
		const workflowsDir = path.join(workspace, ".clinerules", "workflows");
		mkdirSync(workflowsDir, { recursive: true });
		writeFileSync(
			path.join(workflowsDir, "release.md"),
			`---
name: release
---
Release checklist.`,
			"utf8",
		);
		writeFileSync(
			path.join(workflowsDir, "disabled.md"),
			`---
name: disabled
disabled: true
---
Do not list this.`,
			"utf8",
		);

		const result = runCli(["config", "workflows"], {
			cwd: workspace,
			env: createIsolatedEnv(),
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("Available workflows:");
		expect(asText(result.stdout)).toContain("/release");
		expect(asText(result.stdout)).toContain(
			path.join(workflowsDir, "release.md"),
		);
		expect(asText(result.stdout)).not.toContain("/disabled");
	});

	it("lists workflows from workspace root when run in a subdirectory", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workflows-"));
		tempDirs.push(workspace);
		const workflowsDir = path.join(workspace, ".clinerules", "workflows");
		const nestedDir = path.join(workspace, "packages", "app");
		mkdirSync(workflowsDir, { recursive: true });
		mkdirSync(nestedDir, { recursive: true });
		writeFileSync(
			path.join(workflowsDir, "release.md"),
			`---
name: release
---
Release checklist.`,
			"utf8",
		);
		spawnSync("git", ["init"], {
			cwd: workspace,
			encoding: "utf8",
		});

		const result = runCli(["config", "workflows"], {
			cwd: nestedDir,
			env: createIsolatedEnv(),
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("/release");
	});

	it("lists enabled workflows in json mode", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workflows-"));
		tempDirs.push(workspace);
		const workflowsDir = path.join(workspace, ".clinerules", "workflows");
		mkdirSync(workflowsDir, { recursive: true });
		writeFileSync(
			path.join(workflowsDir, "review.md"),
			`---
name: review
---
Review checklist.`,
			"utf8",
		);

		const result = runCli(["config", "workflows", "--json"], {
			cwd: workspace,
			env: createIsolatedEnv(),
		});
		expect(result.status).toBe(0);
		const parsed = JSON.parse(asText(result.stdout)) as Array<{
			name: string;
		}>;
		expect(parsed.some((workflow) => workflow.name === "review")).toBe(true);
	});

	it("includes Documents/Cline workflows", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workspace-"));
		tempDirs.push(homeDir, workspace);
		const docsWorkflowsDir = path.join(
			homeDir,
			"Documents",
			"Cline",
			"Workflows",
		);
		mkdirSync(docsWorkflowsDir, { recursive: true });
		writeFileSync(
			path.join(docsWorkflowsDir, "docs-release.md"),
			`---
name: docs-release
---
Release from docs path.`,
			"utf8",
		);

		const result = runCli(["config", "workflows"], {
			cwd: workspace,
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
			},
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("/docs-release");
	});

	it("lists enabled rules", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-rules-"));
		tempDirs.push(workspace);
		const rulesDir = path.join(workspace, ".clinerules");
		mkdirSync(rulesDir, { recursive: true });
		writeFileSync(
			path.join(rulesDir, "rule.md"),
			`---
name: no-force-push
---
Do not force push.`,
			"utf8",
		);

		const result = runCli(["config", "rules"], {
			cwd: workspace,
			env: createIsolatedEnv(),
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("Enabled rules:");
		expect(asText(result.stdout)).toContain("no-force-push");
		expect(asText(result.stdout)).toContain(path.join(rulesDir, "rule.md"));
	});

	it("lists enabled skills", () => {
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-skills-"));
		tempDirs.push(workspace);
		const skillsDir = path.join(workspace, ".clinerules", "skills", "commit");
		mkdirSync(skillsDir, { recursive: true });
		writeFileSync(
			path.join(skillsDir, "SKILL.md"),
			`---
name: commit
---
Create a concise commit message.`,
			"utf8",
		);

		const result = runCli(["config", "skills"], {
			cwd: workspace,
			env: createIsolatedEnv(),
		});
		expect(result.status).toBe(0);
		expect(asText(result.stdout)).toContain("Enabled skills:");
		expect(asText(result.stdout)).toContain("commit");
		expect(asText(result.stdout)).toContain(path.join(skillsDir, "SKILL.md"));
	});

	it("includes Documents/Cline rules and skills", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workspace-"));
		tempDirs.push(homeDir, workspace);
		const docsRulesDir = path.join(homeDir, "Documents", "Cline", "Rules");
		const docsSkillsDir = path.join(
			homeDir,
			"Documents",
			"Cline",
			"Skills",
			"review",
		);
		mkdirSync(docsRulesDir, { recursive: true });
		mkdirSync(docsSkillsDir, { recursive: true });
		writeFileSync(
			path.join(docsRulesDir, "docs-rule.md"),
			`---
name: docs-rule
---
Rule from docs path.`,
			"utf8",
		);
		writeFileSync(
			path.join(docsSkillsDir, "SKILL.md"),
			`---
name: docs-skill
---
Skill from docs path.`,
			"utf8",
		);

		const rulesResult = runCli(["config", "rules"], {
			cwd: workspace,
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
			},
		});
		expect(rulesResult.status).toBe(0);
		expect(asText(rulesResult.stdout)).toContain("docs-rule");

		const skillsResult = runCli(["config", "skills"], {
			cwd: workspace,
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
			},
		});
		expect(skillsResult.status).toBe(0);
		expect(asText(skillsResult.stdout)).toContain("docs-skill");
	});

	it("lists configured agents with source paths", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-data-"));
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workspace-"));
		tempDirs.push(homeDir, dataDir, workspace);
		const docsAgentsDir = path.join(homeDir, "Documents", "Cline", "Agents");
		const settingsAgentsDir = path.join(dataDir, "settings", "agents");
		mkdirSync(docsAgentsDir, { recursive: true });
		mkdirSync(settingsAgentsDir, { recursive: true });
		writeFileSync(
			path.join(docsAgentsDir, "reviewer.yaml"),
			`---
name: Reviewer
description: Reviews code changes
---
Review diffs thoroughly.`,
			"utf8",
		);
		writeFileSync(
			path.join(settingsAgentsDir, "planner.yaml"),
			`---
name: Planner
description: Plans implementation tasks
---
Break work into clear steps.`,
			"utf8",
		);

		const textResult = runCli(["config", "agents"], {
			cwd: workspace,
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
				CLINE_DATA_DIR: dataDir,
			},
		});
		expect(textResult.status).toBe(0);
		expect(asText(textResult.stdout)).toContain("Configured agents:");
		expect(asText(textResult.stdout)).toContain("Reviewer");
		expect(asText(textResult.stdout)).toContain("Planner");
		expect(asText(textResult.stdout)).toContain(
			path.join(docsAgentsDir, "reviewer.yaml"),
		);
		expect(asText(textResult.stdout)).toContain(
			path.join(settingsAgentsDir, "planner.yaml"),
		);

		const jsonResult = runCli(["config", "agents", "--json"], {
			cwd: workspace,
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
				CLINE_DATA_DIR: dataDir,
			},
		});
		expect(jsonResult.status).toBe(0);
		const parsed = JSON.parse(asText(jsonResult.stdout)) as Array<{
			name: string;
			path: string;
		}>;
		expect(parsed.some((agent) => agent.name === "Reviewer")).toBe(true);
		expect(parsed.some((agent) => agent.name === "Planner")).toBe(true);
		expect(
			parsed.some(
				(agent) => agent.path === path.join(docsAgentsDir, "reviewer.yaml"),
			),
		).toBe(true);
	});

	it("lists discovered plugins", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const dataDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-data-"));
		const workspace = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-workspace-"));
		tempDirs.push(homeDir, dataDir, workspace);
		const workspacePluginsDir = path.join(workspace, ".cline", "plugins");
		const userPluginsDir = path.join(homeDir, ".cline", "plugins");
		const documentsPluginsDir = path.join(
			homeDir,
			"Documents",
			"Cline",
			"Plugins",
		);
		mkdirSync(workspacePluginsDir, { recursive: true });
		mkdirSync(userPluginsDir, { recursive: true });
		mkdirSync(documentsPluginsDir, { recursive: true });
		writeFileSync(
			path.join(workspacePluginsDir, "workspace-plugin.ts"),
			"export default { name: 'workspace-plugin', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		writeFileSync(
			path.join(userPluginsDir, "user-plugin.js"),
			"export default { name: 'user-plugin', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);
		writeFileSync(
			path.join(documentsPluginsDir, "docs-plugin.ts"),
			"export default { name: 'docs-plugin', manifest: { capabilities: ['tools'] } };",
			"utf8",
		);

		const textResult = runCli(["config", "plugins"], {
			cwd: workspace,
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
				CLINE_DATA_DIR: dataDir,
			},
		});
		expect(textResult.status).toBe(0);
		expect(asText(textResult.stdout)).toContain("Discovered plugins:");
		expect(asText(textResult.stdout)).toContain("workspace-plugin");
		expect(asText(textResult.stdout)).toContain("user-plugin");
		expect(asText(textResult.stdout)).toContain("docs-plugin");
		expect(asText(textResult.stdout)).toContain(
			path.join(workspacePluginsDir, "workspace-plugin.ts"),
		);
		expect(asText(textResult.stdout)).toContain(
			path.join(userPluginsDir, "user-plugin.js"),
		);
		expect(asText(textResult.stdout)).toContain(
			path.join(documentsPluginsDir, "docs-plugin.ts"),
		);

		const jsonResult = runCli(["config", "plugins", "--json"], {
			cwd: workspace,
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
				CLINE_DATA_DIR: dataDir,
			},
		});
		expect(jsonResult.status).toBe(0);
		const parsed = JSON.parse(asText(jsonResult.stdout)) as Array<{
			name: string;
			path: string;
		}>;
		expect(parsed.some((plugin) => plugin.name === "workspace-plugin")).toBe(
			true,
		);
		expect(parsed.some((plugin) => plugin.name === "user-plugin")).toBe(true);
		expect(parsed.some((plugin) => plugin.name === "docs-plugin")).toBe(true);
		expect(
			parsed.some((plugin) =>
				plugin.path.endsWith(
					path.join(".cline", "plugins", "workspace-plugin.ts"),
				),
			),
		).toBe(true);
		expect(
			parsed.some((plugin) =>
				plugin.path.endsWith(path.join(".cline", "plugins", "user-plugin.js")),
			),
		).toBe(true);
		expect(
			parsed.some((plugin) =>
				plugin.path.endsWith(
					path.join("Documents", "Cline", "Plugins", "docs-plugin.ts"),
				),
			),
		).toBe(true);
	});

	it("lists configured mcp servers", () => {
		const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-mcp-"));
		tempDirs.push(tempRoot);
		const settingsPath = path.join(tempRoot, "cline_mcp_settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify(
				{
					mcpServers: {
						docs: {
							transport: {
								type: "stdio",
								command: "node",
							},
						},
						remote: {
							transport: {
								type: "streamableHttp",
								url: "https://mcp.example.com",
							},
							disabled: true,
						},
					},
				},
				null,
				2,
			),
			"utf8",
		);

		const textResult = runCli(["config", "mcp"], {
			env: {
				...createIsolatedEnv(),
				CLINE_MCP_SETTINGS_PATH: settingsPath,
			},
		});
		expect(textResult.status).toBe(0);
		expect(asText(textResult.stdout)).toContain("Configured MCP servers");
		expect(asText(textResult.stdout)).toContain("docs [stdio]");
		expect(asText(textResult.stdout)).toContain(
			"remote [streamableHttp] (disabled)",
		);

		const jsonResult = runCli(["config", "mcp", "--json"], {
			env: {
				...createIsolatedEnv(),
				CLINE_MCP_SETTINGS_PATH: settingsPath,
			},
		});
		expect(jsonResult.status).toBe(0);
		const parsed = JSON.parse(asText(jsonResult.stdout)) as Array<{
			name: string;
			transportType: string;
			disabled: boolean;
			path: string;
		}>;
		expect(parsed.some((server) => server.name === "docs")).toBe(true);
		expect(parsed.some((server) => server.name === "remote")).toBe(true);
		expect(
			parsed.some(
				(server) =>
					server.name === "remote" &&
					server.transportType === "streamableHttp" &&
					server.disabled === true &&
					server.path === settingsPath,
			),
		).toBe(true);
	});

	it("lists available tools", () => {
		const textResult = runCli(["config", "tools"], {
			env: createIsolatedEnv(),
		});
		expect(textResult.status).toBe(0);
		expect(asText(textResult.stdout)).toContain("Available tools:");
		expect(asText(textResult.stdout)).toContain("read_files");
		expect(asText(textResult.stdout)).not.toContain("submit_and_exit");

		const jsonResult = runCli(["config", "tools", "--json"], {
			env: createIsolatedEnv(),
		});
		expect(jsonResult.status).toBe(0);
		const parsed = JSON.parse(asText(jsonResult.stdout)) as Array<{
			name: string;
			type: string;
		}>;
		expect(parsed.some((tool) => tool.name === "run_commands")).toBe(true);
		expect(parsed.some((tool) => tool.name === "submit_and_exit")).toBe(false);
		expect(parsed.every((tool) => tool.type === "default")).toBe(true);
	});

	it("rejects invalid hook payloads", () => {
		const result = runCli(["hook"], {
			env: createIsolatedEnv(),
			stdin: JSON.stringify({ bad: "payload" }),
		});
		expect(result.status).toBe(1);
		expect(asText(result.stderr)).toContain("invalid hook payload");
	});

	it("accepts valid hook payloads and writes audit log", () => {
		const homeDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-home-"));
		const sessionDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-sessions-"));
		const logDir = mkdtempSync(path.join(os.tmpdir(), "cli-e2e-hooks-"));
		tempDirs.push(homeDir, sessionDir, logDir);
		const hookPath = path.join(logDir, "hook-events.jsonl");
		const defaultHookPath = path.join(
			homeDir,
			".cline",
			"data",
			"hooks",
			"hooks.jsonl",
		);
		const result = runCli(["hook"], {
			env: {
				...createIsolatedEnv(),
				HOME: homeDir,
				CLINE_SESSION_DATA_DIR: sessionDir,
				CLINE_HOOKS_LOG_PATH: hookPath,
			},
			stdin: JSON.stringify({
				hookName: "tool_call",
				taskId: "conversation_1",
				clineVersion: "",
				timestamp: new Date().toISOString(),
				workspaceRoots: [],
				userId: "agent_1",
				agent_id: "agent_1",
				parent_agent_id: null,
				tool_call: {
					id: "call_1",
					name: "read_files",
					input: { file_paths: ["README.md"] },
				},
			}),
		});

		expect(result.status).toBe(0);
		expect(asText(result.stdout).trim()).toBe("{}");
		const logPath = existsSync(hookPath) ? hookPath : defaultHookPath;
		const log = readFileSync(logPath, "utf8");
		expect(log).toContain('"hookName":"tool_call"');
		expect(log).toContain('"agent_id":"agent_1"');
	});
});
