import { existsSync, readdirSync, readFileSync } from "node:fs";
import {
	basename,
	dirname,
	extname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import {
	type AgentPluginPackageLoadReport,
	loadAgentPluginPackages,
} from "../extensions/agent-plugin";
import {
	createUserInstructionConfigService,
	type RuleConfig,
	type SkillConfig,
	type UserInstructionConfigService,
	type WorkflowConfig,
} from "../extensions/config";
import { toggleSkillFrontmatter } from "../extensions/config/skill-frontmatter-toggle";
import {
	hasMcpSettingsFile,
	resolveDefaultMcpSettingsPath,
	resolveMcpServerRegistrations,
	setMcpServerDisabled,
} from "../extensions/mcp";
import {
	discoverPluginModulePaths,
	resolveAgentPluginPaths,
	resolvePluginConfigSearchPaths,
	resolvePluginSkillDirectoriesFromPaths,
} from "../extensions/plugin/plugin-config-loader";
import {
	readGlobalSettings,
	resolveDisabledAgentPluginNames,
	setDisabledAgentPlugin,
	setDisabledPlugin,
	setToolDisabledGlobally,
	toggleDisabledTool,
} from "../services/global-settings";
import { listPluginToolsWithDiagnostics } from "../services/plugin-tools";
import type {
	CorePluginSettingsSource,
	CoreSettingsItem,
	CoreSettingsListInput,
	CoreSettingsMutationResult,
	CoreSettingsServiceOptions,
	CoreSettingsSnapshot,
	CoreSettingsToggleInput,
} from "./types";

function detectSource(
	filePath: string,
	workspaceRoot: string,
): "global" | "workspace" {
	if (!workspaceRoot) {
		return "global";
	}
	const relativePath = relative(workspaceRoot, filePath);
	return !relativePath.startsWith("..") && !isAbsolute(relativePath)
		? "workspace"
		: "global";
}

function detectPluginSource(
	filePath: string,
	workspaceRoot: string,
): "global-plugin" | "workspace-plugin" {
	return detectSource(filePath, workspaceRoot) === "workspace"
		? "workspace-plugin"
		: "global-plugin";
}

function isPathWithin(parentPath: string, childPath: string): boolean {
	const relativePath = relative(resolve(parentPath), resolve(childPath));
	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function readPackageName(packageJsonPath: string): string | undefined {
	try {
		const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
			name?: unknown;
		};
		return typeof packageJson.name === "string" && packageJson.name.trim()
			? packageJson.name.trim()
			: undefined;
	} catch {
		return undefined;
	}
}

function getPluginDisplayName(filePath: string, searchRoot?: string): string {
	let current = dirname(filePath);
	const root = searchRoot ? resolve(searchRoot) : undefined;
	while (!root || (current !== root && isPathWithin(root, current))) {
		const packageJsonPath = join(current, "package.json");
		if (existsSync(packageJsonPath)) {
			const packageName = readPackageName(packageJsonPath);
			if (packageName) {
				return packageName;
			}
			break;
		}
		const parent = dirname(current);
		if (parent === current) {
			break;
		}
		current = parent;
	}
	return basename(filePath, extname(filePath));
}

function listPluginSettings(input: {
	workspaceRoot: string;
}): CoreSettingsItem[] {
	const disabledPlugins = new Set(readGlobalSettings().disabledPlugins ?? []);
	const pluginsByPath = new Map<string, CoreSettingsItem>();
	for (const directory of resolvePluginConfigSearchPaths(
		input.workspaceRoot || undefined,
	)) {
		if (!existsSync(directory)) {
			continue;
		}
		try {
			for (const pluginPath of discoverPluginModulePaths(directory)) {
				if (pluginsByPath.has(pluginPath)) {
					continue;
				}
				pluginsByPath.set(pluginPath, {
					id: pluginPath,
					name: getPluginDisplayName(pluginPath, directory),
					path: pluginPath,
					enabled: !disabledPlugins.has(pluginPath),
					kind: "plugin",
					source: input.workspaceRoot
						? detectPluginSource(pluginPath, input.workspaceRoot)
						: "global-plugin",
					toggleable: true,
				});
			}
		} catch {
			// Plugin discovery is best-effort so one unreadable root does not hide
			// plugins from the other configured roots.
		}
	}
	return toSorted([...pluginsByPath.values()]);
}

type PluginSkillOwner = {
	directory: string;
	pluginName: string;
	pluginPath: string;
	source: "global-plugin" | "workspace-plugin";
};

function buildPluginSkillOwners(input: {
	workspaceRoot: string;
	cwd?: string;
}): PluginSkillOwner[] {
	const owners: PluginSkillOwner[] = [];
	for (const pluginPath of resolveAgentPluginPaths({
		workspacePath: input.workspaceRoot || undefined,
		cwd: input.cwd,
		includeDisabled: true,
	})) {
		for (const directory of resolvePluginSkillDirectoriesFromPaths([
			pluginPath,
		])) {
			owners.push({
				directory,
				pluginName: getPluginDisplayName(pluginPath),
				pluginPath,
				source: input.workspaceRoot
					? detectPluginSource(pluginPath, input.workspaceRoot)
					: "global-plugin",
			});
		}
	}
	return owners.sort(
		(left, right) => right.directory.length - left.directory.length,
	);
}

function listBundledPluginSkillNames(pluginPath: string): string[] {
	const names = new Set<string>();
	const visit = (directory: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const entryPath = join(directory, entry.name);
			if (entry.isDirectory()) {
				visit(entryPath);
			} else if (
				entry.isFile() &&
				extname(entry.name).toLowerCase() === ".md"
			) {
				const fileName = basename(entry.name, extname(entry.name));
				names.add(
					fileName.toLowerCase() === "skill"
						? basename(dirname(entryPath))
						: fileName,
				);
			}
		}
	};

	for (const directory of resolvePluginSkillDirectoriesFromPaths([
		pluginPath,
	])) {
		try {
			visit(directory);
		} catch {
			// Bundled plugin assets are optional and discovery is best-effort.
		}
	}
	return [...names].sort();
}

