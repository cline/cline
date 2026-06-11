import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import * as p from "@clack/prompts";
import {
	type ConfiguredAgentConfig,
	type ConfiguredAgentPluginRef,
	discoverPluginModulePaths,
	loadConfiguredAgentConfigs,
	parseConfiguredAgentConfig,
	resolvePluginConfigSearchPaths,
} from "@cline/core";
import {
	getPluginDisplayName,
	resolveAgentsConfigDirPath,
} from "@cline/shared/storage";
import { resolveWorkspaceRoot } from "../utils/helpers";
import {
	downloadRemoteFile,
	isLocalPathLike,
	isOfficialRegistrySlug,
	normalizeRemoteSingleFileUrl,
	resolveHomePath,
	runCommand,
	sanitizeSegment,
} from "./install-utils";
import { installPlugin } from "./plugin";

export interface AgentCommandIo {
	writeln: (text?: string) => void;
	writeErr: (text: string) => void;
}

export interface AgentInstallOptions {
	source: string;
	force?: boolean;
	/** Install profile-declared plugins without asking. */
	yes?: boolean;
	json?: boolean;
	cwd?: string;
	officialAgentsRepo?: string;
	io?: AgentCommandIo;
}

export interface AgentInstallResult {
	source: string;
	name: string;
	installPath: string;
	/** Plugin names by outcome, one consistent shape across categories. */
	plugins: {
		alreadyInstalled: string[];
		installed: string[];
		failed: string[];
		skipped: string[];
		manual: string[];
	};
}

export type ParsedAgentSource =
	| { type: "official"; slug: string }
	| { type: "remote"; url: string; filename: string }
	| { type: "local"; path: string };

export const OFFICIAL_AGENTS_REPO = "https://github.com/cline/agents.git";
const AGENTS_REPO_DIRECTORY_NAME = "agents";
const REMOTE_AGENT_FETCH_TIMEOUT_MS = 30_000;
const REMOTE_AGENT_MAX_BYTES = 1024 * 1024;
const AGENT_SOURCE_KIND = "agent profile";

function isAgentConfigFilename(filename: string): boolean {
	const extension = extname(filename).toLowerCase();
	return extension === ".yml" || extension === ".yaml";
}

export function parseAgentSource(source: string): ParsedAgentSource {
	const trimmed = source.trim();
	if (!trimmed) {
		throw new Error("agent install requires a source");
	}
	if (isLocalPathLike(trimmed)) {
		return { type: "local", path: source };
	}
	const remote = normalizeRemoteSingleFileUrl(trimmed, {
		isExpectedFile: isAgentConfigFilename,
		kind: AGENT_SOURCE_KIND,
		extensionsLabel: ".yml or .yaml",
		fallbackFilename: "agent.yml",
	});
	if (remote) {
		return { type: "remote", ...remote };
	}
	if (isOfficialRegistrySlug(trimmed)) {
		return { type: "official", slug: trimmed };
	}
	return { type: "local", path: source };
}

async function fetchOfficialAgentProfile(
	slug: string,
	officialAgentsRepo: string,
): Promise<string> {
	const stagingRoot = await mkdtemp(join(tmpdir(), "cline-agent-install-"));
	try {
		await runCommand("git", [
			"clone",
			"--filter=blob:none",
			"--depth",
			"1",
			"--",
			officialAgentsRepo,
			stagingRoot,
		]);
		for (const extension of [".yml", ".yaml"]) {
			const candidate = join(
				stagingRoot,
				AGENTS_REPO_DIRECTORY_NAME,
				`${slug}${extension}`,
			);
			if (existsSync(candidate)) {
				return readFileSync(candidate, "utf8");
			}
		}
		throw new Error(
			`Official Cline agent "${slug}" was not found at ${AGENTS_REPO_DIRECTORY_NAME}/${slug}.yml in ${officialAgentsRepo}`,
		);
	} finally {
		await rm(stagingRoot, { recursive: true, force: true });
	}
}

