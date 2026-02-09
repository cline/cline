/**
 * Bead Mode Component
 *
 * Provides iterative task execution instructions to the system prompt when
 * the Ralph Wiggum loop (bead mode) is active. This teaches the agent how
 * to work in discrete iterations with completion signals and approval flows.
 */

import { SystemPromptSection } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant, SystemPromptContext } from "../types"

const BEAD_MODE_TEMPLATE = `ITERATIVE EXECUTION MODE (RALPH LOOP)

You are operating in **bead mode** — an iterative loop where your work is broken into discrete, reviewable iterations called "beads."

## Current State
- **Task**: {{BEAD_DESCRIPTION}}
- **Iteration**: {{BEAD_NUMBER}} of {{BEAD_MAX_ITERATIONS}}
{{BEAD_TEST_COMMAND_LINE}}
{{BEAD_FEEDBACK_SECTION}}

## How Bead Mode Works

1. **Work in focused iterations**: Each bead is one reviewable chunk of work. Focus on making meaningful progress toward the task goal in each iteration.

2. **Signal completion**: When you have completed a logical chunk of work for this iteration, include the text **{{BEAD_COMPLETION_SIGNAL}}** at the end of your final message. This tells the system to evaluate your work against the success criteria.

3. **Success criteria evaluation**: After you signal completion, the system will automatically:
   - Check for the completion signal in your response
   - Run tests if a test command is configured
   - Check for errors recorded during the iteration

4. **Approval flow**: If criteria pass, your work enters review. The user can:
   - **Approve**: Your changes are committed and the next bead starts (or the task completes)
   - **Reject**: You receive feedback and a new iteration begins to address it
   - **Skip**: Your changes are discarded and the next bead starts

5. **Iteration limits**: You have {{BEAD_MAX_ITERATIONS}} iterations maximum. Use them wisely — plan your approach so you can make steady progress toward the goal.

## Important Rules

- **Always signal completion**: When you believe the current iteration's work is done, you MUST include "{{BEAD_COMPLETION_SIGNAL}}" in your response. Without this signal, the iteration will not be evaluated.
- **One logical chunk per bead**: Don't try to do everything in one iteration. Focus on one coherent piece of work that can be reviewed independently.
- **Address feedback directly**: If you received rejection feedback, your primary goal for this iteration is to address that feedback.
- **Be explicit about what you did**: Summarize the changes you made at the end of each iteration so the reviewer can quickly assess your work.
- **Run tests before signaling**: If a test command is configured, run it yourself before signaling completion to increase your chances of passing criteria.`

const BEAD_FEEDBACK_TEMPLATE = `- **Previous feedback**: {{BEAD_FEEDBACK}}
  *Address this feedback as your primary goal for this iteration.*`

const BEAD_TEST_COMMAND_TEMPLATE = `- **Test command**: \`{{BEAD_TEST_COMMAND}}\` (will be run automatically after completion signal)`

export async function getBeadModeSection(variant: PromptVariant, context: SystemPromptContext): Promise<string> {
	if (!context.beadModeActive) {
		return ""
	}

	const template = variant.componentOverrides?.[SystemPromptSection.BEAD_MODE]?.template || BEAD_MODE_TEMPLATE

	// Build feedback section if present
	let feedbackSection = ""
	if (context.beadFeedback) {
		const feedbackEngine = new TemplateEngine()
		feedbackSection = feedbackEngine.resolve(BEAD_FEEDBACK_TEMPLATE, context, {
			BEAD_FEEDBACK: context.beadFeedback,
		})
	}

	// Build test command line if present
	let testCommandLine = ""
	if (context.beadTestCommand) {
		const testEngine = new TemplateEngine()
		testCommandLine = testEngine.resolve(BEAD_TEST_COMMAND_TEMPLATE, context, {
			BEAD_TEST_COMMAND: context.beadTestCommand,
		})
	}

	const templateEngine = new TemplateEngine()
	return templateEngine.resolve(template, context, {
		BEAD_DESCRIPTION: context.beadDescription || "No description provided",
		BEAD_NUMBER: String(context.beadNumber || 1),
		BEAD_MAX_ITERATIONS: String(context.beadMaxIterations || 10),
		BEAD_COMPLETION_SIGNAL: context.beadCompletionSignal || "DONE",
		BEAD_TEST_COMMAND: context.beadTestCommand || "",
		BEAD_TEST_COMMAND_LINE: testCommandLine,
		BEAD_FEEDBACK_SECTION: feedbackSection,
		BEAD_FEEDBACK: context.beadFeedback || "",
	})
}