function findPluginSkillOwner(
	filePath: string,
	owners: readonly PluginSkillOwner[],
): PluginSkillOwner | undefined {
	return owners.find((owner) => isPathWithin(owner.directory, filePath));
}

function toSorted<T extends CoreSettingsItem>(items: T[]): T[] {
	return [...items].sort((a, b) => {
		const sourceRank = (source: CoreSettingsItem["source"]): number => {
			switch (source) {
				case "workspace":
				case "workspace-plugin":
					return 0;
				case "global":
				case "global-plugin":
					return 1;
				case "builtin":
					return 2;
			}
		};
		if (a.source !== b.source) {
			return sourceRank(a.source) - sourceRank(b.source);
		}
		return a.name.localeCompare(b.name);
	});
}

function agentPluginItemSource(
	pluginRoot: string,
	workspaceRoot: string,
): "global-plugin" | "workspace-plugin" {
	return workspaceRoot &&
		detectSource(pluginRoot, workspaceRoot) === "workspace"
		? "workspace-plugin"
		: "global-plugin";
}

function joinAgentPluginDiagnostics(
	report: AgentPluginPackageLoadReport,
	pluginRoot: string,
): string | undefined {
	const messages = report.diagnostics
		.filter((entry) => entry.pluginPath === pluginRoot)
		.map((entry) => entry.message);
	return messages.length > 0 ? messages.join("\n") : undefined;
}

