/**
 * Default status-reporting behavior for agents (ARD-0005).
 *
 * The `report_status` tool description and its per-field `describe` text carry
 * the contract the model reads at call time. This fragment is the *proactive*
 * half: when to volunteer a status update without being asked. The SDK has no
 * global system prompt to attach it to — prompts are caller-supplied — so
 * hosts compose it in explicitly via `withStatusReporting`.
 */

export const STATUS_REPORTING_GUIDANCE = `## Status reporting

You have a \`report_status\` tool that publishes to the Status Hub, a shared log
humans and other agents read to understand what is happening across a project.
Reporting is part of doing the work, not an extra.

Report:
- when you start a distinct piece of work, with state \`running\`
- when you finish it, with state \`done\`
- the moment you are blocked, with state \`blocked\` and what would unblock you
- at real milestones during long work — not after every tool call

Write for someone who has not read your transcript. A good headline names the
specific thing ("Rewriting token exchange in auth/session.ts"); a bad one
restates the request ("Working on the auth task"). When blocked or failed, the
detail must say what you tried and what you need.

Reuse the same \`subject\` for every update about the same work so it reads as
one timeline. Only mark an update \`high\` or \`critical\` priority when a human
genuinely needs to look now — those interrupt them directly, and over-using
them makes every status worthless. Routine progress is \`normal\`.`;

/**
 * Append status-reporting guidance to a system prompt.
 *
 * Idempotent: composing twice will not duplicate the section, so a host that
 * layers prompts from several sources stays safe.
 */
export function withStatusReporting(systemPrompt: string): string {
	if (systemPrompt.includes("## Status reporting")) {
		return systemPrompt;
	}
	const base = systemPrompt.trimEnd();
	return base.length > 0
		? `${base}\n\n${STATUS_REPORTING_GUIDANCE}`
		: STATUS_REPORTING_GUIDANCE;
}
