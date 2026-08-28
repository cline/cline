import { join } from "node:path";
import {
	databaseCounts,
	dirEntries,
	fileInfo,
	gatewayDataDir,
	gatewayDataRoot,
	gatewayNamespace,
	listGatewaySessions,
	providerSummary,
	readDiscovery,
	scheduleReport,
	tailGatewayLog,
} from "./support";

export interface GatewaySupportTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
	execute(input?: unknown, context?: unknown): unknown | Promise<unknown>;
}

export interface GatewaySupportCommand {
	name: string;
	description?: string;
	handler(input?: string): unknown | Promise<unknown>;
}

export interface GatewaySupportApi {
	registerTool(tool: GatewaySupportTool): void;
	registerCommand(command: GatewaySupportCommand): void;
	registerRule(rule: { id: string; source?: string; content: string }): void;
}

export interface GatewaySupportPlugin {
	name: string;
	manifest: { capabilities: string[] };
	setup(api: GatewaySupportApi, context?: unknown): void | Promise<void>;
}

function defineTool<const T extends GatewaySupportTool>(tool: T): T {
	return tool;
}

const clineDoctorReport = defineTool({
	name: "cline_doctor_report",
	description:
		"Inspect the active Cline Gateway namespace, discovery record, database, providers, plugins, secrets metadata, and durable object counts without exposing credentials.",
	inputSchema: { type: "object", properties: {}, required: [] },
	async execute() {
		try {
			const data = gatewayDataDir();
			const discovery = readDiscovery();
			const pid =
				typeof discovery?.pid === "number" ? discovery.pid : undefined;
			let processAlive: boolean | undefined;
			if (pid !== undefined) {
				try {
					process.kill(pid, 0);
					processAlive = true;
				} catch {
					processAlive = false;
				}
			}
			return {
				gateway_data_root: gatewayDataRoot(),
				namespace: gatewayNamespace(),
				data_dir: data,
				discovery,
				discovery_process_alive: processAlive,
				database: fileInfo(join(data, "gateway.db")),
				counts: await databaseCounts(),
				providers: providerSummary(),
				plugins: {
					global: dirEntries(join(data, "plugins")),
					bots: dirEntries(join(data, "bots")),
				},
				secret_files: dirEntries(join(data, "secrets")),
				note: "Secret file names are shown; values are never read.",
			};
		} catch (error) {
			return { error: `Gateway doctor report failed: ${String(error)}` };
		}
	},
});

const clineInspectConfig = defineTool({
	name: "cline_inspect_config",
	description:
		"Inspect effective Gateway paths, namespace, provider names, bot directories, plugin directories, and an optional workspace's project configuration.",
	inputSchema: {
		type: "object",
		properties: { workspace: { type: "string" } },
		required: [],
	},
	async execute(input: unknown) {
		try {
			const { workspace } = input as { workspace?: string };
			const data = gatewayDataDir();
			return {
				gateway: {
					data_root: gatewayDataRoot(),
					namespace: gatewayNamespace(),
					data_dir: data,
					discovery: fileInfo(join(data, "gateway.json")),
					database: fileInfo(join(data, "gateway.db")),
					global_plugins: dirEntries(join(data, "plugins")),
					bots: dirEntries(join(data, "bots")),
				},
				providers: providerSummary(),
				workspace: workspace?.trim()
					? {
							path: workspace.trim(),
							agents_md: fileInfo(join(workspace.trim(), "AGENTS.md")),
							rules: dirEntries(join(workspace.trim(), ".cline", "rules")),
							skills: dirEntries(join(workspace.trim(), ".cline", "skills")),
							plugins: dirEntries(join(workspace.trim(), ".cline", "plugins")),
						}
					: undefined,
			};
		} catch (error) {
			return { error: `Gateway config inspection failed: ${String(error)}` };
		}
	},
});

const clineListSessions = defineTool({
	name: "cline_list_sessions",
	description:
		"List recent durable Gateway sessions with bot, workspace, state, latest run state, and latest error.",
	inputSchema: {
		type: "object",
		properties: { limit: { type: "number", minimum: 1, maximum: 50 } },
		required: [],
	},
	async execute(input: unknown) {
		try {
			const limit = (input as { limit?: number }).limit ?? 10;
			const sessions = await listGatewaySessions(limit);
			return { count: sessions.length, sessions };
		} catch (error) {
			return { error: `Gateway session listing failed: ${String(error)}` };
		}
	},
});

