import { readFileSync } from "node:fs";
import path from "node:path";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { Agent } from "@clinebot/agents";
import { LlmsProviders as providers } from "@clinebot/llms";
import {
	Chat,
	ConsoleLogger,
	type Lock,
	type LogLevel,
	type QueueEntry,
	type StateAdapter,
	type Thread,
} from "chat";

class InMemoryStateAdapter implements StateAdapter {
	private readonly values = new Map<
		string,
		{ expiresAt?: number; value: unknown }
	>();
	private readonly queues = new Map<string, QueueEntry[]>();
	private readonly subscriptions = new Set<string>();
	private readonly locks = new Map<string, Lock>();

	private getActiveQueue(threadId: string): QueueEntry[] {
		const queue = this.queues.get(threadId) ?? [];
		const now = Date.now();
		const activeQueue = queue.filter((entry) => entry.expiresAt > now);
		if (activeQueue.length > 0) {
			this.queues.set(threadId, activeQueue);
		} else {
			this.queues.delete(threadId);
		}
		return activeQueue;
	}

	async connect(): Promise<void> {}

	async disconnect(): Promise<void> {}

	async get<T = unknown>(key: string): Promise<T | null> {
		const entry = this.values.get(key);
		if (!entry) {
			return null;
		}
		if (entry.expiresAt && entry.expiresAt <= Date.now()) {
			this.values.delete(key);
			return null;
		}
		return entry.value as T;
	}

	async set<T = unknown>(key: string, value: T, ttlMs?: number): Promise<void> {
		this.values.set(key, {
			value,
			expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
		});
	}

	async delete(key: string): Promise<void> {
		this.values.delete(key);
	}

	async dequeue(threadId: string): Promise<QueueEntry | null> {
		const queue = this.getActiveQueue(threadId);
		const next = queue.shift() ?? null;
		if (queue.length > 0) {
			this.queues.set(threadId, queue);
		} else {
			this.queues.delete(threadId);
		}
		return next;
	}

	async enqueue(
		threadId: string,
		entry: QueueEntry,
		maxSize: number,
	): Promise<number> {
		const queue = [...this.getActiveQueue(threadId), entry];
		const trimmed =
			maxSize > 0 && queue.length > maxSize
				? queue.slice(queue.length - maxSize)
				: queue;
		this.queues.set(threadId, trimmed);
		return trimmed.length;
	}

	async subscribe(threadId: string): Promise<void> {
		this.subscriptions.add(threadId);
	}

	async unsubscribe(threadId: string): Promise<void> {
		this.subscriptions.delete(threadId);
	}

	async isSubscribed(threadId: string): Promise<boolean> {
		return this.subscriptions.has(threadId);
	}

	async queueDepth(threadId: string): Promise<number> {
		return this.getActiveQueue(threadId).length;
	}

	async acquireLock(threadId: string, ttlMs: number): Promise<Lock | null> {
		const existing = this.locks.get(threadId);
		if (existing && existing.expiresAt > Date.now()) {
			return null;
		}
		const lock: Lock = {
			threadId,
			token: crypto.randomUUID(),
			expiresAt: Date.now() + ttlMs,
		};
		this.locks.set(threadId, lock);
		return lock;
	}

	async extendLock(lock: Lock, ttlMs: number): Promise<boolean> {
		const existing = this.locks.get(lock.threadId);
		if (!existing || existing.token !== lock.token) {
			return false;
		}
		existing.expiresAt = Date.now() + ttlMs;
		return true;
	}

	async releaseLock(lock: Lock): Promise<void> {
		const existing = this.locks.get(lock.threadId);
		if (existing?.token === lock.token) {
			this.locks.delete(lock.threadId);
		}
	}
}

function getRequiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

type StoredProviderSettingsEntryLike = { settings?: unknown };
type StoredProviderSettingsLike = {
	lastUsedProvider?: string;
	providers?: Record<string, unknown>;
};

function parseProviderConfigFromDisk(filePathInput: string): {
	modelId: string;
	providerId: string;
	apiKey?: string;
	baseUrl?: string;
	headers?: Record<string, string>;
} {
	const filePath = path.resolve(filePathInput);
	const raw = readFileSync(filePath, "utf8");
	const parsed = JSON.parse(raw) as unknown;

	const asStored = parsed as StoredProviderSettingsLike;
	if (asStored.providers && typeof asStored.providers === "object") {
		const entries = Object.entries(asStored.providers);
		if (!entries.length) {
			throw new Error(`No providers found in ${filePath}.`);
		}
		const firstEntry = entries[0];
		if (!firstEntry) {
			throw new Error(`No providers found in ${filePath}.`);
		}
		const chosenValue =
			(asStored.lastUsedProvider &&
				asStored.providers[asStored.lastUsedProvider]) ||
			firstEntry[1];
		const maybeStoredEntry = chosenValue as StoredProviderSettingsEntryLike;
		const rawSettings = maybeStoredEntry.settings ?? chosenValue;
		const settings = providers.ProviderSettingsSchema.parse(rawSettings);
		const config = providers.toProviderConfig(settings);
		return {
			providerId: config.providerId,
			modelId: config.modelId,
			apiKey: config.apiKey,
			baseUrl: config.baseUrl,
			headers: config.headers,
		};
	}

	if (Array.isArray(parsed)) {
		if (!parsed.length) {
			throw new Error(`Provider settings array is empty in ${filePath}.`);
		}
		const settings = providers.ProviderSettingsSchema.parse(parsed[0]);
		const config = providers.toProviderConfig(settings);
		return {
			providerId: config.providerId,
			modelId: config.modelId,
			apiKey: config.apiKey,
			baseUrl: config.baseUrl,
			headers: config.headers,
		};
	}

	const settings = providers.ProviderSettingsSchema.parse(parsed);
	const config = providers.toProviderConfig(settings);
	return {
		providerId: config.providerId,
		modelId: config.modelId,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		headers: config.headers,
	};
}

