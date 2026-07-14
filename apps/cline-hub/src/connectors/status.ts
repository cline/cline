import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";

function isProcessRunning(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export type ActiveConnectorRecord = {
	id: string;
	type: string;
	pid: number;
	hubUrl: string;
	startedAt?: string;
	applicationId?: string;
	botUsername?: string;
	userName?: string;
	phoneNumberId?: string;
	port?: number;
	baseUrl?: string;
	connectionMode?: string;
};

function listConnectorStatePaths(
	type: ActiveConnectorRecord["type"],
): string[] {
	const dir = join(resolveClineDataDir(), "connectors", type);
	if (!existsSync(dir)) {
		return [];
	}
	return readdirSync(dir)
		.filter((name) => name.endsWith(".json") && !name.endsWith(".threads.json"))
		.map((name) => join(dir, name));
}

function readJsonRecord(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) {
		return undefined;
	}
	try {
		const raw = readFileSync(path, "utf8");
		const parsed = JSON.parse(raw) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		// Ignore malformed connector state.
	}
	return undefined;
}

type ConnectorFieldKey = keyof Omit<
	ActiveConnectorRecord,
	"id" | "type" | "pid" | "hubUrl"
>;

const connectorFieldExtractors: Record<
	ConnectorFieldKey,
	(p: Record<string, unknown>) => string | number | undefined
> = {
	startedAt: (p) => (typeof p.startedAt === "string" ? p.startedAt : undefined),
	port: (p) => (typeof p.port === "number" ? p.port : undefined),
	baseUrl: (p) => (typeof p.baseUrl === "string" ? p.baseUrl : undefined),
	connectionMode: (p) =>
		typeof p.connectionMode === "string" ? p.connectionMode : undefined,
	userName: (p) => (typeof p.userName === "string" ? p.userName : undefined),
	botUsername: (p) =>
		typeof p.botUsername === "string" ? p.botUsername : undefined,
	applicationId: (p) =>
		typeof p.applicationId === "string" ? p.applicationId : undefined,
	phoneNumberId: (p) =>
		typeof p.phoneNumberId === "string" ? p.phoneNumberId : undefined,
};

const connectorConfigs: Record<
	string,
	{ required: ConnectorFieldKey[]; optional: ConnectorFieldKey[] }
> = {
	discord: {
		required: ["userName", "applicationId"],
		optional: ["startedAt", "port", "baseUrl"],
	},
	telegram: { required: ["botUsername"], optional: ["startedAt"] },
	gchat: { required: ["userName"], optional: ["startedAt", "port", "baseUrl"] },
	linear: {
		required: ["userName"],
		optional: ["startedAt", "port", "baseUrl"],
	},
	slack: {
		required: ["userName"],
		optional: ["startedAt", "connectionMode", "port", "baseUrl"],
	},
	whatsapp: {
		required: ["userName"],
		optional: ["startedAt", "phoneNumberId", "port", "baseUrl"],
	},
};

function connectorRecordId(
	type: ActiveConnectorRecord["type"],
	fields: Partial<
		Omit<ActiveConnectorRecord, "id" | "type" | "pid" | "hubUrl">
	>,
	pid: number,
): string {
	const identity =
		fields.botUsername ??
		fields.userName ??
		fields.applicationId ??
		fields.phoneNumberId ??
		String(pid);
	return `${type}:${identity}`;
}

function readActiveConnectorRecord(
	type: ActiveConnectorRecord["type"],
	statePath: string,
): ActiveConnectorRecord | undefined {
	const parsed = readJsonRecord(statePath);
	if (!parsed) {
		return undefined;
	}
	const pid = typeof parsed.pid === "number" ? parsed.pid : undefined;
	const hubUrl =
		typeof parsed.hubUrl === "string"
			? parsed.hubUrl
			: typeof parsed.rpcAddress === "string"
				? parsed.rpcAddress
				: undefined;
	if (!pid || !hubUrl || !isProcessRunning(pid)) {
		return undefined;
	}
	const config = connectorConfigs[type];
	if (!config) {
		return undefined;
	}
	const fields: Partial<
		Omit<ActiveConnectorRecord, "id" | "type" | "pid" | "hubUrl">
	> = {};
	for (const key of config.required) {
		const value = connectorFieldExtractors[key](parsed);
		if (!value || (typeof value === "string" && !value.trim())) {
			return undefined;
		}
		(fields as Record<string, unknown>)[key] = value;
	}
	for (const key of config.optional) {
		const value = connectorFieldExtractors[key](parsed);
		if (value !== undefined) {
			(fields as Record<string, unknown>)[key] = value;
		}
	}
	return {
		id: connectorRecordId(type, fields, pid),
		type,
		pid,
		hubUrl,
		...fields,
	} as ActiveConnectorRecord;
}

export function listActiveConnectors(): ActiveConnectorRecord[] {
	const connectorTypes: ActiveConnectorRecord["type"][] = [
		"discord",
		"telegram",
		"gchat",
		"linear",
		"slack",
		"whatsapp",
	];
	const records: ActiveConnectorRecord[] = [];
	for (const type of connectorTypes) {
		for (const statePath of listConnectorStatePaths(type)) {
			const record = readActiveConnectorRecord(type, statePath);
			if (record) {
				records.push(record);
			}
		}
	}
	return records.sort((left, right) => {
		if (left.type !== right.type) {
			return left.type.localeCompare(right.type);
		}
		const leftName = left.botUsername ?? left.userName ?? "";
		const rightName = right.botUsername ?? right.userName ?? "";
		return leftName.localeCompare(rightName);
	});
}
