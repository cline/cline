export const SESSION_STATUS_VALUES = [
	"running",
	"completed",
	"failed",
	"cancelled",
] as const;

export type SharedSessionStatus = (typeof SESSION_STATUS_VALUES)[number];

export interface SessionLineage {
	parentSessionId?: string;
	agentId?: string;
	parentAgentId?: string;
	conversationId?: string;
	isSubagent: boolean;
}

export interface SessionRuntimeRecordShape extends SessionLineage {
	source: string;
	pid?: number;
	startedAt: string;
	endedAt?: string | null;
	exitCode?: number | null;
	status: SharedSessionStatus;
	interactive: boolean;
	provider: string;
	model: string;
	cwd: string;
	workspaceRoot: string;
	teamName?: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	prompt?: string;
	metadata?: Record<string, unknown>;
	hookPath?: string;
	messagesPath?: string;
	updatedAt: string;
}
