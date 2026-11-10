import {
	type AgendaTaskRecord,
	type AgendaTaskRunRecord,
	createSessionId,
	type FactoryAgent,
	type FactoryAttempt,
	type FactoryRunState,
	type FactoryWorkspace,
} from "@cline/shared";
import type {
	AgendaTaskRuntime,
	AgendaTaskRuntimeResult,
} from "./agenda-task-manager";
import { resolveFactoryAgent } from "./factory-agents";

export class FactoryPersistenceError extends Error {}

export function createFactorySessionRunner(input: {
	task: AgendaTaskRecord;
	run: AgendaTaskRunRecord;
	runtime: AgendaTaskRuntime;
	signal: AbortSignal;
	getState: () => FactoryRunState;
	save: (patch: Partial<FactoryRunState>) => void;
	sessionStarted: (sessionId: string) => void;
}) {
	const { task, run, runtime, signal } = input;
	const config = task.factory;
	if (!config) throw new Error("Factory configuration is required");
	const save = (patch: Partial<FactoryRunState>) => {
		signal.throwIfAborted();
		try {
			input.save(patch);
		} catch (error) {
			throw new FactoryPersistenceError(
				"Could not persist Factory transition",
				{ cause: error },
			);
		}
	};
	const workTask = {
		...task,
		cwd: input.getState().workspace.path,
		workspaceRoot: task.workspaceRoot ?? task.cwd,
		assignee: undefined,
	};
	const saveAttempts = (attempts: FactoryAttempt[]) => {
		const perSession = new Map(
			(input.getState().sessionUsage ?? []).map((entry) => [
				entry.sessionId,
				entry.usage,
			]),
		);
		for (const entry of attempts)
			perSession.set(
				entry.sessionId,
				entry.usage ?? perSession.get(entry.sessionId),
			);
		const totals = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: 0,
		};
		for (const usage of perSession.values())
			if (usage) {
				totals.inputTokens += usage.inputTokens;
				totals.outputTokens += usage.outputTokens;
				totals.cacheReadTokens += usage.cacheReadTokens;
				totals.cacheWriteTokens += usage.cacheWriteTokens;
				totals.totalCost += usage.totalCost;
			}
		save({
			attempts,
			usage: {
				totals,
				unknownSessionIds: [
					...new Set([
						...input.getState().sessions.map((entry) => entry.sessionId),
						...perSession.keys(),
					]),
				].filter((id) => !perSession.get(id)),
			},
		});
	};
	const recordAttempt = (attempt: FactoryAttempt) =>
		saveAttempts([
			...(input.getState().attempts ?? []).filter(
				(entry) => entry.id !== attempt.id,
			),
			attempt,
		]);
	const refreshUsage = async () => {
		saveAttempts(input.getState().attempts ?? []);
		const unknown = input.getState().usage?.unknownSessionIds ?? [];
		if (!unknown.length || !runtime.getSessionUsage) return;
		const resolved = await Promise.all(
			unknown.map(async (sessionId) => ({
				sessionId,
				usage: await runtime
					.getSessionUsage?.(sessionId)
					.catch(() => undefined),
			})),
		);
		const previous = new Map(
			(input.getState().sessionUsage ?? []).map((entry) => [
				entry.sessionId,
				entry,
			]),
		);
		for (const entry of resolved) previous.set(entry.sessionId, entry);
		save({ sessionUsage: [...previous.values()] });
		saveAttempts(input.getState().attempts ?? []);
	};
	const execute = async (
		key: string,
		instructions: string,
		agent: FactoryAgent,
		role: "builder" | "reviewer" | "verifier",
		validate?: (summary: string) => unknown,
		workspace: FactoryWorkspace = input.getState().workspace,
	) => {
		for (;;) {
			signal.throwIfAborted();
			const attempts = (input.getState().attempts ?? []).filter(
				(entry) => entry.key === key,
			);
			let attempt = attempts.at(-1);
			if (attempt?.status === "completed")
				return { sessionId: attempt.sessionId, summary: attempt.summary };
			const failures = attempts.filter((entry) => entry.status === "failed");
			if (failures.length > (config.maxRuntimeRetries ?? 2))
				throw new Error(
					`Factory ${role} retry limit reached: ${failures.at(-1)?.error}`,
				);
			const recovering =
				attempt?.status === "intent" || attempt?.status === "running";
			if (!recovering) {
				if (config.maxCostUsd !== undefined) {
					await refreshUsage();
					const activeSessionIds = new Set(
						(input.getState().attempts ?? [])
							.filter(
								(entry) =>
									entry.status === "intent" || entry.status === "running",
							)
							.map((entry) => entry.sessionId),
					);
					if (
						input
							.getState()
							.usage?.unknownSessionIds.some((id) => !activeSessionIds.has(id))
					)
						throw new Error(
							"Factory budget cannot admit another session while earlier usage is unavailable",
						);
					if (
						(input.getState().usage?.totals.totalCost ?? 0) >= config.maxCostUsd
					)
						throw new Error(
							`Factory cost budget ($${config.maxCostUsd}) reached`,
						);
				}
				const sessionId = createSessionId();
				attempt = {
					id: sessionId,
					key,
					role,
					sessionId,
					instructions,
					agent,
					workspace,
					repairRound: input.getState().repairRound,
					createdAt: new Date().toISOString(),
					status: "intent",
				};
				recordAttempt(attempt);
			}
			if (!attempt) throw new Error("Missing Factory attempt");
			const assignedTask = {
				...workTask,
				cwd: attempt.workspace?.path ?? workspace.path,
			};
			let failure: "runtime" | "output" = "runtime";
			let reconciled = !recovering;
			let resultReceived = false;
			try {
				let result: AgendaTaskRuntimeResult | undefined;
				let needsStart = !recovering;
				if (recovering) {
					if (!runtime.reconcileSession)
						throw new Error(
							`Cannot reconcile interrupted Factory session ${attempt.sessionId}`,
						);
					const recovered = await runtime.reconcileSession(attempt.sessionId);
					if (recovered.status === "running")
						throw new Error(
							`Factory session ${attempt.sessionId} is still running`,
						);
					if (recovered.status === "resumable") {
						needsStart = true;
					} else if (recovered.status === "missing") {
						if (attempt.status === "running")
							throw new Error(
								`Interrupted Factory session ${attempt.sessionId} is missing; inspect its workspace before retrying`,
							);
						needsStart = true;
					} else if (
						recovered.status === "completed" ||
						recovered.status === "failed" ||
						recovered.status === "cancelled"
					)
						result = recovered;
					reconciled = true;
				}
				if (needsStart) {
					const session = await runtime.startSession(
						resolveFactoryAgent(assignedTask, attempt.agent),
						run,
						run.requestedByClientId,
						{
							unattended: true,
							factoryRole: role,
							sessionId: attempt.sessionId,
							factoryAgent: attempt.agent,
						},
					);
					attempt = { ...attempt, sessionId: session.sessionId };
				}
				input.sessionStarted(attempt.sessionId);
				if (signal.aborted) {
					await runtime.abortSession(
						attempt.sessionId,
						"Feature workflow cancelled",
					);
					signal.throwIfAborted();
				}
				const sessionId = attempt.sessionId;
				if (
					!input
						.getState()
						.sessions.some((entry) => entry.sessionId === sessionId)
				)
					save({
						sessions: [
							...input.getState().sessions,
							{ sessionId: attempt.sessionId, role },
						],
					});
				if (!result) {
					recordAttempt({ ...attempt, status: "running" });
					result = await runtime.runSession(
						attempt.sessionId,
						resolveFactoryAgent(
							{ ...assignedTask, instructions: attempt.instructions },
							attempt.agent,
						),
						run,
					);
				}
				resultReceived = true;
				attempt = {
					...attempt,
					usage: await runtime
						.getSessionUsage?.(attempt.sessionId)
						.catch(() => undefined),
				};
				signal.throwIfAborted();
				if (result.status !== "completed")
					throw new Error(
						result.error ??
							result.summary ??
							"Factory session did not complete",
					);
				const summary = result.summary ?? "";
				failure = "output";
				validate?.(summary);
				recordAttempt({
					...attempt,
					status: "completed",
					summary,
					completedAt: new Date().toISOString(),
				});
				return { sessionId: attempt.sessionId, summary };
			} catch (error) {
				if (
					signal.aborted ||
					!reconciled ||
					!resultReceived ||
					error instanceof FactoryPersistenceError
				)
					throw error;
				recordAttempt({
					...attempt,
					status: "failed",
					failure,
					error: error instanceof Error ? error.message : String(error),
					completedAt: new Date().toISOString(),
				});
			}
		}
	};

	return {
		execute,
		refreshUsage,
	};
}
