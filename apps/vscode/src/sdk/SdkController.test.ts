import { describe, expect, it, vi } from "vitest"
import { telemetryService } from "@/services/telemetry"
import { isClineManagedProvider } from "@/shared/utils/cline"
import { Controller as SdkController } from "./SdkController"
import { type RetryAttemptInfo, SdkApiRetryCoordinator } from "./sdk-api-retry-coordinator"
import type { SdkTurnOutcome } from "./sdk-session-lifecycle"
import { resolveWorkspaceManagerPaths, resolveWorkspaceRootPath } from "./workspace-root"

// handleTurnSettled and reDriveAutoRetry are private; tests invoke them on fake
// controllers through this typed view of the prototype.
const privateControllerProto = SdkController.prototype as unknown as {
	handleTurnSettled: (this: never, sessionId: string, outcome: SdkTurnOutcome) => Promise<void>
	reDriveAutoRetry: (this: never, sessionId: string, isCancelled: () => boolean) => Promise<void>
	emitAutoRetryScheduled: (this: never, info: RetryAttemptInfo) => void
	settleAbandonedRetryPhase: (this: never) => void
}

describe("isClineManagedProvider", () => {
	it("treats both Cline account providers as Cline providers", () => {
		expect(isClineManagedProvider("cline")).toBe(true)
		expect(isClineManagedProvider("cline-pass")).toBe(true)
		expect(isClineManagedProvider("anthropic")).toBe(false)
		expect(isClineManagedProvider(undefined)).toBe(false)
	})
})

describe("resolveWorkspaceRootPath", () => {
	it("uses the first non-empty workspace path when available", () => {
		expect(resolveWorkspaceRootPath(["", "/workspace"], "/Users/tester/Desktop")).toBe("/workspace")
	})

	it("falls back to Desktop when no workspace folder is open", () => {
		expect(resolveWorkspaceRootPath([], "/Users/tester/Desktop")).toBe("/Users/tester/Desktop")
	})
})

vi.mock("@/services/telemetry", () => ({
	telemetryService: {
		captureRemoteConfigSessionGate: vi.fn(),
	},
}))

const { buildBaseStateMock } = vi.hoisted(() => ({
	buildBaseStateMock: vi.fn(async () => ({ taskHistory: [] })),
}))
vi.mock("@core/controller/state/getStateToPostToWebview", () => ({
	getStateToPostToWebview: buildBaseStateMock,
}))

