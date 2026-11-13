import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
	AgendaTaskManager,
	createFactoryGuidanceTool,
	createFactoryListTool,
	createFactoryManagerGuidanceExtension,
	createFactoryPromptExtension,
	createFactoryStagesTool,
	createFactoryStatusTool,
	createFactoryTool,
	FACTORY_LIST_TOOL_NAME,
	FACTORY_STATUS_TOOL_NAME,
	FACTORY_TOOL_NAME,
	FactoryGuidanceStore,
	FactoryListToolInputSchema,
	FactoryStatusToolInputSchema,
	FactoryToolInputSchema,
	FileFactoryAgentCardLedger,
	readFactoryManagerReadme,
	resolveFactoryGuidanceDir,
	SessionSource,
} from "@cline/core";
import { type AgentTool, formatFactoryId } from "@cline/shared";
import {
	FACTORY_MANAGER_PROMPT_RULE,
	FACTORY_MANAGER_REQUEST_METADATA_KEY,
	FACTORY_MANAGER_SESSION_TITLE,
	FACTORY_MANAGER_TOOL_NAMES,
} from "../../sidecar/chat-session";
import { createRepo, evalFactoryConfig, quietLogger } from "./fixtures";
import type { FiledCard, ManagerToolCall, ManagerTrial } from "./grade";
import { createEvalAgendaRuntime, EvalCore, type ModelChoice } from "./runtime";
import { MANAGER_PROJECTS, type ManagerScenario } from "./scenarios";
import { race, type TrialOptions } from "./trial";

/** Off in the eval: no network but the model provider. */
const WEB_TOOLS = new Set(["fetch_web_content", "web_search"]);

const SCHEMAS: Record<
	string,
	{ safeParse: (input: unknown) => { success: boolean; data?: unknown } }
> = {
	[FACTORY_TOOL_NAME]: FactoryToolInputSchema,
	[FACTORY_LIST_TOOL_NAME]: FactoryListToolInputSchema,
	[FACTORY_STATUS_TOOL_NAME]: FactoryStatusToolInputSchema,
};

/**
 * One "Ask Factory" conversation: the desktop's manager prompt rule, the
 * Hub's Factory prompt extension and manager readme, and the real Factory
 * tools over a real AgendaTaskManager on a temporary database (cards are
 * created there and never scoped or run). Two temporary git projects; the
 * duplicate check runs for real, including its judge session.
 */