type ThreadAgentRuntime = {
	agent: Agent;
	hasRun: boolean;
};

const requestedLogLevel = process.env.LOG_LEVEL;
const logLevel: LogLevel =
	requestedLogLevel === "debug" ||
	requestedLogLevel === "info" ||
	requestedLogLevel === "warn" ||
	requestedLogLevel === "error" ||
	requestedLogLevel === "silent"
		? requestedLogLevel
		: "info";
const logger = new ConsoleLogger(logLevel, "slack-bot");
const providerConfigPath = getRequiredEnv("CLINE_SLACK_BOT_PROVIDER_CONFIG");
const providerConfig = parseProviderConfigFromDisk(providerConfigPath);
const systemPrompt =
	process.env.CLINE_SYSTEM_PROMPT ??
	"You are a concise, practical Slack assistant. Prefer short, actionable answers.";

if (!providerConfig.apiKey) {
	logger.warn(
		`No API key resolved from provider settings for "${providerConfig.providerId}".`,
	);
}

const useOAuthMode =
	Boolean(process.env.SLACK_CLIENT_ID) &&
	Boolean(process.env.SLACK_CLIENT_SECRET);

const slackAdapter = useOAuthMode
	? createSlackAdapter({
			clientId: getRequiredEnv("SLACK_CLIENT_ID"),
			clientSecret: getRequiredEnv("SLACK_CLIENT_SECRET"),
		})
	: createSlackAdapter();

const bot = new Chat({
	userName: process.env.BOT_USERNAME ?? "cline",
	adapters: {
		slack: slackAdapter,
	},
	state: new InMemoryStateAdapter(),
	logger,
});

const runtimes = new Map<string, ThreadAgentRuntime>();
const threadQueues = new Map<string, Promise<void>>();

function getThreadRuntime(threadId: string): ThreadAgentRuntime {
	const existing = runtimes.get(threadId);
	if (existing) {
		return existing;
	}
	const created: ThreadAgentRuntime = {
		agent: new Agent({
			providerId: providerConfig.providerId,
			modelId: providerConfig.modelId,
			apiKey: providerConfig.apiKey,
			baseUrl: providerConfig.baseUrl,
			headers: providerConfig.headers,
			systemPrompt,
			tools: [],
			maxIterations: 8,
		}),
		hasRun: false,
	};
	runtimes.set(threadId, created);
	return created;
}

async function enqueueThreadTurn(
	threadId: string,
	work: () => Promise<void>,
): Promise<void> {
	const previous = threadQueues.get(threadId) ?? Promise.resolve();
	const current = previous
		.catch(() => {})
		.then(work)
		.finally(() => {
			if (threadQueues.get(threadId) === current) {
				threadQueues.delete(threadId);
			}
		});
	threadQueues.set(threadId, current);
	return current;
}

async function handleUserTurn(thread: Thread, text: string): Promise<void> {
	const input = text.trim();
	if (!input) {
		return;
	}
	await thread.startTyping("Thinking...");
	const runtime = getThreadRuntime(thread.id);
	const result = runtime.hasRun
		? await runtime.agent.continue(input)
		: await runtime.agent.run(input);
	runtime.hasRun = true;
	const answer =
		result.text.trim() ||
		"I could not produce a response. Please try rephrasing your request.";
	await thread.post(answer);
}

bot.onNewMention(async (thread, message) => {
	await thread.subscribe();
	await enqueueThreadTurn(thread.id, async () => {
		await handleUserTurn(thread, message.text);
	});
});

bot.onSubscribedMessage(async (thread, message) => {
	await enqueueThreadTurn(thread.id, async () => {
		await handleUserTurn(thread, message.text);
	});
});

bot.onSlashCommand("/reset", async (event) => {
	const channelPrefix = `${event.channel.id}:`;
	for (const threadId of runtimes.keys()) {
		if (threadId.startsWith(channelPrefix)) {
			runtimes.delete(threadId);
		}
	}
	await event.channel.post(
		"Cleared this channel's Cline agent thread history.",
	);
});

bot.onAssistantThreadStarted(async (event) => {
	const adapter = bot.getAdapter("slack") as SlackAdapter;
	await adapter.setSuggestedPrompts(event.channelId, event.threadTs, [
		{ title: "Summarize", message: "Summarize this channel context." },
		{ title: "Draft reply", message: "Draft a reply for the latest message." },
		{ title: "Action items", message: "List concrete next steps and owners." },
	]);
});

const port = Number(process.env.PORT ?? 8787);
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

await bot.initialize();

Bun.serve({
	port,
	routes: {
		"/api/webhooks/slack": async (request) => bot.webhooks.slack(request),
		"/api/slack/install/callback": async (request) => {
			if (!useOAuthMode) {
				return new Response(
					"OAuth callback route is disabled in single-workspace mode.",
					{ status: 400 },
				);
			}
			if (request.method !== "GET") {
				return new Response("Method Not Allowed", { status: 405 });
			}
			const { teamId } = await slackAdapter.handleOAuthCallback(request);
			return new Response(`Slack app installed for team ${teamId}.`);
		},
		"/health": () => new Response("ok"),
		"/": () =>
			new Response(
				[
					"Slack bot is running.",
					`Webhook URL: ${baseUrl}/api/webhooks/slack`,
					`OAuth callback: ${baseUrl}/api/slack/install/callback`,
				].join("\n"),
			),
	},
	fetch: () => new Response("Not Found", { status: 404 }),
});

logger.info(`Slack bot listening on ${baseUrl}`);
