import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import type { ChatStartSessionRequest } from "@cline/core";
import {
	createUserInstructionConfigService,
	HubSessionClient,
} from "@cline/core";
import type { ConnectSlackOptions, SlackConnectorState } from "@cline/shared";
import {
	type Adapter,
	Chat,
	ConsoleLogger,
	type Message,
	type Thread,
	ThreadImpl,
} from "chat";
import type { Command } from "commander";
import type { CliLoggerAdapter } from "../../logging/adapter";
import { createCliLoggerAdapter } from "../../logging/adapter";
import {
	ensureCliHubServer,
	parseHubEndpointOverride,
	resolveDefaultCliRpcAddress,
} from "../../utils/hub-runtime";
import { createWorkspaceChatCommandHost } from "../../utils/plugin-chat-commands";
import { ConnectorBase } from "../base";
import {
	createChatSdkLogger,
	enqueueThreadTurn,
	startConnectorWebhookServer,
} from "../chat-runtime";
import { isProcessRunning } from "../common";
import {
	type ActiveConnectorTurn,
	handleConnectorUserTurn,
	maybeHandleConnectorApprovalReply,
} from "../connector-host";
import { dispatchConnectorHook } from "../hooks";
import {
	type PendingConnectorApproval,
	truncateConnectorText,
} from "../runtime-turn";
import {
	buildConnectorStartRequest,
	readSessionReplyText,
	stopConnectorSessions,
} from "../session-runtime";
import { FileStateAdapter } from "../stores/file-state";
import { startConnectorTaskUpdateRelay } from "../task-updates";
import {
	type ConnectorBindingScope,
	type ConnectorBindingStore,
	type ConnectorThreadBinding,
	type ConnectorThreadState,
	clearBindingSessionIds,
	findBindingForParticipantKey,
	findBindingForThread,
	loadThreadState,
	persistMergedThreadState,
	readBindings,
	writeBindings,
} from "../thread-bindings";
import type {
	ConnectCommandDefinition,
	ConnectIo,
	ConnectStopResult,
} from "../types";
import {
	getConnectorFirstContactMessage,
	getConnectorSystemPrompt,
	getConnectorSystemRules,
} from "./prompts";

const SLACK_SYSTEM_RULES = getConnectorSystemRules(
	"Slack",
	[
		"You can respond to user messages in threads and DMs, and you can use tools according to user's requests and your capabilities.",
		"When asked to mention a Slack user or bot by name, write the mention as @display-name or @username. The connector resolves unique Slack names to Slack mention IDs before sending. Do not ask the user for a Slack ID unless the name cannot be resolved.",
	].join("\n"),
);

const SLACK_FIRST_CONTACT_MESSAGE = getConnectorFirstContactMessage();

type SlackThreadState = ConnectorThreadState & {
	teamId?: string;
};
type SlackUserProfile = {
	display_name?: string;
	display_name_normalized?: string;
	real_name?: string;
	real_name_normalized?: string;
};
type SlackUser = {
	id?: string;
	name?: string;
	real_name?: string;
	deleted?: boolean;
	profile?: SlackUserProfile;
};
type SlackUsersListResponse = {
	ok?: boolean;
	error?: string;
	members?: SlackUser[];
	response_metadata?: {
		next_cursor?: string;
	};
};
type SlackUsersInfoResponse = {
	ok?: boolean;
	error?: string;
	user?: SlackUser;
};

const SLACK_API_CACHE_TTL_MS = 10 * 60 * 1000;

type SlackCacheEntry<T> = {
	value: T;
	expiresAt: number;
};

const slackUserLabelCache = new Map<string, SlackCacheEntry<string>>();
const pendingSlackUserLabelFetches = new Map<
	string,
	Promise<string | undefined>
>();
const slackUsersCache = new Map<string, SlackCacheEntry<SlackUser[]>>();
const pendingSlackUsersFetches = new Map<string, Promise<SlackUser[]>>();

type SlackConnectionMode = ConnectSlackOptions["connectionMode"];

function inferSlackConnectionMode(
	baseUrl: string | undefined,
): SlackConnectionMode {
	return baseUrl?.trim() ? "webhook" : "socket";
}

function truncateText(value: string, maxLength = 160): string {
	return truncateConnectorText(value, maxLength);
}

