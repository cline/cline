import type { AgentPlugin } from "@cline/core";
import { createTool } from "@cline/shared";
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

const clineDoctorReport = createTool({
	name: "cline_doctor_report",
	description: "Inspect the active Cline Gateway namespace, discovery record, database, providers, plugins, secrets metadata, and durable object counts without exposing credentials.",
	inputSchema: { type: "object", properties: {}, required: [] },
	async execute() {
		try {
			const data = gatewayDataDir();
			const discovery = readDiscovery();
			const pid = typeof discovery?.pid === "number" ? discovery.pid : undefined;
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

const clineInspectConfig = createTool({
	name: "cline_inspect_config",
	description: "Inspect effective Gateway paths, namespace, provider names, bot directories, plugin directories, and an optional workspace's project configuration.",
	inputSchema: {
		type: "object",
		properties: { workspace: { type: "string" } },
		required: [],
	},
	async execute(input) {
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

const clineListSessions = createTool({
	name: "cline_list_sessions",
	description: "List recent durable Gateway sessions with bot, workspace, state, latest run state, and latest error.",
	inputSchema: {
		type: "object",
		properties: { limit: { type: "number", minimum: 1, maximum: 50 } },
		required: [],
	},
	async execute(input) {
		try {
			const limit = (input as { limit?: number }).limit ?? 10;
			const sessions = await listGatewaySessions(limit);
			return { count: sessions.length, sessions };
		} catch (error) {
			return { error: `Gateway session listing failed: ${String(error)}` };
		}
	},
});

const clineReadLogs = createTool({
	name: "cline_read_logs",
	description: "Read a redacted tail from a Gateway or Gateway Desktop log when that log exists in the active Gateway data directory.",
	inputSchema: {
		type: "object",
		properties: {
			file: { type: "string", enum: ["gateway", "desktop"] },
			lines: { type: "number", minimum: 1, maximum: 500 },
		},
		required: ["file"],
	},
	async execute(input) {
		const { file, lines } = input as { file?: string; lines?: number };
		if (file !== "gateway" && file !== "desktop") return { error: "file must be gateway or desktop" };
		try {
			const tail = tailGatewayLog(file, lines ?? 50);
			return tail === undefined
				? { file, exists: false, note: "This Gateway currently writes diagnostics to its owning process stderr; no persisted log file was found." }
				: { file, exists: true, redacted: true, tail };
		} catch (error) {
			return { error: `Gateway log read failed: ${String(error)}` };
		}
	},
});

const clineListSchedules = createTool({
	name: "cline_list_schedules",
	description: "List durable Gateway schedules and recent schedule jobs, including attempts and last errors.",
	inputSchema: { type: "object", properties: {}, required: [] },
	async execute() {
		try {
			return await scheduleReport();
		} catch (error) {
			return { error: `Gateway schedule report failed: ${String(error)}` };
		}
	},
});

const plugin: AgentPlugin = {
	name: "cline-support",
	manifest: { capabilities: ["tools", "commands", "rules"] },
	setup(api) {
		for (const tool of [
			clineDoctorReport,
			clineInspectConfig,
			clineListSessions,
			clineReadLogs,
			clineListSchedules,
		]) api.registerTool(tool);
		api.registerRule({
			id: "cline-support-usage",
			source: "cline-support",
			content: "Use cline_doctor_report first for Gateway failures. These tools target clinegate, not the legacy Hub, and never return credential values.",
		});
		api.registerCommand({
			name: "cline-support",
			description: "Gateway health summary",
			async handler() {
				const report = await clineDoctorReport.execute({}, {} as never);
				return { reply: JSON.stringify(report, null, 2) };
			},
		});
	},
};

export default plugin;
