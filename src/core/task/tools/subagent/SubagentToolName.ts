const SUBAGENT_TOOL_NAME_PREFIX = "use_subagent_"
const SUBAGENT_TOOL_NAME_MAX_LENGTH = 64

function sanitizeAgentName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/_+/g, "_")
		.replace(/^_+|_+$/g, "")
}

function hashString(value: string): string {
	let hash = 2166136261
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i)
		hash = Math.imul(hash, 16777619)
	}
	return (hash >>> 0).toString(36)
}

function trimToolNameToMax(value: string): string {
	if (value.length <= SUBAGENT_TOOL_NAME_MAX_LENGTH) {
		return value
	}
	return value.slice(0, SUBAGENT_TOOL_NAME_MAX_LENGTH)
}

export function buildSubagentToolName(agentName: string): string {
	const sanitized = sanitizeAgentName(agentName) || "agent"
	const hashSuffix = hashString(agentName).slice(0, 6)
	const base = `${SUBAGENT_TOOL_NAME_PREFIX}${sanitized}`

	if (base.length <= SUBAGENT_TOOL_NAME_MAX_LENGTH) {
		return base
	}

	const maxBodyLength = SUBAGENT_TOOL_NAME_MAX_LENGTH - SUBAGENT_TOOL_NAME_PREFIX.length - hashSuffix.length - 1
	const body = sanitized.slice(0, Math.max(1, maxBodyLength))
	return trimToolNameToMax(`${SUBAGENT_TOOL_NAME_PREFIX}${body}_${hashSuffix}`)
}

export function isSubagentToolName(toolName: string): boolean {
	return toolName.startsWith(SUBAGENT_TOOL_NAME_PREFIX)
}