async function fetchAgentProfileContent(
	parsed: ParsedAgentSource,
	cwd: string,
	officialAgentsRepo: string,
): Promise<string> {
	if (parsed.type === "official") {
		return fetchOfficialAgentProfile(parsed.slug, officialAgentsRepo);
	}
	if (parsed.type === "remote") {
		const body = await downloadRemoteFile(parsed.url, {
			timeoutMs: REMOTE_AGENT_FETCH_TIMEOUT_MS,
			maxBytes: REMOTE_AGENT_MAX_BYTES,
			kind: AGENT_SOURCE_KIND,
		});
		return body.toString("utf8");
	}
	const absolutePath = resolve(cwd, resolveHomePath(parsed.path));
	if (!existsSync(absolutePath)) {
		throw new Error(`Agent profile path does not exist: ${absolutePath}`);
	}
	if (!isAgentConfigFilename(absolutePath)) {
		throw new Error(`Agent profile must be .yml or .yaml: ${absolutePath}`);
	}
	return readFileSync(absolutePath, "utf8");
}

export interface AgentPluginInstallPlan {
	/** Listed plugins already installed (matched by display name). */
	alreadyInstalled: ConfiguredAgentPluginRef[];
	/** Listed plugins with an install source, not installed yet. */
	installable: ConfiguredAgentPluginRef[];
	/** Listed plugins with no install source and no local match. */
	manual: ConfiguredAgentPluginRef[];
}

export function planAgentPluginInstalls(
	plugins: ConfiguredAgentPluginRef[] | undefined,
): AgentPluginInstallPlan {
	const plan: AgentPluginInstallPlan = {
		alreadyInstalled: [],
		installable: [],
		manual: [],
	};
	if (!plugins?.length) {
		return plan;
	}
	const installedNames = new Set<string>();
	// Global plugin directories only: the profile installs globally, so a
	// workspace-local plugin cannot satisfy its dependencies.
	for (const directory of resolvePluginConfigSearchPaths(undefined)) {
		let pluginPaths: string[] = [];
		try {
			pluginPaths = discoverPluginModulePaths(directory);
		} catch {
			// Best effort: skip unreadable plugin roots.
		}
		for (const pluginPath of pluginPaths) {
			try {
				installedNames.add(getPluginDisplayName(pluginPath).toLowerCase());
			} catch {
				// Best effort: one unreadable plugin should not hide the rest.
			}
		}
	}
	for (const ref of plugins) {
		if (installedNames.has(ref.name.toLowerCase())) {
			plan.alreadyInstalled.push(ref);
		} else if (ref.install) {
			plan.installable.push(ref);
		} else {
			plan.manual.push(ref);
		}
	}
	return plan;
}