describe("SDK remote-config coordination", () => {
	it("posts the current remote-config revision to the webview", async () => {
		const controller = {
			stateManager: {
				getGlobalSettingsKey: () => undefined,
				getRemoteConfigSettings: () => ({}),
				setGlobalState: vi.fn(),
			},
			backgroundCommandRunning: false,
			backgroundCommandTaskId: undefined,
			foregroundCommands: { isRunning: false },
			isRemoteConfigAvailable: true,
			currentRemoteConfigRevision: 7,
			ensureWorkspaceManager: async () => undefined,
			taskHistory: { listHistory: async () => [] },
			sessions: { getActiveSession: () => undefined },
			turnStateTracker: { get: () => undefined },
			messageTranslatorState: { getMinter: () => ({ epoch: 1, nextSeq: () => 1 }) },
		}

		await SdkController.prototype.getStateToPostToWebview.call(controller as never)

		expect(buildBaseStateMock).toHaveBeenCalledWith(
			expect.objectContaining({ isRemoteConfigAvailable: true, currentRemoteConfigRevision: 7 }),
		)
	})

	it("keys refreshes by the current user and organization", async () => {
		const refresh = vi.fn().mockResolvedValue(true)
		const controller = {
			authService: {
				getInfo: () => ({ user: { uid: "user-1" } }),
				getActiveOrganizationId: () => "org-1",
			},
			remoteConfigRefreshCoordinator: { refresh },
		}

		await SdkController.prototype.refreshRemoteConfig.call(controller as never)

		expect(refresh).toHaveBeenCalledWith("user-1:org-1", {})
	})

	it("uses a stable signed-out identity so startup refresh can settle", async () => {
		const refresh = vi.fn().mockResolvedValue(true)
		const controller = {
			authService: {
				getInfo: () => ({}),
				getActiveOrganizationId: () => null,
			},
			remoteConfigRefreshCoordinator: { refresh },
		}

		await SdkController.prototype.refreshRemoteConfig.call(controller as never)

		expect(refresh).toHaveBeenCalledWith("signed-out:no-org", {})
	})

	it("refreshes remote config after login before posting authenticated state", async () => {
		const events: string[] = []
		const controller = {
			authService: { handleAuthCallback: vi.fn(async () => events.push("auth")) },
			refreshRemoteConfig: vi.fn(async () => {
				events.push("refresh")
				return true
			}),
			postStateToWebview: vi.fn(async () => events.push("post")),
		}

		await SdkController.prototype.handleAuthCallback.call(controller as never, "token", "cline")

		expect(events).toEqual(["auth", "refresh", "post"])
	})

	it("rematerializes policy and ends the active session after a managed toggle", async () => {
		const events: string[] = []
		const controller = {
			refreshRemoteConfig: vi.fn(async () => {
				events.push("refresh")
				return true
			}),
			sessions: {
				endActiveSession: vi.fn(async () => {
					events.push("end")
				}),
			},
			postStateToWebview: vi.fn(async () => events.push("post")),
		}

		await SdkController.prototype.rematerializeRemoteConfig.call(controller as never)

		expect(events).toEqual(["refresh", "end", "post"])
		expect(controller.sessions.endActiveSession).toHaveBeenCalledWith("remoteConfigToggle", { awaitStop: true })
	})

	it("allows the current organization to start with its last known-good policy after a transient failure", async () => {
		const controller = {
			waitForInitialRemoteConfig: vi.fn().mockResolvedValue(undefined),
			refreshRemoteConfig: vi.fn().mockResolvedValue(false),
			authService: { getActiveOrganizationId: () => "org-current" },
			remoteConfigBundle: { metadata: { organizationId: "org-current" } },
		}

		await expect(
			SdkController.prototype["ensureRemoteConfigForSessionStart"].call(controller as never),
		).resolves.toBeUndefined()
		expect(telemetryService.captureRemoteConfigSessionGate).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "last_known_good", managed: true }),
		)
	})

	it("does not block session start for users without an active organization when refresh fails", async () => {
		const controller = {
			waitForInitialRemoteConfig: vi.fn().mockResolvedValue(undefined),
			refreshRemoteConfig: vi.fn().mockResolvedValue(false),
			authService: { getActiveOrganizationId: () => null },
			stateManager: { getGlobalStateKey: () => undefined },
			remoteConfigBundle: undefined,
		}

		await expect(
			SdkController.prototype["ensureRemoteConfigForSessionStart"].call(controller as never),
		).resolves.toBeUndefined()
		expect(telemetryService.captureRemoteConfigSessionGate).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "unmanaged", managed: false }),
		)
	})

	it("does not block unmanaged session start when the refresh rejects instead of returning false", async () => {
		const controller = {
			waitForInitialRemoteConfig: vi.fn().mockResolvedValue(undefined),
			refreshRemoteConfig: vi.fn().mockRejectedValue(new Error("EACCES: permission denied")),
			authService: { getActiveOrganizationId: () => null },
			stateManager: { getGlobalStateKey: () => undefined },
			remoteConfigBundle: undefined,
		}

		await expect(
			SdkController.prototype["ensureRemoteConfigForSessionStart"].call(controller as never),
		).resolves.toBeUndefined()
		expect(telemetryService.captureRemoteConfigSessionGate).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "unmanaged", managed: false }),
		)
	})

	it("blocks session start when the install was managed but the identity cannot be resolved", async () => {
		const controller = {
			waitForInitialRemoteConfig: vi.fn().mockResolvedValue(undefined),
			refreshRemoteConfig: vi.fn().mockResolvedValue(false),
			authService: { getActiveOrganizationId: () => null },
			stateManager: { getGlobalStateKey: () => "org-previous" },
			remoteConfigBundle: undefined,
		}

		await expect(SdkController.prototype["ensureRemoteConfigForSessionStart"].call(controller as never)).rejects.toThrow(
			"Could not verify organization policy",
		)
		expect(telemetryService.captureRemoteConfigSessionGate).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "blocked", managed: true }),
		)
	})

	it("blocks session start when current organization policy cannot be verified", async () => {
		const controller = {
			waitForInitialRemoteConfig: vi.fn().mockResolvedValue(undefined),
			refreshRemoteConfig: vi.fn().mockResolvedValue(false),
			authService: { getActiveOrganizationId: () => "org-new" },
			remoteConfigBundle: { metadata: { organizationId: "org-old" } },
		}

		await expect(SdkController.prototype["ensureRemoteConfigForSessionStart"].call(controller as never)).rejects.toThrow(
			"Could not verify organization policy",
		)
		expect(telemetryService.captureRemoteConfigSessionGate).toHaveBeenCalledWith(
			expect.objectContaining({ outcome: "blocked", managed: true }),
		)
	})

	it("does not enter task startup until initial remote config is ready", async () => {
		let finishPolicyCheck!: () => void
		const policyReady = new Promise<void>((resolve) => {
			finishPolicyCheck = resolve
		})
		const events: string[] = []
		const initTask = vi.fn(async () => {
			events.push("task")
			return "task-id"
		})
		const controller = {
			waitForInitialRemoteConfig: vi.fn(async () => {
				await policyReady
				events.push("policy")
			}),
			turnStateTracker: { set: vi.fn() },
			messageTranslatorState: { clearTurnOutcome: vi.fn() },
			taskStart: { initTask },
		}

		const taskPromise = SdkController.prototype.initTask.call(controller as never, "start immediately")
		await Promise.resolve()
		expect(initTask).not.toHaveBeenCalled()
		expect(controller.turnStateTracker.set).not.toHaveBeenCalled()

		finishPolicyCheck()
		const taskId = await taskPromise

		expect(taskId).toBe("task-id")
		expect(events).toEqual(["policy", "task"])
		expect(initTask).toHaveBeenCalledWith("start immediately", undefined, undefined, undefined, undefined)
	})

	it("waits for initial remote config before resuming an existing task", async () => {
		const events: string[] = []
		const controller = {
			waitForInitialRemoteConfig: vi.fn(async () => events.push("policy")),
			turnStateTracker: { set: vi.fn() },
			messageTranslatorState: { clearTurnOutcome: vi.fn() },
			taskStart: { reinitExistingTaskFromId: vi.fn(async () => events.push("resume")) },
		}

		await SdkController.prototype.reinitExistingTaskFromId.call(controller as never, "task-id")

		expect(events).toEqual(["policy", "resume"])
	})
})

