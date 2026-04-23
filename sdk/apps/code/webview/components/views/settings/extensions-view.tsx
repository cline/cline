"use client";

import {
	Bot,
	Code,
	FileText,
	FolderOpen,
	Play,
	Puzzle,
	RefreshCw,
	TriangleAlert,
	Wrench,
	Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

type ShortcutTab =
	| "Rules"
	| "Hooks"
	| "Skills"
	| "Agents"
	| "Plugins"
	| "Tools";

type RuleItem = {
	name: string;
	instructions: string;
	path: string;
};

type WorkflowItem = {
	id: string;
	name: string;
	instructions: string;
	path: string;
};

type SkillItem = {
	name: string;
	description?: string;
	instructions: string;
	path: string;
};

type CommandItem = {
	id: string;
	type: "workflow" | "skill";
	name: string;
	description?: string;
	instructions: string;
	path: string;
};

type AgentItem = {
	name: string;
	path: string;
};

type PluginItem = {
	name: string;
	path: string;
};

type ToolItem = {
	id: string;
	name: string;
	description?: string;
	enabled: boolean;
	source: string;
	path?: string;
	pluginName?: string;
	headlessToolNames?: string[];
};

type HookItem = {
	fileName: string;
	hookEventName?: string;
	path: string;
};

type SessionHookEvent = {
	ts: string;
	hookEventName: string;
};

type CliDiscoveredSession = {
	sessionId: string;
	startedAt: string;
};

type HookExecutionSummary = {
	count: number;
	lastTs: string | null;
};

type McpServer = {
	name: string;
	transportType: "stdio" | "sse" | "streamableHttp";
	disabled: boolean;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	metadata?: unknown;
};

type McpServersResponse = {
	settingsPath: string;
	hasSettingsFile: boolean;
	servers: McpServer[];
};

type UserInstructionListsResponse = {
	workspaceRoot: string;
	rules: RuleItem[];
	workflows: WorkflowItem[];
	skills: SkillItem[];
	agents: AgentItem[];
	plugins: PluginItem[];
	tools: ToolItem[];
	hooks: HookItem[];
	mcp: McpServersResponse;
	warnings: string[];
};

function asArray<T>(value: T[] | null | undefined): T[] {
	return Array.isArray(value) ? value : [];
}

function normalizeInstructionListsResponse(
	response: Partial<UserInstructionListsResponse> | null | undefined,
): UserInstructionListsResponse {
	return {
		workspaceRoot:
			typeof response?.workspaceRoot === "string" ? response.workspaceRoot : "",
		rules: asArray(response?.rules),
		workflows: asArray(response?.workflows),
		skills: asArray(response?.skills),
		agents: asArray(response?.agents),
		plugins: asArray(response?.plugins),
		tools: asArray(response?.tools),
		hooks: asArray(response?.hooks),
		mcp:
			response?.mcp && typeof response.mcp === "object"
				? {
						settingsPath:
							typeof response.mcp.settingsPath === "string"
								? response.mcp.settingsPath
								: "",
						hasSettingsFile: Boolean(response.mcp.hasSettingsFile),
						servers: asArray(response.mcp.servers),
					}
				: {
						settingsPath: "",
						hasSettingsFile: false,
						servers: [],
					},
		warnings: asArray(response?.warnings),
	};
}

const EXTENSION_LISTS_CACHE_TTL_MS = 60_000;
const EXTENSION_HOOK_STATS_CACHE_TTL_MS = 30_000;

let extensionListsCache:
	| (UserInstructionListsResponse & {
			fetchedAt: number;
	  })
	| null = null;

let extensionHookStatsCache: {
	hookExecutionByEvent: Record<string, HookExecutionSummary>;
	hookExecutionSessionId: string | null;
	fetchedAt: number;
} | null = null;

function hasFreshExtensionsListsCache(
	cache: typeof extensionListsCache,
	now: number,
): cache is NonNullable<typeof extensionListsCache> {
	return Boolean(
		cache &&
			now - cache.fetchedAt < EXTENSION_LISTS_CACHE_TTL_MS &&
			Array.isArray(cache.tools) &&
			cache.tools.length > 0,
	);
}

function previewText(input: string, maxLength = 150): string {
	const compact = input.replace(/\s+/g, " ").trim();
	if (compact.length <= maxLength) {
		return compact;
	}
	return `${compact.slice(0, maxLength).trimEnd()}...`;
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/");
}

async function fetchUserInstructionLists(): Promise<UserInstructionListsResponse> {
	const response = await desktopClient.invoke<
		Partial<UserInstructionListsResponse>
	>("list_user_instruction_configs");
	return normalizeInstructionListsResponse(response);
}

export async function primeExtensionsListsCache(): Promise<void> {
	const now = Date.now();
	if (hasFreshExtensionsListsCache(extensionListsCache, now)) {
		return;
	}
	const response = await fetchUserInstructionLists();
	extensionListsCache = {
		...response,
		fetchedAt: now,
	};
}

export function RulesView() {
	const [activeTab, setActiveTab] = useState<ShortcutTab>("Rules");
	const [isLoading, setIsLoading] = useState(
		() => !hasFreshExtensionsListsCache(extensionListsCache, Date.now()),
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [workspaceRoot, setWorkspaceRoot] = useState(
		() => extensionListsCache?.workspaceRoot ?? "",
	);
	const [rules, setRules] = useState<RuleItem[]>(
		() => extensionListsCache?.rules ?? [],
	);
	const [workflows, setWorkflows] = useState<WorkflowItem[]>(
		() => extensionListsCache?.workflows ?? [],
	);
	const [skills, setSkills] = useState<SkillItem[]>(
		() => extensionListsCache?.skills ?? [],
	);
	const [agents, setAgents] = useState<AgentItem[]>(
		() => extensionListsCache?.agents ?? [],
	);
	const [plugins, setPlugins] = useState<PluginItem[]>(
		() => extensionListsCache?.plugins ?? [],
	);
	const [tools, setTools] = useState<ToolItem[]>(
		() => extensionListsCache?.tools ?? [],
	);
	const [hooks, setHooks] = useState<HookItem[]>(
		() => extensionListsCache?.hooks ?? [],
	);
	const [warnings, setWarnings] = useState<string[]>(
		() => extensionListsCache?.warnings ?? [],
	);
	const [hookExecutionByEvent, setHookExecutionByEvent] = useState<
		Record<string, HookExecutionSummary>
	>(() => extensionHookStatsCache?.hookExecutionByEvent ?? {});
	const [hookExecutionSessionId, setHookExecutionSessionId] = useState<
		string | null
	>(() => extensionHookStatsCache?.hookExecutionSessionId ?? null);
	const [hookExecutionLoading, setHookExecutionLoading] = useState(false);
	const [togglingToolIds, setTogglingToolIds] = useState<Set<string>>(
		() => new Set(),
	);

	const refresh = useCallback(async (force = false) => {
		const now = Date.now();
		if (!force && hasFreshExtensionsListsCache(extensionListsCache, now)) {
			setWorkspaceRoot(extensionListsCache.workspaceRoot);
			setRules(extensionListsCache.rules);
			setWorkflows(extensionListsCache.workflows);
			setSkills(extensionListsCache.skills);
			setAgents(extensionListsCache.agents);
			setPlugins(extensionListsCache.plugins);
			setTools(extensionListsCache.tools);
			setHooks(extensionListsCache.hooks);
			setWarnings(extensionListsCache.warnings);
			setErrorMessage(null);
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		setErrorMessage(null);
		try {
			const response = await fetchUserInstructionLists();
			setWorkspaceRoot(response.workspaceRoot);
			setRules(response.rules);
			setWorkflows(response.workflows);
			setSkills(response.skills);
			setAgents(response.agents);
			setPlugins(response.plugins);
			setTools(response.tools);
			setHooks(response.hooks);
			setWarnings(response.warnings);
			extensionListsCache = {
				...response,
				fetchedAt: Date.now(),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	}, []);

	const loadHookExecutionStats = useCallback(async (force = false) => {
		const now = Date.now();
		if (
			!force &&
			extensionHookStatsCache &&
			now - extensionHookStatsCache.fetchedAt <
				EXTENSION_HOOK_STATS_CACHE_TTL_MS
		) {
			setHookExecutionByEvent(extensionHookStatsCache.hookExecutionByEvent);
			setHookExecutionSessionId(extensionHookStatsCache.hookExecutionSessionId);
			return;
		}

		setHookExecutionLoading(true);
		try {
			const sessions = await desktopClient.invoke<CliDiscoveredSession[]>(
				"list_cli_sessions",
				{
					limit: 300,
				},
			);
			const latestSession = (sessions ?? [])
				.filter(
					(session) =>
						typeof session.sessionId === "string" &&
						session.sessionId.trim().length > 0,
				)
				.sort((left, right) =>
					(right.startedAt ?? "").localeCompare(left.startedAt ?? ""),
				)[0];
			if (!latestSession?.sessionId) {
				setHookExecutionByEvent({});
				setHookExecutionSessionId(null);
				extensionHookStatsCache = {
					hookExecutionByEvent: {},
					hookExecutionSessionId: null,
					fetchedAt: Date.now(),
				};
				return;
			}

			const events = await desktopClient.invoke<SessionHookEvent[]>(
				"read_session_hooks",
				{
					sessionId: latestSession.sessionId,
					limit: 5000,
				},
			);
			const next: Record<string, HookExecutionSummary> = {};
			for (const event of events ?? []) {
				const hookName = event.hookEventName?.trim();
				if (!hookName) {
					continue;
				}
				const current = next[hookName] ?? {
					count: 0,
					lastTs: null,
				};
				current.count += 1;
				if (event.ts && (!current.lastTs || event.ts > current.lastTs)) {
					current.lastTs = event.ts;
				}
				next[hookName] = current;
			}
			setHookExecutionByEvent(next);
			setHookExecutionSessionId(latestSession.sessionId);
			extensionHookStatsCache = {
				hookExecutionByEvent: next,
				hookExecutionSessionId: latestSession.sessionId,
				fetchedAt: Date.now(),
			};
		} catch {
			// Keep existing execution status when lookup fails.
		} finally {
			setHookExecutionLoading(false);
		}
	}, []);

	const applyResponse = useCallback(
		(response: Partial<UserInstructionListsResponse>) => {
			const normalizedResponse = normalizeInstructionListsResponse(response);
			setWorkspaceRoot(normalizedResponse.workspaceRoot);
			setRules(normalizedResponse.rules);
			setWorkflows(normalizedResponse.workflows);
			setSkills(normalizedResponse.skills);
			setAgents(normalizedResponse.agents);
			setPlugins(normalizedResponse.plugins);
			setTools(normalizedResponse.tools);
			setHooks(normalizedResponse.hooks);
			setWarnings(normalizedResponse.warnings);
			extensionListsCache = {
				...normalizedResponse,
				fetchedAt: Date.now(),
			};
		},
		[],
	);

	const togglePluginTool = useCallback(
		async (tool: ToolItem) => {
			if (
				tool.source !== "workspace-plugin" &&
				tool.source !== "global-plugin"
			) {
				return;
			}
			setTogglingToolIds((current) => new Set(current).add(tool.id));
			setErrorMessage(null);
			try {
				const response =
					await desktopClient.invoke<UserInstructionListsResponse>(
						"toggle_disabled_plugin_tool",
						{
							name: tool.name,
						},
					);
				applyResponse(response);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				setErrorMessage(message);
			} finally {
				setTogglingToolIds((current) => {
					const next = new Set(current);
					next.delete(tool.id);
					return next;
				});
			}
		},
		[applyResponse],
	);

	const formatExecutionTs = useCallback((value: string | null): string => {
		if (!value) {
			return "never";
		}
		const asNumber = Number(value);
		const date = Number.isFinite(asNumber)
			? new Date(asNumber)
			: new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleString();
	}, []);

	useEffect(() => {
		void refresh(false);
	}, [refresh]);

	useEffect(() => {
		if (activeTab !== "Hooks") {
			return;
		}
		void loadHookExecutionStats(false);
	}, [activeTab, loadHookExecutionStats]);

	const tabs: ShortcutTab[] = [
		"Rules",
		"Hooks",
		"Skills",
		"Agents",
		"Plugins",
		"Tools",
	];

	const commandItems = useMemo<CommandItem[]>(() => {
		const workflowItems: CommandItem[] = workflows.map((workflow) => ({
			id: workflow.id,
			type: "workflow",
			name: workflow.name,
			instructions: workflow.instructions,
			path: workflow.path,
		}));
		const skillItems: CommandItem[] = skills.map((skill) => ({
			id: normalizePath(skill.path).toLowerCase(),
			type: "skill",
			name: skill.name,
			description: skill.description,
			instructions: skill.instructions,
			path: skill.path,
		}));
		return [...workflowItems, ...skillItems].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	}, [skills, workflows]);

	const { projectRules, globalRules } = useMemo(() => {
		const normalizedRoot = normalizePath(workspaceRoot);
		const project: RuleItem[] = [];
		const global: RuleItem[] = [];
		for (const rule of rules) {
			const normalized = normalizePath(rule.path);
			if (
				normalizedRoot &&
				normalized.startsWith(`${normalizedRoot}/`) &&
				normalized.includes("/.clinerules/")
			) {
				project.push(rule);
			} else {
				global.push(rule);
			}
		}
		return { projectRules: project, globalRules: global };
	}, [rules, workspaceRoot]);

	const { projectHooks, globalHooks } = useMemo(() => {
		const normalizedRoot = normalizePath(workspaceRoot);
		const project: HookItem[] = [];
		const global: HookItem[] = [];
		for (const hook of hooks) {
			const normalized = normalizePath(hook.path);
			if (
				normalizedRoot &&
				normalized.startsWith(`${normalizedRoot}/`) &&
				normalized.includes("/.clinerules/hooks")
			) {
				project.push(hook);
			} else {
				global.push(hook);
			}
		}
		return { projectHooks: project, globalHooks: global };
	}, [hooks, workspaceRoot]);

	const { projectPlugins, globalPlugins } = useMemo(() => {
		const normalizedRoot = normalizePath(workspaceRoot);
		const project: PluginItem[] = [];
		const global: PluginItem[] = [];
		for (const plugin of plugins) {
			const normalized = normalizePath(plugin.path);
			if (
				normalizedRoot &&
				normalized.startsWith(`${normalizedRoot}/`) &&
				normalized.includes("/.cline/plugins")
			) {
				project.push(plugin);
			} else {
				global.push(plugin);
			}
		}
		return { projectPlugins: project, globalPlugins: global };
	}, [plugins, workspaceRoot]);

	const builtinTools = useMemo(
		() => tools.filter((tool) => tool.source === "builtin"),
		[tools],
	);
	const pluginTools = useMemo(
		() => tools.filter((tool) => tool.source !== "builtin"),
		[tools],
	);
	const pluginToolsByPluginKey = useMemo(() => {
		const grouped = new Map<string, ToolItem[]>();
		for (const tool of pluginTools) {
			const key = `${tool.pluginName ?? ""}:${tool.path ?? ""}`;
			const existing = grouped.get(key) ?? [];
			existing.push(tool);
			grouped.set(key, existing);
		}
		for (const items of grouped.values()) {
			items.sort((left, right) => left.name.localeCompare(right.name));
		}
		return grouped;
	}, [pluginTools]);

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				<div className="mb-4 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-foreground">Extensions</h2>
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							void refresh(true);
							if (activeTab === "Hooks") {
								void loadHookExecutionStats(true);
							}
						}}
						disabled={isLoading}
					>
						<RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
						Refresh
					</Button>
				</div>

				<div className="mb-6 flex items-center gap-0 border-b border-border">
					{tabs.map((tab) => (
						<Button
							key={tab}
							variant="ghost"
							onClick={() => setActiveTab(tab)}
							className={cn(
								"relative px-4 py-2.5 text-sm font-medium transition-colors",
								activeTab === tab
									? "text-foreground"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{tab}
							{activeTab === tab && (
								<span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
							)}
						</Button>
					))}
				</div>

				{errorMessage && (
					<div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
						Failed to load configuration lists: {errorMessage}
					</div>
				)}

				{warnings.length > 0 && (
					<div className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">
						<div className="mb-2 flex items-center gap-2 font-medium">
							<TriangleAlert className="h-4 w-4" />
							Partial results
						</div>
						<ul className="list-disc space-y-1 pl-5">
							{warnings.map((warning) => (
								<li key={warning}>{warning}</li>
							))}
						</ul>
					</div>
				)}

				{activeTab === "Rules" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Enabled rules discovered from configured workspace/global
							directories.
						</p>

						<div className="mb-6">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Global Rules
							</h3>
							<div className="flex flex-col gap-2">
								{globalRules.map((rule) => (
									<div
										key={rule.path}
										className="rounded-lg border border-border px-4 py-3"
									>
										<div className="flex items-center gap-3">
											<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="flex-1 text-sm font-medium text-foreground">
												{rule.name}
											</span>
										</div>
										<p className="mt-2 text-xs text-muted-foreground">
											{previewText(rule.instructions)}
										</p>
										<p className="mt-1 text-xs font-mono text-muted-foreground">
											{rule.path}
										</p>
									</div>
								))}
								{globalRules.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No global rules found.
									</p>
								)}
							</div>
						</div>

						<div className="mb-2">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Project Rules
							</h3>
							<div className="flex flex-col gap-2">
								{projectRules.map((rule) => (
									<div
										key={rule.path}
										className="rounded-lg border border-border px-4 py-3"
									>
										<div className="flex items-center gap-3">
											<FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="flex-1 text-sm font-medium text-foreground">
												{rule.name}
											</span>
										</div>
										<p className="mt-2 text-xs text-muted-foreground">
											{previewText(rule.instructions)}
										</p>
										<p className="mt-1 text-xs font-mono text-muted-foreground">
											{rule.path}
										</p>
									</div>
								))}
								{projectRules.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No project rules found.
									</p>
								)}
							</div>
						</div>
					</div>
				)}

				{activeTab === "Hooks" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Hook config files discovered from workspace and global hook
							directories.
						</p>
						{hookExecutionLoading ? (
							<p className="mb-4 text-xs text-muted-foreground">
								Loading hook execution status...
							</p>
						) : null}
						{hookExecutionSessionId ? (
							<p className="mb-4 text-xs text-muted-foreground">
								Execution status is based on hook events in session{" "}
								<span className="font-mono">{hookExecutionSessionId}</span>.
							</p>
						) : (
							<p className="mb-4 text-xs text-muted-foreground">
								Execution status unavailable (no sessions with hook events
								found).
							</p>
						)}

						<div className="mb-6">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Global Hooks
							</h3>
							<div className="flex flex-col gap-2">
								{globalHooks.map((hook) => (
									<div
										key={hook.path}
										className="rounded-lg border border-border px-4 py-3"
									>
										<div className="flex items-center gap-3">
											<Code className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="flex-1 text-sm font-mono text-foreground">
												{hook.fileName}
											</span>
											{hook.hookEventName && (
												<div className="flex items-center gap-2">
													<span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
														{hook.hookEventName}
													</span>
													{(() => {
														const stats =
															hookExecutionByEvent[hook.hookEventName];
														const executed = (stats?.count ?? 0) > 0;
														return (
															<span
																className={cn(
																	"rounded border px-2 py-0.5 text-xs",
																	executed
																		? "border-emerald-400/50 text-emerald-600 dark:text-emerald-400"
																		: "border-border text-muted-foreground",
																)}
															>
																{executed
																	? `${stats?.count ?? 0} executed`
																	: "never executed"}
															</span>
														);
													})()}
												</div>
											)}
										</div>
										{hook.hookEventName ? (
											<p className="mt-1 text-xs text-muted-foreground">
												Last run:{" "}
												{formatExecutionTs(
													hookExecutionByEvent[hook.hookEventName]?.lastTs ??
														null,
												)}
											</p>
										) : null}
										<p className="mt-1 text-xs font-mono text-muted-foreground">
											{hook.path}
										</p>
									</div>
								))}
								{globalHooks.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No global hooks found.
									</p>
								)}
							</div>
						</div>

						<div>
							<div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								<FolderOpen className="h-3.5 w-3.5" />
								Project Hooks
							</div>
							<div className="flex flex-col gap-2">
								{projectHooks.map((hook) => (
									<div
										key={hook.path}
										className="rounded-lg border border-border px-4 py-3"
									>
										<div className="flex items-center gap-3">
											<Code className="h-4 w-4 shrink-0 text-muted-foreground" />
											<span className="flex-1 text-sm font-mono text-foreground">
												{hook.fileName}
											</span>
											{hook.hookEventName && (
												<div className="flex items-center gap-2">
													<span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
														{hook.hookEventName}
													</span>
													{(() => {
														const stats =
															hookExecutionByEvent[hook.hookEventName];
														const executed = (stats?.count ?? 0) > 0;
														return (
															<span
																className={cn(
																	"rounded border px-2 py-0.5 text-xs",
																	executed
																		? "border-emerald-400/50 text-emerald-600 dark:text-emerald-400"
																		: "border-border text-muted-foreground",
																)}
															>
																{executed
																	? `${stats?.count ?? 0} executed`
																	: "never executed"}
															</span>
														);
													})()}
												</div>
											)}
										</div>
										{hook.hookEventName ? (
											<p className="mt-1 text-xs text-muted-foreground">
												Last run:{" "}
												{formatExecutionTs(
													hookExecutionByEvent[hook.hookEventName]?.lastTs ??
														null,
												)}
											</p>
										) : null}
										<p className="mt-1 text-xs font-mono text-muted-foreground">
											{hook.path}
										</p>
									</div>
								))}
								{projectHooks.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No project hooks found.
									</p>
								)}
							</div>
						</div>
					</div>
				)}

				{activeTab === "Skills" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Enabled skills and workflows. Workflows can be invoked in chat
							with{" "}
							<code className="rounded bg-secondary px-1.5 py-0.5 text-xs font-mono text-foreground">
								/workflow-name
							</code>
							.
						</p>

						<div className="flex flex-col gap-3">
							{commandItems.map((item) => (
								<div
									key={`${item.type}:${item.path}`}
									className="rounded-lg border border-border px-5 py-4"
								>
									<div className="flex items-center gap-3">
										{item.type === "workflow" ? (
											<Play className="h-4 w-4 shrink-0 text-primary" />
										) : (
											<Zap className="h-4 w-4 shrink-0 text-primary" />
										)}
										<h3 className="text-sm font-semibold text-foreground">
											{item.name}
										</h3>
										<span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
											{item.type}
										</span>
									</div>
									<p className="mt-2 ml-7 text-xs text-muted-foreground">
										{item.description?.trim() || previewText(item.instructions)}
									</p>
									<p className="mt-1 ml-7 text-xs font-mono text-muted-foreground">
										{item.path}
									</p>
								</div>
							))}
							{commandItems.length === 0 && (
								<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
									No enabled skills or workflows found.
								</p>
							)}
						</div>
					</div>
				)}

				{activeTab === "Agents" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Configured agents discovered from Documents and settings
							directories.
						</p>

						<div className="flex flex-col gap-3">
							{agents.map((agent) => (
								<div
									key={agent.path}
									className="rounded-lg border border-border px-5 py-4"
								>
									<div className="flex items-center gap-3">
										<Bot className="h-4 w-4 shrink-0 text-primary" />
										<h3 className="text-sm font-semibold text-foreground">
											{agent.name}
										</h3>
									</div>
									<p className="mt-1 ml-7 text-xs font-mono text-muted-foreground">
										{agent.path}
									</p>
								</div>
							))}
							{agents.length === 0 && (
								<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
									No configured agents found.
								</p>
							)}
						</div>
					</div>
				)}

				{activeTab === "Plugins" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Plugins discovered from workspace and global plugin directories.
						</p>

						<div className="mb-6">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Global Plugins
							</h3>
							<div className="flex flex-col gap-3">
								{globalPlugins.map((plugin) => (
									<div
										key={plugin.path}
										className="rounded-lg border border-border px-5 py-4"
									>
										<div className="flex items-center gap-3">
											<Puzzle className="h-4 w-4 shrink-0 text-primary" />
											<h3 className="text-sm font-semibold text-foreground">
												{plugin.name}
											</h3>
										</div>
										<p className="mt-1 ml-7 text-xs font-mono text-muted-foreground">
											{plugin.path}
										</p>
										<div className="mt-3 ml-7 flex flex-col gap-2">
											{(
												pluginToolsByPluginKey.get(
													`${plugin.name}:${plugin.path}`,
												) ?? []
											).map((tool) => {
												const isToggling = togglingToolIds.has(tool.id);
												return (
													<div
														key={tool.id}
														className="flex items-center justify-between gap-4 rounded-md border border-border/70 px-3 py-2"
													>
														<div className="min-w-0">
															<p className="text-xs font-medium text-foreground">
																{tool.name}
															</p>
															<p className="text-xs text-muted-foreground">
																{tool.description?.trim() ||
																	"No description available."}
															</p>
														</div>
														<div className="flex items-center gap-2">
															<span className="text-xs text-muted-foreground">
																{tool.enabled ? "Enabled" : "Disabled"}
															</span>
															<Switch
																checked={tool.enabled}
																onCheckedChange={() => {
																	void togglePluginTool(tool);
																}}
																disabled={isToggling}
																aria-label={`Toggle ${tool.name}`}
															/>
														</div>
													</div>
												);
											})}
											{(pluginToolsByPluginKey.get(
												`${plugin.name}:${plugin.path}`,
											)?.length ?? 0) === 0 && (
												<p className="text-xs text-muted-foreground">
													No plugin tools found.
												</p>
											)}
										</div>
									</div>
								))}
								{globalPlugins.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No global plugins found.
									</p>
								)}
							</div>
						</div>

						<div>
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Project Plugins
							</h3>
							<div className="flex flex-col gap-3">
								{projectPlugins.map((plugin) => (
									<div
										key={plugin.path}
										className="rounded-lg border border-border px-5 py-4"
									>
										<div className="flex items-center gap-3">
											<Puzzle className="h-4 w-4 shrink-0 text-primary" />
											<h3 className="text-sm font-semibold text-foreground">
												{plugin.name}
											</h3>
										</div>
										<p className="mt-1 ml-7 text-xs font-mono text-muted-foreground">
											{plugin.path}
										</p>
										<div className="mt-3 ml-7 flex flex-col gap-2">
											{(
												pluginToolsByPluginKey.get(
													`${plugin.name}:${plugin.path}`,
												) ?? []
											).map((tool) => {
												const isToggling = togglingToolIds.has(tool.id);
												return (
													<div
														key={tool.id}
														className="flex items-center justify-between gap-4 rounded-md border border-border/70 px-3 py-2"
													>
														<div className="min-w-0">
															<p className="text-xs font-medium text-foreground">
																{tool.name}
															</p>
															<p className="text-xs text-muted-foreground">
																{tool.description?.trim() ||
																	"No description available."}
															</p>
														</div>
														<div className="flex items-center gap-2">
															<span className="text-xs text-muted-foreground">
																{tool.enabled ? "Enabled" : "Disabled"}
															</span>
															<Switch
																checked={tool.enabled}
																onCheckedChange={() => {
																	void togglePluginTool(tool);
																}}
																disabled={isToggling}
																aria-label={`Toggle ${tool.name}`}
															/>
														</div>
													</div>
												);
											})}
											{(pluginToolsByPluginKey.get(
												`${plugin.name}:${plugin.path}`,
											)?.length ?? 0) === 0 && (
												<p className="text-xs text-muted-foreground">
													No plugin tools found.
												</p>
											)}
										</div>
									</div>
								))}
								{projectPlugins.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No project plugins found.
									</p>
								)}
							</div>
						</div>
					</div>
				)}

				{activeTab === "Tools" && (
					<div>
						<p className="mb-6 text-sm leading-relaxed text-muted-foreground">
							Builtin tool groups and plugin-contributed tools available to the
							runtime.
						</p>

						<div className="mb-6">
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Builtin Tools
							</h3>
							<div className="flex flex-col gap-3">
								{builtinTools.map((tool) => (
									<div
										key={tool.id}
										className="rounded-lg border border-border px-5 py-4"
									>
										<div className="flex items-center gap-3">
											<Wrench className="h-4 w-4 shrink-0 text-primary" />
											<h3 className="text-sm font-semibold text-foreground">
												{tool.name}
											</h3>
											<span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
												{tool.enabled
													? "enabled by default"
													: "disabled by default"}
											</span>
										</div>
										<p className="mt-2 ml-7 text-xs text-muted-foreground">
											{tool.description?.trim() || "No description available."}
										</p>
										{!!tool.headlessToolNames?.length && (
											<p className="mt-1 ml-7 text-xs font-mono text-muted-foreground">
												{tool.headlessToolNames.join(", ")}
											</p>
										)}
									</div>
								))}
								{builtinTools.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No builtin tools found.
									</p>
								)}
							</div>
						</div>

						<div>
							<h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
								Plugin Tools
							</h3>
							<div className="flex flex-col gap-3">
								{pluginTools.map((tool) => (
									<div
										key={tool.id}
										className="rounded-lg border border-border px-5 py-4"
									>
										<div className="flex items-center gap-3">
											<Wrench className="h-4 w-4 shrink-0 text-primary" />
											<h3 className="text-sm font-semibold text-foreground">
												{tool.name}
											</h3>
											{tool.pluginName && (
												<span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
													plugin: {tool.pluginName}
												</span>
											)}
											<span className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
												{tool.enabled ? "enabled" : "disabled"}
											</span>
										</div>
										<p className="mt-2 ml-7 text-xs text-muted-foreground">
											{tool.description?.trim() || "No description available."}
										</p>
										{tool.path && (
											<p className="mt-1 ml-7 text-xs font-mono text-muted-foreground">
												{tool.path}
											</p>
										)}
									</div>
								))}
								{pluginTools.length === 0 && (
									<p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
										No plugin tools found.
									</p>
								)}
							</div>
						</div>
					</div>
				)}
			</div>
		</ScrollArea>
	);
}
