/**
 * Slack Bot Example (Chat SDK + Cline Agents SDK)
 *
 * A production-ready Slack bot that connects Cline agent intelligence to Slack.
 *
 * This example shows how to:
 * - Wire a Chat SDK Slack adapter to a Cline Agent runtime
 * - Support single-workspace and multi-workspace OAuth Slack installs
 * - Maintain per-thread agent conversation memory
 * - Serialize concurrent messages per thread to avoid race conditions
 * - Handle slash commands (/clear) to clear agent state
 * - Use the Slack Assistants API for suggested prompts
 *
 * Prerequisites:
 * - A configured Slack app (see README.md for manifest)
 * - Environment variables: SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET (or OAuth creds)
 * - A provider config file pointed to by CLINE_SLACK_BOT_PROVIDER_CONFIG
 *
 * Run: bun --env-file apps/examples/slack-bot/.env apps/examples/slack-bot/src/index.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { createSlackAdapter, type SlackAdapter } from "@chat-adapter/slack";
import { Agent } from "@clinebot/agents";
import { ProviderSettingsSchema, toProviderConfig } from "@clinebot/core";
import {
	Chat,
	ConsoleLogger,
	type Lock,
	type LogLevel,
	type QueueEntry,
	type StateAdapter,
	type Thread,
} from "chat";

// ---------------------------------------------------------------------------
// Step 1: State adapter — Chat SDK needs a StateAdapter for subscriptions,
// message queues, and lock management. This in-memory implementation works
// for single-process deployments. Swap with Redis/DB for multi-instance.
// ---------------------------------------------------------------------------

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

	async forceReleaseLock(threadId: string): Promise<void> {
		this.locks.delete(threadId);
	}

	async appendToList(
		key: string,
		value: unknown,
		options?: { maxLength?: number; ttlMs?: number },
	): Promise<void> {
		const entry = this.values.get(key);
		const list: unknown[] = Array.isArray(entry?.value)
			? (entry.value as unknown[])
			: [];
		list.push(value);
		if (options?.maxLength && list.length > options.maxLength) {
			list.splice(0, list.length - options.maxLength);
		}
		await this.set(key, list, options?.ttlMs);
	}

	async getList<T = unknown>(key: string): Promise<T[]> {
		const value = await this.get<T[]>(key);
		return Array.isArray(value) ? value : [];
	}

	async setIfNotExists(
		key: string,
		value: unknown,
		ttlMs?: number,
	): Promise<boolean> {
		const existing = await this.get(key);
		if (existing !== null) {
			return false;
		}
		await this.set(key, value, ttlMs);
		return true;
	}
}

// ---------------------------------------------------------------------------
// Step 2: Environment helpers — validate required env vars up front so
// errors surface at startup, not at request time.
// ---------------------------------------------------------------------------

function getRequiredEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
}

// ---------------------------------------------------------------------------
// Step 3: Provider config loader — reads the model/provider/auth from a JSON
// file on disk. Accepts three formats:
//   1. Stored providers.json (with lastUsedProvider + providers map)
//   2. Array of provider settings (uses first entry)
//   3. Single provider settings object
// See README.md for examples of each format.
// ---------------------------------------------------------------------------

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
		const settings = ProviderSettingsSchema.parse(rawSettings);
		const config = toProviderConfig(settings);
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
		const settings = ProviderSettingsSchema.parse(parsed[0]);
		const config = toProviderConfig(settings);
		return {
			providerId: config.providerId,
			modelId: config.modelId,
			apiKey: config.apiKey,
			baseUrl: config.baseUrl,
			headers: config.headers,
		};
	}

	const settings = ProviderSettingsSchema.parse(parsed);
	const config = toProviderConfig(settings);
	return {
		providerId: config.providerId,
		modelId: config.modelId,
		apiKey: config.apiKey,
		baseUrl: config.baseUrl,
		headers: config.headers,
	};
}

// ---------------------------------------------------------------------------
// Step 4: Bootstrap — set up logging, load provider config, create the
// Slack adapter (single-workspace or OAuth), and initialize the Chat bot.
// ---------------------------------------------------------------------------

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

// Decide between single-workspace mode (bot token) and multi-workspace OAuth
const useOAuthMode =
	Boolean(process.env.SLACK_CLIENT_ID) &&
	Boolean(process.env.SLACK_CLIENT_SECRET);

const slackAdapter = useOAuthMode
	? createSlackAdapter({
			clientId: getRequiredEnv("SLACK_CLIENT_ID"),
			clientSecret: getRequiredEnv("SLACK_CLIENT_SECRET"),
		})
	: createSlackAdapter();

// Create the Chat bot — this ties the Slack adapter, state, and logger together
const bot = new Chat({
	userName: process.env.BOT_USERNAME ?? "cline",
	adapters: {
		slack: slackAdapter,
	},
	state: new InMemoryStateAdapter(),
	logger,
});

// ---------------------------------------------------------------------------
// Step 5: Per-thread agent management — each Slack thread gets its own Agent
// instance so conversation history stays isolated. The `hasRun` flag tracks
// whether to call agent.run() (first message) or agent.continue() (follow-ups).
// ---------------------------------------------------------------------------

const runtimes = new Map<string, ThreadAgentRuntime>();
const threadQueues = new Map<string, Promise<void>>();

// Lazily create an Agent for each thread on first message
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
			tools: [], // No tools — pure LLM conversation; add tools here to give the agent capabilities
			maxIterations: 8, // Safety limit on agent loop iterations
		}),
		hasRun: false,
	};
	runtimes.set(threadId, created);
	return created;
}

// Serialize turns per thread — Slack can deliver multiple messages quickly;
// this queue ensures the agent processes them one at a time per thread.
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

// Core message handler — sends text to the agent and posts the response
async function handleUserTurn(thread: Thread, text: string): Promise<void> {
	const input = text.trim();
	if (!input) {
		return;
	}
	// Show a typing indicator while the agent processes
	await thread.startTyping("Thinking...");
	const runtime = getThreadRuntime(thread.id);

	// First message in a thread uses run(); follow-ups use continue()
	const result = runtime.hasRun
		? await runtime.agent.continue(input)
		: await runtime.agent.run(input);
	runtime.hasRun = true;
	const answer =
		result.outputText.trim() ||
		"I could not produce a response. Please try rephrasing your request.";
	await thread.post(answer);
}

// ---------------------------------------------------------------------------
// Step 6: Event handlers — wire Chat SDK events to the agent runtime.
// ---------------------------------------------------------------------------

// When the bot is @mentioned in a channel, subscribe to the thread and respond
bot.onNewMention(async (thread, message) => {
	await thread.subscribe();
	await enqueueThreadTurn(thread.id, async () => {
		await handleUserTurn(thread, message.text);
	});
});

// Follow-up messages in a thread the bot is already subscribed to
bot.onSubscribedMessage(async (thread, message) => {
	await enqueueThreadTurn(thread.id, async () => {
		await handleUserTurn(thread, message.text);
	});
});

// /clear slash command — clears all agent thread history in the channel
bot.onSlashCommand("/clear", async (event) => {
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

// Slack Assistants API — suggest prompts when a user opens an assistant thread
bot.onAssistantThreadStarted(async (event) => {
	const adapter = bot.getAdapter("slack") as SlackAdapter;
	await adapter.setSuggestedPrompts(event.channelId, event.threadTs, [
		{ title: "Summarize", message: "Summarize this channel context." },
		{ title: "Draft reply", message: "Draft a reply for the latest message." },
		{ title: "Action items", message: "List concrete next steps and owners." },
	]);
});

// ---------------------------------------------------------------------------
// Step 7: Start the HTTP server — expose webhook, OAuth callback, and health
// endpoints. Chat SDK handles Slack event verification and routing internally.
// ---------------------------------------------------------------------------

const port = Number(process.env.PORT ?? 8787);
const baseUrl = process.env.BASE_URL ?? `http://localhost:${port}`;

// Initialize the Chat SDK (connects adapters and state)
await bot.initialize();

// Start a Bun HTTP server with route handlers
Bun.serve({
	port,
	routes: {
		// All Slack events (messages, mentions, slash commands) arrive here
		"/api/webhooks/slack": async (request) => bot.webhooks.slack(request),

		// OAuth install callback (only used in multi-workspace mode)
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