describe("resolveWorkspaceManagerPaths", () => {
	it("returns the host's workspace folder paths, dropping blank entries", () => {
		expect(resolveWorkspaceManagerPaths(["/workspace", "  ", "/other"], "/Users/tester/Desktop")).toEqual([
			"/workspace",
			"/other",
		])
	})

	it("falls back to a single root when no workspace folder is open", () => {
		// Legacy-parity: an empty VS Code window must still yield a usable root
		// so @-mention file search doesn't fail with workspace_unavailable.
		expect(resolveWorkspaceManagerPaths([], "/Users/tester/Desktop")).toEqual(["/Users/tester/Desktop"])
		expect(resolveWorkspaceManagerPaths(undefined, "/Users/tester/Desktop")).toEqual(["/Users/tester/Desktop"])
		expect(resolveWorkspaceManagerPaths(["", "   "], "/Users/tester/Desktop")).toEqual(["/Users/tester/Desktop"])
	})

	it("prefers real workspace folders over the fallback", () => {
		expect(resolveWorkspaceManagerPaths(["/workspace"], "/Users/tester/Desktop")).toEqual(["/workspace"])
	})

	it("returns no roots when the fallback is also unavailable", () => {
		expect(resolveWorkspaceManagerPaths([], undefined)).toEqual([])
		expect(resolveWorkspaceManagerPaths([], "  ")).toEqual([])
	})
})

