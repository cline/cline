/**
 * /btw Plugin Example
 *
 * Adds a `/btw` command: a side question about the chat, answered by the
 * chat's own model, that never becomes part of the chat. The agent does not
 * see the question or the answer on its next turn, no tool runs, and the
 * transcript is unchanged.
 *
 * The answer comes from an aside. The host sends the chat's last model
 * request again with the question appended, so the model reads the whole
 * conversation through the provider's prompt cache instead of paying for it
 * a second time.
 *
 * CLI usage:
 *   cline plugin install https://github.com/cline/cline/blob/main/sdk/examples/plugins/btw.ts --cwd .
 *   cline -i "Fix the failing test"
 *   /btw which file did you change first, and why?
 */

import type { AgentPlugin } from "@cline/core";
import type { AsideResult, AsideSkipReason } from "@cline/shared";

const ANSWER_MAX_OUTPUT_TOKENS = 800;
// A command call is stopped by the host after 60 seconds.
const ANSWER_TIMEOUT_MS = 45_000;

function asSideQuestion(question: string): string {
	return [
		"Side question from the user about this conversation.",
		"Answer it from what is already here, in a few plain sentences.",
		"Do not call tools and do not continue the task.",
		"",
		question,
	].join("\n");
}

const NOT_ASKED: Record<AsideSkipReason, string> = {
	no_recorded_request:
		"There is nothing to ask about yet. Send a message first.",
	no_prompt_cache:
		"This chat's model has no prompt cache, so a side question would cost as much as the whole chat again.",
	budget: "/btw has used this chat's side questions for the hour.",
	disabled:
		'Side questions are turned off ("asidesEnabled": false in the global settings).',
	stale_run: "The chat moved on before the question was asked. Ask again.",
	unsupported:
		"There is no chat to ask about here. Send a message first; if that does not help, this app does not answer side questions.",
};

function replyFor(result: AsideResult): string {
	switch (result.status) {
		case "ok":
			return (
				result.text.trim() ||
				"The model asked for a tool instead of answering. A side question is answered only from what is already in the chat."
			);
		case "skipped":
			return NOT_ASKED[result.reason];
		case "superseded":
			return "The chat moved on before the answer arrived. Ask again.";
		case "timeout":
			return "The answer took too long. Ask again, or ask something narrower.";
		case "error":
			return `The side question failed: ${result.error ?? "the model call did not finish"}`;
	}
}

const plugin: AgentPlugin = {
	name: "btw",
	manifest: {
		capabilities: ["commands", "asides"],
		rootOnly: true,
	},

	setup(api, ctx) {
		api.registerCommand({
			name: "btw",
			description: "Ask a side question about this chat without adding to it",
			async handler(input) {
				const question = input.trim();
				if (!question) return "Usage: /btw <a question about this chat>";
				if (!ctx.asides) return NOT_ASKED.unsupported;
				return replyFor(
					await ctx.asides.ask({
						prompt: asSideQuestion(question),
						maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
						timeoutMs: ANSWER_TIMEOUT_MS,
					}),
				);
			},
		});
	},
};

export default plugin;
