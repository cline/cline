/**
 * Plan-Mode Reminder Extension
 *
 * Runtime extension that re-anchors the plan-mode contract on every model
 * request. The system prompt states the contract once, but models drift over
 * long turns — they read a few files and then start editing (see #13107).
 * A reminder adjacent to the newest user message is a much stronger signal
 * than a section buried at the top of the context window.
 *
 * Implemented as a message builder (not a persisted transcript change): on
 * each request the latest real user message — the newest user turn, skipping
 * tool-result messages — gets a <system_reminder> block appended to the copy
 * sent to the provider. Nothing is written to the conversation store, so the
 * transcript stays clean, the UI never renders the reminder, and switching to
 * act mode (which rebuilds the runtime without this extension) leaves no
 * stale plan-mode text behind in history.
 *
 * The runtime builder registers this extension for plan-mode sessions
 * alongside the command guard (command-guard-extension.ts): the reminder is
 * the prompt-level nudge, the guard is the hard backstop.
 */

import type { AgentExtension, ContentBlock, Message } from "@cline/shared";

export const PLAN_MODE_REMINDER_EXTENSION_NAME = "core.plan-mode-reminder";

/**
 * Appended to the newest user turn on every plan-mode model request.
 * Wrapped in <system_reminder> so the model reads it as runtime guidance
 * rather than user-typed text.
 */
export const PLAN_MODE_REMINDER_TEXT =
	"<system_reminder>Reminder: you are still in PLAN MODE. Do not edit files, write code, or run any command that changes the project or system state -- tools are for read-only exploration here, and file modifications are blocked. Analyze, then present a plan; if the task needs changes, describe them in the plan so they can happen after the user approves switching to act mode.</system_reminder>";

/**
 * A "real" user turn: a user-role message carrying typed input (string or
 * text/image blocks), as opposed to the user-role messages that carry tool
 * results back to the model.
 */
function isUserTurnMessage(message: Message): boolean {
	if (message.role !== "user") {
		return false;
	}
	if (typeof message.content === "string") {
		return message.content.trim().length > 0;
	}
	return (
		message.content.length > 0 &&
		!message.content.some((block) => block.type === "tool_result")
	);
}

function hasReminder(message: Message): boolean {
	if (typeof message.content === "string") {
		return message.content.includes(PLAN_MODE_REMINDER_TEXT);
	}
	return message.content.some(
		(block) =>
			block.type === "text" && block.text.includes(PLAN_MODE_REMINDER_TEXT),
	);
}

function withReminder(message: Message): Message {
	if (typeof message.content === "string") {
		return {
			...message,
			content: `${message.content}\n\n${PLAN_MODE_REMINDER_TEXT}`,
		};
	}
	const reminderBlock: ContentBlock = {
		type: "text",
		text: PLAN_MODE_REMINDER_TEXT,
	};
	return { ...message, content: [...message.content, reminderBlock] };
}

/**
 * Return a copy of `messages` with the plan-mode reminder appended to the
 * newest user turn. The input array and its messages are never mutated —
 * this runs on the provider-request copy, not the persisted transcript.
 */
export function appendPlanModeReminder(messages: Message[]): Message[] {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (!isUserTurnMessage(message)) {
			continue;
		}
		if (hasReminder(message)) {
			return messages;
		}
		const next = [...messages];
		next[index] = withReminder(message);
		return next;
	}
	return messages;
}

export function createPlanModeReminderExtension(): AgentExtension {
	return {
		name: PLAN_MODE_REMINDER_EXTENSION_NAME,
		manifest: {
			capabilities: ["messageBuilders"],
		},
		setup: (api) => {
			api.registerMessageBuilder({
				name: PLAN_MODE_REMINDER_EXTENSION_NAME,
				build: (messages) => appendPlanModeReminder(messages),
			});
		},
	};
}
