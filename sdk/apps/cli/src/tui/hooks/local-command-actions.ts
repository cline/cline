import type { LocalSlashCommandInvocation } from "../utils/skill-command-input";

export interface LocalSlashCommandActionInput {
	name: string;
	openAccount: () => void;
	openConfig: () => void;
	openMcpManager: () => Promise<boolean>;
	openModelSelector: () => void;
	openSkills: (invocation?: LocalSlashCommandInvocation) => void;
	invocation?: LocalSlashCommandInvocation;
	runCompact: () => void;
	runFork: () => void;
	runUndo: () => Promise<void>;
	clearConversation: () => Promise<void>;
	openHelp: () => void;
	openHistory: () => void;
	exitCline: () => void;
}

export function runLocalSlashCommandAction(
	input: LocalSlashCommandActionInput,
): boolean | Promise<boolean> {
	const normalized = input.name;
	if (normalized === "config" || normalized === "settings") {
		input.openConfig();
		return true;
	}
	if (normalized === "skills") {
		input.openSkills(input.invocation);
		return true;
	}
	if (normalized === "mcp") {
		return input.openMcpManager().then(() => true);
	}
	if (normalized === "account") {
		input.openAccount();
		return true;
	}
	if (normalized === "model") {
		input.openModelSelector();
		return true;
	}
	if (normalized === "compact") {
		input.runCompact();
		return true;
	}
	if (normalized === "fork") {
		input.runFork();
		return true;
	}
	if (normalized === "undo") {
		return input.runUndo().then(() => true);
	}
	if (normalized === "clear") {
		return input.clearConversation().then(() => true);
	}
	if (normalized === "help") {
		input.openHelp();
		return true;
	}
	if (normalized === "history") {
		input.openHistory();
		return true;
	}
	if (normalized === "quit") {
		setTimeout(input.exitCline, 0);
		return true;
	}
	return false;
}
