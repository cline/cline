import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentPlugin,
	type AgentTool,
	type AgentToolContext,
	ClineCore,
	createTool,
} from "@cline/core";
import YAML from "yaml";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SessionManager = ClineCore;

/** Minimal plugin host interface injected by the runtime via globalThis. */
interface ClinePluginHost {
	emitEvent?: (name: string, payload?: unknown) => void;
}

declare global {
	var __clinePluginHost: ClinePluginHost | undefined;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const BUNDLED_AGENTS_DIR = join(MODULE_DIR, "agents");
const BUNDLED_SKILLS_DIR = join(MODULE_DIR, "skills");

function resolveDefaultHomeDir(): string {
	const envHome = process?.env?.HOME?.trim();
	if (envHome && envHome !== "~") {
		return envHome;
	}
	const envUserProfile = process?.env?.USERPROFILE?.trim();
	if (envUserProfile) {
		return envUserProfile;
	}
	const envHomeDrive = process?.env?.HOMEDRIVE?.trim();
	const envHomePath = process?.env?.HOMEPATH?.trim();
	if (envHomeDrive && envHomePath) {
		return `${envHomeDrive}${envHomePath}`;
	}
	return "~";
}

function resolveClineDirPath(): string {
	const explicitDir = process.env.CLINE_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveDefaultHomeDir(), ".cline");
}

function resolveClineDataDirPath(): string {
	const explicitDir = process.env.CLINE_DATA_DIR?.trim();
	if (explicitDir) {
		return explicitDir;
	}
	return join(resolveClineDirPath(), "data");
}

function resolveGlobalAgentsDirPath(): string {
	return join(resolveClineDataDirPath(), "settings", "agents");
}

const HANDOFFS_DIR = join(
	resolveClineDataDirPath(),
	"plugins",
	"subagents",
	"handoffs",
);
const GLOBAL_SKILLS_DIR = join(resolveClineDataDirPath(), "settings", "skills");

// Agent and skill definitions live in the `agents/` and `skills/`
// directories alongside this file. They are loaded at runtime from disk.

/** Safe identifier pattern for conversation IDs used in filesystem paths. */
const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/;

const envOr = (key: string, fallback: string): string =>
	process.env[key]?.trim() || fallback;

const DEFAULT_PROVIDER_ID = envOr("CLINE_SUBAGENT_PROVIDER_ID", "cline");
const DEFAULT_MODEL_ID = envOr(
	"CLINE_SUBAGENT_MODEL_ID",
	"anthropic/claude-sonnet-4.6",
);
type SubagentBackendMode = "auto" | "hub" | "local";

const DEFAULT_BACKEND_MODE = envOr("CLINE_SUBAGENTS_BACKEND_MODE", "auto");
const DEFAULT_AGENT_PRESET = envOr("CLINE_SUBAGENT_DEFAULT_PRESET", "phantom");

// ---------------------------------------------------------------------------
// Agent & Skill Definitions
// ---------------------------------------------------------------------------

interface AgentDefinition {
	name: string;
	description?: string;
	providerId?: string;
	modelId?: string;
	systemPrompt: string;
	cwd?: string;
	maxIterations?: number;
	source: "bundled" | "global" | "project";
}

interface SkillDefinition {
	name: string;
	description?: string;
	content: string;
	source: "bundled" | "global" | "project";
}