describe("turn failure boundary (handleTurnSettled)", () => {
	/** Fake controller surface exercised by handleTurnSettled. */
	function makeBoundaryFake(overrides: Record<string, unknown> = {}) {
		return {
			diffEdits: { discardAllPreviews: vi.fn() },
			apiRetry: { reset: vi.fn(), cancel: vi.fn(), handleSendError: vi.fn(() => true) },
			postStateToWebview: vi.fn(() => Promise.resolve()),
			getSessionProviderId: vi.fn(() => "anthropic"),
			getActiveProviderId: vi.fn(() => "anthropic"),
			isClineBalanceError: vi.fn(() => false),
			classifyAutoRetryFailure: vi.fn(() => ({ retryable: true })),
			captureProviderFailure: vi.fn(),
			emitClineAuthError: vi.fn(),
			emitClineBalanceError: vi.fn(),
			emitAgentError: vi.fn(),
			turnStateTracker: { set: vi.fn() },
			settleAbandonedRetryPhase: vi.fn(),
			interactions: {
				settleAutoRecovery: vi.fn(),
				resetMistakeEscalation: vi.fn(),
				// Guard used by the live-marker settle path; inert by default.
				isAutoRecoveryActive: vi.fn((): boolean => false),
				beginAutoRecoveryCountdown: vi.fn(),
				markAutoRecoveryRetrying: vi.fn(),
			},
			// Delegates exactly like the real helper so assertions on
			// interactions.settleAutoRecovery exercise the boundary's behavior.
			settleLiveAutoRecoveryMarker: vi.fn(function (this: {
				interactions?: { settleAutoRecovery: () => void }
			}) {
				this.interactions?.settleAutoRecovery()
			}),
			...overrides,
		}
	}

	it("resets the retry streak and discards previews when a turn completes", async () => {
		const controller = makeBoundaryFake()

		await privateControllerProto.handleTurnSettled.call(controller as never, "session-123", { status: "completed" })

		expect(controller.diffEdits.discardAllPreviews).toHaveBeenCalledWith("turn complete")
		expect(controller.apiRetry.reset).toHaveBeenCalledOnce()
		expect(controller.apiRetry.handleSendError).not.toHaveBeenCalled()
		expect(controller.turnStateTracker.set).not.toHaveBeenCalled()
	})

	it("schedules exactly one retry for a retryable send rejection and keeps the phase streaming", async () => {
		const controller = makeBoundaryFake()
		const error = new Error("socket hang up")

		await privateControllerProto.handleTurnSettled.call(controller as never, "session-123", {
			status: "failed",
			error,
			source: "send_rejection",
		})

		expect(controller.diffEdits.discardAllPreviews).toHaveBeenCalledWith("turn error")
		// Exactly one schedule per failed turn — the boundary never sees the
		// event-channel duplicate of this failure.
		expect(controller.apiRetry.handleSendError).toHaveBeenCalledExactlyOnceWith(error, "session-123", undefined)
		expect(controller.turnStateTracker.set).not.toHaveBeenCalledWith("error")
		expect(controller.emitAgentError).toHaveBeenCalledWith("session-123", "Agent error: socket hang up", "running")
	})

	it("passes a server-provided Retry-After through to the coordinator", async () => {
		const controller = makeBoundaryFake({
			classifyAutoRetryFailure: vi.fn(() => ({ retryable: true, retryAfterSeconds: 42 })),
		})
		const error = Object.assign(new Error("rate limited"), { statusCode: 429 })

		await privateControllerProto.handleTurnSettled.call(controller as never, "session-123", {
			status: "failed",
			error,
			source: "agent_event",
		})

		expect(controller.apiRetry.handleSendError).toHaveBeenCalledExactlyOnceWith(error, "session-123", 42)
	})

	it("settles the phase on error recovery when a send rejection is not retryable", async () => {
		const controller = makeBoundaryFake({
			// Unmatched failure (e.g. unfamiliar 400): typed classification says permanent.
			classifyAutoRetryFailure: vi.fn(() => ({ retryable: false })),
		})
		const error = new Error("prompt is too long")

		await privateControllerProto.handleTurnSettled.call(controller as never, "session-123", {
			status: "failed",
			error,
			source: "send_rejection",
		})

		expect(controller.apiRetry.handleSendError).not.toHaveBeenCalled()
		expect(controller.turnStateTracker.set).toHaveBeenCalledWith("error")
		expect(controller.emitAgentError).toHaveBeenCalledWith("session-123", "Agent error: prompt is too long", "error")
	})

	it("applies retry policy to event-delivered failures without re-rendering them", async () => {
		const controller = makeBoundaryFake()
		const error = new Error("fetch failed")

		await privateControllerProto.handleTurnSettled.call(controller as never, "session-123", {
			status: "failed",
			error,
			source: "agent_event",
		})

		// The event stream already rendered the error and captured its provider
		// failure telemetry; the boundary only applies retry policy.
		expect(controller.apiRetry.handleSendError).toHaveBeenCalledExactlyOnceWith(error, "session-123", undefined)
		expect(controller.emitAgentError).not.toHaveBeenCalled()
		expect(controller.captureProviderFailure).not.toHaveBeenCalled()
		expect(controller.turnStateTracker.set).not.toHaveBeenCalled()
	})

	it("routes auth failures to sign-in instead of the retry loop", async () => {
		const controller = makeBoundaryFake({
			getSessionProviderId: vi.fn(() => "cline"),
			classifyAutoRetryFailure: vi.fn(() => ({ retryable: false })),
		})

		await privateControllerProto.handleTurnSettled.call(controller as never, "session-123", {
			status: "failed",
			error: new Error("Unauthorized: missing api key"),
			source: "send_rejection",
		})

		expect(controller.emitClineAuthError).toHaveBeenCalledOnce()
		expect(controller.apiRetry.handleSendError).not.toHaveBeenCalled()
		expect(controller.emitAgentError).not.toHaveBeenCalled()
	})

	it("emits the failure row before scheduling the retry marker", async () => {
		// The webview binds the countdown marker to the nearest PRECEDING error
		// block (findActiveRecoveryDecoration), so the error row must already
		// exist when the marker lands — otherwise the marker reaches back to a
		// previous streak's error and the hold truncates the chat at it.
		const order: string[] = []
		const controller = makeBoundaryFake({
			emitAgentError: vi.fn(() => order.push("error-row")),
			apiRetry: {
				reset: vi.fn(),
				cancel: vi.fn(),
				handleSendError: vi.fn(() => {
					order.push("schedule")
					return true
				}),
			},
		})

		await privateControllerProto.handleTurnSettled.call(controller as never, "session-123", {
			status: "failed",
			error: new Error("socket hang up"),
			source: "send_rejection",
		})

		expect(order).toEqual(["error-row", "schedule"])
	})

	it("settles a live recovery marker when a permanent send rejection ends the streak", async () => {
		const controller = makeBoundaryFake({
			classifyAutoRetryFailure: vi.fn(() => ({ retryable: false })),
		})

		await privateControllerProto.handleTurnSettled.call(controller as never, "session-123", {
			status: "failed",
			error: new Error("prompt is too long"),
			source: "send_rejection",
		})

		expect(controller.interactions.settleAutoRecovery).toHaveBeenCalledOnce()
	})

	it("settles a live recovery marker when a permanent event-delivered failure ends the streak", async () => {
		const controller = makeBoundaryFake({
			classifyAutoRetryFailure: vi.fn(() => ({ retryable: false })),
		})

		await privateControllerProto.handleTurnSettled.call(controller as never, "session-123", {
			status: "failed",
			error: new Error("Unauthorized"),
			source: "agent_event",
		})

		expect(controller.interactions.settleAutoRecovery).toHaveBeenCalledOnce()
	})
})

