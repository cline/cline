import { createHash } from "node:crypto";
import type { McpToolNameTransform } from "./types";

const MAX_MCP_TOOL_NAME_LENGTH = 128;
const INVALID_MCP_TOOL_NAME_CHARACTERS = /[^a-zA-Z0-9_-]+/g;
const HASH_LENGTH = 8;
const HASH_SEPARATOR_LENGTH = 1;
const FALLBACK_BASE_NAME = "mcp_tool";

function buildMcpToolNameHash(value: string): string {
	return createHash("sha1").update(value).digest("hex").slice(0, HASH_LENGTH);
}

function sanitizeMcpToolNameCandidate(value: string): string {
	return value.replace(INVALID_MCP_TOOL_NAME_CHARACTERS, "_");
}

export const defaultMcpToolNameTransform: McpToolNameTransform = ({
	serverName,
	toolName,
}): string => {
	const rawName = `${serverName}__${toolName}`;
	const sanitizedName = sanitizeMcpToolNameCandidate(rawName);
	if (sanitizedName === rawName && rawName.length <= MAX_MCP_TOOL_NAME_LENGTH) {
		return rawName;
	}

	const hash = buildMcpToolNameHash(rawName);
	const maxBaseLength =
		MAX_MCP_TOOL_NAME_LENGTH - HASH_SEPARATOR_LENGTH - HASH_LENGTH;
	const baseName = sanitizedName.slice(0, maxBaseLength) || FALLBACK_BASE_NAME;
	return `${baseName}_${hash}`;
};
