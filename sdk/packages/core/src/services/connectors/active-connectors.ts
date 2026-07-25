import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ActiveConnectorRecord } from "@cline/shared";
import { listConnectorCatalog } from "@cline/shared";
import { resolveConnectorDataDir } from "@cline/shared/storage";

type ConnectorFieldKey = keyof Omit<
	ActiveConnectorRecord,
	"id" | "type" | "instanceId" | "pid" | "hubUrl"
>;

const connectorFieldExtractors: Record<
	ConnectorFieldKey,
	(record: Record<string, unknown>) => string | number | undefined
> = {
	startedAt: (record) =>
		typeof record.startedAt === "string" ? record.startedAt : undefined,
	port: (record) => (typeof record.port === "number" ? record.port : undefined),
	baseUrl: (record) =>
		typeof record.baseUrl === "string" ? record.baseUrl : undefined,
	connectionMode: (record) =>
		typeof record.connectionMode === "string"
			? record.connectionMode
			: undefined,
	userName: (record) =>
		typeof record.userName === "string" ? record.userName : undefined,
	botUsername: (record) =>
		typeof record.botUsername === "string" ? record.botUsername : undefined,
	applicationId: (record) =>
		typeof record.applicationId === "string" ? record.applicationId : undefined,
	phoneNumberId: (record) =>
		typeof record.phoneNumberId === "string" ? record.phoneNumberId : undefined,
};

const connectorActiveStateConfigs: Record<
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

function readActiveConnectorRecord(
	type: string,
	statePath: string,
): ActiveConnectorRecord | undefined {
	let parsed: Record<string, unknown>;
	try {
		const value = JSON.parse(readFileSync(statePath, "utf8")) as unknown;
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			return undefined;
		}
		parsed = value as Record<string, unknown>;
	} catch {
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

	const config = connectorActiveStateConfigs[type];
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

	const instanceId =
		type === "telegram"
			? fields.botUsername
			: type === "discord"
				? fields.applicationId
				: type === "whatsapp" && typeof parsed.instanceKey === "string"
					? parsed.instanceKey
					: fields.userName;
	if (!instanceId) {
		return undefined;
	}
	return {
		id: `${type}:${instanceId}`,
		type,
		instanceId,
		pid,
		hubUrl,
		...fields,
	} as ActiveConnectorRecord;
}

export function listActiveConnectors(): ActiveConnectorRecord[] {
	const records: ActiveConnectorRecord[] = [];
	for (const { name } of listConnectorCatalog()) {
		const directory = join(resolveConnectorDataDir(), name);
		if (!existsSync(directory)) {
			continue;
		}
		for (const filename of readdirSync(directory)) {
			if (!filename.endsWith(".json") || filename.endsWith(".threads.json")) {
				continue;
			}
			const record = readActiveConnectorRecord(name, join(directory, filename));
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
