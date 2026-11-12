import {
	type AgendaTaskRecord,
	type AgendaTaskRunRecord,
	createSessionId,
	type FactoryAgent,
	type FactoryAttempt,
	type FactoryRunState,
	type FactoryWorkspace,
	factoryCardCostLimitUsd,
	factorySessionCostUsd,
	factorySpendingLimitReason,
	factoryUnstartedSessionIds,
} from "@cline/shared";
import type {
	AgendaTaskRuntime,
	AgendaTaskRuntimeResult,
} from "./agenda-task-manager";
import { resolveFactoryAgent } from "./factory-agents";
import { FactoryDecisionError } from "./factory-errors";

export class FactoryPersistenceError extends Error {}

/** How often a running session's spend is checked against the limits. */
const FACTORY_SPENDING_POLL_MS = 30_000;

const errorMessage = (error: unknown) =>
	error instanceof Error ? error.message : String(error);

export function createFactorySessionRunner(input: {
	task: AgendaTaskRecord;
	run: AgendaTaskRunRecord;
	runtime: AgendaTaskRuntime;
	signal: AbortSignal;
	getState: () => FactoryRunState;
	save: (patch: Partial<FactoryRunState>) => void;
	sessionStarted: (sessionId: string) => void;
	/** How long to wait for a session whose turn threw to stop running. */
	settlePolling?: { intervalMs: number; timeoutMs: number };
}) {
	const { task, run, runtime, signal } = input;
	const settlePolling = input.settlePolling ?? {
		intervalMs: 1000,
		timeoutMs: 60_000,
	};
	const config = task.factory;
	if (!config) throw new Error("Factory configuration is required");
	// The card's limit covers every run and its scoping, so earlier runs'
	// recorded spend (priorCardCostUsd) counts too. Hands-off cards without
	// their own limit get the built-in one.
	const costLimit = factoryCardCostLimitUsd(config);
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
		const unstarted = factoryUnstartedSessionIds([
			{ attempts, sessions: input.getState().sessions },
		]);
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
				].filter((id) => !perSession.get(id) && !unstarted.has(id)),
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
	const abortQuietly = async (sessionId: string, reason: string) => {
		try {
			await runtime.abortSession(sessionId, reason);
		} catch {
			// Best effort: callers check the runtime's view or give up the session.
		}
	};
	/**
	 * The card's spend: earlier runs, then each session once, running ones at
	 * the usage they report so far. Fails closed: a started session whose
	 * usage is unknown counts a conservative amount (factorySessionCostUsd).
	 */
	const cardSpentUsd = async () => {
		const state = input.getState();
		const attempts = state.attempts ?? [];
		const known = new Map(
			(state.sessionUsage ?? []).map((entry) => [entry.sessionId, entry.usage]),
		);
		for (const entry of attempts)
			if (entry.usage) known.set(entry.sessionId, entry.usage);
		if (runtime.getSessionUsage)
			for (const { sessionId, usage } of await Promise.all(
				attempts
					.filter((entry) => entry.status === "running" && !entry.usage)
					.map(async ({ sessionId }) => ({
						sessionId,
						usage: await runtime
							.getSessionUsage?.(sessionId)
							.catch(() => undefined),
					})),
			))
				if (usage) known.set(sessionId, usage);
		const unstarted = factoryUnstartedSessionIds([state]);
		const sessionIds = new Set([
			...known.keys(),
			...attempts.map((entry) => entry.sessionId),
			...state.sessions.map((entry) => entry.sessionId),
		]);
		let spent = state.priorCardCostUsd ?? 0;
		for (const id of sessionIds)
			spent += factorySessionCostUsd(known.get(id), !unstarted.has(id));
		return spent;
	};
	/** The card's, then the Hub-wide daily, spending limit reason once reached. */
	const spendingLimitReason = async () => {
		if (costLimit !== undefined && (await cardSpentUsd()) >= costLimit)
			return factorySpendingLimitReason(costLimit);
		return runtime.factoryAdmissionBlocker?.();
	};
	/**
	 * Checks spend every FACTORY_SPENDING_POLL_MS while a session runs and
	 * aborts it once a limit is reached; `reason` is then that limit's
	 * sentence. `stop` clears the timer.
	 */
	const watchSpending = (sessionId: string) => {
		const watch = { reason: undefined as string | undefined, stop() {} };
		if (costLimit === undefined && !runtime.factoryAdmissionBlocker)
			return watch;
		let stopped = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const tick = async () => {
			// A failed read leaves the session running; new sessions still
			// fail closed at admission.
			const reason = await spendingLimitReason().catch(() => undefined);
			if (stopped) return;
			if (!reason) {
				timer = setTimeout(tick, FACTORY_SPENDING_POLL_MS);
				return;
			}
			watch.reason = reason;
			await abortQuietly(sessionId, reason);
		};
		timer = setTimeout(tick, FACTORY_SPENDING_POLL_MS);
		watch.stop = () => {
			stopped = true;
			clearTimeout(timer);
		};
		return watch;
	};
	const pause = (ms: number) =>
		new Promise<void>((resolve) => {
			let timer: ReturnType<typeof setTimeout> | undefined;
			const done = () => {
				clearTimeout(timer);
				signal.removeEventListener("abort", done);
				resolve();
			};
			timer = setTimeout(done, ms);
			signal.addEventListener("abort", done, { once: true });
		});
	/**
	 * Reconciles a session whose turn threw, polling while it still reports
	 * running: an aborted turn keeps executing until the runtime unwinds it.
	 * Returns the last status, which is still `running` when the bound passes;
	 * undefined when the runtime cannot reconcile. Reconcile errors propagate.
	 */
	const settleSession = async (sessionId: string) => {
		const reconcile = runtime.reconcileSession;
		if (!reconcile) return undefined;
		const deadline = Date.now() + settlePolling.timeoutMs;
		for (;;) {
			const settled = await reconcile.call(runtime, sessionId);
			const remaining = deadline - Date.now();
			if (settled.status !== "running" || remaining <= 0) return settled;
			await pause(Math.min(settlePolling.intervalMs, remaining));
			if (signal.aborted) return settled;
		}
	};
	/** Lists a session the runtime started (or may have) in the run's `sessions`. */
	const recordSession = (sessionId: string, role: FactoryAttempt["role"]) => {
		if (
			!input.getState().sessions.some((entry) => entry.sessionId === sessionId)
		)
			save({ sessions: [...input.getState().sessions, { sessionId, role }] });
	};
	const execute = async (
		key: string,
		instructions: string,
		agent: FactoryAgent,
		role: "builder" | "reviewer" | "verifier",
		validate?: (summary: string) => unknown,
		workspace: FactoryWorkspace = input.getState().workspace,
		/** A repository stage's session: recorded on the attempt; no role guidance. */
		stageId?: string,
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
				throw new FactoryDecisionError(
					`Factory ${role} retry limit reached: ${failures.at(-1)?.error}`,
				);
			const recovering =
				attempt?.status === "intent" || attempt?.status === "running";
			if (!recovering) {
				if (costLimit !== undefined) await refreshUsage();
				// The card's limit, then the Hub-wide daily limit, which also stops
				// running cards from starting new sessions.
				const limitReached = await spendingLimitReason();
				if (limitReached) throw new FactoryDecisionError(limitReached);
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
					...(stageId ? { stageId } : {}),
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
			let spendingStop: string | undefined;
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
							...(attempt.stageId ? { factoryStage: attempt.stageId } : {}),
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
				recordSession(attempt.sessionId, role);
				if (!result) {
					recordAttempt({ ...attempt, status: "running" });
					const watch = watchSpending(attempt.sessionId);
					try {
						result = await runtime.runSession(
							attempt.sessionId,
							resolveFactoryAgent(
								{ ...assignedTask, instructions: attempt.instructions },
								attempt.agent,
							),
							run,
						);
					} finally {
						watch.stop();
						spendingStop = watch.reason;
					}
				}
				resultReceived = true;
				attempt = {
					...attempt,
					usage: await runtime
						.getSessionUsage?.(attempt.sessionId)
						.catch(() => undefined),
					// What the session ran on; `agent` stays the frozen configuration.
					sessionModel:
						(await runtime
							.getSessionModel?.(attempt.sessionId)
							.catch(() => undefined)) ?? attempt.sessionModel,
				};
				signal.throwIfAborted();
				// Stopped for spending: a decision, never retried automatically.
				if (spendingStop && result.status !== "completed")
					throw new FactoryDecisionError(spendingStop);
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
					error instanceof FactoryPersistenceError
				)
					throw error;
				if (spendingStop) {
					recordAttempt({
						...attempt,
						status: "failed",
						failure,
						error: spendingStop,
						completedAt: new Date().toISOString(),
					});
					throw new FactoryDecisionError(spendingStop);
				}
				// A thrown start or run (hub timeout, transport failure) leaves the
				// session's state unknown. Stop it, then retry only once the runtime
				// confirms it is no longer running, so no second writer shares the
				// worktree.
				if (!resultReceived) {
					await abortQuietly(
						attempt.sessionId,
						`Factory ${role} session failed: ${errorMessage(error)}`,
					);
					let settled: Awaited<ReturnType<typeof settleSession>>;
					try {
						settled = await settleSession(attempt.sessionId);
					} catch {
						throw error;
					}
					// A start that threw may still have created the session: it counts
					// toward spend unless the runtime reports no such session.
					if (settled?.status !== "missing" && !signal.aborted)
						recordSession(attempt.sessionId, role);
					// No reconcile, or still running at the bound: block as before
					// rather than start a second writer.
					if (!settled || signal.aborted || settled.status === "running")
						throw error;
					// The attempt is still intent/running, so the recovery branch
					// adopts the completed result on the next pass.
					if (settled.status === "completed") continue;
				}
				recordAttempt({
					...attempt,
					status: "failed",
					failure,
					error: errorMessage(error),
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
