import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { RpcProviderCapability } from "@clinebot/core";
import {
	addLocalProvider,
	ensureCustomProvidersLoaded,
	getLocalProviderModels,
	listLocalProviders,
	loginLocalProvider,
	normalizeOAuthProvider,
	ProviderSettingsManager,
	resolveSessionBackend,
	SqliteSessionStore,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
} from "@clinebot/core";
import {
	resolveCliEntrypointPath,
	resolveMcpSettingsPath,
	resolveScriptPath,
	rootSessionIdFrom,
	runBunScriptJson,
	sessionHookLogPath,
	sessionLogPath,
	sharedSessionDataDir,
} from "./paths";
import {
	handleChatSessionCommand,
	listPendingToolApprovalsForSession,
	respondToolApproval,
} from "./runtime-bridge";
import {
	discoverChatSessions,
	discoverCliSessions,
	findArtifactUnderDir,
	mergeDiscoveredSessionLists,
	normalizeSessionTitle,
	readSessionHooks,
	readSessionMessages,
	readSessionTranscript,
	searchWorkspaceFiles,
} from "./session-data";
import type {
	ChatSessionCommandRequest,
	HostContext,
	JsonRecord,
} from "./types";

function readMcpServersResponse(): JsonRecord {
	const settingsPath = resolveMcpSettingsPath();
	if (!existsSync(settingsPath)) {
		return {
			settingsPath,
			hasSettingsFile: false,
			servers: [],
		};
	}
	const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as JsonRecord;
	const servers = parsed.mcpServers as JsonRecord | undefined;
	const entries = Object.entries(servers ?? {}).map(([name, body]) => ({
		name,
		...(body as JsonRecord),
	}));
	return {
		settingsPath,
		hasSettingsFile: true,
		servers: entries,
	};
}

function writeMcpServersMap(servers: JsonRecord) {
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

function listGitBranches(
	ctx: HostContext,
	cwd?: string,
): {
	current?: string;
	branches?: string[];
} {
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
			.map((value) => value.trim())
			.filter(Boolean);
		return {
			current: current || undefined,
			branches,
		};
	} catch {
		return {
			current: current || undefined,
			branches: [],
		};
	}
}

