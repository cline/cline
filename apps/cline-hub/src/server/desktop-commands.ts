import {
	addLocalProvider,
	type ClineAccountActionRequest,
	ClineAccountService,
	ensureCustomProvidersLoaded,
	executeClineAccountAction,
	getLocalProviderModels,
	listLocalProviders,
	loginLocalProvider,
	normalizeOAuthProvider,
	type ProviderCapability,
	type ProviderClient,
	type ProviderProtocol,
	readGlobalSettings,
	resolveLocalClineAuthToken,
	saveLocalProviderOAuthCredentials,
	saveLocalProviderSettings,
	setAutoUpdateEnabledGlobally,
	setDisabledPlugin,
	setDisabledTools,
	setTelemetryOptOutGlobally,
	toggleDisabledTool,
} from "@cline/core";
import { getClineEnvironmentConfig } from "@cline/shared";
import {
	connectorChannelsPayload,
	startConnectorChannel,
	stopConnectorChannel,
} from "./connectors";
import { providerSettingsManager, workspaceRoot } from "./deps";
import {
	deleteMcpServer,
	ensureMcpSettingsFile,
	readMcpServersResponse,
	setMcpServerDisabled,
	upsertMcpServer,
} from "./mcp";
import { handleRoutineScheduleCommand } from "./schedules";
import { toWebviewSessionSummary } from "./session-mapping";
import type { HubContext } from "./state";
import { broadcastHubState } from "./state-payloads";
import type { JsonRecord } from "./types";
import { listUserInstructionConfigs } from "./user-instructions";
import { openExternalUrl, readProviderSettingsUpdate } from "./utils";

const ROUTINE_SCHEDULE_COMMANDS = new Set([
	"list_routine_schedules",
	"create_routine_schedule",
	"update_routine_schedule",
	"pause_routine_schedule",
	"resume_routine_schedule",
	"trigger_routine_schedule",
	"delete_routine_schedule",
]);

