import type { SerializedThread, Thread } from "chat";
import { readJsonFile, writeJsonFile } from "./common";

export type ConnectorBindingScope = "thread" | "participant";

export type ConnectorThreadState = {
	sessionId?: string;
	enableTools?: boolean;
	autoApproveTools?: boolean;
	cwd?: string;
	workspaceRoot?: string;
	systemPrompt?: string;
	bindingScope?: ConnectorBindingScope;
	participantKey?: string;
	participantLabel?: string;
	welcomeSentAt?: string;
};

export type ConnectorThreadBinding<TState extends ConnectorThreadState> = {
	kind?: "participant" | "thread" | "thread-participant-mute";
	channelId: string;
	isDM: boolean;
	participantKey?: string;
	participantLabel?: string;
	threadMutedAt?: string;
	mutedParticipantKey?: string;
	mutedParticipantLabel?: string;
	participantMutedAt?: string;
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
	bindingScope?: ConnectorBindingScope;
};

export type ConnectorMuteTarget = {
	participantKey: string;
	participantLabel?: string;
};

function normalizeParticipantKey(
	value: string | undefined,
): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
}

function normalizeBindingScope(
	value: ConnectorBindingScope | undefined,
): ConnectorBindingScope | undefined {
	return value === "thread" || value === "participant" ? value : undefined;
}

