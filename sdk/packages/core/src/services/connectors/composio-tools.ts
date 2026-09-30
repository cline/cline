import { createHash } from "node:crypto";
import { join } from "node:path";
import { resolveClineDataDir } from "@cline/shared/storage";
import type { ConnectorToolSchema } from "./cline-connectors-api";

const MAX_TOOL_DESCRIPTION_LENGTH = 1024;

export type StoredComposioTool = {
	slug: string;
	name?: string;
	description?: string;
	version?: string;
	input_parameters?: Record<string, unknown>;
};

function parseToolInputParameters(
	value: unknown,
): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null
		? (value as Record<string, unknown>)
		: undefined;
}

export function normalizeComposioTool(
	raw: ConnectorToolSchema,
): StoredComposioTool | undefined {
	if (!raw?.slug) {
		return undefined;
	}
	const description = raw.description?.trim();
	return {
		slug: raw.slug,
		name: raw.name?.trim() || undefined,
		description:
			description && description.length > MAX_TOOL_DESCRIPTION_LENGTH
				? `${description.slice(0, MAX_TOOL_DESCRIPTION_LENGTH)}…`
				: description || undefined,
		version:
			typeof raw.version === "string" && raw.version.trim()
				? raw.version.trim()
				: undefined,
		input_parameters: parseToolInputParameters(raw.input_parameters),
	};
}

export function resolveComposioToolsStatePath(accountId: string): string {
	const key = createHash("sha256").update(accountId).digest("hex");
	return join(resolveClineDataDir(), "settings", "composio", `${key}.json`);
}