describe("auto-recovery marker settles when no action is in flight", () => {
	it("cancelTask settles a live marker before the session is torn down", async () => {
		const order: string[] = []
		const fake = {
			apiRetry: { cancel: vi.fn(() => order.push("apiRetry.cancel")) },
			interactions: { settleAutoRecovery: vi.fn(() => order.push("settle")) },
			settleLiveAutoRecoveryMarker: vi.fn(function (this: {
				interactions?: { settleAutoRecovery: () => void }
			}) {
				this.interactions?.settleAutoRecovery()
			}),
			turnStateTracker: { set: vi.fn(() => order.push("phase")) },
			taskControl: { cancelTask: vi.fn(async () => order.push("taskControl")) },
		}

		await SdkController.prototype.cancelTask.call(fake as never)

		// The settle must precede taskControl.cancelTask() — the marker row can
		// only be rewritten while this session is still the active one.
		expect(order).toEqual(["apiRetry.cancel", "settle", "phase", "taskControl"])
	})

	it("clearTask settles a live marker while the session is still active", async () => {
		const order: string[] = []
		const fake = {
			pendingClineAuthRetryPrompt: "prompt",
			apiRetry: { cancel: vi.fn(() => order.push("apiRetry.cancel")) },
			interactions: { settleAutoRecovery: vi.fn(() => order.push("settle")) },
			settleLiveAutoRecoveryMarker: vi.fn(function (this: {
				interactions?: { settleAutoRecovery: () => void }
			}) {
				this.interactions?.settleAutoRecovery()
			}),
			turnStateTracker: { set: vi.fn() },
			taskControl: { clearTask: vi.fn(async () => order.push("taskControl")) },
			postStateToWebview: vi.fn(async () => order.push("post")),
		}

		await SdkController.prototype.clearTask.call(fake as never)

		expect(order.indexOf("settle")).toBeLessThan(order.indexOf("taskControl"))
	})
})

