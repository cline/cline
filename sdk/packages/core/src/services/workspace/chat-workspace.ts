import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	AGENTS_RULES_FILE_NAME,
	resolveChatWorkspacePath,
} from "@cline/shared/storage";
import type {
	RuntimeSessionConfig,
	StartSessionConfig,
} from "../../runtime/host/runtime-host";

const CHAT_WORKSPACE_RULES = `# Cline chat workspace

This directory is Cline's shared workspace for chat sessions that were
started without a project. It is not a project of its own, and other chat
sessions use it too. Treat the conversation as a chat first: do not create
or edit files here unless the user asks for something that requires them.

If the user asks you to build something or write code:

1. Ask where they would like the project to live.
2. If they have no preference, create a new folder with a short, descriptive
   name inside this directory and do all work inside that folder. Tell the
   user where it is so they can open it as a workspace later.

Projects from earlier chat sessions may already exist as folders here; the
user may refer back to them. Never assume loose files in this directory
belong to the current conversation, and keep new work inside a named folder
rather than at the top level.
`;

/**
 * Ensure the shared chat workspace exists and is seeded with the rules file
 * that tells the agent how to behave in a project-less session. The rules
 * file is only written when missing so users can edit it.
 */
export async function ensureChatWorkspace(): Promise<string> {
	const workspacePath = resolveChatWorkspacePath();
	await mkdir(workspacePath, { recursive: true, mode: 0o700 });
	const rulesPath = join(workspacePath, AGENTS_RULES_FILE_NAME);
	try {
		await writeFile(rulesPath, CHAT_WORKSPACE_RULES, { flag: "wx" });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
	}
	return workspacePath;
}

/** Resolve the optional workspace fields at the execution-host boundary. */
export async function resolveStartSessionWorkspace(
	config: StartSessionConfig,
): Promise<RuntimeSessionConfig> {
	const requestedCwd = config.cwd?.trim() ?? "";
	const requestedRoot = config.workspaceRoot?.trim() ?? "";
	const workspacePath =
		requestedCwd || requestedRoot || (await ensureChatWorkspace());

	return {
		...config,
		cwd: requestedCwd || workspacePath,
		workspaceRoot: requestedRoot || workspacePath,
	};
}