function appendAgentPluginSettings(input: {
	report: AgentPluginPackageLoadReport;
	workspaceRoot: string;
	disabledPluginNames: ReadonlySet<string>;
	plugins: CoreSettingsItem[];
	skills: CoreSettingsItem[];
	mcp: CoreSettingsItem[];
}): void {
	const loadedRoots = new Set<string>();
	for (const plugin of input.report.plugins) {
		loadedRoots.add(plugin.rootPath);
		const enabled = !input.disabledPluginNames.has(plugin.manifest.name);
		const source = agentPluginItemSource(plugin.rootPath, input.workspaceRoot);
		const skillNames = plugin.skills.map((skill) => skill.metadata.name).sort();
		const mcpServerNames = plugin.mcpServers
			.map((server) => server.registration.name)
			.sort();
		const componentSummary = [
			`${skillNames.length} skill${skillNames.length === 1 ? "" : "s"}`,
			`${mcpServerNames.length} MCP server${mcpServerNames.length === 1 ? "" : "s"}`,
		].join(", ");
		input.plugins.push({
			id: `agent-plugin:${plugin.manifest.name}`,
			name: plugin.manifest.name,
			path: plugin.rootPath,
			enabled,
			kind: "plugin",
			source,
			toggleable: true,
			agentPlugin: true,
			pluginName: plugin.manifest.name,
			pluginPath: plugin.rootPath,
			description: [
				plugin.manifest.description,
				`Portable Agent Plugin${plugin.manifest.version ? ` v${plugin.manifest.version}` : ""} (${componentSummary})`,
			]
				.filter(Boolean)
				.join("\n"),
			loadError: joinAgentPluginDiagnostics(input.report, plugin.rootPath),
			contributions: {
				inspectionStatus: enabled ? "available" : "disabled",
				capabilities: [
					...(skillNames.length > 0 ? ["skills"] : []),
					...(mcpServerNames.length > 0 ? ["mcp"] : []),
				],
				tools: [],
				skills: skillNames,
				rules: [],
				hooks: [],
				commands: [],
				mcpServers: mcpServerNames,
				providers: [],
			},
		});
		if (!enabled) {
			continue;
		}

		for (const skill of plugin.skills) {
			input.skills.push({
				id: `${plugin.manifest.name}:${skill.metadata.name}`,
				name: skill.metadata.name,
				path: skill.filePath,
				enabled: true,
				kind: "skill",
				source,
				description: skill.metadata.description,
				toggleable: false,
				agentPlugin: true,
				pluginName: plugin.manifest.name,
				pluginPath: plugin.rootPath,
			});
		}

		for (const server of plugin.mcpServers) {
			input.mcp.push({
				id: server.registration.name,
				name: server.registration.name,
				path: join(plugin.rootPath, "mcp.json"),
				enabled: true,
				kind: "mcp",
				source,
				description: `${server.registration.transport.type}, portable Agent Plugin`,
				toggleable: false,
				agentPlugin: true,
				pluginName: plugin.manifest.name,
				pluginPath: plugin.rootPath,
			});
		}
	}

	const rejectedRoots = new Set(
		input.report.diagnostics
			.filter(
				(entry) =>
					!loadedRoots.has(entry.pluginPath) &&
					(entry.scope === "plugin" || entry.scope === "manifest"),
			)
			.map((entry) => entry.pluginPath),
	);
	for (const pluginRoot of rejectedRoots) {
		input.plugins.push({
			id: `agent-plugin:invalid:${pluginRoot}`,
			name: basename(pluginRoot) || pluginRoot,
			path: pluginRoot,
			enabled: false,
			kind: "plugin",
			source: agentPluginItemSource(pluginRoot, input.workspaceRoot),
			toggleable: false,
			agentPlugin: true,
			pluginPath: pluginRoot,
			description: "Invalid portable Agent Plugin package.",
			loadError: joinAgentPluginDiagnostics(input.report, pluginRoot),
			contributions: {
				inspectionStatus: "failed",
				capabilities: [],
				tools: [],
				skills: [],
				rules: [],
				hooks: [],
				commands: [],
				mcpServers: [],
				providers: [],
			},
		});
	}
}

function resolveWorkspaceRoot(input: CoreSettingsListInput): string {
	return input.workspaceRoot?.trim() || input.cwd?.trim() || "";
}

function resolveCwd(
	input: CoreSettingsListInput,
	workspaceRoot: string,
): string {
	return input.cwd?.trim() || workspaceRoot || process.cwd();
}

async function withUserInstructionService<T>(
	input: CoreSettingsListInput,
	run: (service?: UserInstructionConfigService) => Promise<T>,
): Promise<T> {
	if (input.userInstructionService) {
		return await run(input.userInstructionService);
	}
	const workspaceRoot = resolveWorkspaceRoot(input);
	const cwd = resolveCwd(input, workspaceRoot);
	const service = createUserInstructionConfigService({
		skills: {
			workspacePath: workspaceRoot || undefined,
			includePluginSkills: true,
			cwd,
		},
		rules: { workspacePath: workspaceRoot || undefined },
		workflows: { workspacePath: workspaceRoot || undefined },
	});
	try {
		await service.start();
		return await run(service);
	} finally {
		service.stop();
	}
}

