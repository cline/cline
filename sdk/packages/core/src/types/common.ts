import { SESSION_STATUS_VALUES } from "@cline/shared";

export const SESSION_STATUSES = SESSION_STATUS_VALUES;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const NON_TERMINAL_SESSION_STATUSES = [
	"idle",
	"running",
	"pending",
] as const satisfies readonly SessionStatus[];

export type NonTerminalSessionStatus =
	(typeof NON_TERMINAL_SESSION_STATUSES)[number];

export type TerminalSessionStatus = Exclude<
	SessionStatus,
	NonTerminalSessionStatus
>;

export function isTerminalSessionStatus(
	status: SessionStatus,
): status is TerminalSessionStatus {
	return !NON_TERMINAL_SESSION_STATUSES.includes(
		status as NonTerminalSessionStatus,
	);
}

export function isNonTerminalSessionStatus(
	status: SessionStatus,
): status is NonTerminalSessionStatus {
	return !isTerminalSessionStatus(status);
}

export const SessionSource = {
	CORE: "core",
	CLI: "cli",
	SUBAGENT: "subagent",
	DESKTOP: "desktop",
	KANBAN: "kanban",
	API: "api",
	WEB: "web",
	VSCODE: "vscode",
	ENTERPRISE: "enterprise",
	IDE: "ide",
	JETBRAINS: "jetbrains",
	NEOVIM: "neovim",
	SCHEDULE: "schedule",
	UNKNOWN: "unknown",
} as const;

export type BuiltinSessionSource =
	(typeof SessionSource)[keyof typeof SessionSource];

export type SessionSource = BuiltinSessionSource | (string & {});
