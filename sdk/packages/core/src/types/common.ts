import { SESSION_STATUS_VALUES } from "@clinebot/shared";

export const SESSION_STATUSES = SESSION_STATUS_VALUES;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

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
	UNKNOWN: "unknown",
} as const;

export type BuiltinSessionSource =
	(typeof SessionSource)[keyof typeof SessionSource];

export type SessionSource = BuiltinSessionSource | (string & {});
