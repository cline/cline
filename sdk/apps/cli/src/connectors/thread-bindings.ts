import type { SerializedThread, Thread } from "chat";
import { readJsonFile, writeJsonFile } from "./common";

export type ConnectorThreadState = {
	sessionId?: string;
	enableTools?: boolean;
	autoApproveTools?: boolean;
	cwd?: string;
	workspaceRoot?: string;
	systemPrompt?: string;
	participantKey?: string;
	participantLabel?: string;
	welcomeSentAt?: string;
};

export type ConnectorThreadBinding<TState extends ConnectorThreadState> = {
	channelId: string;
	isDM: boolean;
	participantKey?: string;
	participantLabel?: string;
	serializedThread: string;
	sessionId?: string;
	state?: TState;
	updatedAt: string;
};

export type ConnectorBindingStore<TState extends ConnectorThreadState> = Record<
	string,
	ConnectorThreadBinding<TState>
>;

export type SerializableConnectorThread<TState extends ConnectorThreadState> =
	Thread<TState> & {
		toJSON(): SerializedThread;
	};

export type ConnectorBindingThreadIdentity = Pick<
	Thread<ConnectorThreadState>,
	"id" | "channelId" | "isDM"
> & {
	participantKey?: string;
};

function normalizeParticipantKey(
	value: string | undefined,
): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

export function resolveThreadBindingKey(
	thread: ConnectorBindingThreadIdentity,
	state?: ConnectorThreadState | null,
): string {
	return (
		normalizeParticipantKey(state?.participantKey ?? thread.participantKey) ??
		thread.id
	);
}

export function readBindings<TState extends ConnectorThreadState>(
	path: string,
): ConnectorBindingStore<TState> {
	const parsed = readJsonFile<ConnectorBindingStore<TState>>(path, {});
	return parsed && typeof parsed === "object" ? parsed : {};
}

export function writeBindings<TState extends ConnectorThreadState>(
	path: string,
	bindings: ConnectorBindingStore<TState>,
): void {
	writeJsonFile(path, bindings);
}

export function findBindingForThread<TState extends ConnectorThreadState>(
	bindings: ConnectorBindingStore<TState>,
	thread: ConnectorBindingThreadIdentity,
): { binding: ConnectorThreadBinding<TState>; key: string } | undefined {
	const participantKey = normalizeParticipantKey(thread.participantKey);
	if (participantKey) {
		const exactThread = bindings[thread.id];
		const exactThreadParticipantKey = normalizeParticipantKey(
			exactThread?.participantKey ?? exactThread?.state?.participantKey,
		);
		if (exactThread && exactThreadParticipantKey === participantKey) {
			return { key: thread.id, binding: exactThread };
		}
		const exactParticipant = bindings[participantKey];
		if (exactParticipant) {
			return { key: participantKey, binding: exactParticipant };
		}
		for (const [key, binding] of Object.entries(bindings)) {
			const bindingParticipantKey = normalizeParticipantKey(
				binding.participantKey ?? binding.state?.participantKey,
			);
			if (bindingParticipantKey === participantKey) {
				return { key, binding };
			}
		}
		return undefined;
	}
	const exact = bindings[thread.id];
	if (exact) {
		return { key: thread.id, binding: exact };
	}
	for (const [key, binding] of Object.entries(bindings)) {
		if (
			binding.channelId === thread.channelId &&
			binding.isDM === thread.isDM
		) {
			return { key, binding };
		}
	}
	return undefined;
}

export function readBindingForThread<TState extends ConnectorThreadState>(
	path: string,
	thread: ConnectorBindingThreadIdentity,
): ConnectorThreadBinding<TState> | undefined {
	const bindings = readBindings<TState>(path);
	const match = findBindingForThread(bindings, thread);
	if (!match) {
		return undefined;
	}
	const targetKey = resolveThreadBindingKey(thread, match.binding.state);
	if (match.key !== targetKey) {
		bindings[targetKey] = {
			...match.binding,
			participantKey:
				normalizeParticipantKey(thread.participantKey) ??
				match.binding.participantKey,
		};
		delete bindings[match.key];
		writeBindings(path, bindings);
	}
	return bindings[targetKey];
}

export function serializeThread<TState extends ConnectorThreadState>(
	thread: Thread<TState>,
	errorLabel: string,
): string {
	const candidate = thread as Partial<SerializableConnectorThread<TState>>;
	if (typeof candidate.toJSON !== "function") {
		throw new Error(`${errorLabel} thread cannot be serialized`);
	}
	return JSON.stringify(candidate.toJSON.call(thread));
}

