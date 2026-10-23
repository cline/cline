import {
	type ComposerSuggestionItem,
	type ComposerSuggestionsAction,
	type ComposerSuggestionsState,
	type PluginUiStateEnvelope,
	parsePluginUiAction,
} from "@cline/shared/browser";
import { expect } from "vitest";
import type { ChatMessage } from "@/lib/chat-schema";
import { fakeDesktop } from "./fake-client";

export const SESSION_ID = "ses-b";
export const OLDER_SESSION_ID = "ses-a";
export const ENVIRONMENT_ID = "local";
const SLOT = "composer.suggestions";
const PLUGIN = "composer-suggestions";

export const ITEMS: ComposerSuggestionItem[] = [
	{
		id: "verify",
		label: "Verify",
		tone: "check",
		icon: "verify",
		prompt: "Run the tests and fix what fails",
		detail: "the last edit touched src",
		sendable: true,
	},
	{
		id: "review",
		label: "Review",
		tone: "look",
		icon: "review",
		prompt: "Review the diff",
		sendable: true,
	},
	{
		id: "commit",
		label: "Commit",
		tone: "finish",
		icon: "commit",
		prompt: "Commit the change",
		sendable: false,
	},
];

export function readyState(
	revision: string,
	overrides: Partial<ComposerSuggestionsState> = {},
): ComposerSuggestionsState {
	return {
		status: "ready",
		title: "Next",
		cue: { text: "after a command failed", tone: "repair" },
		revision,
		items: ITEMS,
		canRefresh: true,
		...overrides,
	};
}

export function envelope(
	state: ComposerSuggestionsState | null,
	{
		sessionId = SESSION_ID,
		epoch = 100,
		seq = 1,
	}: { sessionId?: string; epoch?: number; seq?: number } = {},
): PluginUiStateEnvelope<"composer.suggestions"> {
	return { sessionId, slot: SLOT, plugin: PLUGIN, epoch, seq, state };
}

export type HubScript = {
	/** `plugin_ui_get`'s reply, per session. */
	states?: Record<string, PluginUiStateEnvelope[]>;
	/** A verb's reply, or undefined for the default: `attach` gets epoch 100, everything else `ok`. */
	reply?: (
		sessionId: string,
		action: ComposerSuggestionsAction,
	) => unknown | undefined;
};

export function scriptHub(script: HubScript = {}): void {
	fakeDesktop.invoke.mockImplementation(async (command, args) => {
		const sessionId = String(args?.sessionId ?? "");
		if (command === "plugin_ui_get") return script.states?.[sessionId] ?? [];
		if (command !== "plugin_ui_invoke") return undefined;
		const action = args?.action as ComposerSuggestionsAction;
		const scripted = script.reply?.(sessionId, action);
		if (scripted !== undefined) return scripted;
		return action.verb === "attach"
			? { outcome: "ok", epoch: 100 }
			: { outcome: "ok" };
	});
}

export type InvokedAction = {
	sessionId: string;
	action: ComposerSuggestionsAction;
	order: number;
};

export function invokedActions(verb?: string): InvokedAction[] {
	const { calls, invocationCallOrder } = fakeDesktop.invoke.mock;
	return calls.flatMap(([command, args], index) => {
		if (command !== "plugin_ui_invoke") return [];
		const action = args?.action as ComposerSuggestionsAction;
		if (verb && action.verb !== verb) return [];
		return [
			{
				sessionId: String(args?.sessionId),
				action,
				order: invocationCallOrder[index] ?? 0,
			},
		];
	});
}

export function commandCalls(command: string): unknown[] {
	return fakeDesktop.invoke.mock.calls
		.filter(([name]) => name === command)
		.map(([, args]) => args);
}

/** Every action the hook sent must survive the hub's parser, or it would come back `rejected`. */
export function expectEveryActionParses(): void {
	for (const { action } of invokedActions()) {
		expect(parsePluginUiAction(SLOT, action)).toMatchObject({ ok: true });
	}
}

export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((onResolve, onReject) => {
		resolve = onResolve;
		reject = onReject;
	});
	return { promise, resolve, reject };
}

export function userMessage(
	id: string,
	content: string,
	runCount?: number,
): ChatMessage {
	return {
		id,
		sessionId: SESSION_ID,
		role: "user",
		content,
		createdAt: 1,
		...(runCount === undefined ? {} : { meta: { runCount } }),
	};
}

export const READY_R1 = { [SESSION_ID]: [envelope(readyState("r1"))] };
export const SEND_KEYS = {
	code: "Digit1",
	key: "!",
	ctrlKey: true,
	shiftKey: true,
};