function sanitizeKey(value: string): string {
	return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function stopSessionsForUser(
	state: SlackConnectorState,
): Promise<number> {
	return stopConnectorSessions({
		rpcAddress: state.rpcAddress,
		rpcMatcher: (metadata) =>
			metadata?.transport === "slack" && metadata?.userName === state.userName,
		localMatcher: (metadata) =>
			metadata?.transport === "slack" && metadata?.userName === state.userName,
	});
}

async function buildSlackStartRequest(
	options: ConnectSlackOptions,
	io: ConnectIo,
	loggerConfig: Parameters<
		typeof buildConnectorStartRequest
	>[0]["loggerConfig"],
): Promise<ChatStartSessionRequest> {
	return buildConnectorStartRequest({
		options,
		io,
		loggerConfig,
		systemRules: SLACK_SYSTEM_RULES,
	});
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: undefined;
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
	return Array.isArray(value) ? asRecord(value[0]) : undefined;
}

function readString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSlackLookupName(value: string | undefined): string {
	return (value ?? "")
		.trim()
		.replace(/^@+/, "")
		.replace(/\s+/g, " ")
		.toLowerCase();
}

function slackTeamCacheKey(teamId: string | undefined): string {
	return teamId?.trim() || "default";
}

function slackUserLabelCacheKey(teamId: string, userId: string): string {
	return `${slackTeamCacheKey(teamId)}:${userId.trim()}`;
}

function readSlackCache<T>(
	cache: Map<string, SlackCacheEntry<T>>,
	key: string,
	now = Date.now(),
): T | undefined {
	const entry = cache.get(key);
	if (!entry) {
		return undefined;
	}
	if (entry.expiresAt <= now) {
		cache.delete(key);
		return undefined;
	}
	return entry.value;
}

function writeSlackCache<T>(
	cache: Map<string, SlackCacheEntry<T>>,
	key: string,
	value: T,
	now = Date.now(),
): void {
	cache.set(key, { value, expiresAt: now + SLACK_API_CACHE_TTL_MS });
}

function clearSlackApiCaches(): void {
	slackUserLabelCache.clear();
	pendingSlackUserLabelFetches.clear();
	slackUsersCache.clear();
	pendingSlackUsersFetches.clear();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSlackMessageEventChannelType<T>(event: T): T {
	const record = asRecord(event);
	const channel = readString(record?.channel);
	if (!channel?.startsWith("D") || record?.channel_type === "im") {
		return event;
	}
	return {
		...record,
		channel_type: "im",
	} as T;
}

function readRawSlackMessageText(rawMessage: unknown): string | undefined {
	const raw = asRecord(rawMessage);
	return (
		readString(raw?.text) ||
		readString(asRecord(raw?.event)?.text) ||
		readString(asRecord(raw?.message)?.text)
	);
}

function stripLeadingSlackMention(text: string, botUserId?: string): string {
	const trimmed = text.trim();
	const botId = botUserId?.trim();
	if (!botId) {
		return trimmed;
	}
	return trimmed
		.replace(new RegExp(`^<@${escapeRegExp(botId)}(?:\\|[^>]+)?>\\s*`, "i"), "")
		.trim();
}

function resolveSlackTurnText(input: {
	text: string;
	raw: unknown;
	botUserId?: string;
}): string {
	const rawText = readRawSlackMessageText(input.raw);
	if (rawText) {
		const strippedRaw = stripLeadingSlackMention(rawText, input.botUserId);
		if (strippedRaw !== rawText.trim()) {
			return strippedRaw;
		}
	}
	return stripLeadingSlackMention(input.text, input.botUserId);
}

function buildSlackParticipantKey(teamId: string, userId: string): string {
	return `slack:team:${teamId}:user:${userId}`;
}

function resolveSlackParticipantUserId(
	participantKey: string | undefined,
): string | undefined {
	return participantKey?.match(/^slack:team:[^:]+:user:([^:]+)$/)?.[1];
}

function resolveSlackParticipant(
	rawMessage: unknown,
	teamId?: string,
): { key: string; label?: string } | undefined {
	const raw = asRecord(rawMessage);
	const event = asRecord(raw?.event);
	const message = asRecord(raw?.message);
	const user =
		readString(raw?.user) ||
		readString(event?.user) ||
		readString(message?.user) ||
		readString(firstRecord(raw?.authorizations)?.user_id);
	const username =
		readString(raw?.username) ||
		readString(event?.username) ||
		readString(message?.username);
	const label = username || user;
	if (!user || !teamId?.trim()) {
		return undefined;
	}
	return {
		key: buildSlackParticipantKey(teamId.trim(), user),
		label,
	};
}

function slackUserDisplayLabel(
	user: SlackUser | undefined,
): string | undefined {
	if (!user) {
		return undefined;
	}
	const profile = user.profile ?? {};
	return (
		profile.display_name_normalized?.trim() ||
		profile.display_name?.trim() ||
		profile.real_name_normalized?.trim() ||
		profile.real_name?.trim() ||
		user.real_name?.trim() ||
		user.name?.trim() ||
		user.id?.trim()
	);
}

async function fetchSlackUserLabel(input: {
	slack: Pick<SlackAdapter, "webClient">;
	userId: string;
}): Promise<string | undefined> {
	const result = (await input.slack.webClient.users.info({
		user: input.userId,
	})) as SlackUsersInfoResponse;
	if (result.ok === false) {
		throw new Error(result.error ?? "Slack users.info returned ok=false");
	}
	return slackUserDisplayLabel(result.user);
}

async function fetchCachedSlackUserLabel(input: {
	slack: Pick<SlackAdapter, "webClient" | "getInstallation" | "withBotToken">;
	teamId: string;
	userId: string;
}): Promise<string | undefined> {
	const key = slackUserLabelCacheKey(input.teamId, input.userId);
	const cached = readSlackCache(slackUserLabelCache, key);
	if (cached) {
		return cached;
	}
	const pending = pendingSlackUserLabelFetches.get(key);
	if (pending) {
		return pending;
	}
	const fetch = withSlackTeamBotToken({
		slack: input.slack,
		teamId: input.teamId,
		work: () =>
			fetchSlackUserLabel({
				slack: input.slack,
				userId: input.userId,
			}),
	}).then((label) => {
		if (label) {
			writeSlackCache(slackUserLabelCache, key, label);
		}
		return label;
	});
	pendingSlackUserLabelFetches.set(key, fetch);
	try {
		return await fetch;
	} finally {
		pendingSlackUserLabelFetches.delete(key);
	}
}

async function resolveSlackParticipantLabel(input: {
	slack: Pick<SlackAdapter, "webClient" | "getInstallation" | "withBotToken">;
	teamId: string;
	participant: { key: string; label?: string } | undefined;
	currentState: SlackThreadState;
	logger?: CliLoggerAdapter;
}): Promise<{ key: string; label?: string } | undefined> {
	if (!input.participant) {
		return undefined;
	}
	const userId = resolveSlackParticipantUserId(input.participant.key);
	if (!userId) {
		return input.participant;
	}
	const currentLabel =
		input.currentState.participantKey === input.participant.key
			? input.currentState.participantLabel?.trim()
			: undefined;
	const rawLabel = input.participant.label?.trim();
	const rawLabelMatchesCurrent =
		rawLabel &&
		currentLabel &&
		normalizeSlackLookupName(rawLabel) ===
			normalizeSlackLookupName(currentLabel);
	if (
		currentLabel &&
		(!rawLabel || rawLabel === userId || rawLabelMatchesCurrent)
	) {
		return { ...input.participant, label: currentLabel };
	}
	try {
		const profileLabel = await fetchCachedSlackUserLabel({
			slack: input.slack,
			teamId: input.teamId,
			userId,
		});
		if (profileLabel) {
			return { ...input.participant, label: profileLabel };
		}
	} catch (error) {
		input.logger?.core.log("Slack participant label lookup skipped", {
			severity: "warn",
			transport: "slack",
			error: error instanceof Error ? error.message : String(error),
		});
	}
	return input.participant;
}

function extractSlackTeamId(raw: unknown): string | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	const value =
		typeof record.team_id === "string"
			? record.team_id
			: typeof record.team === "string"
				? record.team
				: undefined;
	return value?.trim() || undefined;
}

function resolveSlackBindingScope(
	thread: Pick<Thread<SlackThreadState>, "isDM">,
): ConnectorBindingScope {
	return thread.isDM ? "participant" : "thread";
}

function formatSlackRuntimeText(input: {
	text: string;
	thread: Thread<SlackThreadState>;
	state: SlackThreadState;
	addressedToBot: boolean;
}): string {
	const authorId = resolveSlackParticipantUserId(input.state.participantKey);
	return [
		"<slack_message_context>",
		...(input.state.teamId ? [`teamId: ${input.state.teamId}`] : []),
		`threadId: ${input.thread.id}`,
		`channelId: ${input.thread.channelId}`,
		`isDM: ${input.thread.isDM ? "true" : "false"}`,
		...(authorId
			? [`authorId: ${authorId}`, `authorMention: <@${authorId}>`]
			: []),
		...(input.state.participantLabel
			? [`authorLabel: ${input.state.participantLabel}`]
			: []),
		...(input.state.participantKey
			? [`participantKey: ${input.state.participantKey}`]
			: []),
		`isDirectMention: ${input.addressedToBot ? "true" : "false"}`,
		"</slack_message_context>",
		"",
		input.text,
	].join("\n");
}

function slackUserNames(user: SlackUser): string[] {
	const profile = user.profile ?? {};
	const names = [
		user.name,
		user.real_name,
		profile.display_name,
		profile.display_name_normalized,
		profile.real_name,
		profile.real_name_normalized,
	];
	return [
		...new Set(
			names
				.map((name) => name?.trim())
				.filter((name): name is string => Boolean(name)),
		),
	];
}

function buildSlackMentionNameIndex(
	users: SlackUser[],
): Map<string, { ids: Set<string>; names: Set<string> }> {
	const index = new Map<string, { ids: Set<string>; names: Set<string> }>();
	for (const user of users) {
		const id = user.id?.trim();
		if (!id || user.deleted) {
			continue;
		}
		for (const name of slackUserNames(user)) {
			const normalizedName = normalizeSlackLookupName(name);
			if (!normalizedName || /^[UW][A-Z0-9]+$/i.test(normalizedName)) {
				continue;
			}
			const entry = index.get(normalizedName) ?? {
				ids: new Set<string>(),
				names: new Set<string>(),
			};
			entry.ids.add(id);
			entry.names.add(name);
			index.set(normalizedName, entry);
		}
	}
	return index;
}

function pickSlackMentionForName(input: {
	index: Map<string, { ids: Set<string>; names: Set<string> }>;
	name: string;
	preferredUserIds?: string[];
}): string | undefined {
	const entry = input.index.get(normalizeSlackLookupName(input.name));
	if (!entry) {
		return undefined;
	}
	const ids = [...entry.ids];
	if (ids.length === 1) {
		return `<@${ids[0]}>`;
	}
	const preferredIds = new Set(input.preferredUserIds ?? []);
	const preferred = ids.filter((id) => preferredIds.has(id));
	return preferred.length === 1 ? `<@${preferred[0]}>` : undefined;
}

function hasPotentialSlackOutboundMention(text: string): boolean {
	return /(^|[\s([{])@[A-Za-z0-9_.-]/.test(text);
}

function resolveSlackOutboundMentionText(input: {
	text: string;
	users: SlackUser[];
	preferredUserIds?: string[];
}): string {
	if (!hasPotentialSlackOutboundMention(input.text)) {
		return input.text;
	}
	const index = buildSlackMentionNameIndex(input.users);
	const candidates = [...index.entries()]
		.map(([normalizedName, entry]) => ({
			normalizedName,
			names: [...entry.names].sort((a, b) => b.length - a.length),
		}))
		.sort((a, b) => b.normalizedName.length - a.normalizedName.length);
	let resolved = input.text;
	for (const candidate of candidates) {
		const mention = pickSlackMentionForName({
			index,
			name: candidate.normalizedName,
			preferredUserIds: input.preferredUserIds,
		});
		if (!mention) {
			continue;
		}
		const pattern = new RegExp(
			`(^|[\\s([{])@(?:${candidate.names.map(escapeRegExp).join("|")})(?=$|[\\s,.;:!?}\\])])`,
			"gi",
		);
		resolved = resolved.replace(pattern, (_full, prefix: string) => {
			return `${prefix}${mention}`;
		});
	}
	return resolved;
}

async function fetchSlackUsers(input: {
	slack: Pick<SlackAdapter, "webClient">;
}): Promise<SlackUser[]> {
	const users: SlackUser[] = [];
	let cursor: string | undefined;
	do {
		const result = (await input.slack.webClient.users.list({
			limit: 200,
			...(cursor ? { cursor } : {}),
		})) as SlackUsersListResponse;
		if (result.ok === false) {
			throw new Error(result.error ?? "Slack users.list returned ok=false");
		}
		users.push(...(Array.isArray(result.members) ? result.members : []));
		cursor = result.response_metadata?.next_cursor?.trim() || undefined;
	} while (cursor);
	return users;
}

async function fetchCachedSlackUsers(input: {
	slack: Pick<SlackAdapter, "webClient">;
	teamId?: string;
}): Promise<SlackUser[]> {
	const key = slackTeamCacheKey(input.teamId);
	const cached = readSlackCache(slackUsersCache, key);
	if (cached) {
		return cached;
	}
	const pending = pendingSlackUsersFetches.get(key);
	if (pending) {
		return pending;
	}
	const fetch = fetchSlackUsers({ slack: input.slack }).then((users) => {
		writeSlackCache(slackUsersCache, key, users);
		return users;
	});
	pendingSlackUsersFetches.set(key, fetch);
	try {
		return await fetch;
	} finally {
		pendingSlackUsersFetches.delete(key);
	}
}

async function resolveSlackOutboundMentions(input: {
	slack: Pick<SlackAdapter, "webClient">;
	text: string;
	teamId?: string;
	preferredUserIds?: string[];
	logger?: CliLoggerAdapter;
}): Promise<string> {
	if (!hasPotentialSlackOutboundMention(input.text)) {
		return input.text;
	}
	let users: SlackUser[];
	try {
		users = await fetchCachedSlackUsers({
			slack: input.slack,
			teamId: input.teamId,
		});
	} catch (error) {
		input.logger?.core.log("Slack mention resolution skipped", {
			severity: "warn",
			transport: "slack",
			error: error instanceof Error ? error.message : String(error),
		});
		return input.text;
	}
	return resolveSlackOutboundMentionText({
		text: input.text,
		users,
		preferredUserIds: input.preferredUserIds,
	});
}

async function postSlackResolvedText(input: {
	slack: Pick<SlackAdapter, "webClient">;
	thread: Thread<SlackThreadState>;
	text: string;
	teamId?: string;
	preferredUserIds?: string[];
	logger?: CliLoggerAdapter;
}): Promise<void> {
	const resolvedText = await resolveSlackOutboundMentions({
		slack: input.slack,
		text: input.text,
		teamId: input.teamId,
		preferredUserIds: input.preferredUserIds,
		logger: input.logger,
	});
	await input.thread.post(resolvedText);
}

function extractSlackMessageRecord(
	raw: unknown,
): Record<string, unknown> | undefined {
	const record = asRecord(raw);
	return asRecord(record?.event) ?? asRecord(record?.message) ?? record;
}

function extractSlackChannelFromId(id: string): string | undefined {
	const parts = id.split(":");
	return parts[0] === "slack" ? readString(parts[1]) : undefined;
}

function resolveSlackChannelMentionThread(
	thread: Thread<SlackThreadState>,
	message: Message,
): Thread<SlackThreadState> {
	if (thread.isDM) {
		return thread;
	}
	const event = extractSlackMessageRecord(message.raw);
	const threadTs = readString(event?.thread_ts) ?? readString(event?.ts);
	if (!threadTs) {
		return thread;
	}
	const channel =
		readString(event?.channel) ??
		extractSlackChannelFromId(thread.id) ??
		extractSlackChannelFromId(thread.channelId);
	if (!channel) {
		return thread;
	}
	const threadId = `slack:${channel}:${threadTs}`;
	const channelId = `slack:${channel}`;
	if (thread.id === threadId && thread.channelId === channelId) {
		return thread;
	}
	return new ThreadImpl<SlackThreadState>({
		adapterName: "slack",
		channelId,
		channelVisibility: thread.channelVisibility,
		currentMessage: message,
		fallbackStreamingPlaceholderText: null,
		id: threadId,
		initialMessage: message,
		isDM: false,
		isSubscribedContext: false,
		streamingUpdateIntervalMs: 500,
	});
}

async function withSlackBindingBotToken<T>(input: {
	slack: Pick<SlackAdapter, "getInstallation" | "withBotToken">;
	binding: ConnectorThreadBinding<SlackThreadState>;
	work: () => Promise<T>;
}): Promise<T> {
	return withSlackTeamBotToken({
		slack: input.slack,
		teamId: input.binding.state?.teamId,
		work: input.work,
	});
}

async function withSlackTeamBotToken<T>(input: {
	slack: Pick<SlackAdapter, "getInstallation" | "withBotToken">;
	teamId?: string;
	work: () => Promise<T>;
}): Promise<T> {
	const teamId = input.teamId?.trim();
	if (!teamId) {
		return input.work();
	}
	const installation = await input.slack.getInstallation(teamId);
	if (!installation?.botToken) {
		return input.work();
	}
	return input.slack.withBotToken(installation.botToken, input.work);
}

function patchSlackMessageEventHandling(slack: SlackAdapter): void {
	const adapter = slack as unknown as {
		handleMessageEvent?: (event: unknown, options?: unknown) => unknown;
	};
	if (typeof adapter.handleMessageEvent !== "function") {
		return;
	}
	const original = adapter.handleMessageEvent.bind(slack);
	adapter.handleMessageEvent = (event, options) =>
		original(normalizeSlackMessageEventChannelType(event), options);
}

function isSlackInvalidThreadTsError(error: unknown): boolean {
	const message =
		error instanceof Error
			? error.message
			: typeof error === "string"
				? error
				: "";
	return /\binvalid_thread_ts\b/i.test(message);
}

function clearSlackBinding(
	bindingsPath: string,
	bindingKey: string | undefined,
): boolean {
	const key = bindingKey?.trim();
	if (!key) {
		return false;
	}
	const bindings = readBindings<SlackThreadState>(bindingsPath);
	if (!bindings[key]) {
		return false;
	}
	delete bindings[key];
	writeBindings(bindingsPath, bindings);
	return true;
}

async function persistSlackThreadContext(input: {
	slack: SlackAdapter;
	thread: Thread<SlackThreadState>;
	bindingsPath: string;
	baseStartRequest: ChatStartSessionRequest;
	rawMessage: unknown;
	errorLabel: string;
	logger?: CliLoggerAdapter;
}): Promise<void> {
	const teamId = extractSlackTeamId(input.rawMessage);
	let participant = resolveSlackParticipant(input.rawMessage, teamId);
	if (!teamId) {
		return;
	}
	const bindingScope = resolveSlackBindingScope(input.thread);
	const currentState = await loadThreadState(
		input.thread,
		input.bindingsPath,
		input.baseStartRequest,
		bindingScope,
	);
	participant = await resolveSlackParticipantLabel({
		slack: input.slack,
		teamId,
		participant,
		currentState,
		logger: input.logger,
	});
	if (
		currentState.teamId === teamId &&
		currentState.bindingScope === bindingScope &&
		currentState.participantKey === participant?.key &&
		currentState.participantLabel === participant?.label
	) {
		return;
	}
	await persistMergedThreadState(
		input.thread,
		input.bindingsPath,
		{
			...currentState,
			teamId: teamId ?? currentState.teamId,
			bindingScope,
			participantKey: participant?.key ?? currentState.participantKey,
			participantLabel: participant?.label ?? currentState.participantLabel,
		},
		input.errorLabel,
	);
}

async function deliverScheduledResult(input: {
	bot: Chat;
	slack: SlackAdapter;
	client: HubSessionClient;
	logger: CliLoggerAdapter;
	bindingsPath: string;
	userName: string;
	scheduleId: string;
	executionId: string;
	sessionId?: string;
	status: string;
	errorMessage?: string;
	hookCommand?: string;
}): Promise<void> {
	const schedule = await input.client.getSchedule(input.scheduleId);
	const delivery = schedule?.metadata?.delivery as
		| Record<string, unknown>
		| undefined;
	if (!delivery || delivery.adapter !== "slack") {
		return;
	}
	const targetUser =
		typeof delivery.userName === "string" ? delivery.userName.trim() : "";
	if (targetUser && targetUser !== input.userName) {
		return;
	}
	const threadId =
		typeof delivery.threadId === "string" ? delivery.threadId.trim() : "";
	const bindingKey =
		typeof delivery.bindingKey === "string"
			? delivery.bindingKey.trim()
			: typeof delivery.participantKey === "string"
				? delivery.participantKey.trim()
				: "";
	if (!threadId && !bindingKey) {
		return;
	}
	const bindings = readBindings<SlackThreadState>(input.bindingsPath);
	const match = bindingKey
		? findBindingForParticipantKey(bindings, bindingKey)
		: threadId
			? { key: threadId, binding: bindings[threadId] }
			: undefined;
	const binding = match?.binding;
	const deliveryThreadId = match?.key || threadId || bindingKey;
	if (!binding?.serializedThread) {
		return;
	}
	const thread = JSON.parse(
		binding.serializedThread,
		input.bot.reviver(),
	) as Thread<SlackThreadState>;
	let body = "";
	if (input.status === "success" && input.sessionId) {
		const text = await readSessionReplyText(input.client, input.sessionId);
		body = text?.trim()
			? text
			: `Schedule "${schedule?.name ?? input.scheduleId}" completed, but no assistant reply text was found.`;
	} else {
		body = `Schedule "${schedule?.name ?? input.scheduleId}" ${input.status}.${input.errorMessage ? `\n\n${input.errorMessage}` : ""}`;
	}
	try {
		await withSlackBindingBotToken({
			slack: input.slack,
			binding,
			work: () => thread.post(body).then(() => undefined),
		});
	} catch (error) {
		if (
			isSlackInvalidThreadTsError(error) &&
			clearSlackBinding(input.bindingsPath, deliveryThreadId)
		) {
			input.logger.core.log(
				"Cleared stale Slack binding after invalid_thread_ts",
				{
					severity: "warn",
					transport: "slack",
					threadId: deliveryThreadId,
					scheduleId: input.scheduleId,
					executionId: input.executionId,
				},
			);
		}
		throw error;
	}
}

class SlackConnector extends ConnectorBase<
	ConnectSlackOptions,
	SlackConnectorState
> {
	constructor() {
		super(
			"slack",
			"Slack webhook/socket bridge backed by RPC runtime sessions",
		);
	}

	protected override createCommand(): Command {
		return super
			.createCommand()
			.usage("--base-url <PUBLIC_BASE_URL> [options]")
			.option("--user-name <name>", "Slack bot username label")
			.option(
				"--bot-token <token>",
				"Slack bot token for single-workspace mode",
			)
			.option("--token <token>", "Alias for --bot-token")
			.option("--signing-secret <secret>", "Slack signing secret")
			.option("--app-token <token>", "Slack app-level token for socket mode")
			.option("--client-id <id>", "Slack OAuth client id")
			.option("--client-secret <secret>", "Slack OAuth client secret")
			.option(
				"--encryption-key <key>",
				"Base64 32-byte key for encrypted installations",
			)
			.option(
				"--installation-key-prefix <prefix>",
				"Override stored installation key prefix",
			)
			.option("--provider <id>", "Provider override")
			.option("--model <id>", "Model override")
			.option("--api-key <key>", "Provider API key override")
			.option("--system <prompt>", "System prompt override")
			.option("--cwd <path>", "Workspace / cwd for runtime")
			.option("--mode <act|plan>", "Agent mode", "act")
			.option("-i, --interactive", "Keep connector in foreground")
			.option("--enable-tools", "Enable tools for Slack sessions")
			.option(
				"--hook-command <command>",
				"Run a shell command for connector events",
			)
			.option(
				"--rpc-address <host:port>",
				"RPC address",
				process.env.CLINE_RPC_ADDRESS?.trim() || resolveDefaultCliRpcAddress(),
			)
			.option("--host <host>", "Webhook listen host")
			.option("--port <port>", "Webhook listen port")
			.option(
				"--base-url <url>",
				"Public base URL for webhooks and OAuth callback",
			)
			.addHelpText(
				"after",
				[
					"",
					"Environment:",
					"  SLACK_BOT_TOKEN             Single-workspace bot token",
					"  SLACK_SIGNING_SECRET        Slack signing secret",
					"  SLACK_APP_TOKEN             App-level token for socket mode",
					"  SLACK_CLIENT_ID             OAuth client id",
					"  SLACK_CLIENT_SECRET         OAuth client secret",
					"  SLACK_ENCRYPTION_KEY        Optional installation encryption key",
				].join("\n"),
			);
	}

	protected override readOptions(command: Command): ConnectSlackOptions {
		const opts = command.opts<{
			userName?: string;
			botToken?: string;
			token?: string;
			signingSecret?: string;
			appToken?: string;
			clientId?: string;
			clientSecret?: string;
			encryptionKey?: string;
			installationKeyPrefix?: string;
			cwd?: string;
			model?: string;
			provider?: string;
			apiKey?: string;
			system?: string;
			mode?: string;
			interactive?: boolean;
			enableTools?: boolean;
			rpcAddress?: string;
			hookCommand?: string;
			port?: string;
			host?: string;
			baseUrl?: string;
		}>();
		const parsedPort =
			this.parseOptionalInteger(opts.port, "port") ??
			Number.parseInt(process.env.PORT ?? "8787", 10);
		const port = Number.isFinite(parsedPort) ? parsedPort : 8787;
		const baseUrl = opts.baseUrl?.trim() || process.env.BASE_URL?.trim();
		const connectionMode = inferSlackConnectionMode(baseUrl);
		const isSocketMode = connectionMode === "socket";
		if (isSocketMode && (opts.clientId?.trim() || opts.clientSecret?.trim())) {
			throw new Error(
				"Slack socket mode does not support --client-id or --client-secret",
			);
		}
		const botToken =
			opts.botToken?.trim() ||
			opts.token?.trim() ||
			process.env.SLACK_BOT_TOKEN?.trim();
		const appToken = isSocketMode
			? opts.appToken?.trim() || process.env.SLACK_APP_TOKEN?.trim()
			: undefined;
		if (isSocketMode && !appToken) {
			throw new Error(
				"Slack socket mode requires --app-token or SLACK_APP_TOKEN",
			);
		}
		if (isSocketMode && !botToken) {
			throw new Error(
				"Slack socket mode requires --bot-token or SLACK_BOT_TOKEN",
			);
		}
		return {
			userName:
				opts.userName?.trim() ||
				process.env.SLACK_BOT_USERNAME?.trim() ||
				"cline-slack",
			connectionMode,
			botToken,
			signingSecret:
				connectionMode === "webhook"
					? opts.signingSecret?.trim() ||
						process.env.SLACK_SIGNING_SECRET?.trim()
					: opts.signingSecret?.trim(),
			appToken,
			clientId:
				connectionMode === "webhook"
					? opts.clientId?.trim() || process.env.SLACK_CLIENT_ID?.trim()
					: undefined,
			clientSecret:
				connectionMode === "webhook"
					? opts.clientSecret?.trim() || process.env.SLACK_CLIENT_SECRET?.trim()
					: undefined,
			encryptionKey:
				opts.encryptionKey?.trim() || process.env.SLACK_ENCRYPTION_KEY?.trim(),
			installationKeyPrefix:
				opts.installationKeyPrefix?.trim() ||
				process.env.SLACK_INSTALLATION_KEY_PREFIX?.trim(),
			cwd: opts.cwd || process.cwd(),
			model: opts.model,
			provider: opts.provider,
			apiKey: opts.apiKey,
			systemPrompt: opts.system,
			mode: this.parseMode(opts.mode),
			interactive: Boolean(opts.interactive),
			enableTools: Boolean(opts.enableTools),
			rpcAddress:
				opts.rpcAddress?.trim() ||
				process.env.CLINE_RPC_ADDRESS?.trim() ||
				resolveDefaultCliRpcAddress(),
			hookCommand:
				opts.hookCommand?.trim() ||
				process.env.CLINE_CONNECT_HOOK_COMMAND?.trim(),
			port,
			host: opts.host?.trim() || process.env.HOST?.trim() || "0.0.0.0",
			baseUrl,
		};
	}

	private resolveConnectorStatePath(userName: string): string {
		return this.resolveConnectorPath(`${sanitizeKey(userName)}.json`);
	}

	private resolveBindingsPath(userName: string): string {
		return this.resolveConnectorPath(`${sanitizeKey(userName)}.threads.json`);
	}

	private resolveStateStorePath(userName: string): string {
		return this.resolveConnectorPath(`${sanitizeKey(userName)}.state.json`);
	}

	private listConnectorStatePaths(): string[] {
		return this.listJsonStatePaths([".threads.json", ".state.json"]);
	}

	private readConnectorState(
		statePath: string,
	): SlackConnectorState | undefined {
		return this.readStateFile(
			statePath,
			(value): value is SlackConnectorState =>
				Boolean(
					value &&
						typeof value === "object" &&
						typeof (value as SlackConnectorState).pid === "number" &&
						typeof (value as SlackConnectorState).userName === "string",
				),
		);
	}

	private writeConnectorState(
		statePath: string,
		state: SlackConnectorState,
	): void {
		this.writeStateFile(statePath, state);
	}

	private async stopSlackConnectorInstance(
		statePath: string,
		io: ConnectIo,
	): Promise<ConnectStopResult> {
		return this.stopManagedProcess({
			io,
			statePath,
			readState: (path) => this.readConnectorState(path),
			describeStoppedProcess: (state) =>
				`[slack] stopped pid=${state.pid} user=${state.userName}`,
			getPid: (state) => state.pid,
			stopSessions: stopSessionsForUser,
			clearBindings: (state) => {
				clearBindingSessionIds<SlackThreadState>(
					this.resolveBindingsPath(state.userName),
				);
			},
		});
	}

	override async stopAll(io: ConnectIo): Promise<ConnectStopResult> {
		return this.stopAllFromStatePaths(
			io,
			this.listConnectorStatePaths(),
			(statePath, stopIo) => this.stopSlackConnectorInstance(statePath, stopIo),
		);
	}

	protected override async runWithOptions(
		options: ConnectSlackOptions,
		rawArgs: string[],
		io: ConnectIo,
	): Promise<number> {
		const statePath = this.resolveConnectorStatePath(options.userName);
		const bindingsPath = this.resolveBindingsPath(options.userName);
		const stateStorePath = this.resolveStateStorePath(options.userName);
		const staleState = this.removeStaleState(
			statePath,
			(path) => this.readConnectorState(path),
			(state) => state.pid,
		);
		if (staleState) {
			clearBindingSessionIds<SlackThreadState>(bindingsPath);
		}
		if (
			await this.maybeRunInBackground({
				rawArgs,
				io,
				interactive: options.interactive,
				childEnvVar: "CLINE_SLACK_CONNECT_CHILD",
				statePath,
				readState: (path) => this.readConnectorState(path),
				isRunning: (state) => isProcessRunning(state.pid),
				formatAlreadyRunningMessage: (state) =>
					state.connectionMode === "socket"
						? `[slack] connector already running pid=${state.pid} rpc=${state.rpcAddress} mode=socket`
						: `[slack] connector already running pid=${state.pid} rpc=${state.rpcAddress} url=${state.baseUrl}`,
				formatBackgroundStartMessage: (pid) =>
					`[slack] starting background connector pid=${pid} user=${options.userName} mode=${options.connectionMode}`,
				foregroundHint:
					"[slack] use `cline connect slack -i ...` to run in the foreground",
				launchFailureMessage: "failed to launch Slack connector in background",
			})
		) {
			return 0;
		}

		const loggerAdapter = createCliLoggerAdapter({
			runtime: "cli",
			component: "slack-connect",
		});
		const logger = createChatSdkLogger(loggerAdapter);
		const consoleLogger = new ConsoleLogger("info", "slack-connect");
		const slackConfig: Record<string, unknown> = {
			logger: consoleLogger,
			mode: options.connectionMode,
			userName: options.userName,
		};
		if (options.botToken?.trim()) {
			slackConfig.botToken = options.botToken.trim();
		}
		if (options.signingSecret?.trim()) {
			slackConfig.signingSecret = options.signingSecret.trim();
		}
		if (options.appToken?.trim()) {
			slackConfig.appToken = options.appToken.trim();
		}
		if (options.clientId?.trim()) {
			slackConfig.clientId = options.clientId.trim();
		}
		if (options.clientSecret?.trim()) {
			slackConfig.clientSecret = options.clientSecret.trim();
		}
		if (options.encryptionKey?.trim()) {
			slackConfig.encryptionKey = options.encryptionKey.trim();
		}
		if (options.installationKeyPrefix?.trim()) {
			slackConfig.installationKeyPrefix = options.installationKeyPrefix.trim();
		}
		const slack = createSlackAdapter(slackConfig) as SlackAdapter;
		patchSlackMessageEventHandling(slack);
		const bot = new Chat({
			userName: options.userName,
			adapters: { slack: slack as unknown as Adapter },
			state: new FileStateAdapter(stateStorePath),
			logger,
			fallbackStreamingPlaceholderText: null,
			streamingUpdateIntervalMs: 500,
		}).registerSingleton();
		const threadQueues = new Map<string, Promise<void>>();
		const activeTurns = new Map<string, ActiveConnectorTurn>();
		const pendingApprovals = new Map<string, PendingConnectorApproval>();
		const startRequest = await buildSlackStartRequest(options, io, {
			enabled: loggerAdapter.runtimeConfig.enabled,
			level: loggerAdapter.runtimeConfig.level,
			destination: loggerAdapter.runtimeConfig.destination,
			bindings: {
				transport: "slack",
				userName: options.userName,
			},
		});
		const userInstructionService = createUserInstructionConfigService({
			skills: { workspacePath: startRequest.cwd },
			rules: { workspacePath: startRequest.cwd },
			workflows: { workspacePath: startRequest.cwd },
		});
		await userInstructionService.start().catch(() => undefined);
		const commandCwd = startRequest.cwd || process.cwd();
		const { host: chatCommandHost } = await createWorkspaceChatCommandHost({
			cwd: commandCwd,
			workspaceRoot: startRequest.workspaceRoot || commandCwd,
		});
		const { url: rpcAddress, authToken: rpcAuthToken } =
			await ensureCliHubServer(
				startRequest.workspaceRoot || startRequest.cwd || process.cwd(),
				parseHubEndpointOverride(options.rpcAddress),
			);

		const clientId = `slack-${process.pid}-${Date.now()}`;
		const client = new HubSessionClient({
			address: rpcAddress,
			authToken: rpcAuthToken,
			clientId,
			clientType: "cli",
			displayName: "slack connector",
			workspaceRoot: startRequest.workspaceRoot || startRequest.cwd,
			cwd: startRequest.cwd,
			metadata: {
				transport: "slack",
				userName: options.userName,
			},
		});
		await client.connect();
		this.writeConnectorState(statePath, {
			userName: options.userName,
			connectionMode: options.connectionMode,
			pid: process.pid,
			rpcAddress,
			...(options.connectionMode === "webhook"
				? { port: options.port, baseUrl: options.baseUrl }
				: {}),
			startedAt: new Date().toISOString(),
		});

		let stopping = false;
		let resolveStop: (() => void) | undefined;
		const stopPromise = new Promise<void>((resolve) => {
			resolveStop = resolve;
		});
		const requestStop = (_reason: string) => {
			if (stopping) {
				return;
			}
			stopping = true;
			resolveStop?.();
		};

		const handleTurn = async (
			thread: Thread<SlackThreadState>,
			text: string,
			addressedToBot: boolean,
		) => {
			const currentState = await loadThreadState(
				thread,
				bindingsPath,
				startRequest,
				resolveSlackBindingScope(thread),
			);
			const queueKey =
				currentState.bindingScope === "thread"
					? thread.id
					: currentState.participantKey || thread.id;
			const runTurn = async () => {
				try {
					await withSlackTeamBotToken({
						slack,
						teamId: currentState.teamId,
						work: async () =>
							handleConnectorUserTurn({
								thread,
								text,
								runtimeText: formatSlackRuntimeText({
									text,
									thread,
									state: currentState,
									addressedToBot,
								}),
								client,
								pendingApprovals,
								baseStartRequest: startRequest,
								explicitSystemPrompt:
									options.systemPrompt?.trim() ||
									getConnectorSystemPrompt("slack"),
								clientId,
								logger: loggerAdapter,
								transport: "slack",
								botUserName: options.userName,
								addressedToBot,
								requestStop,
								bindingsPath,
								hookCommand: options.hookCommand,
								systemRules: SLACK_SYSTEM_RULES,
								errorLabel: "Slack",
								firstContactMessage: SLACK_FIRST_CONTACT_MESSAGE,
								userInstructionService,
								chatCommandHost,
								activeTurns,
								turnKey: queueKey,
								getSessionMetadata: (
									currentThread,
									_clientId,
									currentState,
								) => ({
									userName: options.userName,
									slackThreadId: currentThread.id,
									slackChannelId: currentThread.channelId,
									...(currentState.participantKey
										? { slackParticipantKey: currentState.participantKey }
										: {}),
									...(currentState.participantLabel
										? { slackParticipantLabel: currentState.participantLabel }
										: {}),
								}),
								reusedLogMessage: "Slack thread reusing RPC session",
								startedLogMessage: "Slack thread started RPC session",
								postFinalReply: async ({
									thread: replyThread,
									text: replyText,
								}) => {
									await postSlackResolvedText({
										slack,
										thread: replyThread,
										text: replyText,
										teamId: currentState.teamId,
										preferredUserIds: [
											resolveSlackParticipantUserId(
												currentState.participantKey,
											),
										].filter((id): id is string => Boolean(id)),
										logger: loggerAdapter,
									});
								},
								onMessageReceived: async (details) => {
									await dispatchConnectorHook(
										options.hookCommand,
										{
											adapter: "slack",
											botUserName: options.userName,
											event: "message.received",
											payload: details,
											ts: new Date().toISOString(),
										},
										loggerAdapter,
									);
								},
								onReplyCompleted: async (result) => {
									await dispatchConnectorHook(
										options.hookCommand,
										{
											adapter: "slack",
											botUserName: options.userName,
											event: "message.completed",
											payload: {
												threadId: result.threadId,
												sessionId: result.sessionId,
												finishReason: result.finishReason,
												iterations: result.iterations,
												outputPreview: truncateText(result.text),
												outputLength: result.text.length,
											},
											ts: new Date().toISOString(),
										},
										loggerAdapter,
									);
								},
								onReplyFailed: async (details) => {
									await dispatchConnectorHook(
										options.hookCommand,
										{
											adapter: "slack",
											botUserName: options.userName,
											event: "message.failed",
											payload: {
												threadId: details.threadId,
												sessionId: details.sessionId,
												error: details.error.message,
											},
											ts: new Date().toISOString(),
										},
										loggerAdapter,
									);
								},
							}),
					});
				} catch (error) {
					const message =
						error instanceof Error ? error.message : String(error);
					await withSlackTeamBotToken({
						slack,
						teamId: currentState.teamId,
						work: () => thread.post(`Slack bridge error: ${message}`),
					});
				}
			};
			if (activeTurns.has(queueKey)) {
				await runTurn();
				return;
			}
			await enqueueThreadTurn(threadQueues, queueKey, async () => {
				await runTurn();
			});
		};

		bot.onNewMention(async (thread, message) => {
			const mentionThread = resolveSlackChannelMentionThread(thread, message);
			const text = resolveSlackTurnText({
				text: message.text,
				raw: message.raw,
				botUserId: slack.botUserId,
			});
			await mentionThread.subscribe();
			await persistSlackThreadContext({
				slack,
				thread: mentionThread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Slack",
				logger: loggerAdapter,
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread: mentionThread,
					text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Denied by Slack user",
				})
			) {
				return;
			}
			await handleTurn(mentionThread, text, true);
		});

		bot.onSubscribedMessage(async (thread, message) => {
			const text = resolveSlackTurnText({
				text: message.text,
				raw: message.raw,
				botUserId: slack.botUserId,
			});
			await persistSlackThreadContext({
				slack,
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: message.raw,
				errorLabel: "Slack",
				logger: loggerAdapter,
			});
			if (
				await maybeHandleConnectorApprovalReply({
					thread,
					text,
					client,
					clientId,
					pendingApprovals,
					deniedReason: "Denied by Slack user",
				})
			) {
				return;
			}
			await handleTurn(thread, text, message.isMention === true);
		});

		bot.onSlashCommand(async (event) => {
			const commandText = [event.command.trim(), event.text.trim()]
				.filter(Boolean)
				.join(" ");
			const rootMessage = await event.channel.post(
				`${event.user.fullName} invoked ${commandText}`,
			);
			const thread = new ThreadImpl<SlackThreadState>({
				adapterName: "slack",
				channelId: event.channel.id,
				id: rootMessage.threadId,
				isDM: event.channel.isDM,
				isSubscribedContext: true,
			});
			await thread.subscribe();
			await persistSlackThreadContext({
				slack,
				thread,
				bindingsPath,
				baseStartRequest: startRequest,
				rawMessage: event.raw,
				errorLabel: "Slack",
				logger: loggerAdapter,
			});
			await handleTurn(thread, commandText, true);
		});

		await bot.initialize();
		const stopTaskUpdateStream =
			startConnectorTaskUpdateRelay<SlackThreadState>({
				client,
				clientId,
				bot,
				logger: loggerAdapter,
				bindingsPath,
				transport: "slack",
				postToThread: async ({ thread, binding, body, threadId }) => {
					try {
						await withSlackBindingBotToken({
							slack,
							binding,
							work: () => thread.post(body).then(() => undefined),
						});
					} catch (error) {
						if (
							isSlackInvalidThreadTsError(error) &&
							clearSlackBinding(bindingsPath, threadId)
						) {
							loggerAdapter.core.log(
								"Cleared stale Slack binding after invalid_thread_ts",
								{
									severity: "warn",
									transport: "slack",
									threadId,
								},
							);
						}
						throw error;
					}
				},
			});

		let webhookUrl: string | undefined;
		let oauthCallbackUrl: string | undefined;
		const server =
			options.connectionMode === "webhook"
				? await (async () => {
						const baseUrl = options.baseUrl?.trim();
						if (!baseUrl) {
							throw new Error(
								"Slack webhook mode requires --base-url or BASE_URL",
							);
						}
						webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/webhooks/slack`;
						oauthCallbackUrl = `${baseUrl.replace(/\/$/, "")}/api/oauth/slack/callback`;
						return startConnectorWebhookServer({
							host: options.host,
							port: options.port,
							routes: {
								"/api/webhooks/slack": async (request) =>
									bot.webhooks.slack(request),
								"/api/oauth/slack/callback": async (request) => {
									try {
										const result = await slack.handleOAuthCallback(request);
										return new Response(
											`Slack installation stored for team ${result.teamId}. You can return to Slack.`,
										);
									} catch (error) {
										const message =
											error instanceof Error ? error.message : String(error);
										loggerAdapter.core.log("Slack OAuth callback failed", {
											severity: "warn",
											transport: "slack",
											error: message,
										});
										return new Response(`Slack OAuth error: ${message}`, {
											status: 500,
										});
									}
								},
								"/health": () => new Response("ok"),
								"/": () =>
									new Response(
										[
											"Slack connector is running.",
											"Connection mode: webhook",
											`Webhook URL: ${webhookUrl}`,
											`OAuth callback URL: ${oauthCallbackUrl}`,
											options.botToken?.trim()
												? "Auth mode: single workspace"
												: options.clientId?.trim() &&
														options.clientSecret?.trim()
													? "Auth mode: multi-workspace OAuth"
													: "Auth mode: incomplete (set bot token or OAuth credentials)",
										].join("\n"),
									),
							},
						});
					})()
				: undefined;

		const stopEventStream = client.streamEvents(
			{ clientId: `${clientId}-server-events` },
			{
				onEvent: (event) => {
					if (event.eventType === "rpc.server.shutting_down") {
						requestStop("rpc_server_shutting_down");
						return;
					}
					if (
						event.eventType !== "schedule.execution.completed" &&
						event.eventType !== "schedule.execution.failed"
					) {
						return;
					}
					const scheduleId =
						typeof event.payload.scheduleId === "string"
							? event.payload.scheduleId.trim()
							: "";
					const executionId =
						typeof event.payload.executionId === "string"
							? event.payload.executionId.trim()
							: "";
					const sessionId =
						typeof event.payload.sessionId === "string"
							? event.payload.sessionId.trim()
							: undefined;
					const status =
						typeof event.payload.status === "string"
							? event.payload.status.trim()
							: "";
					const errorMessage =
						typeof event.payload.errorMessage === "string"
							? event.payload.errorMessage
							: undefined;
					if (!scheduleId || !executionId || !status) {
						return;
					}
					void deliverScheduledResult({
						bot,
						slack,
						client,
						logger: loggerAdapter,
						bindingsPath,
						userName: options.userName,
						scheduleId,
						executionId,
						sessionId,
						status,
						errorMessage,
						hookCommand: options.hookCommand,
					});
				},
				onError: () => {
					requestStop("rpc_server_event_stream_failed");
				},
			},
		);

		process.once("SIGINT", () => requestStop("sigint"));
		process.once("SIGTERM", () => requestStop("sigterm"));

		if (options.connectionMode === "webhook") {
			io.writeln(`[slack] listening on ${options.host}:${options.port}`);
			io.writeln(`[slack] configure Slack webhook URL: ${webhookUrl}`);
			io.writeln(
				`[slack] configure Slack OAuth callback URL: ${oauthCallbackUrl}`,
			);
		} else {
			io.writeln("[slack] socket mode connected");
		}

		await stopPromise;
		clearBindingSessionIds<SlackThreadState>(bindingsPath);
		stopTaskUpdateStream();
		stopEventStream();
		await server?.close();
		await bot.shutdown();
		userInstructionService.stop();
		client.close();
		this.removeStateFile(statePath);
		return 0;
	}
}

export const slackConnector: ConnectCommandDefinition = new SlackConnector();

function parseSlackOptionsForTest(rawArgs: string[]): ConnectSlackOptions {
	return (
		new SlackConnector() as unknown as {
			parseArgs(rawArgs: string[]): ConnectSlackOptions;
		}
	).parseArgs(rawArgs);
}

export const __test__ = {
	parseSlackOptionsForTest,
	inferSlackConnectionMode,
	buildSlackParticipantKey,
	resolveSlackParticipantUserId,
	resolveSlackParticipant,
	resolveSlackParticipantLabel,
	formatSlackRuntimeText,
	normalizeSlackMessageEventChannelType,
	stripLeadingSlackMention,
	resolveSlackTurnText,
	resolveSlackOutboundMentionText,
	resolveSlackOutboundMentions,
	postSlackResolvedText,
	clearSlackApiCaches,
	resolveSlackChannelMentionThread,
	withSlackTeamBotToken,
	isSlackInvalidThreadTsError,
	findBindingForThread: (
		bindings: ConnectorBindingStore<SlackThreadState>,
		thread: Pick<Thread<SlackThreadState>, "id" | "channelId" | "isDM"> & {
			participantKey?: string;
			bindingScope?: ConnectorBindingScope;
		},
	) => findBindingForThread(bindings, thread),
};