function findSkillRecord(
	service: UserInstructionConfigService | undefined,
	input: CoreSettingsToggleInput,
) {
	if (!service) {
		return undefined;
	}
	const records = service.listRecords<SkillConfig>("skill");
	if (input.id) {
		const match = records.find((record) => record.id === input.id);
		if (match) {
			return match;
		}
	}
	for (const record of records) {
		if (
			record.filePath === input.path ||
			record.item.name === input.name ||
			record.id === input.name
		) {
			return record;
		}
	}
	return undefined;
}

export class CoreSettingsService {
	private readonly pluginSource: CorePluginSettingsSource | undefined;

	constructor(options: CoreSettingsServiceOptions = {}) {
		this.pluginSource = options.pluginSource;
	}

	async list(input: CoreSettingsListInput = {}): Promise<CoreSettingsSnapshot> {
		return await withUserInstructionService(input, async (service) => {
			const workspaceRoot = resolveWorkspaceRoot(input);
			const pluginSkillOwners = buildPluginSkillOwners({
				workspaceRoot,
				cwd: resolveCwd(input, workspaceRoot),
			});
			const workflows: CoreSettingsItem[] = [];
			const rules: CoreSettingsItem[] = [];
			const skills: CoreSettingsItem[] = [];
			const plugins = this.pluginSource
				? []
				: listPluginSettings({ workspaceRoot });
			const tools: CoreSettingsItem[] = [];
			const mcp: CoreSettingsItem[] = [];
			if (this.pluginSource) {
				const supplied = await this.pluginSource.list(input);
				plugins.push(...supplied.plugins);
				tools.push(...supplied.tools);
			}
			try {
				const report = await loadAgentPluginPackages({
					pluginPaths: input.agentPluginPaths,
					cwd: resolveCwd(input, workspaceRoot),
				});
				appendAgentPluginSettings({
					report,
					workspaceRoot,
					disabledPluginNames: resolveDisabledAgentPluginNames(),
					plugins,
					skills,
					mcp,
				});
			} catch (error) {
				// Portable package discovery is isolated from all other settings.
				const message = error instanceof Error ? error.message : String(error);
				console.warn(
					`[agent-plugins] Package discovery failed; listing settings without Agent Plugins: ${message}`,
				);
			}
			const enabledPluginPaths = new Set(
				plugins
					.filter((plugin) => plugin.enabled !== false)
					.map((plugin) => plugin.path),
			);

			if (service) {
				for (const record of service.listRecords<WorkflowConfig>("workflow")) {
					const workflow = record.item;
					workflows.push({
						id: record.id,
						name: workflow.name,
						path: record.filePath,
						enabled: workflow.disabled !== true,
						kind: "workflow",
						source: detectSource(record.filePath, workspaceRoot),
						description: workflow.instructions,
						toggleable: false,
					});
				}
				for (const record of service.listRecords<RuleConfig>("rule")) {
					const rule = record.item;
					rules.push({
						id: record.id,
						name: rule.name,
						path: record.filePath,
						enabled: rule.disabled !== true,
						kind: "rule",
						source: detectSource(record.filePath, workspaceRoot),
						description: rule.instructions,
						toggleable: false,
					});
				}
				for (const record of service.listRecords<SkillConfig>("skill")) {
					const skill = record.item;
					const pluginOwner = findPluginSkillOwner(
						record.filePath,
						pluginSkillOwners,
					);
					skills.push({
						id: record.id,
						name: skill.name,
						path: record.filePath,
						enabled: skill.disabled !== true,
						kind: "skill",
						source:
							pluginOwner?.source ??
							detectSource(record.filePath, workspaceRoot),
						description: skill.description,
						pluginName: pluginOwner?.pluginName,
						pluginPath: pluginOwner?.pluginPath,
						toggleable: true,
					});
				}
			}

			if (
				workspaceRoot &&
				!this.pluginSource &&
				input.includePluginTools !== false
			) {
				try {
					const pluginReport = await listPluginToolsWithDiagnostics({
						workspacePath: workspaceRoot,
						cwd: input.cwd,
						providerId: input.availabilityContext?.providerId,
						modelId: input.availabilityContext?.modelId,
					});
					for (const pluginTool of pluginReport.tools) {
						tools.push({
							id: `${pluginTool.pluginName}:${pluginTool.name}:${pluginTool.path}`,
							name: pluginTool.name,
							path: pluginTool.path,
							enabled:
								pluginTool.enabled && enabledPluginPaths.has(pluginTool.path),
							kind: "tool",
							source: pluginTool.source,
							description: pluginTool.description,
							toggleable: true,
							pluginName: pluginTool.pluginName,
							pluginPath: pluginTool.path,
						});
					}
					const contributionByPath = new Map(
						pluginReport.plugins.map((plugin) => [plugin.path, plugin]),
					);
					for (const plugin of plugins) {
						if (plugin.agentPlugin === true) {
							continue;
						}
						const contribution = contributionByPath.get(plugin.path);
						plugin.contributions = {
							inspectionStatus:
								plugin.enabled === false
									? "disabled"
									: contribution
										? "available"
										: "failed",
							capabilities: contribution?.capabilities ?? [],
							tools: contribution?.tools ?? [],
							skills: [
								...new Set([
									...listBundledPluginSkillNames(plugin.path),
									...skills
										.filter((skill) => skill.pluginPath === plugin.path)
										.map((skill) => skill.name),
								]),
							].sort(),
							rules: contribution?.rules ?? [],
							hooks: contribution?.hooks ?? [],
							commands: contribution?.commands ?? [],
							mcpServers: contribution?.mcpServers ?? [],
							providers: contribution?.providers ?? [],
						};
					}
				} catch {
					// Settings listing is best-effort; unreadable plugin roots should
					// not hide rules, skills, workflows, or built-in tools.
				}
			}

			const mcpSettingsPath = resolveDefaultMcpSettingsPath();
			if (hasMcpSettingsFile({ filePath: mcpSettingsPath })) {
				try {
					for (const registration of resolveMcpServerRegistrations({
						filePath: mcpSettingsPath,
					})) {
						mcp.push({
							id: registration.name,
							name: registration.name,
							path: mcpSettingsPath,
							enabled: registration.disabled !== true,
							kind: "mcp",
							source: detectSource(mcpSettingsPath, workspaceRoot),
							description: registration.transport.type,
							toggleable: true,
						});
					}
				} catch {
					// Settings listing is best-effort; unreadable MCP settings should
					// not hide rules, skills, workflows, or tools.
				}
			}

			return {
				workflows: toSorted(workflows.filter((item) => existsSync(item.path))),
				rules: toSorted(rules.filter((item) => existsSync(item.path))),
				plugins,
				skills: toSorted(skills.filter((item) => existsSync(item.path))),
				tools: toSorted(tools),
				mcp: toSorted(mcp.filter((item) => existsSync(item.path))),
			};
		});
	}