const clineReadLogs = defineTool({
	name: "cline_read_logs",
	description:
		"Read a redacted tail from a Gateway or Gateway Desktop log when that log exists in the active Gateway data directory.",
	inputSchema: {
		type: "object",
		properties: {
			file: { type: "string", enum: ["gateway", "desktop"] },
			lines: { type: "number", minimum: 1, maximum: 500 },
		},
		required: ["file"],
	},
	async execute(input: unknown) {
		const { file, lines } = input as { file?: string; lines?: number };
		if (file !== "gateway" && file !== "desktop")
			return { error: "file must be gateway or desktop" };
		try {
			const tail = tailGatewayLog(file, lines ?? 50);
			return tail === undefined
				? {
						file,
						exists: false,
						note: "This Gateway currently writes diagnostics to its owning process stderr; no persisted log file was found.",
					}
				: { file, exists: true, redacted: true, tail };
		} catch (error) {
			return { error: `Gateway log read failed: ${String(error)}` };
		}
	},
});

const clineListSchedules = defineTool({
	name: "cline_list_schedules",
	description:
		"List durable Gateway schedules and recent schedule jobs, including attempts and last errors.",
	inputSchema: { type: "object", properties: {}, required: [] },
	async execute() {
		try {
			return await scheduleReport();
		} catch (error) {
			return { error: `Gateway schedule report failed: ${String(error)}` };
		}
	},
});

export interface ProposeNewBotInput {
	name?: string;
	initialProjectPath?: string;
	reason?: string;
	systemPrompt?: string;
}

function trimmedOptional(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed || undefined;
}

/**
 * Creation intentionally remains a desktop-owned, user-confirmed action. The
 * tool call itself is the durable proposal that the desktop renders as a
 * review card; its structured result only tells the model that confirmation is
 * still outstanding.
 */
export const proposeNewBot = defineTool({
	name: "propose_new_bot",
	description:
		"Propose a new worker bot for the user to review and create in the Cline Bots desktop app. Use this when the user asks for a new bot or agrees that a separate specialist bot should be created. This tool does not create the bot: it displays a confirmation card, and the user must click Create this bot. Never claim the bot was created based only on this tool's result.",
	inputSchema: {
		type: "object",
		properties: {
			name: {
				type: "string",
				minLength: 1,
				maxLength: 80,
				description: "Short, user-facing name for the new bot.",
			},
			initialProjectPath: {
				type: "string",
				minLength: 1,
				description:
					"Optional absolute path to the project the user wants to grant to the new bot.",
			},
			reason: {
				type: "string",
				maxLength: 500,
				description:
					"Brief user-facing explanation of why this separate bot is useful.",
			},
			systemPrompt: {
				type: "string",
				maxLength: 12_000,
				description:
					"Optional durable instructions defining the new bot's role and behavior.",
			},
		},
		required: ["name"],
		additionalProperties: false,
	},
	async execute(input: unknown) {
		const proposal =
			typeof input === "object" && input !== null
				? (input as ProposeNewBotInput)
				: {};
		const name = trimmedOptional(proposal.name);
		if (!name) return { error: "Bot name is required." };
		if (name.length > 80)
			return { error: "Bot name must be 80 characters or fewer." };

		const reason = trimmedOptional(proposal.reason);
		const systemPrompt = trimmedOptional(proposal.systemPrompt);
		const initialProjectPath = trimmedOptional(proposal.initialProjectPath);
		if (reason && reason.length > 500)
			return { error: "Proposal reason must be 500 characters or fewer." };
		if (systemPrompt && systemPrompt.length > 12_000)
			return { error: "Bot instructions must be 12,000 characters or fewer." };

		return {
			proposed: true,
			requiresUserConfirmation: true,
			name,
			...(initialProjectPath ? { initialProjectPath } : {}),
			...(reason ? { reason } : {}),
			...(systemPrompt ? { systemPrompt } : {}),
			message:
				"The proposal is ready for review. The bot has not been created; wait for the user to use the confirmation card.",
		};
	},
});

const plugin: GatewaySupportPlugin = {
	name: "cline-support",
	manifest: { capabilities: ["tools", "commands", "rules"] },
	setup(api) {
		for (const tool of [
			clineDoctorReport,
			clineInspectConfig,
			clineListSessions,
			clineReadLogs,
			clineListSchedules,
			proposeNewBot,
		])
			api.registerTool(tool);
		api.registerRule({
			id: "cline-support-usage",
			source: "cline-support",
			content:
				"Use cline_doctor_report first for Gateway failures. These tools target clinegate, not the legacy Hub, and never return credential values. When the user asks to create a bot, use propose_new_bot with a clear name and optional role instructions. The proposal requires the user to confirm creation in the desktop UI, so never say the bot exists until the user confirms it.",
		});
		api.registerCommand({
			name: "cline-support",
			description: "Gateway health summary",
			async handler() {
				const report = await clineDoctorReport.execute();
				return { reply: JSON.stringify(report, null, 2) };
			},
		});
	},
};

export default plugin;