export function installAgentProfile(options: {
	content: string;
	source: string;
	force?: boolean;
}): { config: ConfiguredAgentConfig; installPath: string } {
	let config: ConfiguredAgentConfig;
	try {
		config = parseConfiguredAgentConfig(options.content);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Invalid agent profile from ${options.source}: ${message}`);
	}

	const agentsDir = resolveAgentsConfigDirPath();
	const installPath = join(
		agentsDir,
		`${sanitizeSegment(config.name.toLowerCase(), "agent")}.yml`,
	);
	if (existsSync(installPath) && options.force !== true) {
		throw new Error(
			`Agent profile is already installed at ${installPath}. Use --force to replace it.`,
		);
	}
	mkdirSync(agentsDir, { recursive: true });
	writeFileSync(installPath, options.content, "utf8");
	return { config, installPath };
}

function formatPluginRef(ref: ConfiguredAgentPluginRef): string {
	return ref.install && ref.install !== ref.name
		? `${ref.name} (${ref.install})`
		: ref.name;
}

async function installPluginDependencies(input: {
	refs: ConfiguredAgentPluginRef[];
	wizard: boolean;
	io?: AgentCommandIo;
}): Promise<{ installed: string[]; failed: string[] }> {
	const installed: string[] = [];
	const failed: string[] = [];
	for (const ref of input.refs) {
		const source = ref.install ?? ref.name;
		const spinner = input.wizard ? p.spinner() : undefined;
		spinner?.start(`Installing plugin ${ref.name}`);
		try {
			const result = await installPlugin({ source });
			spinner?.stop(`Installed plugin ${ref.name}`);
			if (!input.wizard) {
				input.io?.writeln(
					`Installed plugin ${ref.name} at ${result.installPath}`,
				);
			}
			installed.push(ref.name);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			spinner?.stop(`Failed to install plugin ${ref.name}: ${message}`);
			if (!input.wizard) {
				input.io?.writeErr(`Failed to install plugin ${ref.name}: ${message}`);
			}
			failed.push(ref.name);
		}
	}
	return { installed, failed };
}

export async function runAgentInstallCommand(
	options: AgentInstallOptions,
): Promise<number> {
	const json = options.json === true;
	const wizard = !json && process.stdout.isTTY === true;
	const cwd = options.cwd?.trim() ? resolve(options.cwd) : process.cwd();
	const officialAgentsRepo =
		options.officialAgentsRepo?.trim() || OFFICIAL_AGENTS_REPO;

	try {
		if (wizard) {
			p.intro("cline agent install");
		}
		const parsed = parseAgentSource(options.source);
		const content = await fetchAgentProfileContent(
			parsed,
			cwd,
			officialAgentsRepo,
		);
		const { config, installPath } = installAgentProfile({
			content,
			source: options.source.trim(),
			force: options.force,
		});
		if (wizard) {
			p.log.success(`Installed agent profile "${config.name}"`);
			p.log.info(`Path: ${installPath}`);
		} else if (!json) {
			options.io?.writeln(`Installed agent profile "${config.name}"`);
			options.io?.writeln(`  Path: ${installPath}`);
		}

		const plan = planAgentPluginInstalls(config.plugins);
		const reportLine = (text: string) => {
			if (wizard) {
				p.log.info(text);
			} else if (!json) {
				options.io?.writeln(text);
			}
		};
		for (const ref of plan.alreadyInstalled) {
			reportLine(`Plugin ${ref.name} is already installed`);
		}
		for (const ref of plan.manual) {
			reportLine(
				`Profile references plugin ${ref.name} with no install source; install it manually with: cline plugin install <source>`,
			);
		}

		let installed: string[] = [];
		let failed: string[] = [];
		let skipped: string[] = [];
		if (plan.installable.length > 0) {
			// Profile-declared plugin installs run arbitrary code; never install
			// them without an explicit confirmation or --yes.
			let confirmed = options.yes === true;
			if (!confirmed && wizard) {
				const lines = plan.installable.map(formatPluginRef).join("\n");
				p.note(lines, "This agent profile wants to install plugins");
				const answer = await p.confirm({
					message: `Install ${plan.installable.length} plugin${plan.installable.length === 1 ? "" : "s"}?`,
				});
				if (p.isCancel(answer)) {
					p.cancel(
						`Cancelled. The agent profile is installed at ${installPath}; install its plugins later with cline plugin install.`,
					);
					return 1;
				}
				confirmed = answer === true;
			}
			if (confirmed) {
				const result = await installPluginDependencies({
					refs: plan.installable,
					wizard,
					io: options.io,
				});
				installed = result.installed;
				failed = result.failed;
			} else {
				skipped = plan.installable.map((ref) => ref.name);
				const sources = plan.installable
					.map((ref) => `cline plugin install ${ref.install ?? ref.name}`)
					.join("; ");
				reportLine(`Skipped plugin installs. Run manually: ${sources}`);
			}
		}

		if (wizard) {
			p.outro(
				failed.length > 0
					? "Done with errors"
					: `Agent "${config.name}" is ready. Switch to it with /agents or --agent ${config.name}.`,
			);
		}
		if (json) {
			const result: AgentInstallResult = {
				source: options.source.trim(),
				name: config.name,
				installPath,
				plugins: {
					alreadyInstalled: plan.alreadyInstalled.map((ref) => ref.name),
					installed,
					failed,
					skipped,
					manual: plan.manual.map((ref) => ref.name),
				},
			};
			process.stdout.write(JSON.stringify(result));
		}
		return failed.length > 0 ? 1 : 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (wizard) {
			p.cancel(message);
		} else {
			options.io?.writeErr(message);
		}
		return 1;
	}
}

export interface AgentUninstallResult {
	name: string;
	installPath: string;
}

export function uninstallAgentProfile(name: string): AgentUninstallResult {
	const trimmed = name.trim();
	if (!trimmed) {
		throw new Error("agent uninstall requires a profile name");
	}
	const agentsDir = resolveAgentsConfigDirPath();
	const normalized = trimmed.toLowerCase();
	const available: string[] = [];
	let entries: string[];
	try {
		entries = readdirSync(agentsDir);
	} catch {
		entries = [];
	}
	for (const entry of entries) {
		if (!isAgentConfigFilename(entry)) {
			continue;
		}
		const filePath = join(agentsDir, entry);
		let profileName = basename(entry, extname(entry));
		try {
			profileName = parseConfiguredAgentConfig(
				readFileSync(filePath, "utf8"),
			).name;
		} catch {
			// Unparseable file: fall back to matching the filename.
		}
		available.push(profileName);
		if (
			profileName.trim().toLowerCase() === normalized ||
			basename(entry, extname(entry)).toLowerCase() === normalized
		) {
			rmSync(filePath);
			return { name: profileName, installPath: filePath };
		}
	}
	throw new Error(
		available.length > 0
			? `Agent profile "${trimmed}" was not found in ${agentsDir} (available: ${available.join(", ")})`
			: `Agent profile "${trimmed}" was not found (no agent profiles in ${agentsDir})`,
	);
}

export async function runAgentUninstallCommand(options: {
	name: string;
	json?: boolean;
	io?: AgentCommandIo;
}): Promise<number> {
	try {
		const result = uninstallAgentProfile(options.name);
		if (options.json) {
			process.stdout.write(JSON.stringify(result));
			return 0;
		}
		options.io?.writeln(`Uninstalled agent profile "${result.name}"`);
		options.io?.writeln(`  Removed: ${result.installPath}`);
		return 0;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		options.io?.writeErr(message);
		return 1;
	}
}

export async function runAgentListCommand(options: {
	cwd?: string;
	json?: boolean;
	io?: AgentCommandIo;
}): Promise<number> {
	const workspaceRoot = resolveWorkspaceRoot(
		options.cwd?.trim() ? resolve(options.cwd) : process.cwd(),
	);
	const { configs, errors } = loadConfiguredAgentConfigs({ workspaceRoot });
	if (options.json) {
		process.stdout.write(
			JSON.stringify({
				agents: configs.map((config) => ({
					name: config.name,
					description: config.description,
					path: config.path,
					plugins: config.plugins,
				})),
				errors: errors.map((error) => ({
					path: error.path,
					message: error.error.message,
				})),
			}),
		);
		return 0;
	}
	if (configs.length === 0 && errors.length === 0) {
		options.io?.writeln(
			"No agent profiles found. Install one with: cline agent install <source>",
		);
		return 0;
	}
	for (const config of configs) {
		options.io?.writeln(`${config.name}  ${config.description}`);
		if (config.path) {
			options.io?.writeln(`  path: ${config.path}`);
		}
		if (config.plugins?.length) {
			options.io?.writeln(
				`  plugins: ${config.plugins.map((plugin) => plugin.name).join(", ")}`,
			);
		}
	}
	for (const error of errors) {
		options.io?.writeErr(
			`failed to load ${error.path}: ${error.error.message}`,
		);
	}
	return errors.length > 0 ? 1 : 0;
}