	async toggle(
		input: CoreSettingsToggleInput,
	): Promise<CoreSettingsMutationResult> {
		if (input.type === "skills") {
			return await withUserInstructionService(input, async (service) => {
				const record = findSkillRecord(service, input);
				if (record?.item.source?.type === "agent-plugin") {
					// Agent Plugin skills are only toggleable as part of their
					// plugin (`type: "plugins"`). Writing `disabled` into the
					// skill's frontmatter would corrupt it: the strict Agent
					// Skills parser rejects any field outside its closed set,
					// so the skill would fail to load on the very next refresh.
					throw new Error(
						`Skill '${record.item.name}' is contributed by the Agent Plugin '${record.item.source.pluginName}' and cannot be toggled individually; toggle the plugin instead.`,
					);
				}
				const filePath = record?.filePath;
				if (!filePath) {
					throw new Error(
						`Unable to resolve skill setting '${input.id ?? input.name ?? basename(input.path ?? "")}'.`,
					);
				}
				const currentEnabled =
					record?.item && "disabled" in record.item
						? (record.item as SkillConfig).disabled !== true
						: undefined;
				const enabled =
					input.enabled ??
					(currentEnabled !== undefined ? !currentEnabled : undefined);
				if (enabled === undefined) {
					throw new Error(
						`Cannot determine toggle state for skill '${input.id ?? input.name ?? basename(input.path ?? "")}'; provide an explicit enabled value or a resolvable workspace context.`,
					);
				}
				await toggleSkillFrontmatter({ filePath, enabled });
				await service?.refreshType("skill");
				return {
					snapshot: await this.list({
						...input,
						userInstructionService: service,
					}),
					changedTypes: ["skills"],
				};
			});
		}

		if (input.type === "tools") {
			if (!input.name?.trim()) {
				throw new Error("Tool settings toggle requires a tool name.");
			}
			if (input.enabled === undefined) {
				toggleDisabledTool(input.name);
			} else {
				setToolDisabledGlobally(input.name, !input.enabled);
			}
			return {
				snapshot: await this.list(input),
				changedTypes: ["tools"],
			};
		}

		if (input.type === "plugins") {
			const snapshotBeforeMutation = await this.list(input);
			const requestedId = input.id?.trim();
			const requestedPath = input.path?.trim();
			const requestedName = input.name?.trim();
			const plugin = snapshotBeforeMutation.plugins.find(
				(item) =>
					(requestedId && item.id === requestedId) ||
					(requestedPath && item.path === requestedPath) ||
					(requestedName && item.name === requestedName),
			);
			if (!plugin) {
				throw new Error(
					`Unknown plugin: ${requestedPath ?? requestedId ?? requestedName ?? "(missing target)"}`,
				);
			}

			if (plugin.agentPlugin === true) {
				if (plugin.toggleable !== true) {
					throw new Error(`Agent Plugin '${plugin.name}' cannot be toggled.`);
				}
				const enabled = input.enabled ?? plugin.enabled === false;
				setDisabledAgentPlugin(plugin.pluginName ?? plugin.name, !enabled);
				return {
					snapshot: await this.list(input),
					changedTypes: ["plugins", "skills", "mcp"],
				};
			}

			const pluginPath = plugin.path;
			if (this.pluginSource) {
				let enabled = input.enabled;
				if (enabled === undefined) {
					enabled = !plugin.enabled;
				}
				const sourceSnapshot = await this.pluginSource.setEnabled({
					path: pluginPath,
					enabled,
					cwd: input.cwd,
					workspaceRoot: input.workspaceRoot,
				});
				return {
					snapshot: {
						...snapshotBeforeMutation,
						plugins: [
							...sourceSnapshot.plugins,
							...snapshotBeforeMutation.plugins.filter(
								(item) => item.agentPlugin === true,
							),
						],
						tools: toSorted(sourceSnapshot.tools),
					},
					changedTypes: ["plugins"],
				};
			}

			let enabled = input.enabled;
			if (enabled === undefined) {
				enabled = !plugin.enabled;
			}
			setDisabledPlugin(pluginPath, !enabled);
			return {
				snapshot: await this.list(input),
				changedTypes: ["plugins"],
			};
		}

		if (input.type === "mcp") {
			const name = input.name?.trim() || input.id?.trim();
			if (!name) {
				throw new Error("MCP server settings toggle requires a server name.");
			}
			const filePath = input.path?.trim() || resolveDefaultMcpSettingsPath();
			let targetEnabled = input.enabled;
			if (targetEnabled === undefined) {
				const current = resolveMcpServerRegistrations({ filePath }).find(
					(registration) => registration.name === name,
				);
				if (!current) {
					throw new Error(`Unknown MCP server: ${name}`);
				}
				targetEnabled = current.disabled === true;
			}
			setMcpServerDisabled({
				filePath,
				name,
				disabled: !targetEnabled,
			});
			return {
				snapshot: await this.list(input),
				changedTypes: ["mcp"],
			};
		}

		throw new Error(`Settings type '${input.type}' does not support toggles.`);
	}
}

export function createCoreSettingsService(
	options: CoreSettingsServiceOptions = {},
): CoreSettingsService {
	return new CoreSettingsService(options);
}