export async function handleCommand(
	ctx: HostContext,
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	if (command === "chat_session_command") {
		return await handleChatSessionCommand(
			ctx,
			(args?.request as ChatSessionCommandRequest | undefined) ??
				(args as ChatSessionCommandRequest),
		);
	}
	if (command === "read_session_messages") {
		return await readSessionMessages(
			ctx,
			String(args?.sessionId ?? ""),
			typeof args?.maxMessages === "number" ? args.maxMessages : 800,
		);
	}
	if (command === "read_session_transcript") {
		return await readSessionTranscript(
			String(args?.sessionId ?? ""),
			typeof args?.maxChars === "number" ? args.maxChars : undefined,
		);
	}
	if (command === "read_session_hooks") {
		return await readSessionHooks(
			String(args?.sessionId ?? ""),
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "get_chat_ws_endpoint") {
		return "";
	}
	if (command === "poll_tool_approvals") {
		return listPendingToolApprovalsForSession(
			String(args?.sessionId ?? ""),
			typeof args?.limit === "number" ? args.limit : 20,
		);
	}
	if (command === "respond_tool_approval") {
		return await respondToolApproval(ctx, args);
	}
	if (command === "get_process_context") {
		return {
			workspaceRoot: ctx.workspaceRoot,
			cwd: ctx.workspaceRoot,
		};
	}
	if (command === "list_chat_sessions") {
		return discoverChatSessions(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "list_cli_sessions") {
		return discoverCliSessions(
			ctx,
			typeof args?.limit === "number" ? args.limit : 300,
		);
	}
	if (command === "list_discovered_sessions") {
		const limit = typeof args?.limit === "number" ? args.limit : 300;
		return mergeDiscoveredSessionLists(
			discoverChatSessions(ctx, limit),
			discoverCliSessions(ctx, limit),
			limit,
		);
	}
	if (command === "update_chat_session_title") {
		const sessionId = String(args?.sessionId ?? "").trim();
		if (!sessionId) {
			throw new Error("session id is required");
		}
		const title = normalizeSessionTitle(String(args?.title ?? ""));
		const backend = await resolveSessionBackend({ backendMode: "local" });
		const result = await backend.updateSession({
			sessionId,
			title,
		});
		if (!result.updated) {
			throw new Error(`Session ${sessionId} not found`);
		}
		const liveSession = ctx.liveSessions.get(sessionId);
		if (liveSession) {
			liveSession.title = title;
		}
		return true;
	}
	if (command === "delete_chat_session" || command === "delete_cli_session") {
		const sessionId = String(args?.sessionId ?? args?.session_id ?? "").trim();
		if (!sessionId) {
			throw new Error("session id is required");
		}
		ctx.liveSessions.delete(sessionId);
		const store = new SqliteSessionStore();
		const row = store.get(sessionId);
		store.delete(sessionId, true);
		for (const path of [
			sessionLogPath(sessionId),
			sessionHookLogPath(sessionId),
			join(sharedSessionDataDir(), sessionId),
		]) {
			if (existsSync(path)) {
				rmSync(path, { recursive: true, force: true });
			}
		}
		for (const path of [
			row?.transcriptPath,
			row?.hookPath,
			row?.messagesPath,
		].filter(
			(value): value is string => typeof value === "string" && value.length > 0,
		)) {
			if (existsSync(path)) {
				rmSync(path, { force: true });
			}
		}
		for (const suffix of ["messages.json", "log", "hooks.jsonl"]) {
			const fileName = `${sessionId}.${suffix}`;
			const found = findArtifactUnderDir(
				join(sharedSessionDataDir(), rootSessionIdFrom(sessionId)),
				fileName,
				4,
			);
			if (found && existsSync(found)) {
				rmSync(found, { force: true });
			}
		}
		return true;
	}
	if (command === "search_workspace_files") {
		return await searchWorkspaceFiles(ctx, args);
	}
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
				? (args?.models as string[])
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
				? (args.capabilities as RpcProviderCapability[])
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
	if (
		command === "list_routine_schedules" ||
		command === "create_routine_schedule" ||
		command === "pause_routine_schedule" ||
		command === "resume_routine_schedule" ||
		command === "trigger_routine_schedule" ||
		command === "delete_routine_schedule"
	) {
		const scriptPath = resolveScriptPath(ctx, "routine-schedules.ts");
		if (!scriptPath) {
			throw new Error("routine schedules script not found");
		}
		const actionMap: Record<string, string> = {
			list_routine_schedules: "listOverview",
			create_routine_schedule: "createSchedule",
			pause_routine_schedule: "pauseSchedule",
			resume_routine_schedule: "resumeSchedule",
			trigger_routine_schedule: "triggerScheduleNow",
			delete_routine_schedule: "deleteSchedule",
		};
		return runBunScriptJson(scriptPath, {
			action: actionMap[command],
			scheduleId: args?.schedule_id,
			name: args?.name,
			cronPattern: args?.cron_pattern,
			prompt: args?.prompt,
			provider: args?.provider,
			model: args?.model,
			mode: args?.mode,
			workspaceRoot: args?.workspace_root,
			cwd: args?.cwd,
			systemPrompt: args?.system_prompt,
			maxIterations: args?.max_iterations,
			timeoutSeconds: args?.timeout_seconds,
			maxParallel: args?.max_parallel,
			enabled: args?.enabled,
			tags: args?.tags,
		});
	}
	if (command === "list_user_instruction_configs") {
		const cliEntrypoint = resolveCliEntrypointPath(ctx);
		if (!cliEntrypoint) {
			throw new Error("CLI entrypoint not found");
		}
		const runList = (target: string) => {
			const result = spawnSync(
				"bun",
				["run", cliEntrypoint, "list", target, "--json"],
				{
					cwd: ctx.workspaceRoot,
					encoding: "utf8",
				},
			);
			if (result.status !== 0) {
				throw new Error(result.stderr.trim() || `list ${target} failed`);
			}
			return JSON.parse(result.stdout || "[]");
		};
		const warnings: string[] = [];
		const load = (target: string) => {
			try {
				return runList(target);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				warnings.push(`${target}: ${message}`);
				return [];
			}
		};
		return {
			workspaceRoot: ctx.workspaceRoot,
			rules: load("rules"),
			workflows: load("workflows"),
			skills: load("skills"),
			agents: load("agents"),
			hooks: load("hooks"),
			warnings,
		};
	}
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
		if (!name) {
			throw new Error("server name is required");
		}
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
	if (command === "get_git_branch") {
		const branches = listGitBranches(
			ctx,
			typeof args?.cwd === "string" ? args.cwd : undefined,
		);
		return {
			branch: branches.current,
		};
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
		if (!branch) {
			throw new Error("branch is required");
		}
		execFileSync("git", ["checkout", branch], {
			cwd: cwd?.trim() || ctx.workspaceRoot,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return {
			branch,
		};
	}
	if (command === "ensure_mcp_settings_file") {
		return ensureMcpSettingsFile();
	}
	throw new Error(`unsupported desktop command: ${command}`);
}
