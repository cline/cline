import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import type {
	ClineAccountActionRequest,
	ProviderCapability,
} from "@clinebot/core";
import {
	ALL_DEFAULT_TOOL_NAMES,
	addLocalProvider,
	ClineAccountService,
	ClineCore,
	createLocalHubScheduleRuntimeHandlers,
	createUserInstructionConfigWatcher,
	discoverPluginModulePaths,
	ensureCustomProvidersLoaded,
	ensureHubServer,
	executeClineAccountAction,
	getLocalProviderModels,
	listHookConfigFiles,
	listLocalProviders,
	listPluginTools,
	loginLocalProvider,
	normalizeOAuthProvider,
	ProviderSettingsManager,
	resolveLocalClineAuthToken,
	resolvePluginConfigSearchPaths,
	resolveRulesConfigSearchPaths,
	resolveSessionBackend,
	resolveAgentConfigSearchPaths as resolveSharedAgentConfigSearchPaths,
	resolveSkillsConfigSearchPaths,
	resolveWorkflowsConfigSearchPaths,
	SqliteSessionStore,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
	sendHubCommand,
	toggleDisabledTool,
} from "@clinebot/core";
import { broadcastEvent } from "./context";
import {
	findArtifactUnderDir,
	readSessionManifest,
	resolveMcpSettingsPath,
	rootSessionIdFrom,
	sessionLogPath,
	sharedSessionDataDir,
} from "./paths";
import { readSessionHooks } from "./session-data/artifacts";
import { normalizeSessionTitle } from "./session-data/common";
import { discoverChatSessions } from "./session-data/discovery";
import { readSessionMessages } from "./session-data/messages";
import { searchWorkspaceFiles } from "./session-data/search";
import type {
	ChatSessionCommandRequest,
	JsonRecord,
	SidecarContext,
} from "./types";

// ---------------------------------------------------------------------------
// MCP settings helpers
// ---------------------------------------------------------------------------

function readMcpServersResponse(): JsonRecord {
	const settingsPath = resolveMcpSettingsPath();
	if (!existsSync(settingsPath)) {
		return { settingsPath, hasSettingsFile: false, servers: [] };
	}
	const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
	const servers = parsed.mcpServers as JsonRecord | undefined;
	const entries = Object.entries(servers ?? {}).map(([name, body]) => {
		const record = body as JsonRecord;
		const transport =
			record.transport && typeof record.transport === "object"
				? (record.transport as JsonRecord)
				: undefined;
		const transportType = String(
			transport?.type ?? record.transportType ?? record.type ?? "stdio",
		).trim();
		return {
			name,
			transportType,
			disabled: record.disabled === true,
			command:
				typeof transport?.command === "string"
					? transport.command
					: typeof record.command === "string"
						? record.command
						: undefined,
			args: Array.isArray(transport?.args)
				? transport.args
				: Array.isArray(record.args)
					? record.args
					: undefined,
			cwd:
				typeof transport?.cwd === "string"
					? transport.cwd
					: typeof record.cwd === "string"
						? record.cwd
						: undefined,
			env:
				transport?.env && typeof transport.env === "object"
					? transport.env
					: record.env && typeof record.env === "object"
						? record.env
						: undefined,
			url:
				typeof transport?.url === "string"
					? transport.url
					: typeof record.url === "string"
						? record.url
						: undefined,
			headers:
				transport?.headers && typeof transport.headers === "object"
					? transport.headers
					: record.headers && typeof record.headers === "object"
						? record.headers
						: undefined,
			metadata: record.metadata,
		};
	});
	return { settingsPath, hasSettingsFile: true, servers: entries };
}

