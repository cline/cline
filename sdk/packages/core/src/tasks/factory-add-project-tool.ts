import { basename } from "node:path";
import { type AgentTool, createTool, zodToJsonSchema } from "@cline/shared";
import { z } from "zod";
import {
	awaitFactoryManagerConfirmation,
	FACTORY_GUIDANCE_CONFIRM_TTL_MS,
	FactoryProjectError,
	factoryManagerProjects,
	factoryProjectRoot,
} from "./factory-tool";

// ---------------------------------------------------------------------------
// Factory manager: asking the person to add a project

export const FACTORY_ADD_PROJECT_TOOL_NAME = "factory_add_project";

const FactoryAddProjectToolInputSchema = z.object({
	path: z
		.string()
		.min(1)
		.max(4096)
		.describe(
			"The full (absolute) path of the project folder the user gave, inside a git repository",
		),
});

/** What the person is asked before a project is added. */
export interface FactoryAddProjectConfirmationRequest {
	sessionId: string;
	agentId: string;
	conversationId?: string;
	iteration: number;
	toolCallId: string;
	/** The repository's folder name. */
	name: string;
	workspaceRoot: string;
	signal?: AbortSignal;
}

export interface CreateFactoryAddProjectToolOptions {
	/** Defined only for the user's Factory manager chat; the tool refuses every other session. */
	resolveManagerSession: (sessionId: string) => Promise<unknown | undefined>;
	/** Candidate projects; one Factory already knows is not asked about again. */
	listProjects: () => Promise<readonly (string | undefined)[]>;
	/** Stores the project; called only after the person confirmed it. */
	addProject: (workspaceRoot: string) => Promise<unknown>;
	/** Asks the person in their app. Without it nothing is added. */
	confirm?: (
		request: FactoryAddProjectConfirmationRequest,
	) => Promise<{ approved: boolean; reason?: string }>;
}

function failure(code: string, message: string) {
	return { ok: false as const, error: { code, message } };
}

/**
 * Lets the Factory manager ask the person to add a folder as a project. The
 * manager can read fetched web text, so it can never add one on its own:
 * the folder is added only when the person confirms in the app.
 */
export function createFactoryAddProjectTool(
	options: CreateFactoryAddProjectToolOptions,
): AgentTool {
	return createTool({
		name: FACTORY_ADD_PROJECT_TOOL_NAME,
		description:
			"Asks the user to add a folder as a Factory project. Use it only when the user gave the full path of a project Factory does not know. The folder must be inside a git repository; its repository is added, and only if the user confirms in the app. Then file the work with that project.",
		inputSchema: zodToJsonSchema(FactoryAddProjectToolInputSchema),
		// Waits for the person's answer.
		timeoutMs: FACTORY_GUIDANCE_CONFIRM_TTL_MS + 60_000,
		retryable: false,
		maxRetries: 0,
		execute: async (rawInput, context) => {
			const parsed = FactoryAddProjectToolInputSchema.safeParse(rawInput);
			if (!parsed.success)
				return failure(
					"invalid_factory_add_project_input",
					"Pass path: the full path of the project folder.",
				);
			const sessionId = context.sessionId;
			const session = sessionId
				? await options.resolveManagerSession(sessionId).catch(() => undefined)
				: undefined;
			if (!sessionId || !session)
				return failure(
					"factory_add_project_unavailable",
					"Projects can only be added from the Factory manager chat (Factory → Ask Factory) or in Factory settings → Projects.",
				);
			let workspaceRoot: string;
			try {
				workspaceRoot = factoryProjectRoot(parsed.data.path);
			} catch (error) {
				if (error instanceof FactoryProjectError)
					return failure(error.code, error.message);
				throw error;
			}
			const name = basename(workspaceRoot);
			if (
				factoryManagerProjects(await options.listProjects()).includes(
					workspaceRoot,
				)
			)
				return {
					ok: true as const,
					project: name,
					workspaceRoot,
					already: true,
					next: `Factory already knows ${name}. File the work with project "${workspaceRoot}".`,
				};
			if (!options.confirm)
				return failure(
					"factory_add_project_confirmation_unavailable",
					'Factory cannot ask the user to confirm here, so nothing was added. Tell them: "Add it in Factory settings → Projects."',
				);
			const answer = await awaitFactoryManagerConfirmation(options.confirm, {
				sessionId,
				agentId: context.agentId,
				conversationId: context.conversationId,
				iteration: context.iteration,
				toolCallId: context.toolCallId ?? `factory_add_project_${Date.now()}`,
				name,
				workspaceRoot,
				signal: context.signal,
			});
			if (!answer.approved)
				return failure(
					"factory_add_project_not_confirmed",
					`The user did not add ${name}, so nothing was added and no work was filed.${answer.reason ? ` (${answer.reason})` : ""}`,
				);
			await options.addProject(workspaceRoot);
			return {
				ok: true as const,
				project: name,
				workspaceRoot,
				next: `Factory now knows ${name}. File the work with project "${workspaceRoot}".`,
			};
		},
	}) as AgentTool;
}