describe("auto-retry re-drive (reDriveAutoRetry)", () => {
	function makeReDriveFake(overrides: Record<string, unknown> = {}) {
		return {
			sessions: {
				getActiveSession: vi.fn(() => ({ sessionId: "session-123", isRunning: false })),
			},
			task: { taskId: "session-123" },
			turnStateTracker: { set: vi.fn() },
			messageTranslatorState: { clearTurnOutcome: vi.fn() },
			postStateToWebview: vi.fn(() => Promise.resolve()),
			followups: { askResponse: vi.fn(() => Promise.resolve()) },
			// Abandon/settle collaborators: without these the abandon paths
			// throw into reDriveAutoRetry's catch (which used to swallow it).
			settleAbandonedRetryPhase: vi.fn(),
			settleLiveAutoRecoveryMarker: vi.fn(),
			...overrides,
		}
	}

	it("re-drives the idle failed session through the normal follow-up funnel", async () => {
		const controller = makeReDriveFake()

		await privateControllerProto.reDriveAutoRetry.call(controller as never, "session-123", () => false)

		// Mirror of askResponse's pre-set: the footer flips to streaming and
		// the completion signal resets before the retried turn starts.
		expect(controller.turnStateTracker.set).toHaveBeenCalledWith("streaming")
		expect(controller.messageTranslatorState.clearTurnOutcome).toHaveBeenCalledOnce()
		expect(controller.followups.askResponse).toHaveBeenCalledExactlyOnceWith(
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			expect.any(Function),
		)
	})

	it("does not re-drive when another turn owns the session", async () => {
		const controller = makeReDriveFake({
			sessions: { getActiveSession: vi.fn(() => ({ sessionId: "session-123", isRunning: true })) },
		})

		await privateControllerProto.reDriveAutoRetry.call(controller as never, "session-123", () => false)

		expect(controller.followups.askResponse).not.toHaveBeenCalled()
	})

	it("does not re-drive when the displayed task moved on", async () => {
		const controller = makeReDriveFake({ task: { taskId: "another-task" } })

		await privateControllerProto.reDriveAutoRetry.call(controller as never, "session-123", () => false)

		expect(controller.followups.askResponse).not.toHaveBeenCalled()
		expect(controller.turnStateTracker.set).not.toHaveBeenCalled()
	})

	it("aborts before re-driving when the retry was already cancelled", async () => {
		const controller = makeReDriveFake()

		await privateControllerProto.reDriveAutoRetry.call(controller as never, "session-123", () => true)

		expect(controller.followups.askResponse).not.toHaveBeenCalled()
		expect(controller.turnStateTracker.set).not.toHaveBeenCalled()
		expect(controller.messageTranslatorState.clearTurnOutcome).not.toHaveBeenCalled()
	})

	it("settles the pre-set phase to resumable when cancellation aborts the send mid-funnel", async () => {
		let cancelled = false
		const controller = makeReDriveFake({
			followups: { askResponse: vi.fn(async () => (cancelled = true)) },
		})

		await privateControllerProto.reDriveAutoRetry.call(controller as never, "session-123", () => cancelled)

		expect(controller.followups.askResponse).toHaveBeenCalledOnce()
		expect(controller.turnStateTracker.set).toHaveBeenCalledWith("resumable")
	})

	it("keeps the cancelling flow's own phase when the task moved on mid-funnel", async () => {
		let cancelled = false
		const controller = makeReDriveFake()
		controller.followups.askResponse = vi.fn(async () => {
			cancelled = true
			controller.task = { taskId: "another-task" }
		})

		await privateControllerProto.reDriveAutoRetry.call(controller as never, "session-123", () => cancelled)

		expect(controller.turnStateTracker.set).not.toHaveBeenCalledWith("resumable")
	})
})

