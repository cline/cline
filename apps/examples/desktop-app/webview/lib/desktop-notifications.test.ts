// @vitest-environment jsdom

import {
	factoryDesignProgressSchema,
	factoryDesignReviewSchema,
	factoryRunStateSchema,
	factoryTaskConfigSchema,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureLocalStorage } from "./test-local-storage";

type EventHandler = (payload: unknown) => void;

const mocks = vi.hoisted(() => ({
	eventHandlers: new Map<string, Set<EventHandler>>(),
	focused: false,
	invoke: vi.fn(),
	isPermissionGranted: vi.fn(),
	requestPermission: vi.fn(),
}));

vi.mock("@/lib/desktop-client", () => ({
	desktopClient: {
		invoke: mocks.invoke,
		subscribe: (eventName: string, handler: EventHandler) => {
			const handlers = mocks.eventHandlers.get(eventName) ?? new Set();
			handlers.add(handler);
			mocks.eventHandlers.set(eventName, handlers);
			return () => handlers.delete(handler);
		},
	},
	isTauriAvailable: () => true,
}));

vi.mock("@tauri-apps/api/window", () => ({
	getCurrentWindow: () => ({
		isFocused: async () => mocks.focused,
	}),
}));

vi.mock("@tauri-apps/plugin-notification", () => ({
	isPermissionGranted: mocks.isPermissionGranted,
	requestPermission: mocks.requestPermission,
}));

function emit(eventName: string, payload: unknown): void {
	for (const handler of mocks.eventHandlers.get(eventName) ?? []) {
		handler(payload);
	}
}

async function importFresh() {
	vi.resetModules();
	return await import("./desktop-notifications");
}

ensureLocalStorage();