interface RunningSubagent {
	sessionId: string;
	parentSessionId?: string;
	name: string;
	task: string;
	agent?: string;
	startedAt: number;
	status: "running" | "completed" | "failed";
	resultText?: string;
	error?: string;
	finishReason?: string;
	completedAt?: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const subagents = new Map<string, RunningSubagent>();
let sessionManagerPromise: Promise<SessionManager> | undefined;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Cast a fully-typed tool to the `AgentTool<unknown, unknown>` expected by
 * the plugin API's `registerTool` method. This is safe at runtime because the
 * registry only invokes `execute` with validated input that matches the
 * tool's `inputSchema`.
 */
function toRegisteredTool<I, O>(
	tool: AgentTool<I, O>,
): AgentTool<unknown, unknown> {
	return tool as AgentTool<unknown, unknown>;
}

function optStr(v: unknown): string | undefined {
	return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function optInt(v: unknown): number | undefined {
	return typeof v === "number" && Number.isFinite(v) && v > 0
		? Math.floor(v)
		: undefined;
}

function parseFrontmatter(md: string): {
	data: Record<string, unknown>;
	body: string;
} {
	const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
	if (!m) return { data: {}, body: md.trim() };
	try {
		const frontmatter = m[1] ?? "";
		const body = m[2] ?? "";
		const parsed = YAML.parse(frontmatter);
		return {
			data:
				parsed && typeof parsed === "object" && !Array.isArray(parsed)
					? (parsed as Record<string, unknown>)
					: {},
			body: body.trim(),
		};
	} catch {
		// Malformed YAML frontmatter — treat as plain markdown with no metadata.
		return { data: {}, body: md.trim() };
	}
}

function readMarkdownDir(
	dirPath: string,
	source: AgentDefinition["source"],
): Array<{
	name: string;
	data: Record<string, unknown>;
	body: string;
	source: typeof source;
}> {
	if (!existsSync(dirPath)) return [];
	const results: Array<{
		name: string;
		data: Record<string, unknown>;
		body: string;
		source: typeof source;
	}> = [];
	for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		try {
			const { data, body } = parseFrontmatter(
				readFileSync(join(dirPath, entry.name), "utf8"),
			);
			if (!body) continue;
			const name = optStr(data.name) ?? entry.name.replace(/\.md$/, "");
			results.push({ name, data, body, source });
		} catch {}
	}
	return results;
}

function readAgentDefinitions(baseCwd: string): AgentDefinition[] {
	const dirs: Array<{ path: string; source: AgentDefinition["source"] }> = [
		{ path: BUNDLED_AGENTS_DIR, source: "bundled" },
		{ path: resolveGlobalAgentsDirPath(), source: "global" },
		{ path: join(baseCwd, ".cline", "agents"), source: "project" },
	];
	const defs = new Map<string, AgentDefinition>();
	for (const { path, source } of dirs) {
		for (const entry of readMarkdownDir(path, source)) {
			defs.set(entry.name, {
				name: entry.name,
				description: optStr(entry.data.description),
				providerId: optStr(entry.data.providerId),
				modelId: optStr(entry.data.modelId),
				systemPrompt: entry.body,
				cwd: optStr(entry.data.cwd),
				maxIterations: optInt(entry.data.maxIterations),
				source: entry.source,
			});
		}
	}
	return [...defs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function readSkillDefinitions(baseCwd: string): SkillDefinition[] {
	const dirs: Array<{ path: string; source: SkillDefinition["source"] }> = [
		{ path: BUNDLED_SKILLS_DIR, source: "bundled" },
		{ path: GLOBAL_SKILLS_DIR, source: "global" },
		{ path: join(baseCwd, ".cline", "skills"), source: "project" },
	];
	const defs = new Map<string, SkillDefinition>();
	for (const { path, source } of dirs) {
		for (const entry of readMarkdownDir(path, source)) {
			defs.set(entry.name, {
				name: entry.name,
				description: optStr(entry.data.description),
				content: entry.body,
				source: entry.source,
			});
		}
	}
	return [...defs.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function parentSessionId(ctx: AgentToolContext): string | undefined {
	const id = ctx.metadata?.sessionId;
	return typeof id === "string" && id.trim() ? id.trim() : undefined;
}

function sanitizeConversationId(conversationId: string): string {
	const trimmed = conversationId.trim();
	if (!trimmed || !SAFE_ID_RE.test(trimmed)) {
		throw new Error(`Invalid conversation ID for filesystem use: "${trimmed}"`);
	}
	return trimmed;
}

function handoffsDir(ctx: AgentToolContext): string {
	const conversationId = ctx.conversationId ?? parentSessionId(ctx);
	if (!conversationId) {
		throw new Error("Missing conversation ID for handoff storage");
	}
	const safeId = sanitizeConversationId(conversationId);
	const dir = join(HANDOFFS_DIR, safeId);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function resolveHandoffPath(
	ctx: AgentToolContext,
	relativePath: string,
): string {
	const dir = handoffsDir(ctx);
	const resolved = resolve(dir, relativePath);
	if (!resolved.startsWith(`${dir}/`)) {
		throw new Error(`Handoff path escapes directory: ${relativePath}`);
	}
	return resolved;
}

function emitSteer(sessionId: string | undefined, prompt: string): void {
	if (sessionId && prompt.trim()) {
		globalThis.__clinePluginHost?.emitEvent?.("steer_message", {
			sessionId,
			prompt,
		});
	}
}

async function getSessionManager(): Promise<SessionManager> {
	sessionManagerPromise ??= ClineCore.create({
		backendMode: resolveSubagentBackendMode(DEFAULT_BACKEND_MODE),
	}).catch((err) => {
		// Clear the cached promise so subsequent calls can retry.
		sessionManagerPromise = undefined;
		throw err;
	});
	return sessionManagerPromise;
}

function resolveSubagentBackendMode(value: string): SubagentBackendMode {
	switch (value) {
		case "auto":
		case "hub":
		case "local":
			return value;
		default:
			return "auto";
	}
}

function extractLastAssistantText(
	messages: Array<{ role?: string; content?: unknown }>,
): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
		const text = (msg.content as Array<{ type?: string; text?: unknown }>)
			.filter((b) => b?.type === "text" && typeof b.text === "string")
			.map((b) => b.text as string)
			.join("")
			.trim();
		if (text) return text;
	}
	return "";
}

function elapsed(start: number, end = Date.now()): string {
	const s = Math.max(0, Math.floor((end - start) / 1000));
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function steerPrompt(subagent: RunningSubagent): string {
	const time = elapsed(subagent.startedAt, subagent.completedAt ?? Date.now());
	const header =
		subagent.status === "completed"
			? `Sub-agent "${subagent.name}" completed (${time}).`
			: `Sub-agent "${subagent.name}" failed (${time}).`;
	const body = subagent.resultText?.trim() || subagent.error?.trim() || "";
	return [header, body, `Session ID: ${subagent.sessionId}`]
		.filter(Boolean)
		.join("\n\n");
}

async function runSubagentTurn(
	subagent: RunningSubagent,
	message: string,
	steer: boolean,
): Promise<void> {
	try {
		const mgr = await getSessionManager();
		const result = await mgr.send({
			sessionId: subagent.sessionId,
			prompt: message,
		});
		const messages = await mgr.readMessages(subagent.sessionId);
		subagent.status = "completed";
		subagent.finishReason = result?.finishReason;
		subagent.resultText =
			result?.text?.trim() || extractLastAssistantText(messages) || "";
		subagent.error = undefined;
		subagent.completedAt = Date.now();
	} catch (err) {
		subagent.status = "failed";
		subagent.error = err instanceof Error ? err.message : String(err);
		subagent.completedAt = Date.now();
	}
	if (steer) emitSteer(subagent.parentSessionId, steerPrompt(subagent));
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const NonEmptyText = z.string().trim().min(1);

const HandoffPathInput = z
	.string()
	.trim()
	.min(1)
	.max(240)
	.regex(
		/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+$/,
		"Use a relative file path with letters, numbers, '.', '_', '-', or '/'.",
	);

const StartSubagentInput = z
	.object({
		label: NonEmptyText.describe(
			"Short display label for this run, used in status and completion messages.",
		),
		task: NonEmptyText.describe(
			"Primary task for the subagent. This becomes its first user message.",
		),
		preset: NonEmptyText.optional().describe(
			`Optional agent preset name from list_agent_presets. Defaults to "${DEFAULT_AGENT_PRESET}" when omitted.`,
		),
		instructions: NonEmptyText.optional().describe(
			"Extra system instructions appended after the preset prompt. Optional when using a preset.",
		),
		providerId: NonEmptyText.optional().describe(
			"Optional provider override. Defaults to the preset or plugin default.",
		),
		modelId: NonEmptyText.optional().describe(
			"Optional model override. Defaults to the preset or plugin default.",
		),
		workingDirectory: NonEmptyText.optional().describe(
			"Optional working directory, resolved from the plugin base cwd.",
		),
		maxIterations: z
			.number()
			.int()
			.min(1)
			.optional()
			.describe("Optional hard limit for the subagent turn loop."),
		notifyParent: z
			.boolean()
			.optional()
			.describe(
				"When true or omitted, send the final outcome back to the parent session.",
			),
	})
	.strict();

const MessageSubagentInput = z
	.object({
		sessionId: NonEmptyText.describe("Existing subagent session ID."),
		prompt: NonEmptyText.describe(
			"Follow-up user message to send to the subagent.",
		),
		notifyParent: z
			.boolean()
			.optional()
			.describe(
				"When true or omitted, send the final outcome back to the parent session.",
			),
	})
	.strict();

const GetSubagentInput = z
	.object({
		sessionId: NonEmptyText.describe("Subagent session ID."),
	})
	.strict();

const SaveHandoffInput = z
	.object({
		path: HandoffPathInput.describe(
			"Relative path inside the conversation handoff store, for example 'research/notes.md'.",
		),
		content: z
			.string()
			.describe(
				"Text content to store for later retrieval by this conversation's agents.",
			),
	})
	.strict();

const ReadHandoffInput = z
	.object({
		path: HandoffPathInput.describe(
			"Relative path inside the conversation handoff store.",
		),
	})
	.strict();

const GetSkillInput = z
	.object({
		name: NonEmptyText.describe("Skill name from list_skills."),
	})
	.strict();

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: AgentPlugin = {
	name: "portable-subagents",
	manifest: { capabilities: ["tools"] },

	setup(api) {
		// -- start_subagent: Start a new subagent session --
		api.registerTool(
			toRegisteredTool(
				createTool({
					name: "start_subagent",
					description: `Start a background subagent run and return its session ID immediately. Prefer a preset from list_agent_presets; when omitted, this tool uses the bundled "${DEFAULT_AGENT_PRESET}" preset automatically. Use get_subagent to poll, or keep notifyParent enabled to have the result pushed back into the parent session.`,
					inputSchema: StartSubagentInput,
					timeoutMs: 60_000,
					retryable: false,
					async execute(input, ctx) {
						const mgr = await getSessionManager();
						const baseCwd = envOr("CLINE_SUBAGENT_CWD", process.cwd());
						const defs = readAgentDefinitions(baseCwd);
						const presetName = input.preset ?? DEFAULT_AGENT_PRESET;
						const def = defs.find((d) => d.name === presetName);
						if (presetName && !def && !input.instructions?.trim()) {
							throw new Error(`Unknown agent preset: ${presetName}`);
						}

						const cwd = resolve(
							baseCwd,
							input.workingDirectory ?? def?.cwd ?? ".",
						);
						const providerId =
							input.providerId ?? def?.providerId ?? DEFAULT_PROVIDER_ID;
						const modelId = input.modelId ?? def?.modelId ?? DEFAULT_MODEL_ID;
						const prompt = [
							def?.systemPrompt?.trim(),
							input.instructions?.trim(),
						]
							.filter(Boolean)
							.join("\n\n");
						if (!prompt) {
							throw new Error(
								`Subagent "${input.label}" needs instructions. Provide "instructions" or use an available preset such as "${DEFAULT_AGENT_PRESET}".`,
							);
						}

						const { sessionId } = await mgr.start({
							config: {
								providerId,
								modelId,
								cwd,
								workspaceRoot: cwd,
								enableTools: true,
								enableSpawnAgent: false,
								enableAgentTeams: false,
								pluginPaths: [],
								systemPrompt: prompt,
								maxIterations: input.maxIterations ?? def?.maxIterations,
							},
							interactive: false,
						});

						const subagent: RunningSubagent = {
							sessionId,
							parentSessionId: parentSessionId(ctx),
							name: input.label,
							task: input.task,
							agent: input.preset,
							startedAt: Date.now(),
							status: "running",
						};
						subagents.set(sessionId, subagent);
						void runSubagentTurn(
							subagent,
							input.task,
							input.notifyParent !== false,
						);

						return {
							status: "started",
							sessionId,
							label: subagent.name,
							preset: def?.name ?? input.preset,
							task: subagent.task,
						};
					},
				}),
			),
		);

		// -- list_agent_presets: Show available agent definitions --
		api.registerTool(
			toRegisteredTool(
				createTool({
					name: "list_agent_presets",
					description:
						"List the available subagent presets, including bundled, global, and project-level definitions.",
					inputSchema: z.object({}).strict(),
					async execute(_input, _ctx) {
						const baseCwd = envOr("CLINE_SUBAGENT_CWD", process.cwd());
						const agents = readAgentDefinitions(baseCwd).map((a) => ({
							name: a.name,
							description: a.description,
							providerId: a.providerId ?? DEFAULT_PROVIDER_ID,
							modelId: a.modelId ?? DEFAULT_MODEL_ID,
							source: a.source,
						}));
						return {
							agents,
							text: agents.length
								? agents
										.map(
											(a) =>
												`- ${a.name} [${a.source}] (${a.providerId}/${a.modelId})${a.description ? `: ${a.description}` : ""}`,
										)
										.join("\n")
								: "No agent definitions found.",
						};
					},
				}),
			),
		);

		// -- message_subagent: Send follow-up to an existing session --
		api.registerTool(
			toRegisteredTool(
				createTool({
					name: "message_subagent",
					description:
						"Send a follow-up message to an existing subagent session and return immediately.",
					inputSchema: MessageSubagentInput,
					timeoutMs: 60_000,
					retryable: false,
					async execute(input, ctx) {
						const mgr = await getSessionManager();
						const record = await mgr.get(input.sessionId);
						if (!record) {
							throw new Error(`Unknown session: ${input.sessionId}`);
						}

						const subagent: RunningSubagent = subagents.get(
							input.sessionId,
						) ?? {
							sessionId: input.sessionId,
							parentSessionId: parentSessionId(ctx),
							name: input.sessionId,
							task: input.prompt,
							startedAt: Date.now(),
							status: "running",
						};
						subagent.parentSessionId = parentSessionId(ctx);
						subagent.task = input.prompt;
						subagent.status = "running";
						subagent.error = undefined;
						subagents.set(subagent.sessionId, subagent);

						void runSubagentTurn(
							subagent,
							input.prompt,
							input.notifyParent !== false,
						);
						return {
							status: "started",
							sessionId: subagent.sessionId,
							label: subagent.name,
							task: subagent.task,
						};
					},
				}),
			),
		);

		// -- get_subagent: Check subagent result --
		api.registerTool(
			toRegisteredTool(
				createTool({
					name: "get_subagent",
					description:
						"Get the latest status, output, and error details for a subagent session.",
					inputSchema: GetSubagentInput,
					async execute(input, _ctx) {
						const subagent = subagents.get(input.sessionId);
						if (!subagent) {
							return {
								status: "unknown",
								sessionId: input.sessionId,
								text: `No tracked session: ${input.sessionId}`,
							};
						}
						return {
							status: subagent.status,
							sessionId: subagent.sessionId,
							label: subagent.name,
							task: subagent.task,
							finishReason: subagent.finishReason,
							error: subagent.error,
							text:
								subagent.resultText ??
								(subagent.status === "running" ? "Still running." : ""),
						};
					},
				}),
			),
		);

		// -- save_handoff: Persist a conversation-scoped handoff file --
		api.registerTool(
			toRegisteredTool(
				createTool({
					name: "save_handoff",
					description:
						"Save text into the conversation handoff store so other agents in this conversation can read it later.",
					inputSchema: SaveHandoffInput,
					async execute(input, ctx) {
						const filePath = resolveHandoffPath(ctx, input.path);
						mkdirSync(dirname(filePath), { recursive: true });
						writeFileSync(filePath, input.content, "utf8");
						return { path: filePath, handoffPath: input.path };
					},
				}),
			),
		);

		// -- read_handoff: Read a conversation-scoped handoff file --
		api.registerTool(
			toRegisteredTool(
				createTool({
					name: "read_handoff",
					description: "Read text from the conversation handoff store.",
					inputSchema: ReadHandoffInput,
					async execute(input, ctx) {
						const filePath = resolveHandoffPath(ctx, input.path);
						if (!existsSync(filePath)) {
							throw new Error(`Handoff not found: ${input.path}`);
						}
						return {
							path: filePath,
							handoffPath: input.path,
							content: readFileSync(filePath, "utf8"),
						};
					},
				}),
			),
		);

		// -- list_skills: Show available skill definitions --
		api.registerTool(
			toRegisteredTool(
				createTool({
					name: "list_skills",
					description:
						"List the available skill definitions from bundled, global, and project-level directories.",
					inputSchema: z.object({}).strict(),
					async execute(_input, _ctx) {
						const baseCwd = envOr("CLINE_SUBAGENT_CWD", process.cwd());
						const skills = readSkillDefinitions(baseCwd);
						return {
							skills: skills.map((s) => ({
								name: s.name,
								description: s.description,
								source: s.source,
							})),
							text: skills.length
								? skills
										.map(
											(s) =>
												`- ${s.name} [${s.source}]${s.description ? `: ${s.description}` : ""}`,
										)
										.join("\n")
								: "No skill definitions found.",
						};
					},
				}),
			),
		);

		// -- get_skill: Load a skill's instructions --
		api.registerTool(
			toRegisteredTool(
				createTool({
					name: "get_skill",
					description:
						"Get a skill by name, including the instructions that should be followed for that specialization.",
					inputSchema: GetSkillInput,
					async execute(input, _ctx) {
						const baseCwd = envOr("CLINE_SUBAGENT_CWD", process.cwd());
						const skills = readSkillDefinitions(baseCwd);
						const skill = skills.find((s) => s.name === input.name);
						if (!skill) {
							const available = skills.map((s) => s.name).join(", ");
							throw new Error(
								`Unknown skill: "${input.name}". Available: ${available || "none"}`,
							);
						}
						return {
							name: skill.name,
							description: skill.description,
							source: skill.source,
							instructions: skill.content,
						};
					},
				}),
			),
		);
	},
};

export { plugin };
export default plugin;