describe("auto-retry lifecycle (failed turn → countdown → re-drive)", () => {
	/**
	 * Deterministic timer clock: scheduled retries are captured and fired by the
	 * test instead of waiting real backoff delays, and a cancelled timer can
	 * still be fired to prove the generation guard survives stray wake-ups.
	 */
	function makeManualClock() {
		const timers: Array<{ fn: () => void; delayMs: number; cancelled: boolean }> = []
		return {
			timers,
			scheduleTimer: vi.fn((fn: () => void, delayMs: number) => {
				const handle = timers.push({ fn, delayMs, cancelled: false }) - 1
				return handle as unknown as ReturnType<typeof setTimeout>
			}),
			cancelTimer: vi.fn((handle: ReturnType<typeof setTimeout>) => {
				const timer = timers[handle as unknown as number]
				if (timer) {
					timer.cancelled = true
				}
			}),
			fire(index: number): void {
				timers[index]?.fn()
			},
		}
	}

	interface LifecycleHarness {
		controller: Record<string, unknown>
		apiRetry: SdkApiRetryCoordinator
		clock: ReturnType<typeof makeManualClock>
		emitSessionEvents: ReturnType<typeof vi.fn>
		setPhase: ReturnType<typeof vi.fn>
		clearTurnOutcome: ReturnType<typeof vi.fn>
		askResponse: ReturnType<typeof vi.fn>
		/** Auto-recovery marker lifecycle collaborator (settle calls asserted). */
		interactions: { settleAutoRecovery: ReturnType<typeof vi.fn> }
		/** Replace the active session (the session-replacement race). */
		setActiveSession(session: { sessionId: string; isRunning: boolean } | undefined): void
		/** Deliver a turn's terminal outcome to the real handleTurnSettled boundary. */
		settle(source: "agent_event" | "send_rejection", error: unknown): Promise<void>
	}

	/**
	 * The real controller prototype over faked collaborators, with the real
	 * SdkApiRetryCoordinator wired exactly like the constructor (real
	 * classification, real re-drive, manual clock). The boundary tests above
	 * stub the coordinator; these tests exercise the races only the composed
	 * lifecycle produces.
	 */
	function makeLifecycleHarness(): LifecycleHarness {
		const clock = makeManualClock()
		let activeSession: { sessionId: string; isRunning: boolean } | undefined = {
			sessionId: "session-123",
			isRunning: false,
		}
		const emitSessionEvents = vi.fn()
		const setPhase = vi.fn()
		// Phase-aware fake so settleAbandonedRetryPhase()'s currentPhase guard is real.
		const trackerState = { phase: "idle" as string }
		const turnStateTracker = {
			set: (phase: string) => {
				trackerState.phase = phase
				setPhase(phase)
			},
			get currentPhase() {
				return trackerState.phase
			},
		}
		const clearTurnOutcome = vi.fn()
		const askResponse = vi.fn(async () => {})
		const interactions = {
			beginAutoRecoveryCountdown: vi.fn(),
			markAutoRecoveryRetrying: vi.fn(),
			settleAutoRecovery: vi.fn(),
			isAutoRecoveryActive: vi.fn(() => false),
		}
		const controller = Object.create(SdkController.prototype) as Record<string, unknown>
		Object.assign(controller, {
			stateManager: { getGlobalSettingsKey: vi.fn(() => undefined) },
			sessions: { getActiveSession: () => activeSession },
			messages: { emitSessionEvents },
			diffEdits: { discardAllPreviews: vi.fn() },
			postStateToWebview: vi.fn(async () => {}),
			// Unmanaged provider: skips the Cline auth/balance recovery branches.
			getSessionProviderId: vi.fn(() => undefined),
			getActiveProviderId: vi.fn(() => undefined),
			captureProviderFailure: vi.fn(),
			turnStateTracker,
			messageTranslatorState: { clearTurnOutcome },
			task: { taskId: "session-123" },
			followups: { askResponse },
			interactions,
		})
		const apiRetry = new SdkApiRetryCoordinator({
			isSessionActive: (sessionId) => activeSession?.sessionId === sessionId,
			sendTurn: (sessionId, isCancelled) => {
				void privateControllerProto.reDriveAutoRetry.call(controller as never, sessionId, isCancelled)
			},
			emitRetryScheduled: (info) => privateControllerProto.emitAutoRetryScheduled.call(controller as never, info),
			onRetryAbandoned: () => privateControllerProto.settleAbandonedRetryPhase.call(controller as never),
			scheduleTimer: clock.scheduleTimer,
			cancelTimer: clock.cancelTimer,
		})
		controller.apiRetry = apiRetry

		return {
			controller,
			apiRetry,
			clock,
			emitSessionEvents,
			setPhase,
			clearTurnOutcome,
			askResponse,
			interactions,
			setActiveSession: (session) => {
				activeSession = session
			},
			settle: (source, error) =>
				privateControllerProto.handleTurnSettled.call(controller as never, "session-123", {
					status: "failed",
					error,
					source,
				}),
		}
	}

	/** A transient transport failure the classifier marks retryable. */
	const transportError = (message = "socket hang up") => Object.assign(new Error(message), { code: "ECONNRESET" })

	/** Let a fired timer's async re-drive run past its next await. */
	const flushTurnWork = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

	it("re-drives a retryable event-delivered failure through the follow-up funnel", async () => {
		const harness = makeLifecycleHarness()

		await harness.settle("agent_event", transportError())

		// The countdown is scheduled on the Fibonacci schedule (first delay 3s) and
		// takes over the footer via the "retrying" phase (Cancel only) — nothing is
		// appended below the already-rendered error, so no row is emitted at all.
		expect(harness.clock.timers).toHaveLength(1)
		expect(harness.clock.timers[0]?.delayMs).toBe(3000)
		expect(harness.setPhase).toHaveBeenCalledWith("retrying")
		expect(harness.emitSessionEvents).not.toHaveBeenCalled()
		// …but nothing re-drives yet, and the already-rendered event failure is
		// not re-surfaced as an agent error.
		expect(harness.askResponse).not.toHaveBeenCalled()
		expect(harness.emitSessionEvents).not.toHaveBeenCalledWith([expect.objectContaining({ say: "error" })], expect.anything())

		harness.clock.fire(0)
		await flushTurnWork()

		// The re-drive mirrors askResponse's pre-set, then rides the funnel
		// with the live cancellation guard.
		expect(harness.setPhase).toHaveBeenCalledWith("streaming")
		expect(harness.clearTurnOutcome).toHaveBeenCalledOnce()
		expect(harness.askResponse).toHaveBeenCalledExactlyOnceWith(
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			expect.any(Function),
		)
		// Nothing cancelled: the streaming phase stands until the retried turn settles.
		expect(harness.setPhase).not.toHaveBeenCalledWith("resumable")
	})

	it("surfaces a rejected send as a running error and re-drives it once the delay elapses", async () => {
		const harness = makeLifecycleHarness()
		const error = Object.assign(new Error("provider overloaded"), { statusCode: 503 })

		await harness.settle("send_rejection", error)

		// A rejected send surfaces nowhere else, so the banner reports it while
		// the retry owns the phase — no "error" settle yet.
		expect(harness.setPhase).not.toHaveBeenCalledWith("error")
		expect(harness.emitSessionEvents).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "error", text: "Agent error: provider overloaded" })],
			{ type: "status", payload: { sessionId: "session-123", status: "running" } },
		)
		expect(harness.clock.timers).toHaveLength(1)

		harness.clock.fire(0)
		await flushTurnWork()

		expect(harness.askResponse).toHaveBeenCalledOnce()
	})

	it("aborts the re-drive mid-funnel when cancellation lands while it awaits settlement", async () => {
		const harness = makeLifecycleHarness()
		let releaseFunnel: () => void = () => {}
		harness.askResponse.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					releaseFunnel = resolve
				}),
		)

		await harness.settle("agent_event", transportError())
		harness.clock.fire(0)
		await flushTurnWork()

		// The re-drive is parked inside the funnel awaiting settlement.
		expect(harness.askResponse).toHaveBeenCalledOnce()
		expect(harness.setPhase).toHaveBeenCalledWith("streaming")

		// The user cancels (or the task tears down) while the funnel is pending.
		harness.apiRetry.cancel()
		releaseFunnel()
		await flushTurnWork()

		// The post-await guard settles the pre-set phase so the footer does not
		// hang on Thinking, and the cancelled retry never sends again.
		expect(harness.askResponse).toHaveBeenCalledOnce()
		expect(harness.setPhase).toHaveBeenCalledWith("resumable")
		expect(harness.clock.timers).toHaveLength(1)
	})

	it("never sends a retry that was counting down when the task was cancelled", async () => {
		const harness = makeLifecycleHarness()

		await harness.settle("send_rejection", transportError("fetch failed"))
		expect(harness.clock.timers).toHaveLength(1)

		// The task is cancelled — the pending timer is invalidated…
		harness.apiRetry.cancel()
		expect(harness.clock.cancelTimer).toHaveBeenCalledOnce()
		expect(harness.apiRetry.hasPendingRetry).toBe(false)

		// …and even a stray late wake-up cannot send.
		harness.clock.fire(0)
		await flushTurnWork()

		expect(harness.askResponse).not.toHaveBeenCalled()
		expect(harness.setPhase).not.toHaveBeenCalledWith("streaming")

		// The streak was cleared too: a later failure schedules a fresh streak
		// instead of resuming the cancelled one.
		await harness.settle("send_rejection", transportError("fetch failed again"))
		expect(harness.clock.timers).toHaveLength(2)
		expect(harness.apiRetry.currentRetryCount).toBe(1)
	})

	it("treats an unrecognized 4xx as permanent and leaves recovery to the user", async () => {
		const harness = makeLifecycleHarness()
		const error = Object.assign(new Error("Unavailable For Legal Reasons"), { statusCode: 451 })

		await harness.settle("send_rejection", error)

		// Nothing is scheduled, nothing re-drives…
		expect(harness.clock.timers).toHaveLength(0)
		expect(harness.askResponse).not.toHaveBeenCalled()
		expect(harness.setPhase).not.toHaveBeenCalledWith("retrying")
		// …the phase settles on error recovery and the banner reports "error".
		expect(harness.setPhase).toHaveBeenCalledWith("error")
		expect(harness.emitSessionEvents).toHaveBeenCalledWith(
			[expect.objectContaining({ say: "error", text: "Agent error: Unavailable For Legal Reasons" })],
			{ type: "status", payload: { sessionId: "session-123", status: "error" } },
		)
	})

	it("abandons a pending retry when its session was replaced before the timer fired", async () => {
		const harness = makeLifecycleHarness()

		await harness.settle("agent_event", transportError("fetch failed"))
		expect(harness.apiRetry.hasPendingRetry).toBe(true)

		// The user moved to a new task; the failed session is no longer active.
		harness.setActiveSession({ sessionId: "session-456", isRunning: false })

		harness.clock.fire(0)
		await flushTurnWork()

		// The live session guard fails at fire time: no re-drive, no phase churn.
		expect(harness.askResponse).not.toHaveBeenCalled()
		expect(harness.setPhase).not.toHaveBeenCalledWith("streaming")
		expect(harness.setPhase).not.toHaveBeenCalledWith("resumable")
	})

	it("settles the marker and restores error recovery when the re-drive funnel throws", async () => {
		const harness = makeLifecycleHarness()
		// The re-drive reaches the funnel, but the send path blows up (e.g. the
		// session host connection died while the machine slept) before any
		// turn outcome can be produced.
		harness.askResponse.mockImplementation(() => Promise.reject(new Error("session host disconnected")))

		await harness.settle("agent_event", transportError())
		expect(harness.clock.timers).toHaveLength(1)

		harness.clock.fire(0)
		await flushTurnWork()

		// Without the catch-path settle the marker strands as "retrying" with
		// the phase parked on "streaming": Cancel-only footer, spinner, and
		// the recovery hold hiding rows below the frozen error block forever.
		expect(harness.interactions.settleAutoRecovery).toHaveBeenCalledOnce()
		expect(harness.setPhase).toHaveBeenLastCalledWith("error")
	})
})