beforeEach(() => {
	window.localStorage.clear();
	mocks.eventHandlers.clear();
	mocks.focused = false;
	mocks.invoke.mockReset().mockResolvedValue(undefined);
	mocks.isPermissionGranted.mockReset().mockResolvedValue(true);
	mocks.requestPermission.mockReset().mockResolvedValue("granted");
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("desktop notifications", () => {
	it("does not deduplicate completion notifications across hosts", async () => {
		const { watchDesktopNotifications } = await importFresh();
		const stop = watchDesktopNotifications();
		for (const environmentId of ["local", "remote"]) {
			emit("chat_session_ended", {
				sessionId: "same-id",
				environmentId,
				reason: "completed",
			});
			emit("chat_session_ended", {
				sessionId: "same-id",
				environmentId,
				reason: "completed",
			});
		}
		await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
		stop();
	});

	it("notifies once when a background approval remains in state snapshots", async () => {
		const { watchDesktopNotifications } = await importFresh();
		const stop = watchDesktopNotifications();
		const payload = {
			sessionId: "session-1",
			items: [
				{
					requestId: "approval-1",
					toolName: "run_commands",
				},
			],
		};

		emit("tool_approval_state", payload);
		emit("tool_approval_state", payload);

		await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
		expect(mocks.invoke).toHaveBeenCalledWith("show_session_notification", {
			title: "Approval needed",
			body: "run_commands is waiting for your approval.",
			sessionId: "session-1",
			sound: undefined,
		});
		stop();
	});

	it("deduplicates chat completion and session-ended terminal events", async () => {
		const { watchDesktopNotifications } = await importFresh();
		const stop = watchDesktopNotifications();

		emit("chat_event", {
			sessionId: "session-2",
			stream: "chat_done",
			chunk: JSON.stringify({ reason: "completed" }),
		});
		emit("chat_session_ended", {
			sessionId: "session-2",
			reason: "completed",
		});

		await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
		expect(mocks.invoke).toHaveBeenCalledWith(
			"show_session_notification",
			expect.objectContaining({
				title: "Task completed",
				sessionId: "session-2",
			}),
		);
		stop();
	});

	it("does not notify while the native window is focused", async () => {
		mocks.focused = true;
		const { watchDesktopNotifications } = await importFresh();
		const stop = watchDesktopNotifications();

		emit("ask_question_requested", {
			requestId: "question-1",
			sessionId: "session-3",
			question: "Which branch should I use?",
		});

		await new Promise((resolve) => window.setTimeout(resolve, 0));
		expect(mocks.invoke).not.toHaveBeenCalled();
		stop();
	});

	it("routes questions to their session and applies the event sound setting", async () => {
		vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
		);
		const {
			DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
			watchDesktopNotifications,
			writeDesktopNotificationSettings,
		} = await importFresh();
		writeDesktopNotificationSettings({
			...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
			questionAsked: { enabled: true, sound: true },
		});
		const stop = watchDesktopNotifications();

		emit("ask_question_requested", {
			requestId: "question-2",
			sessionId: "session-4",
			question: "Which branch should I use?",
		});

		await vi.waitFor(() =>
			expect(mocks.invoke).toHaveBeenCalledWith("show_session_notification", {
				title: "Cline has a question",
				body: "Which branch should I use?",
				sessionId: "session-4",
				sound: "Default",
			}),
		);
		stop();
	});

	it("reports the default permission state when native permission is undecided", async () => {
		mocks.isPermissionGranted.mockResolvedValue(false);
		vi.stubGlobal("Notification", undefined);
		const { getDesktopNotificationPermission } = await importFresh();

		await expect(getDesktopNotificationPermission()).resolves.toBe("default");
	});

	it("deduplicates session errors and includes their detail", async () => {
		const { watchDesktopNotifications } = await importFresh();
		const stop = watchDesktopNotifications();

		emit("chat_event", {
			sessionId: "session-5",
			stream: "chat_done",
			chunk: JSON.stringify({
				reason: "error",
				text: "The provider is unavailable.",
			}),
		});
		emit("chat_session_ended", {
			sessionId: "session-5",
			reason: "error",
		});

		await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
		expect(mocks.invoke).toHaveBeenCalledWith(
			"show_session_notification",
			expect.objectContaining({
				title: "Task failed",
				body: "The provider is unavailable.",
				sessionId: "session-5",
			}),
		);
		stop();
	});

	describe("Factory task attention", () => {
		const factory = factoryTaskConfigSchema.parse({
			checks: [{ name: "API", command: "bun test", kind: "api" }],
			acceptanceCriteria: [
				{ id: "titles", text: "Title search", check: "API" },
			],
		});
		const factoryTask = (overrides: Record<string, unknown> = {}) => ({
			taskId: "task-1",
			title: "Search notes",
			instructions: "Search note titles.",
			status: "in_progress",
			revision: 2,
			factory,
			...overrides,
		});
		const progress = (
			revision: number,
			phase: string,
			agents: Record<string, unknown> = {},
		) =>
			factoryDesignProgressSchema.parse({
				revision,
				repairRound: 0,
				agents,
				designerSessionId: "designer",
				findings: [],
				phase,
				reviewerSessions: [{ reviewerIndex: 0, sessionId: "plan-reviewer" }],
				reviews: [],
			});
		const notifications = () =>
			mocks.invoke.mock.calls
				.filter(([command]) => command === "show_session_notification")
				.map(([, args]) => args);
		const settle = () =>
			new Promise((resolve) => window.setTimeout(resolve, 0));

		it("notifies once per question and again for the next question", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			const question = (questionId: string, status = "pending") => ({
				questionId,
				revision: 2,
				status,
				question: "Which list should search cover?",
				sessionId: "designer-session",
			});
			const pending = {
				task: factoryTask({
					status: "pending_approval",
					factoryQuestions: [question("q1")],
				}),
			};
			emit("task.updated", pending);
			// A redelivered snapshot, such as after a reconnect, is the same episode.
			emit("task.updated", pending);
			emit("task.run.started", pending);
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			expect(notifications()[0]).toEqual({
				title: "Factory needs your answer",
				body: "Search notes: Which list should search cover?",
				factoryTaskId: "task-1",
				sound: undefined,
			});
			emit("task.updated", {
				task: factoryTask({
					status: "pending_approval",
					factoryQuestions: [question("q1", "answered"), question("q2")],
				}),
			});
			await vi.waitFor(() => expect(notifications()).toHaveLength(2));
			stop();
		});

		it("notifies for each reviewed plan revision but not while scoping", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			const plan = (revision: number, phase: string) => ({
				task: factoryTask({
					status: "pending_approval",
					revision,
					factoryDesignProgress: progress(revision, phase),
				}),
			});
			emit("task.updated", plan(2, "reviewing"));
			emit("task.updated", plan(2, "complete"));
			emit("task.updated", plan(2, "complete"));
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			expect(notifications()[0]).toMatchObject({
				title: "Plan ready for your approval",
				factoryTaskId: "task-1",
			});
			emit("task.updated", plan(3, "complete"));
			await vi.waitFor(() => expect(notifications()).toHaveLength(2));
			stop();
		});

		it("asks for approval, not a failure decision, when automatic approval is waiting", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			const waiting = {
				task: factoryTask({
					status: "pending_approval",
					factory: { ...factory, approval: "automatic" },
					factoryDesignProgress: progress(2, "complete"),
					error:
						"Automatic approval is waiting: Implementer model test-provider/gone is not available",
				}),
			};
			emit("task.updated", waiting);
			emit("task.updated", waiting);
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			await settle();
			expect(notifications()).toEqual([
				{
					title: "Plan waiting for your approval",
					body: "Search notes: automatic approval is waiting. Implementer model test-provider/gone is not available",
					factoryTaskId: "task-1",
					sound: undefined,
				},
			]);
			stop();
		});

		it("names the draft PR when a delivered result has one", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			emit("task.run.completed", {
				task: factoryTask({ status: "completed", lastRunId: "run-1" }),
				run: {
					runId: "run-1",
					taskRevision: 2,
					factory: {
						phase: "ready",
						candidate: { commit: "abc" },
						pullRequestUrl: "https://github.com/example/notes/pull/7",
					},
				},
			});
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			expect(notifications()[0]).toMatchObject({
				title: "Draft PR ready for your review",
				body: "Search notes passed its checks and reviews. Factory opened a draft PR.",
			});
			stop();
		});

		it("asks for review with the reason when core requires it at delivery", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			emit("task.run.completed", {
				task: factoryTask({ status: "completed", lastRunId: "run-1" }),
				run: {
					runId: "run-1",
					taskRevision: 2,
					factory: {
						phase: "ready",
						candidate: { commit: "abc" },
						pullRequestUrl: "https://github.com/example/notes/pull/7",
						humanReview: { required: true, reason: "shared contract" },
					},
				},
			});
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			expect(notifications()[0]).toMatchObject({
				title: "Factory needs your review",
				body: "Search notes: Factory asks for your review: touches a shared contract.",
			});
			stop();
		});

		it("says the draft PR is open when a run stops with unresolved review findings", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			emit("task.run.failed", {
				task: factoryTask({
					status: "failed",
					lastRunId: "run-1",
					error: "Repair limit (2) reached; the draft PR stays open.",
				}),
				run: {
					runId: "run-1",
					taskRevision: 2,
					factory: {
						phase: "blocked",
						candidate: { commit: "abc" },
						pullRequestUrl: "https://github.com/example/notes/pull/7",
						humanReview: {
							required: true,
							reason: "review findings unresolved",
						},
						unresolvedFindings: {
							commit: "abc",
							findings: ["Reviewer 1: a", "Reviewer 1: b", "Reviewer 1: c"],
							pullRequestOpen: true,
						},
					},
				},
			});
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			expect(notifications()[0]).toMatchObject({
				title: "Draft PR open with review findings",
				body: "Search notes: Draft PR open · reviewer has 3 unresolved findings.",
			});
			stop();
		});

		it("does not take a finished later run for the automatic retry", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			const handsOff = factoryTaskConfigSchema.parse({
				autonomy: "hands_off",
				approval: "automatic",
				publishPullRequest: true,
			});
			const recovery = {
				attempts: 1,
				reason: "Provider unavailable",
				at: "2026-01-01T00:05:00Z",
			};
			emit("task.run.failed", {
				task: factoryTask({
					status: "failed",
					factory: handsOff,
					error: "Provider unavailable",
					// Recorded no later than the schedule, as a skewed clock can.
					updatedAt: "2026-01-01T00:05:00Z",
					lastRunId: "run-3",
				}),
				run: {
					runId: "run-3",
					taskRevision: 2,
					createdAt: "2026-01-01T00:09:00Z",
					status: "failed",
					factory: { phase: "blocked", autoRecovery: recovery },
				},
			});
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			expect(notifications()[0]).toMatchObject({
				title: "Factory work stopped",
			});
			stop();
		});

		it("asks once to confirm a designer conclusion per revision and ends the episode on revision or cancellation", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			const concluded = (
				revision: number,
				conclusion: Record<string, unknown>,
				overrides: Record<string, unknown> = {},
			) => ({
				task: factoryTask({
					status: "pending_approval",
					revision,
					factoryDesignProgress: factoryDesignProgressSchema.parse({
						revision,
						repairRound: 0,
						agents: {},
						designerSessionId: "designer",
						findings: [],
						phase: "complete",
						reviewerSessions: [],
						reviews: [],
						conclusion,
					}),
					...overrides,
				}),
			});
			const fixed = {
				outcome: "already_fixed",
				rationale: "Search already covers titles.",
				evidence: ["src/search.ts:12"],
			};
			emit("task.updated", concluded(2, fixed));
			emit("task.updated", concluded(2, fixed));
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			expect(notifications()[0]).toEqual({
				title: "No build needed — confirm",
				body: "Search notes: designer concluded already fixed.",
				factoryTaskId: "task-1",
				sound: undefined,
			});
			// Cancelling ends the episode; the same revision asks again if reopened.
			emit("task.updated", concluded(2, fixed, { status: "cancelled" }));
			await settle();
			expect(notifications()).toHaveLength(1);
			emit("task.updated", concluded(2, fixed));
			await vi.waitFor(() => expect(notifications()).toHaveLength(2));
			// Revising the brief discards the conclusion and designs again; a new
			// conclusion asks again.
			emit("task.updated", {
				task: factoryTask({
					status: "pending_approval",
					revision: 3,
					factoryDesignProgress: progress(3, "designing"),
				}),
			});
			await settle();
			expect(notifications()).toHaveLength(2);
			emit(
				"task.updated",
				concluded(4, {
					outcome: "duplicate",
					rationale: "Another card covers this.",
					evidence: ["task-9"],
					duplicateOf: "task-9",
				}),
			);
			await vi.waitFor(() => expect(notifications()).toHaveLength(3));
			expect(notifications()[2]).toMatchObject({
				title: "No build needed — confirm",
				body: "Search notes: designer concluded duplicate of task-9.",
			});
			// A conclusion is never offered as a plan to approve.
			expect(
				notifications().filter(
					(args) =>
						(args as { title?: string }).title ===
						"Plan ready for your approval",
				),
			).toHaveLength(0);
			stop();
		});

		it("asks to confirm a conclusion on an approved card instead of leaving it silent", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			emit("task.updated", {
				task: factoryTask({
					status: "approved",
					factoryDesignProgress: factoryDesignProgressSchema.parse({
						revision: 2,
						repairRound: 0,
						agents: {},
						designerSessionId: "designer",
						findings: [],
						phase: "complete",
						reviewerSessions: [],
						reviews: [],
						conclusion: {
							outcome: "no_change",
							rationale: "The requested behavior is already the default.",
							evidence: ["docs/search.md:3"],
						},
					}),
				}),
			});
			await vi.waitFor(() =>
				expect(
					notifications().some(
						(args) =>
							(args as { body?: string }).body ===
							"Search notes: designer concluded no change needed.",
					),
				).toBe(true),
			);
			stop();
		});

		it("asks for plan approval only once the plan meets the approval gate", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			const reviewed = progress(2, "complete", { planReviewers: [{}] });
			const pending = (overrides: Record<string, unknown>) => ({
				task: factoryTask({
					status: "pending_approval",
					factoryDesignProgress: reviewed,
					...overrides,
				}),
			});
			const factoryDesignReview = factoryDesignReviewSchema.parse({
				revision: 2,
				reviews: [
					{
						reviewerIndex: 0,
						sessionId: "plan-reviewer",
						review: {
							verdict: "pass",
							summary: "Plan is complete.",
							findings: [],
						},
					},
				],
			});
			// Older scoping without named criteria cannot be approved.
			emit(
				"task.updated",
				pending({
					factoryDesignReview,
					factory: factoryTaskConfigSchema.parse({
						...factory,
						acceptanceCriteria: undefined,
					}),
				}),
			);
			// The plan reviewer has not reported on this revision.
			emit("task.updated", pending({}));
			await settle();
			expect(notifications()).toHaveLength(0);
			const passed = pending({ factoryDesignReview });
			emit("task.updated", passed);
			emit("task.updated", passed);
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			expect(notifications()[0]).toMatchObject({
				title: "Plan ready for your approval",
			});
			stop();
		});

		it("keeps a follow-up stop active through updates without its run and notifies a later stop", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			const completed = factoryTask({
				status: "completed",
				lastRunId: "run-1",
			});
			const run = (phase: string) => ({
				runId: "run-1",
				taskRevision: 2,
				factory: { phase, candidate: { commit: "abc" } },
			});
			emit("task.updated", { task: completed, run: run("blocked") });
			// Spec and question updates carry no run: no evidence the stop ended.
			emit("task.updated", { task: completed });
			emit("task.updated", { task: completed, run: run("blocked") });
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			await settle();
			expect(notifications()).toHaveLength(1);
			emit("task.updated", { task: completed, run: run("watching") });
			emit("task.updated", { task: completed, run: run("blocked") });
			await vi.waitFor(() => expect(notifications()).toHaveLength(2));
			expect(notifications()[1]).toMatchObject({
				title: "Factory work stopped",
			});
			stop();
		});

		it("treats a blocked run and its failure as one stop, and notifies a ready result", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			const run = (phase: string, extra: Record<string, unknown> = {}) => ({
				runId: "run-1",
				taskRevision: 2,
				factory: {
					phase,
					candidate: { commit: "abc" },
					sessions: [{ sessionId: "builder-1" }],
					...extra,
				},
			});
			emit("task.updated", {
				task: factoryTask({ currentRunId: "run-1" }),
				run: run("blocked"),
			});
			emit("task.run.failed", {
				task: factoryTask({
					status: "failed",
					lastRunId: "run-1",
					error: "Provider error: request id 123 failed",
				}),
				run: run("blocked"),
			});
			await vi.waitFor(() => expect(notifications()).toHaveLength(1));
			expect(notifications()[0]).toEqual({
				title: "Factory work stopped",
				body: "Search notes needs your decision before it can continue.",
				factoryTaskId: "task-1",
				sound: undefined,
			});

			const ready = {
				task: factoryTask({ status: "completed", lastRunId: "run-2" }),
				run: { ...run("ready"), runId: "run-2" },
			};
			emit("task.run.completed", ready);
			emit("task.updated", ready);
			emit("task.updated", { task: ready.task });
			emit("task.updated", ready);
			await vi.waitFor(() => expect(notifications()).toHaveLength(2));
			expect(notifications()[1]).toMatchObject({
				title: "Factory result ready",
				factoryTaskId: "task-1",
			});
			emit("task.updated", {
				...ready,
				run: {
					...ready.run,
					factory: { ...ready.run.factory, humanApproval: { commit: "abc" } },
				},
			});
			await settle();
			expect(notifications()).toHaveLength(2);
			stop();
		});

		describe("PR follow-up outcomes", () => {
			const task = factoryTask({ status: "completed", lastRunId: "run-1" });
			const passed = { status: "passed", headCommit: "abc", checks: [] };
			const watch = (paused: boolean) => ({
				headCommit: "abc",
				paused,
				handledFeedbackIds: [],
			});
			const approved = {
				humanApproval: { commit: "abc", approvedAt: "2026-01-02T00:00:00Z" },
			};
			const update = (state: Record<string, unknown>) =>
				emit("task.updated", {
					task,
					run: {
						runId: "run-1",
						taskRevision: 2,
						factory: factoryRunStateSchema.parse({
							repairRound: 0,
							workspace: {
								path: "/candidate",
								branch: "feat/search",
								baseBranch: "main",
								baseCommit: "base",
							},
							sessions: [],
							candidate: { commit: "abc", checks: [], reviews: [] },
							...state,
						}),
					},
				});

			it("notifies a paused follow-up once, and nothing for a note on the delivery", async () => {
				const { watchDesktopNotifications } = await importFresh();
				const stop = watchDesktopNotifications();
				update({
					phase: "watching",
					pullRequestWatch: watch(false),
					pullRequestChecks: passed,
				});
				const paused = {
					phase: "ready",
					pullRequestWatch: watch(true),
					pullRequestChecks: passed,
				};
				update(paused);
				emit("task.updated", { task });
				update(paused);
				// An older Hub recorded the note as a stop; it reads as the
				// delivery it is, so it adds no episode (a stop or a decision).
				const finding = {
					...paused,
					phase: "blocked",
					error: "Human sample finding: Empty titles still match.",
					audit: {
						selectedAt: "2026-01-02T00:00:00Z",
						finding: "Empty titles still match.",
						reviewedAt: "2026-01-02T00:00:00Z",
					},
				};
				update(finding);
				emit("task.updated", { task });
				update(finding);
				await vi.waitFor(() => expect(notifications()).toHaveLength(2));
				await settle();
				expect(notifications()).toEqual([
					expect.objectContaining({ title: "Factory result ready" }),
					{
						title: "Factory PR follow-up paused",
						body: "Search notes is waiting for you to resume PR follow-up.",
						factoryTaskId: "task-1",
						sound: undefined,
					},
				]);
				stop();
			});

			it("stays quiet for an approved result until its follow-up stops", async () => {
				const { watchDesktopNotifications } = await importFresh();
				const stop = watchDesktopNotifications();
				update({
					...approved,
					phase: "watching",
					pullRequestWatch: watch(false),
					pullRequestChecks: passed,
				});
				update({ ...approved, phase: "ready", pullRequestWatch: watch(true) });
				await settle();
				expect(notifications()).toHaveLength(0);
				const blocked = {
					...approved,
					phase: "blocked",
					error:
						"The PR branch changed outside this feature. Review its new head before resuming.",
					pullRequestWatch: watch(false),
				};
				update(blocked);
				update(blocked);
				await vi.waitFor(() => expect(notifications()).toHaveLength(1));
				await settle();
				expect(notifications()[0]).toMatchObject({
					title: "Factory work stopped",
				});
				stop();
			});
		});

		it("lets the task own role-session attention while ordinary sessions still notify", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			emit("task.updated", {
				task: factoryTask({ currentRunId: "run-1" }),
				run: {
					runId: "run-1",
					taskRevision: 2,
					factory: {
						phase: "implementing",
						sessions: [{ sessionId: "builder-1" }],
					},
				},
			});
			emit("chat_session_ended", {
				sessionId: "builder-1",
				reason: "completed",
			});
			emit("chat_session_ended", { sessionId: "builder-1", reason: "error" });
			emit("ask_question_requested", {
				requestId: "live-question",
				sessionId: "builder-1",
				question: "Keep the old API?",
			});
			// An agent intake card records its creator; that chat keeps its own
			// attention. It has no run and no run IDs yet.
			emit("task.created", {
				task: factoryTask({
					taskId: "intake-1",
					status: "pending_approval",
					originSessionId: "chat-1",
					factory: factoryTaskConfigSchema.parse({
						intake: { source: "nightly-audit", key: "issue-42" },
					}),
				}),
			});
			emit("ask_question_requested", {
				requestId: "chat-question",
				sessionId: "chat-1",
				question: "Which branch?",
			});
			emit("chat_session_ended", { sessionId: "chat-1", reason: "completed" });
			await vi.waitFor(() => expect(notifications()).toHaveLength(3));
			expect(notifications()).toEqual([
				{
					title: "Cline has a question",
					body: "Keep the old API?",
					factoryTaskId: "task-1",
					sound: undefined,
				},
				{
					title: "Cline has a question",
					body: "Which branch?",
					sessionId: "chat-1",
					sound: undefined,
				},
				{
					title: "Task completed",
					body: "Cline finished working and the result is ready.",
					sessionId: "chat-1",
					sound: undefined,
				},
			]);
			stop();
		});

		it("ignores non-Factory, archived and closed tasks", async () => {
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			emit("task.updated", {
				task: { ...factoryTask({ status: "failed" }), factory: undefined },
			});
			emit("task.updated", {
				task: factoryTask({ status: "failed", archivedAt: "2026-01-01" }),
			});
			emit("task.updated", { task: factoryTask({ status: "cancelled" }) });
			await settle();
			expect(notifications()).toHaveLength(0);
			stop();
		});

		it("does not send a notification when OS permission is denied", async () => {
			mocks.isPermissionGranted.mockResolvedValue(false);
			vi.stubGlobal("Notification", { permission: "denied" });
			const { watchDesktopNotifications } = await importFresh();
			const stop = watchDesktopNotifications();
			emit("task.updated", { task: factoryTask({ status: "failed" }) });
			await settle();
			await settle();
			expect(mocks.requestPermission).not.toHaveBeenCalled();
			expect(notifications()).toHaveLength(0);
			stop();
		});
	});

	it("persists independent event and sound preferences", async () => {
		const {
			DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
			readDesktopNotificationSettings,
			writeDesktopNotificationSettings,
		} = await importFresh();
		writeDesktopNotificationSettings({
			...DEFAULT_DESKTOP_NOTIFICATION_SETTINGS,
			approvalNeeded: { enabled: false, sound: true },
		});

		expect(readDesktopNotificationSettings().approvalNeeded).toEqual({
			enabled: false,
			sound: true,
		});
		expect(readDesktopNotificationSettings().taskCompletion).toEqual({
			enabled: true,
			sound: false,
		});
	});
});