export async function handleDesktopCommand(
	ctx: HubContext,
	command: string,
	args?: Record<string, unknown>,
): Promise<unknown> {
	if (command === "list_provider_catalog") {
		await ensureCustomProvidersLoaded(providerSettingsManager);
		return await listLocalProviders(providerSettingsManager);
	}
	if (command === "list_provider_models") {
		const provider = String(args?.provider ?? "").trim();
		return await getLocalProviderModels(
			provider,
			providerSettingsManager.getProviderConfig(provider),
		);
	}
	if (command === "save_provider_settings") {
		return saveLocalProviderSettings(providerSettingsManager, {
			...readProviderSettingsUpdate(args),
			providerId: String(args?.provider ?? ""),
			enabled: typeof args?.enabled === "boolean" ? args.enabled : undefined,
			apiKey: typeof args?.api_key === "string" ? args.api_key : undefined,
			baseUrl: typeof args?.base_url === "string" ? args.base_url : undefined,
		});
	}
	if (command === "add_provider") {
		await ensureCustomProvidersLoaded(providerSettingsManager);
		return await addLocalProvider(providerSettingsManager, {
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
			protocol:
				typeof args?.protocol === "string"
					? (args.protocol as ProviderProtocol)
					: undefined,
			client:
				typeof args?.client === "string"
					? (args.client as ProviderClient)
					: undefined,
			capabilities: Array.isArray(args?.capabilities)
				? (args.capabilities as ProviderCapability[])
				: undefined,
		});
	}
	if (command === "run_provider_oauth_login") {
		const providerId = normalizeOAuthProvider(String(args?.provider ?? ""));
		const existing = providerSettingsManager.getProviderSettings(providerId);
		const credentials = await loginLocalProvider(
			providerId,
			existing,
			openExternalUrl,
		);
		const saved = saveLocalProviderOAuthCredentials(
			providerSettingsManager,
			providerId,
			existing,
			credentials,
		);
		return {
			provider: providerId,
			accessToken: saved.auth?.accessToken ?? saved.apiKey ?? "",
		};
	}
	if (command === "cline_account") {
		const settings = providerSettingsManager.getProviderSettings("cline");
		const accountService = new ClineAccountService({
			apiBaseUrl:
				settings?.baseUrl?.trim() || getClineEnvironmentConfig().apiBaseUrl,
			getAuthToken: async () => resolveLocalClineAuthToken(settings),
		});
		return await executeClineAccountAction(
			args as ClineAccountActionRequest,
			accountService,
		);
	}
	if (command === "get_global_settings") {
		return readGlobalSettings();
	}
	if (command === "set_telemetry_opt_out") {
		if (typeof args?.telemetry_opt_out !== "boolean") {
			throw new Error("telemetry_opt_out must be a boolean");
		}
		setTelemetryOptOutGlobally(args.telemetry_opt_out);
		return readGlobalSettings();
	}
	if (command === "set_auto_update_enabled") {
		if (typeof args?.auto_update_enabled !== "boolean") {
			throw new Error("auto_update_enabled must be a boolean");
		}
		setAutoUpdateEnabledGlobally(args.auto_update_enabled);
		return readGlobalSettings();
	}
	if (command === "list_connector_channels") {
		return connectorChannelsPayload();
	}
	if (command === "start_connector_channel") {
		const response = await startConnectorChannel(args);
		broadcastHubState(ctx);
		return response;
	}
	if (command === "stop_connector_channel") {
		const response = await stopConnectorChannel(args);
		broadcastHubState(ctx);
		return response;
	}
	if (command === "list_mcp_servers") {
		return readMcpServersResponse();
	}
	if (command === "set_mcp_server_disabled") {
		return setMcpServerDisabled(
			String(args?.name ?? "").trim(),
			Boolean(args?.disabled),
		);
	}
	if (command === "upsert_mcp_server") {
		const input =
			args?.input && typeof args.input === "object"
				? (args.input as JsonRecord)
				: ((args ?? {}) as JsonRecord);
		return upsertMcpServer(input);
	}
	if (command === "delete_mcp_server") {
		return deleteMcpServer(String(args?.name ?? "").trim());
	}
	if (command === "ensure_mcp_settings_file") {
		return ensureMcpSettingsFile();
	}
	if (command === "open_mcp_settings_file") {
		const path = ensureMcpSettingsFile();
		openExternalUrl(path);
		return path;
	}
	if (ROUTINE_SCHEDULE_COMMANDS.has(command)) {
		return await handleRoutineScheduleCommand(command, args);
	}
	if (command === "get_process_context") {
		return { workspaceRoot, cwd: workspaceRoot };
	}
	if (
		command === "list_cli_sessions" ||
		command === "list_discovered_sessions"
	) {
		return [...ctx.sessions.values()].map(toWebviewSessionSummary);
	}
	if (command === "read_session_hooks") {
		return [];
	}
	if (command === "list_user_instruction_configs") {
		return await listUserInstructionConfigs(workspaceRoot);
	}
	if (command === "toggle_disabled_plugin_tool") {
		const toolName = String(args?.name ?? "").trim();
		if (!toolName) throw new Error("tool name is required");
		toggleDisabledTool(toolName);
		return await listUserInstructionConfigs(workspaceRoot);
	}
	if (command === "set_tool_disabled") {
		const rawNames = Array.isArray(args?.names) ? args.names : [args?.name];
		const toolNames = rawNames
			.map((name) => String(name ?? "").trim())
			.filter(Boolean);
		if (toolNames.length === 0) throw new Error("tool name is required");
		setDisabledTools(toolNames, args?.disabled === true);
		return await listUserInstructionConfigs(workspaceRoot);
	}
	if (command === "set_plugin_disabled") {
		const pluginPath = String(args?.path ?? "").trim();
		if (!pluginPath) throw new Error("plugin path is required");
		setDisabledPlugin(pluginPath, args?.disabled === true);
		return await listUserInstructionConfigs(workspaceRoot);
	}
	throw new Error(`unsupported desktop command: ${command}`);
}
