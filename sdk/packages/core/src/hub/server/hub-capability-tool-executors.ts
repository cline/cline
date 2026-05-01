import type { HubToolExecutorName, ToolContext } from "@clinebot/shared";
import type { ToolExecutors } from "../../extensions/tools";

function serializeToolContext(context: ToolContext): Record<string, unknown> {
	return {
		agentId: context.agentId,
		conversationId: context.conversationId,
		iteration: context.iteration,
		metadata: context.metadata,
	};
}

export function createHubCapabilityToolExecutors(
	sessionId: string,
	targetClientId: string,
	executors: HubToolExecutorName[],
	requestCapability: (
		sessionId: string,
		capabilityName: string,
		payload: Record<string, unknown>,
		targetClientId: string,
	) => Promise<Record<string, unknown> | undefined>,
): Partial<ToolExecutors> {
	const available = new Set(executors);
	const invoke = async (
		executor: HubToolExecutorName,
		args: unknown[],
		context: ToolContext,
	): Promise<unknown> => {
		const response = await requestCapability(
			sessionId,
			`tool_executor.${executor}`,
			{
				executor,
				args,
				context: serializeToolContext(context),
			},
			targetClientId,
		);
		return response?.result;
	};

	return {
		...(available.has("readFile")
			? {
					readFile: async (request, context) =>
						(await invoke("readFile", [request], context)) as Awaited<
							ReturnType<NonNullable<ToolExecutors["readFile"]>>
						>,
				}
			: {}),
		...(available.has("search")
			? {
					search: async (query, cwd, context) =>
						String((await invoke("search", [query, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("bash")
			? {
					bash: async (command, cwd, context) =>
						String((await invoke("bash", [command, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("webFetch")
			? {
					webFetch: async (url, prompt, context) =>
						String((await invoke("webFetch", [url, prompt], context)) ?? ""),
				}
			: {}),
		...(available.has("editor")
			? {
					editor: async (input, cwd, context) =>
						String((await invoke("editor", [input, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("applyPatch")
			? {
					applyPatch: async (input, cwd, context) =>
						String((await invoke("applyPatch", [input, cwd], context)) ?? ""),
				}
			: {}),
		...(available.has("skills")
			? {
					skills: async (skill, args, context) =>
						String((await invoke("skills", [skill, args], context)) ?? ""),
				}
			: {}),
		...(available.has("askQuestion")
			? {
					askQuestion: async (question, options, context) =>
						String(
							(await invoke("askQuestion", [question, options], context)) ?? "",
						),
				}
			: {}),
		...(available.has("submit")
			? {
					submit: async (summary, verified, context) =>
						String(
							(await invoke("submit", [summary, verified], context)) ?? "",
						),
				}
			: {}),
	};
}
