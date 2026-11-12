import type { McpServer } from "@/lib/extension-inventory";
import type { McpServerUpsertInput, McpTransportType } from "./mcp-types";

type McpServerType = "local" | "remote";

export function serverTypeOf(transportType: McpTransportType): McpServerType {
	return transportType === "stdio" ? "local" : "remote";
}

export type McpServerFormState = {
	name: string;
	/** The stored name of the server being edited, exactly as stored. */
	previousName: string | undefined;
	transportType: McpTransportType;
	command: string;
	argsText: string;
	cwd: string;
	envEntries: Array<{ id: string; key: string; value: string }>;
	url: string;
	headersText: string;
	disabled: boolean;
	metadataText: string;
};

function splitCsv(text: string): string[] {
	return text
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function parseKeyValuePairs(text: string): Record<string, string> | undefined {
	const pairs = splitCsv(text);
	if (pairs.length === 0) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const pair of pairs) {
		const idx = pair.indexOf("=");
		if (idx <= 0) {
			continue;
		}
		const key = pair.slice(0, idx).trim();
		const value = pair.slice(idx + 1).trim();
		if (!key) {
			continue;
		}
		out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function stringifyKeyValuePairs(input?: Record<string, string>): string {
	if (!input) {
		return "";
	}
	return Object.entries(input)
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
}

export function createEnvEntries(
	input?: Record<string, string>,
): Array<{ id: string; key: string; value: string }> {
	if (!input || Object.keys(input).length === 0) {
		return [{ id: crypto.randomUUID(), key: "", value: "" }];
	}
	return Object.entries(input).map(([key, value]) => ({
		id: crypto.randomUUID(),
		key,
		value,
	}));
}

export function createServerFormState(
	existing?: McpServer,
): McpServerFormState {
	return {
		name: existing?.name ?? "",
		previousName: existing?.name,
		transportType: existing?.transportType ?? "stdio",
		command: existing?.command ?? "",
		argsText: existing?.args?.join(", ") ?? "",
		cwd: existing?.cwd ?? "",
		envEntries: createEnvEntries(existing?.env),
		url: existing?.url ?? "",
		headersText: stringifyKeyValuePairs(existing?.headers),
		disabled: existing?.disabled ?? false,
		metadataText:
			existing?.metadata === undefined
				? ""
				: JSON.stringify(existing.metadata, null, 2),
	};
}

export function buildServerInput(
	form: McpServerFormState,
): McpServerUpsertInput {
	const name = form.name.trim();
	if (!name) {
		throw new Error("Server name is required.");
	}
	const env = form.envEntries.reduce<Record<string, string>>((acc, entry) => {
		const key = entry.key.trim();
		if (!key) {
			return acc;
		}
		acc[key] = entry.value;
		return acc;
	}, {});
	const metadataText = form.metadataText.trim();
	const metadata =
		metadataText.length > 0 ? JSON.parse(metadataText) : undefined;
	if (form.transportType === "stdio") {
		const command = form.command.trim();
		if (!command) {
			throw new Error("Command is required for local servers.");
		}
		const args = splitCsv(form.argsText);
		return {
			name,
			previousName: form.previousName,
			transportType: form.transportType,
			command,
			args: args.length > 0 ? args : undefined,
			cwd: form.cwd.trim() || undefined,
			env: Object.keys(env).length > 0 ? env : undefined,
			disabled: form.disabled,
			metadata,
		} satisfies McpServerUpsertInput;
	}
	const url = form.url.trim();
	if (!url) {
		throw new Error("Server URL is required for remote servers.");
	}
	return {
		name,
		previousName: form.previousName,
		transportType: form.transportType,
		url,
		headers: parseKeyValuePairs(form.headersText),
		disabled: form.disabled,
		metadata,
	} satisfies McpServerUpsertInput;
}