function readSerializedThreadIdentity(
	serializedThread: string | undefined,
): Partial<ConnectorBindingThreadIdentity> | undefined {
	if (!serializedThread?.trim()) {
		return undefined;
	}
	try {
		const parsed = JSON.parse(
			serializedThread,
		) as Partial<ConnectorBindingThreadIdentity>;
		return parsed && typeof parsed === "object" ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function resolveThreadControlKey(
	thread: ConnectorBindingThreadIdentity,
): string {
	return `thread:${thread.id}`;
}

function resolveParticipantMuteControlKey(
	thread: ConnectorBindingThreadIdentity,
	participantKey: string | undefined,
): string | undefined {
	const normalized = normalizeParticipantKey(participantKey);
	return normalized
		? `thread:${thread.id}:participant:${normalized}`
		: undefined;
}

function isControlBinding(
	binding: ConnectorThreadBinding<ConnectorThreadState> | undefined,
): boolean {
	return (
		binding?.kind === "thread" || binding?.kind === "thread-participant-mute"
	);
}

function clearSerializedThreadSessionId(serializedThread: string | undefined): {
	serializedThread: string | undefined;
	updated: boolean;
} {
	if (!serializedThread?.trim()) {
		return { serializedThread, updated: false };
	}
	try {
		const parsed = JSON.parse(serializedThread) as unknown;
		if (!parsed || typeof parsed !== "object") {
			return { serializedThread, updated: false };
		}
		const record = parsed as Record<string, unknown>;
		let updated = false;
		if ("sessionId" in record) {
			delete record.sessionId;
			updated = true;
		}
		if (record.state && typeof record.state === "object") {
			const state = record.state as Record<string, unknown>;
			if ("sessionId" in state) {
				delete state.sessionId;
				updated = true;
			}
		}
		return {
			serializedThread: updated ? JSON.stringify(parsed) : serializedThread,
			updated,
		};
	} catch {
		return { serializedThread, updated: false };
	}
}

export function resolveThreadBindingKey(
	thread: ConnectorBindingThreadIdentity,
	state?: ConnectorThreadState | null,
): string {
	if (
		normalizeBindingScope(state?.bindingScope ?? thread.bindingScope) ===
		"thread"
	) {
		return thread.id;
	}
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
	if (normalizeBindingScope(thread.bindingScope) === "thread") {
		const exact = bindings[thread.id];
		return exact && !isControlBinding(exact)
			? { key: thread.id, binding: exact }
			: undefined;
	}
	if (participantKey) {
		const exactThread = bindings[thread.id];
		const exactThreadParticipantKey = normalizeParticipantKey(
			exactThread?.participantKey ?? exactThread?.state?.participantKey,
		);
		if (
			exactThread &&
			!isControlBinding(exactThread) &&
			exactThreadParticipantKey === participantKey
		) {
			return { key: thread.id, binding: exactThread };
		}
		const exactParticipant = bindings[participantKey];
		if (exactParticipant && !isControlBinding(exactParticipant)) {
			return { key: participantKey, binding: exactParticipant };
		}
		for (const [key, binding] of Object.entries(bindings)) {
			if (isControlBinding(binding)) {
				continue;
			}
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
	if (exact && !isControlBinding(exact)) {
		return { key: thread.id, binding: exact };
	}
	for (const [key, binding] of Object.entries(bindings)) {
		if (isControlBinding(binding)) {
			continue;
		}
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
	thread: Thread<TState>,
	errorLabel: string,
	participantKey?: string,
	bindingScope?: ConnectorBindingScope,
): ConnectorThreadBinding<TState> | undefined {
	const bindings = readBindings<TState>(path);
	const threadIdentity: ConnectorBindingThreadIdentity = {
		id: thread.id,
		channelId: thread.channelId,
		isDM: thread.isDM,
		participantKey,
		bindingScope,
	};
	const match = findBindingForThread(bindings, threadIdentity);
	if (!match) {
		return undefined;
	}
	const targetKey = resolveThreadBindingKey(threadIdentity, {
		...(match.binding.state ?? {}),
		...(bindingScope ? { bindingScope } : {}),
	});
	const normalizedParticipantKey = normalizeParticipantKey(participantKey);
	const normalizedBindingScope = normalizeBindingScope(bindingScope);
	const storedThread = readSerializedThreadIdentity(
		match.binding.serializedThread,
	);
	const storedParticipantKey = normalizeParticipantKey(
		match.binding.participantKey ?? match.binding.state?.participantKey,
	);
	const storedBindingScope = normalizeBindingScope(
		match.binding.state?.bindingScope,
	);
	const needsRefresh =
		match.key !== targetKey ||
		storedThread?.id !== thread.id ||
		storedThread?.channelId !== thread.channelId ||
		storedThread?.isDM !== thread.isDM ||
		storedParticipantKey !== normalizedParticipantKey ||
		(normalizedBindingScope !== undefined &&
			storedBindingScope !== normalizedBindingScope);
	if (needsRefresh) {
		bindings[targetKey] = {
			...match.binding,
			channelId: thread.channelId,
			isDM: thread.isDM,
			participantKey: normalizedParticipantKey ?? match.binding.participantKey,
			state: {
				...(match.binding.state ?? ({} as TState)),
				...(bindingScope ? { bindingScope } : {}),
			},
			serializedThread: serializeThread(thread, errorLabel),
			updatedAt: new Date().toISOString(),
		};
		if (match.key !== targetKey) {
			delete bindings[match.key];
		}
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
	const bindingScope = normalizeBindingScope(state.bindingScope);
	const bindingKey = resolveThreadBindingKey(
		thread as ConnectorBindingThreadIdentity,
		state,
	);
	for (const [key, binding] of Object.entries(bindings)) {
		if (isControlBinding(binding)) {
			continue;
		}
		const bindingParticipantKey = normalizeParticipantKey(
			binding.participantKey ?? binding.state?.participantKey,
		);
		const storedThread = readSerializedThreadIdentity(binding.serializedThread);
		if (bindingScope === "thread") {
			if (key !== bindingKey && storedThread?.id === thread.id) {
				delete bindings[key];
			}
			continue;
		}
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
		kind: "participant",
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

export function isThreadMuted<TState extends ConnectorThreadState>(
	path: string,
	thread: ConnectorBindingThreadIdentity,
): boolean {
	const bindings = readBindings<TState>(path);
	return isThreadMutedInBindings(bindings, thread);
}

export function isThreadMutedInBindings<TState extends ConnectorThreadState>(
	bindings: ConnectorBindingStore<TState>,
	thread: ConnectorBindingThreadIdentity,
): boolean {
	const binding = bindings[resolveThreadControlKey(thread)];
	return Boolean(binding?.threadMutedAt);
}

export function isParticipantMuted<TState extends ConnectorThreadState>(
	path: string,
	thread: ConnectorBindingThreadIdentity,
	participantKey: string | undefined,
): boolean {
	const key = resolveParticipantMuteControlKey(thread, participantKey);
	if (!key) {
		return false;
	}
	const bindings = readBindings<TState>(path);
	return isParticipantMutedInBindings(bindings, thread, participantKey);
}

export function isParticipantMutedInBindings<
	TState extends ConnectorThreadState,
>(
	bindings: ConnectorBindingStore<TState>,
	thread: ConnectorBindingThreadIdentity,
	participantKey: string | undefined,
): boolean {
	const key = resolveParticipantMuteControlKey(thread, participantKey);
	if (!key) {
		return false;
	}
	const binding = bindings[key];
	return Boolean(binding?.participantMutedAt);
}

export function findMutedParticipantsForThread<
	TState extends ConnectorThreadState,
>(
	bindings: ConnectorBindingStore<TState>,
	thread: ConnectorBindingThreadIdentity,
): ConnectorMuteTarget[] {
	const prefix = `thread:${thread.id}:participant:`;
	return Object.entries(bindings)
		.filter(
			([key, binding]) =>
				key.startsWith(prefix) &&
				binding.kind === "thread-participant-mute" &&
				Boolean(binding.participantMutedAt) &&
				Boolean(normalizeParticipantKey(binding.mutedParticipantKey)),
		)
		.map(([, binding]) => ({
			participantKey:
				normalizeParticipantKey(binding.mutedParticipantKey) ?? "",
			participantLabel: binding.mutedParticipantLabel,
		}))
		.filter((target) => target.participantKey.length > 0);
}

export function setThreadMuted<TState extends ConnectorThreadState>(
	path: string,
	thread: Thread<TState>,
	muted: boolean,
	errorLabel: string,
): string | undefined {
	const bindings = readBindings<TState>(path);
	const key = resolveThreadControlKey(thread as ConnectorBindingThreadIdentity);
	if (!muted) {
		if (bindings[key]) {
			delete bindings[key];
			writeBindings(path, bindings);
		}
		return undefined;
	}
	const mutedAt = new Date().toISOString();
	bindings[key] = {
		kind: "thread",
		channelId: thread.channelId,
		isDM: thread.isDM,
		threadMutedAt: mutedAt,
		serializedThread: serializeThread(thread, errorLabel),
		updatedAt: mutedAt,
	};
	writeBindings(path, bindings);
	return mutedAt;
}

export function setParticipantMuted<TState extends ConnectorThreadState>(
	path: string,
	thread: Thread<TState>,
	target: ConnectorMuteTarget,
	muted: boolean,
	errorLabel: string,
): string | undefined {
	const normalized = normalizeParticipantKey(target.participantKey);
	const key = resolveParticipantMuteControlKey(
		thread as ConnectorBindingThreadIdentity,
		normalized,
	);
	if (!normalized || !key) {
		return undefined;
	}
	const bindings = readBindings<TState>(path);
	if (!muted) {
		if (bindings[key]) {
			delete bindings[key];
			writeBindings(path, bindings);
		}
		return undefined;
	}
	const mutedAt = new Date().toISOString();
	bindings[key] = {
		kind: "thread-participant-mute",
		channelId: thread.channelId,
		isDM: thread.isDM,
		mutedParticipantKey: normalized,
		mutedParticipantLabel: target.participantLabel?.trim() || undefined,
		participantMutedAt: mutedAt,
		serializedThread: serializeThread(thread, errorLabel),
		updatedAt: mutedAt,
	};
	writeBindings(path, bindings);
	return mutedAt;
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
		bindingScope:
			threadState?.bindingScope ||
			bindingState?.bindingScope ||
			base.bindingScope,
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
	bindingScope?: ConnectorBindingScope,
): Promise<TState> {
	const threadState = await thread.state;
	const resolvedBindingScope = threadState?.bindingScope ?? bindingScope;
	const binding = readBindingForThread<TState>(
		bindingsPath,
		thread,
		"Connector",
		threadState?.participantKey,
		resolvedBindingScope,
	);
	return mergeThreadState(
		resolvedBindingScope
			? ({
					...(threadState ?? {}),
					bindingScope: resolvedBindingScope,
				} as TState)
			: threadState,
		binding?.state,
		base,
	);
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
		if ("sessionId" in binding) {
			delete binding.sessionId;
			updated = true;
		}
		if (binding.state && "sessionId" in binding.state) {
			delete binding.state.sessionId;
			updated = true;
		}
		const serialized = clearSerializedThreadSessionId(binding.serializedThread);
		if (serialized.updated) {
			binding.serializedThread = serialized.serializedThread ?? "";
			updated = true;
		}
	}
	if (updated) {
		writeBindings(path, bindings);
	}
}