export function persistThreadBinding<TState extends ConnectorThreadState>(
	path: string,
	thread: Thread<TState>,
	state: TState,
	errorLabel: string,
): void {
	const bindings = readBindings<TState>(path);
	const participantKey = normalizeParticipantKey(state.participantKey);
	const bindingKey = resolveThreadBindingKey(
		thread as ConnectorBindingThreadIdentity,
		state,
	);
	for (const [key, binding] of Object.entries(bindings)) {
		const bindingParticipantKey = normalizeParticipantKey(
			binding.participantKey ?? binding.state?.participantKey,
		);
		const matchesParticipant =
			participantKey && bindingParticipantKey === participantKey;
		const matchesLegacyKey = participantKey && key === thread.id;
		const matchesLegacyThread =
			!participantKey &&
			binding.channelId === thread.channelId &&
			binding.isDM === thread.isDM;
		if (
			key !== bindingKey &&
			(matchesParticipant || matchesLegacyKey || matchesLegacyThread)
		) {
			delete bindings[key];
		}
	}
	bindings[bindingKey] = {
		channelId: thread.channelId,
		isDM: thread.isDM,
		participantKey,
		participantLabel: state.participantLabel?.trim() || undefined,
		serializedThread: serializeThread(thread, errorLabel),
		sessionId: state.sessionId,
		state,
		updatedAt: new Date().toISOString(),
	};
	writeBindings(path, bindings);
}

export function mergeThreadState<TState extends ConnectorThreadState>(
	threadState: TState | null | undefined,
	bindingState: TState | undefined,
	base: ConnectorThreadState,
): TState {
	return {
		...(threadState ?? bindingState ?? {}),
		sessionId:
			threadState?.sessionId?.trim() ||
			bindingState?.sessionId?.trim() ||
			undefined,
		enableTools:
			threadState?.enableTools ?? bindingState?.enableTools ?? base.enableTools,
		autoApproveTools:
			threadState?.autoApproveTools ??
			bindingState?.autoApproveTools ??
			base.autoApproveTools,
		cwd: threadState?.cwd || bindingState?.cwd || base.cwd,
		workspaceRoot:
			threadState?.workspaceRoot ||
			bindingState?.workspaceRoot ||
			base.workspaceRoot,
		systemPrompt:
			threadState?.systemPrompt ||
			bindingState?.systemPrompt ||
			base.systemPrompt,
		participantKey:
			threadState?.participantKey ||
			bindingState?.participantKey ||
			base.participantKey,
		participantLabel:
			threadState?.participantLabel ||
			bindingState?.participantLabel ||
			base.participantLabel,
		welcomeSentAt:
			threadState?.welcomeSentAt ||
			bindingState?.welcomeSentAt ||
			base.welcomeSentAt,
	} as TState;
}

export async function loadThreadState<TState extends ConnectorThreadState>(
	thread: Thread<TState>,
	bindingsPath: string,
	base: ConnectorThreadState,
): Promise<TState> {
	const threadState = await thread.state;
	const binding = readBindingForThread<TState>(bindingsPath, {
		...(thread as ConnectorBindingThreadIdentity),
		participantKey: threadState?.participantKey,
	});
	return mergeThreadState(threadState, binding?.state, base);
}

export function findBindingForParticipantKey<
	TState extends ConnectorThreadState,
>(
	bindings: ConnectorBindingStore<TState>,
	participantKey: string | undefined,
): { binding: ConnectorThreadBinding<TState>; key: string } | undefined {
	const normalized = normalizeParticipantKey(participantKey);
	if (!normalized) {
		return undefined;
	}
	const exact = bindings[normalized];
	if (exact) {
		return { key: normalized, binding: exact };
	}
	for (const [key, binding] of Object.entries(bindings)) {
		const bindingParticipantKey = normalizeParticipantKey(
			binding.participantKey ?? binding.state?.participantKey,
		);
		if (bindingParticipantKey === normalized) {
			return { key, binding };
		}
	}
	return undefined;
}

export async function persistMergedThreadState<
	TState extends ConnectorThreadState,
>(
	thread: Thread<TState>,
	bindingsPath: string,
	nextState: TState,
	errorLabel: string,
): Promise<void> {
	await thread.setState(nextState, { replace: true });
	persistThreadBinding(bindingsPath, thread, nextState, errorLabel);
}

export function clearBindingSessionIds<TState extends ConnectorThreadState>(
	path: string,
): void {
	const bindings = readBindings<TState>(path);
	let updated = false;
	for (const binding of Object.values(bindings)) {
		if (binding.sessionId || binding.state?.sessionId) {
			binding.sessionId = undefined;
			if (binding.state) {
				binding.state.sessionId = undefined;
			}
			updated = true;
		}
	}
	if (updated) {
		writeBindings(path, bindings);
	}
}