function writeMcpServersMap(servers: JsonRecord): void {
	const path = resolveMcpSettingsPath();
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify({ mcpServers: servers }, null, 2)}\n`);
}

function ensureMcpSettingsFile(): string {
	const path = resolveMcpSettingsPath();
	if (!existsSync(path)) {
		writeMcpServersMap({});
	}
	return path;
}

function removePathIfExists(
	path: string,
	options?: { recursive?: boolean },
): boolean {
	if (!path || !existsSync(path)) {
		return false;
	}
	rmSync(path, {
		force: true,
		recursive: options?.recursive === true,
	});
	return true;
}

async function listSessionsFromSidecarManager(
	ctx: SidecarContext,
	limit: number,
): Promise<unknown> {
	if (ctx.sessionManager) {
		return await ctx.sessionManager.list(limit);
	}
	const core = await ClineCore.create({
		backendMode: "hub",
		hub: {
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
			clientType: "code-sidecar-list",
			displayName: "Code App history",
		},
	});
	try {
		return await core.list(limit);
	} finally {
		await core.dispose("code_sidecar_list_sessions");
	}
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function listGitBranches(
	ctx: SidecarContext,
	cwd?: string,
): { current?: string; branches?: string[] } {
	const targetCwd = cwd?.trim() || ctx.workspaceRoot;
	const current = (() => {
		try {
			return execFileSync("git", ["branch", "--show-current"], {
				cwd: targetCwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			return "";
		}
	})();
	try {
		const stdout = execFileSync(
			"git",
			["for-each-ref", "--format=%(refname:short)", "refs/heads"],
			{
				cwd: targetCwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
		const branches = stdout
			.split("\n")
			.map((v) => v.trim())
			.filter(Boolean);
		return { current: current || undefined, branches };
	} catch {
		return { current: current || undefined, branches: [] };
	}
}

// ---------------------------------------------------------------------------
// Routine schedule helpers (in-process via shared hub server)
// ---------------------------------------------------------------------------

function toPositiveInt(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	const rounded = Math.trunc(value);
	return rounded > 0 ? rounded : undefined;
}

function asTrimmedString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

async function handleRoutineScheduleCommand(
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	await ensureHubServer({
		runtimeHandlers: createLocalHubScheduleRuntimeHandlers(),
	});
	const clientCommand = async (
		hubCommand: string,
		payload?: Record<string, unknown>,
	) => {
		const reply = await sendHubCommand(
			{},
			{
				clientId: "code-sidecar-routines",
				command: hubCommand as never,
				payload,
			},
		);
		if (!reply.ok) {
			throw new Error(
				reply.error?.message ?? `hub command failed: ${hubCommand}`,
			);
		}
		return (reply.payload ?? {}) as Record<string, unknown>;
	};
	try {
		if (command === "list_routine_schedules") {
			const [schedules, activeExecutions, upcomingRuns] = await Promise.all([
				clientCommand("schedule.list", {
					limit: toPositiveInt(args?.limit) ?? 200,
				}),
				clientCommand("schedule.active"),
				clientCommand("schedule.upcoming", { limit: 30 }),
			]);
			return {
				schedules: schedules.schedules ?? [],
				activeExecutions: activeExecutions.executions ?? [],
				upcomingRuns: upcomingRuns.runs ?? [],
			};
		}
		if (command === "create_routine_schedule") {
			const name = asTrimmedString(args?.name);
			const cronPattern = asTrimmedString(args?.cron_pattern);
			const prompt = asTrimmedString(args?.prompt);
			const workspaceRoot = asTrimmedString(args?.workspace_root);
			if (!name || !cronPattern || !prompt || !workspaceRoot) {
				throw new Error(
					"createSchedule requires name, cron_pattern, prompt, and workspace_root",
				);
			}
			const created = await clientCommand("schedule.create", {
				name,
				cronPattern,
				prompt,
				modelSelection: {
					providerId: asTrimmedString(args?.provider) ?? "cline",
					modelId: asTrimmedString(args?.model) ?? "openai/gpt-5.3-codex",
				},
				mode: args?.mode === "plan" ? "plan" : "act",
				workspaceRoot,
				cwd: asTrimmedString(args?.cwd),
				systemPrompt: asTrimmedString(args?.system_prompt),
				maxIterations: toPositiveInt(args?.max_iterations),
				timeoutSeconds: toPositiveInt(args?.timeout_seconds),
				maxParallel: toPositiveInt(args?.max_parallel) ?? 1,
				enabled: args?.enabled !== false,
				tags:
					Array.isArray(args?.tags) && args.tags.length > 0
						? (args.tags as string[])
								.map((v: string) => v.trim())
								.filter((v: string) => v.length > 0)
						: undefined,
			});
			return { schedule: created.schedule ?? null };
		}
		const scheduleId = asTrimmedString(args?.schedule_id);
		if (!scheduleId) throw new Error(`${command} requires schedule_id`);
		if (command === "pause_routine_schedule") {
			const reply = await clientCommand("schedule.disable", { scheduleId });
			return { schedule: reply.schedule ?? null };
		}
		if (command === "resume_routine_schedule") {
			const reply = await clientCommand("schedule.enable", { scheduleId });
			return { schedule: reply.schedule ?? null };
		}
		if (command === "trigger_routine_schedule") {
			const reply = await clientCommand("schedule.trigger", { scheduleId });
			return { execution: reply.execution ?? null };
		}
		if (command === "delete_routine_schedule") {
			const reply = await clientCommand("schedule.delete", { scheduleId });
			return { deleted: reply.deleted === true };
		}
		throw new Error(`unsupported routine schedule command: ${command}`);
	} finally {
	}
}

// ---------------------------------------------------------------------------
// User instruction config listing (in-process via @clinebot/core watchers)
// ---------------------------------------------------------------------------

function resolveAgentConfigSearchPaths(workspaceRoot?: string): string[] {
	return resolveSharedAgentConfigSearchPaths(workspaceRoot);
}

async function listUserInstructionConfigs(
	workspaceRoot: string,
): Promise<JsonRecord> {
	const warnings: string[] = [];

	const loadWatcherSnapshot = async (
		type: "rule" | "skill" | "workflow",
		directories: string[],
	): Promise<unknown[]> => {
		const items: unknown[] = [];
		const existing = directories.filter((d) => existsSync(d));
		for (const directory of existing) {
			const opts =
				type === "rule"
					? {
							skills: { directories: [] },
							rules: { directories: [directory] },
							workflows: { directories: [] },
						}
					: type === "skill"
						? {
								skills: { directories: [directory] },
								rules: { directories: [] },
								workflows: { directories: [] },
							}
						: {
								skills: { directories: [] },
								rules: { directories: [] },
								workflows: { directories: [directory] },
							};
			const watcher = createUserInstructionConfigWatcher(opts);
			try {
				await watcher.start();
				const snapshot = watcher.getSnapshot(type);
				for (const [id, record] of snapshot.entries()) {
					const item = record.item as unknown as JsonRecord;
					if (item.disabled === true) continue;
					items.push({
						id,
						name: item.name ?? id,
						instructions: item.instructions,
						path: record.filePath,
					});
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				warnings.push(`${type}: ${message}`);
			} finally {
				watcher.stop();
			}
		}
		return items;
	};

	const loadAgents = (): unknown[] => {
		const agentsById = new Map<string, { name: string; path: string }>();
		const directories = resolveAgentConfigSearchPaths(workspaceRoot).filter(
			(d) => existsSync(d),
		);
		for (const directory of directories) {
			try {
				for (const entry of readdirSync(directory, { withFileTypes: true })) {
					if (!entry.isFile()) continue;
					const ext = extname(entry.name).toLowerCase();
					if (ext !== ".yml" && ext !== ".yaml") continue;
					const filePath = join(directory, entry.name);
					const raw = readFileSync(filePath, "utf8");
					const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
					const fm = fmMatch?.[1] ?? "";
					const nameMatch = fm.match(/^\s*name:\s*(.+?)\s*$/m);
					const parsedName = nameMatch?.[1]?.replace(/^["']|["']$/g, "").trim();
					const name =
						parsedName && parsedName.length > 0
							? parsedName
							: basename(entry.name, ext);
					const id = name.toLowerCase();
					if (!agentsById.has(id)) {
						agentsById.set(id, { name, path: filePath });
					}
				}
			} catch {
				// best-effort
			}
		}
		return [...agentsById.values()].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	};

	const loadHooks = (): unknown[] => {
		try {
			return listHookConfigFiles(workspaceRoot);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			warnings.push(`hooks: ${message}`);
			return [];
		}
	};

	const loadPlugins = (): Array<{ name: string; path: string }> => {
		const pluginsByPath = new Map<string, { name: string; path: string }>();
		const directories = resolvePluginConfigSearchPaths(workspaceRoot).filter(
			(d) => existsSync(d),
		);
		for (const directory of directories) {
			try {
				for (const filePath of discoverPluginModulePaths(directory)) {
					if (pluginsByPath.has(filePath)) {
						continue;
					}
					pluginsByPath.set(filePath, {
						name: basename(filePath, extname(filePath)),
						path: filePath,
					});
				}
			} catch {
				// best-effort
			}
		}
		return [...pluginsByPath.values()].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
	};

	const [rules, workflows, skills, pluginTools] = await Promise.all([
		loadWatcherSnapshot("rule", resolveRulesConfigSearchPaths(workspaceRoot)),
		loadWatcherSnapshot(
			"workflow",
			resolveWorkflowsConfigSearchPaths(workspaceRoot),
		),
		loadWatcherSnapshot("skill", [
			...resolveSkillsConfigSearchPaths(workspaceRoot),
			join(homedir(), "Documents", "Cline", "Skills"),
		]),
		listPluginTools({
			workspacePath: workspaceRoot,
			cwd: workspaceRoot,
		}),
	]);

	return {
		workspaceRoot,
		rules,
		workflows,
		skills,
		agents: loadAgents(),
		plugins: loadPlugins(),
		tools: [
			...ALL_DEFAULT_TOOL_NAMES.map((name) => ({
				id: name,
				name,
				enabled: true,
				source: "builtin",
			})),
			...pluginTools.map((tool) => ({
				id: `${tool.pluginName}:${tool.name}:${tool.path}`,
				name: tool.name,
				description: tool.description,
				enabled: tool.enabled,
				source: tool.source,
				path: tool.path,
				pluginName: tool.pluginName,
			})),
		],
		hooks: loadHooks(),
		mcp: readMcpServersResponse(),
		warnings,
	};
}

// ---------------------------------------------------------------------------
// Native OS commands
// ---------------------------------------------------------------------------

function pickWorkspaceDirectory(): string | null {
	const platform = process.platform;
	if (platform === "darwin") {
		try {
			const result = execFileSync(
				"osascript",
				[
					"-e",
					'set theFolder to choose folder with prompt "Select workspace directory"',
					"-e",
					"return POSIX path of theFolder",
				],
				{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			).trim();
			return result || null;
		} catch {
			return null;
		}
	}
	// Linux — try zenity
	try {
		const result = execFileSync(
			"zenity",
			["--file-selection", "--directory", "--title=Select workspace directory"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
		).trim();
		return result || null;
	} catch {
		return null;
	}
}

function openFileInEditor(filePath: string): void {
	const platform = process.platform;
	const cmd =
		platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
	const cmdArgs =
		platform === "win32" ? ["/c", "start", "", filePath] : [filePath];
	const child = spawn(cmd, cmdArgs, { stdio: "ignore", detached: true });
	child.unref();
}

// ---------------------------------------------------------------------------
// Main command router
// ---------------------------------------------------------------------------

export async function handleCommand(
	ctx: SidecarContext,
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	// ── Chat session commands ──────────────────────────────────────────
	if (command === "chat_session_command") {
		const { handleChatSessionCommand } = await import("./chat-session");
		return await handleChatSessionCommand(
			ctx,
			(args?.request as ChatSessionCommandRequest | undefined) ??
				(args as ChatSessionCommandRequest),
		);
	}

	// ── Session data reading ──────────────────────────────────────────
	if (command === "read_session_messages") {
		return await readSessionMessages(
			ctx as any,
			String(args?.sessionId ?? ""),
			typeof args?.maxMessages === "number" ? args.maxMessages : 800,
		);
	}
	if (command === "read_session_hooks") {
		return await readSessionHooks(
			String(args?.sessionId ?? ""),
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}

	// ── Process context ───────────────────────────────────────────────
	if (command === "get_process_context") {
		return { workspaceRoot: ctx.workspaceRoot, cwd: ctx.workspaceRoot };
	}
	if (command === "get_chat_ws_endpoint") {
		return "";
	}

	// ── Tool approvals (in-memory) ────────────────────────────────────
	if (command === "poll_tool_approvals") {
		const sessionId = String(args?.sessionId ?? "").trim();
		return Array.from(ctx.pendingApprovals.values())
			.filter((a) => a.item.sessionId === sessionId)
			.map((a) => a.item);
	}
	if (command === "respond_tool_approval") {
		const sessionId = String(args?.sessionId ?? "").trim();
		const requestId = String(args?.requestId ?? "").trim();
		if (!sessionId || !requestId) {
			throw new Error("sessionId and requestId are required");
		}
		const pending = ctx.pendingApprovals.get(requestId);
		if (pending && ctx.hubClient) {
			await ctx.hubClient.command("approval.respond", {
				approvalId: pending.approvalId,
				approved: Boolean(args?.approved),
				payload:
					typeof args?.reason === "string" && args.reason.trim().length > 0
						? { reason: args.reason }
						: undefined,
			});
		}
		ctx.pendingApprovals.delete(requestId);
		const remaining = Array.from(ctx.pendingApprovals.values())
			.filter((a) => a.item.sessionId === sessionId)
			.map((a) => a.item);
		broadcastEvent(ctx, "tool_approval_state", {
			sessionId,
			items: remaining,
		});
		return true;
	}

	// ── Session discovery ─────────────────────────────────────────────
	if (command === "list_chat_sessions") {
		return discoverChatSessions(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "list_cli_sessions") {
		return await listSessionsFromSidecarManager(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "list_discovered_sessions") {
		return await listSessionsFromSidecarManager(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "update_chat_session_title") {
		const sessionId = String(args?.sessionId ?? "").trim();
		if (!sessionId) throw new Error("session id is required");
		const title = normalizeSessionTitle(String(args?.title ?? ""));
		const backend = await resolveSessionBackend({ backendMode: "local" });
		const result = await backend.updateSession({ sessionId, title });
		if (!result.updated) throw new Error(`Session ${sessionId} not found`);
		const liveSession = ctx.liveSessions.get(sessionId);
		if (liveSession) liveSession.title = title;
		return true;
	}
	if (command === "delete_chat_session" || command === "delete_cli_session") {
		const sessionId = String(args?.sessionId ?? args?.session_id ?? "").trim();
		if (!sessionId) throw new Error("session id is required");
		console.error(
			`[sidecar:delete] request command=${command} sessionId=${sessionId}`,
		);
		const store = new SqliteSessionStore();
		const row = store.get(sessionId);
		const manifest = readSessionManifest(sessionId);
		let deleted = false;
		let deleteError: Error | null = null;
		try {
			if (ctx.sessionManager) {
				deleted = await ctx.sessionManager.delete(sessionId);
			} else {
				const backend = await resolveSessionBackend({ backendMode: "local" });
				const deleteSession = (
					backend as {
						deleteSession: (
							sessionId: string,
							cascade?: boolean,
						) => Promise<boolean | { deleted: boolean }>;
					}
				).deleteSession.bind(backend);
				const deleteResult = await deleteSession(sessionId, true);
				deleted =
					typeof deleteResult === "boolean"
						? deleteResult
						: deleteResult.deleted;
			}
		} catch (error) {
			deleteError = error instanceof Error ? error : new Error(String(error));
		}
		if (store.delete(sessionId, true)) {
			deleted = true;
		}
		ctx.liveSessions.delete(sessionId);
		const directoryCandidates = new Set<string>([
			join(sharedSessionDataDir(), sessionId),
		]);
		for (const path of [
			row?.messagesPath,
			typeof manifest?.messages_path === "string"
				? manifest.messages_path
				: null,
		]) {
			if (typeof path === "string" && path.trim().length > 0) {
				directoryCandidates.add(dirname(path));
			}
		}
		for (const path of [sessionLogPath(sessionId)]) {
			if (removePathIfExists(path, { recursive: true })) {
				deleted = true;
			}
		}
		for (const dir of directoryCandidates) {
			if (removePathIfExists(dir, { recursive: true })) {
				deleted = true;
			}
		}
		for (const path of [
			row?.messagesPath,
			typeof manifest?.messages_path === "string"
				? manifest.messages_path
				: null,
			join(sharedSessionDataDir(), sessionId, `${sessionId}.json`),
		].filter((v): v is string => typeof v === "string" && v.length > 0)) {
			if (removePathIfExists(path)) {
				deleted = true;
			}
		}
		for (const suffix of ["messages.json"]) {
			const fileName = `${sessionId}.${suffix}`;
			const found = findArtifactUnderDir(
				join(sharedSessionDataDir(), rootSessionIdFrom(sessionId)),
				fileName,
				4,
			);
			if (found && removePathIfExists(found)) {
				deleted = true;
			}
		}
		if (!deleted && deleteError) {
			console.error(
				`[sidecar:delete] failed sessionId=${sessionId} error=${deleteError.message}`,
			);
			throw deleteError;
		}
		console.error(
			`[sidecar:delete] result sessionId=${sessionId} deleted=${deleted}`,
		);
		if (deleted) {
			broadcastEvent(ctx, "session_deleted", {
				sessionId,
				command,
				deleted: true,
			});
		}
		return deleted;
	}

	// ── Workspace file search ─────────────────────────────────────────
	if (command === "search_workspace_files") {
		return await searchWorkspaceFiles(ctx as any, args);
	}

	// ── Cline account ──────────────────────────────────────────────────
	if (command === "cline_account") {
		const operation = String(args?.operation ?? "").trim();
		if (!operation) throw new Error("operation is required");
		const manager = new ProviderSettingsManager();
		const settings = manager.getProviderSettings("cline");
		const accountService = new ClineAccountService({
			apiBaseUrl: settings?.baseUrl?.trim() || "https://api.cline.bot",
			getAuthToken: async () => resolveLocalClineAuthToken(settings),
		});
		return await executeClineAccountAction(
			args as ClineAccountActionRequest,
			accountService,
		);
	}

	// ── Provider management ────────────────────────────────────────────
	if (command === "list_provider_catalog") {
		const manager = new ProviderSettingsManager();
		await ensureCustomProvidersLoaded(manager);
		return await listLocalProviders(manager);
	}
	if (command === "list_provider_models") {
		const manager = new ProviderSettingsManager();
		return await getLocalProviderModels(
			String(args?.provider ?? ""),
			manager.getProviderConfig(String(args?.provider ?? "").trim()),
		);
	}
	if (command === "save_provider_settings") {
		const manager = new ProviderSettingsManager();
		return saveLocalProviderSettings(manager, {
			providerId: String(args?.provider ?? ""),
			enabled: typeof args?.enabled === "boolean" ? args.enabled : undefined,
			apiKey: typeof args?.api_key === "string" ? args.api_key : undefined,
			baseUrl: typeof args?.base_url === "string" ? args.base_url : undefined,
		});
	}
	if (command === "add_provider") {
		const manager = new ProviderSettingsManager();
		await ensureCustomProvidersLoaded(manager);
		return await addLocalProvider(manager, {
			providerId: String(args?.provider_id ?? ""),
			name: String(args?.name ?? ""),
			baseUrl: String(args?.base_url ?? ""),
			apiKey: typeof args?.api_key === "string" ? args.api_key : undefined,
			headers:
				args?.headers && typeof args.headers === "object"
					? (args.headers as Record<string, string>)
					: undefined,
			timeoutMs:
				typeof args?.timeout_ms === "number" ? args.timeout_ms : undefined,
			models: Array.isArray(args?.models)
				? (args.models as string[])
				: undefined,
			defaultModelId:
				typeof args?.default_model_id === "string"
					? args.default_model_id
					: undefined,
			modelsSourceUrl:
				typeof args?.models_source_url === "string"
					? args.models_source_url
					: undefined,
			capabilities: Array.isArray(args?.capabilities)
				? (args.capabilities as ProviderCapability[])
				: undefined,
		});
	}
	if (command === "run_provider_oauth_login") {
		const providerId = normalizeOAuthProvider(String(args?.provider ?? ""));
		const manager = new ProviderSettingsManager();
		const existing = manager.getProviderSettings(providerId);
		const credentials = await loginLocalProvider(
			providerId,
			existing,
			(url) => {
				const platform = process.platform;
				const spawned =
					platform === "darwin"
						? spawn("open", [url], { stdio: "ignore", detached: true })
						: platform === "win32"
							? spawn("cmd", ["/c", "start", "", url], {
									stdio: "ignore",
									detached: true,
								})
							: spawn("xdg-open", [url], {
									stdio: "ignore",
									detached: true,
								});
				spawned.unref();
			},
		);
		const saved = saveLocalProviderOAuthCredentials(
			manager,
			providerId,
			existing,
			credentials,
		);
		return {
			provider: providerId,
			accessToken: saved.auth?.accessToken ?? saved.apiKey ?? "",
		};
	}

	// ── MCP server management ─────────────────────────────────────────
	if (command === "list_mcp_servers") {
		return readMcpServersResponse();
	}
	if (command === "set_mcp_server_disabled") {
		const path = ensureMcpSettingsFile();
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
		const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
		const name = String(args?.name ?? "").trim();
		const current = servers[name];
		if (!current || typeof current !== "object") {
			throw new Error(`unknown MCP server: ${name}`);
		}
		servers[name] = {
			...(current as JsonRecord),
			disabled: Boolean(args?.disabled),
		};
		writeMcpServersMap(servers);
		return readMcpServersResponse();
	}
	if (command === "upsert_mcp_server") {
		const input =
			args?.input && typeof args.input === "object"
				? (args.input as JsonRecord)
				: (args as JsonRecord);
		const name = String(input.name ?? "").trim();
		if (!name) throw new Error("server name is required");
		const previousName = String(
			input.previousName ?? input.previous_name ?? "",
		).trim();
		const transportType = String(
			input.transportType ?? input.transport_type ?? "",
		).trim();
		const next: JsonRecord =
			transportType === "stdio"
				? {
						transport: {
							type: "stdio",
							command: input.command,
							args: input.args,
							cwd: input.cwd,
							env: input.env,
						},
						disabled: Boolean(input.disabled),
						metadata: input.metadata,
					}
				: {
						transport: {
							type: transportType,
							url: input.url,
							headers: input.headers,
						},
						disabled: Boolean(input.disabled),
						metadata: input.metadata,
					};
		const path = ensureMcpSettingsFile();
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
		const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
		if (previousName && previousName !== name) {
			delete servers[previousName];
		}
		servers[name] = next;
		writeMcpServersMap(servers);
		return readMcpServersResponse();
	}
	if (command === "delete_mcp_server") {
		const path = ensureMcpSettingsFile();
		const parsed = JSON.parse(readFileSync(path, "utf8")) as JsonRecord;
		const servers = (parsed.mcpServers as JsonRecord | undefined) ?? {};
		delete servers[String(args?.name ?? "")];
		writeMcpServersMap(servers);
		return readMcpServersResponse();
	}
	if (command === "ensure_mcp_settings_file") {
		return ensureMcpSettingsFile();
	}

	// ── Git operations ─────────────────────────────────────────────────
	if (command === "get_git_branch") {
		const branches = listGitBranches(
			ctx,
			typeof args?.cwd === "string" ? args.cwd : undefined,
		);
		return { branch: branches.current };
	}
	if (command === "list_git_branches") {
		return listGitBranches(
			ctx,
			typeof args?.cwd === "string" ? args.cwd : undefined,
		);
	}
	if (command === "checkout_git_branch") {
		const cwd = typeof args?.cwd === "string" ? args.cwd : undefined;
		const branch = String(args?.branch ?? "").trim();
		if (!branch) throw new Error("branch is required");
		execFileSync("git", ["checkout", branch], {
			cwd: cwd?.trim() || ctx.workspaceRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { branch };
	}

	// ── Routine schedules ─────────────────────────────────────────────
	if (
		command === "list_routine_schedules" ||
		command === "create_routine_schedule" ||
		command === "pause_routine_schedule" ||
		command === "resume_routine_schedule" ||
		command === "trigger_routine_schedule" ||
		command === "delete_routine_schedule"
	) {
		return await handleRoutineScheduleCommand(command, args);
	}

	// ── User instruction configs ──────────────────────────────────────
	if (command === "list_user_instruction_configs") {
		return await listUserInstructionConfigs(ctx.workspaceRoot);
	}
	if (command === "toggle_disabled_plugin_tool") {
		const toolName = String(args?.name ?? "").trim();
		if (!toolName) {
			throw new Error("tool name is required");
		}
		toggleDisabledTool(toolName);
		return await listUserInstructionConfigs(ctx.workspaceRoot);
	}

	// ── Native OS commands ────────────────────────────────────────────
	if (command === "pick_workspace_directory") {
		return pickWorkspaceDirectory();
	}
	if (command === "open_mcp_settings_file") {
		const path = ensureMcpSettingsFile();
		openFileInEditor(path);
		return path;
	}

	throw new Error(`unsupported desktop command: ${command}`);
}
