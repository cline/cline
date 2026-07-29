// LanguageModelV3 middleware that reshapes the prompt into the "R1" chat
// format required by DeepSeek-R1-style endpoints (and self-hosted R1-distill
// chat templates served via vLLM / llama.cpp / SGLang). Those backends reject
// a `role:"system"` message and reject back-to-back same-role messages,
// returning a hard 400. This middleware:
//
//   1. Demotes the leading `role:"system"` message to a `role:"user"` message
//      (its text becomes the first user turn).
//   2. Merges consecutive same-role user/assistant messages into one, so the
//      outgoing conversation strictly alternates user/assistant.
//
// It operates on the typed `LanguageModelV3Prompt` produced by the AI SDK
// (after `streamText` folds the `system` option into a system message and
// before the `@ai-sdk/openai-compatible` chat-messages converter serializes
// the wire body). It is a direct port of classic Cline's `convertToR1Format`
// (`src/core/api/transform/r1-format.ts` on origin/legacy-extension), which
// prepended the system prompt as a user message and merged consecutive
// same-role turns.
//
// Scope: endpoints that need R1 format are simple chat/completions endpoints
// that do not do native tool calling, so this transform intentionally only
// merges `user` and `assistant` text/file content. `tool`-role messages and
// assistant messages carrying tool calls are passed through unchanged (they
// break strict alternation, but only occur on native-tool paths that never
// need R1 format). Applied only when the resolved model's `apiFormat` is
// `"r1"`; see `createOpenAICompatibleProviderModule`.

import type {
	LanguageModelV3CallOptions,
	LanguageModelV3FilePart,
	LanguageModelV3Message,
	LanguageModelV3Middleware,
	LanguageModelV3TextPart,
} from "@ai-sdk/provider";

type UserContentPart = LanguageModelV3TextPart | LanguageModelV3FilePart;

/**
 * Collapse adjacent text parts into a single newline-joined text part, leaving
 * non-text parts (images/files) untouched and in order. Matches classic
 * Cline's newline joining of merged R1 text so the wire body carries one text
 * block per turn rather than many fragments.
 */
function coalesceAdjacentText(parts: readonly UserContentPart[]): UserContentPart[] {
	const out: UserContentPart[] = [];
	for (const part of parts) {
		const prev = out[out.length - 1];
		if (part.type === "text" && prev?.type === "text") {
			out[out.length - 1] = { ...prev, text: `${prev.text}\n${part.text}` };
		} else {
			out.push(part);
		}
	}
	return out;
}

/**
 * Reshape a prompt into R1 format: system demoted to user, consecutive
 * same-role user/assistant turns merged. Returns the (possibly new) prompt and
 * a `mutated` flag for test/observation use. Never mutates the input messages.
 */
export function convertPromptToR1(prompt: readonly LanguageModelV3Message[]): {
	prompt: LanguageModelV3Message[];
	mutated: boolean;
} {
	const merged: LanguageModelV3Message[] = [];
	let mutated = false;

	for (const original of prompt) {
		// Demote system -> user. Everything else keeps its role.
		const message: LanguageModelV3Message =
			original.role === "system"
				? { role: "user", content: [{ type: "text", text: original.content }] }
				: original;
		if (original.role === "system") {
			mutated = true;
		}

		const last = merged[merged.length - 1];
		const mergeable = message.role === "user" || message.role === "assistant";
		if (last && last.role === message.role && mergeable) {
			// Same role as the previous merged turn: concatenate content. Only
			// user/assistant reach here; their content arrays are compatible
			// enough to concatenate and re-coalesce adjacent text.
			const combined = [
				...(last.content as UserContentPart[]),
				...(message.content as UserContentPart[]),
			];
			last.content = coalesceAdjacentText(combined) as typeof last.content;
			mutated = true;
			continue;
		}

		// New turn: push a shallow clone with a fresh content array so we never
		// mutate the caller's message objects when a later turn merges into it.
		merged.push({ ...message, content: [...message.content] } as LanguageModelV3Message);
	}

	return { prompt: merged, mutated };
}

/**
 * Apply via
 * `wrapLanguageModel({ model, middleware: r1FormatMiddleware })`
 * for OpenAI-compatible models whose resolved `apiFormat` is `"r1"`.
 */
export const r1FormatMiddleware: LanguageModelV3Middleware = {
	specificationVersion: "v3",
	transformParams: async ({ params }) => {
		const { prompt: newPrompt, mutated } = convertPromptToR1(params.prompt);
		if (!mutated) {
			return params;
		}
		return {
			...params,
			prompt: newPrompt,
		} satisfies LanguageModelV3CallOptions;
	},
};