export async function runManagerTrial(
	scenario: ManagerScenario,
	trial: number,
	model: ModelChoice,
	options: TrialOptions,
): Promise<ManagerTrial> {
	const started = Date.now();
	const root = realpathSync(mkdtempSync(join(tmpdir(), "factory-eval-")));
	const toolCalls: ManagerToolCall[] = [];
	const questions: string[] = [];
	const priorityConfirmations: ManagerTrial["priorityConfirmations"] = [];
	let core: EvalCore | undefined;
	let manager: AgendaTaskManager | undefined;
	const base = {
		suite: "manager" as const,
		scenarioId: scenario.id,
		trial,
		modelRequests: 0,
		toolCalls,
		cards: [] as FiledCard[],
		priorityConfirmations,
		questions,
		seeded: [] as ManagerTrial["seeded"],
		judgeSessions: 0,
	};
	try {
		const projects = MANAGER_PROJECTS.map((name) => {
			const dir = join(root, name);
			createRepo(
				dir,
				{ "README.md": `# ${name}\n` },
				`https://github.com/example-org/${name}.git`,
			);
			return dir;
		});
		const chat = join(root, "chat");
		mkdirSync(chat);
		const dbPath = join(root, "tasks.db");
		const guidance = new FactoryGuidanceStore(
			resolveFactoryGuidanceDir(dbPath),
		);
		let sessionId = "";
		const evalCore = await EvalCore.create({
			model,
			dryRun: options.dryRun,
			// In the app the person would now answer; the turn ends here.
			onQuestion: (text) => {
				questions.push(text);
				void evalCore.abort(sessionId, "The manager asked the person");
			},
		});
		core = evalCore;
		const tasks = new AgendaTaskManager({
			runtime: createEvalAgendaRuntime(evalCore, guidance),
			dbPath,
			globalSpecsDir: join(root, "specs"),
			watchFiles: false,
			automationEnabled: false,
			factoryStorageDir: join(root, "factory"),
			factoryGuidance: guidance,
			logger: quietLogger,
		});
		manager = tasks;
		const seededIds = new Set<string>();
		for (const card of scenario.seededCards ?? []) {
			const project = projects.find((dir) => basename(dir) === card.project);
			if (!project) throw new Error(`unknown project ${card.project}`);
			const task = await tasks.createTask({
				title: card.title,
				type: "follow-up",
				instructions: card.instructions,
				scope: "workspace",
				workspaceRoot: project,
				cwd: project,
				expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
				requiresApproval: true,
				automationEligible: false,
				queueFactoryDesign: false,
				factory: evalFactoryConfig(),
				createdBy: { kind: "user" },
			});
			seededIds.add(task.taskId);
			base.seeded.push({
				shortId: task.factoryNumber
					? formatFactoryId(task.factoryNumber)
					: task.taskId,
				title: task.title,
			});
		}
		const listProjects = async () => projects;
		const resolveSessionDefaults = async () => ({
			interactive: true,
			manager: true,
			modelSelection: model,
		});
		const resolveManagerSession = async () => ({});
		const record = (tool: AgentTool): AgentTool => ({
			...tool,
			execute: async (input, context) => {
				const parsed = SCHEMAS[tool.name]?.safeParse(input);
				const call: ManagerToolCall = {
					name: tool.name,
					input: parsed?.success ? parsed.data : input,
				};
				toolCalls.push(call);
				const output = await tool.execute(input, context);
				if (output && typeof output === "object" && "ok" in output) {
					const reply = output as {
						ok: unknown;
						error?: { code?: unknown };
						duplicateOf?: unknown;
					};
					call.ok = reply.ok === true;
					if (typeof reply.error?.code === "string")
						call.errorCode = reply.error.code;
					if (reply.duplicateOf) call.duplicateOf = true;
				}
				return output;
			},
		});
		const declined = async () => ({
			approved: false,
			reason: "Nobody answered.",
		});
		sessionId = await evalCore.start("manager", {
			source: SessionSource.DESKTOP,
			interactive: true,
			sessionMetadata: {
				[FACTORY_MANAGER_REQUEST_METADATA_KEY]: true,
				title: FACTORY_MANAGER_SESSION_TITLE,
			},
			config: {
				cwd: chat,
				workspaceRoot: chat,
				// Empty: the runtime builds the default prompt with these rules,
				// as the desktop does for a local session.
				systemPrompt: "",
				rules: FACTORY_MANAGER_PROMPT_RULE,
				mode: "act",
				enableTools: true,
				enableSpawnAgent: false,
				enableAgentTeams: false,
				extraTools: [
					createFactoryTool({
						manager: tasks,
						agentCards: new FileFactoryAgentCardLedger(undefined),
						resolveSessionDefaults,
						listProjects,
					}) as AgentTool,
					createFactoryListTool({
						manager: tasks,
						resolveSessionDefaults,
						listProjects,
					}) as AgentTool,
					createFactoryStatusTool({
						manager: tasks,
						resolveSessionDefaults,
						listProjects,
						confirmPriority: async (request) => {
							const approved = scenario.confirmUrgent === true;
							priorityConfirmations.push({ to: request.to, approved });
							return approved
								? { approved }
								: { approved, reason: "The person declined." };
						},
					}) as AgentTool,
				].map(record),
				extensions: [
					createFactoryPromptExtension(),
					createFactoryManagerGuidanceExtension({
						tools: [
							createFactoryGuidanceTool({
								store: guidance,
								resolveManagerSession,
								listProjects,
								confirm: declined,
							}) as AgentTool,
							createFactoryStagesTool({
								manager: tasks,
								resolveManagerSession,
								listProjects,
								confirm: declined,
							}) as AgentTool,
						].map(record),
						isManagerSession: async () => true,
						readme: () => readFactoryManagerReadme(guidance).block,
					}),
				],
			},
			toolPolicies: {
				"*": { enabled: false, autoApprove: true },
				...Object.fromEntries(
					FACTORY_MANAGER_TOOL_NAMES.map((name) => [
						name,
						{ enabled: !WEB_TOOLS.has(name) },
					]),
				),
			},
		});
		let status: "settled" | "timeout" | "aborted" = "settled";
		let finalText: string | undefined;
		for (const message of scenario.messages) {
			const ended = await race(evalCore.send(sessionId, message), options);
			if (ended.status !== "settled") {
				status = ended.status;
				break;
			}
			finalText = ended.value?.text;
			if (evalCore.captured) break;
		}
		await evalCore.abortAll("Trial ended");
		for (const project of projects)
			for (const task of await tasks.listTasks({
				scope: "workspace",
				workspaceRoot: project,
				factoryOnly: true,
				includeArchived: true,
				limit: 100,
			}))
				if (!seededIds.has(task.taskId))
					base.cards.push({
						title: task.title,
						project: basename(project),
						...(task.factoryPriority?.level
							? { priority: task.factoryPriority.level }
							: {}),
						...(task.factory?.deliverable
							? { deliverable: task.factory.deliverable }
							: {}),
					});
		const sessions = [...evalCore.sessions.values()];
		const asked =
			questions.length > 0 ||
			(!toolCalls.some((call) => call.name === FACTORY_TOOL_NAME) &&
				(finalText ?? "").trim().endsWith("?"));
		return {
			...base,
			outcome:
				status !== "settled"
					? status
					: base.cards.length
						? `${base.cards.length} card${base.cards.length === 1 ? "" : "s"}`
						: asked
							? "asked"
							: "no card",
			seconds: (Date.now() - started) / 1000,
			modelRequests: sessions.reduce((n, s) => n + s.modelRequests, 0),
			judgeSessions: sessions.filter((s) => s.role === "judge").length,
			...(finalText ? { finalText } : {}),
			...(evalCore.captured ? { captured: evalCore.captured } : {}),
			usage: await evalCore.usage(),
		};
	} catch (error) {
		return {
			...base,
			outcome: "harness_error",
			seconds: (Date.now() - started) / 1000,
			error:
				error instanceof Error ? (error.stack ?? error.message) : String(error),
		};
	} finally {
		await core?.abortAll("Trial ended").catch(() => {});
		await manager?.dispose().catch(() => {});
		await core?.dispose().catch(() => {});
		rmSync(root, { recursive: true, force: true });
	}
}
