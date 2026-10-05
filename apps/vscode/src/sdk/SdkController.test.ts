import { GetTaskHistoryRequest } from "@shared/proto/cline/task"
import { describe, expect, it, vi } from "vitest"
import { telemetryService } from "@/services/telemetry"
import { isClineManagedProvider } from "@/shared/utils/cline"
import { Controller as SdkController } from "./SdkController"
import { createTaskProxy, type TaskProxy } from "./task-proxy"
import { resolveWorkspaceManagerPaths, resolveWorkspaceRootPath } from "./workspace-root"

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
				getGlobalStateKey: () => undefined,
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
			cloud: { getCurrentTaskInfo: () => undefined },
			turnStateTracker: { get: () => undefined },
			messageTranslatorState: { getMinter: () => ({ epoch: 1, nextSeq: () => 1 }) },
		}

		await SdkController.prototype.getStateToPostToWebview.call(controller as never)

		expect(buildBaseStateMock).toHaveBeenCalledWith(
			expect.objectContaining({ isRemoteConfigAvailable: true, currentRemoteConfigRevision: 7 }),
		)
	})

	it("rebuilds the snapshot when the epoch moves while the state is being built", async () => {
		buildBaseStateMock.mockClear()
		const minter = { epoch: 1, nextSeq: () => 1 }
		const controller = {
			stateManager: {
				getGlobalSettingsKey: () => undefined,
				getGlobalStateKey: () => undefined,
				getRemoteConfigSettings: () => ({}),
				setGlobalState: vi.fn(),
			},
			backgroundCommandRunning: false,
			backgroundCommandTaskId: undefined,
			foregroundCommands: { isRunning: false },
			isRemoteConfigAvailable: false,
			currentRemoteConfigRevision: undefined,
			ensureWorkspaceManager: async () => undefined,
			taskHistory: {
				listHistory: async () => {
					// A conversation boundary (follow-up on an idle session) bumps the
					// epoch while this snapshot's transcript copy is already taken.
					minter.epoch = 2
					return []
				},
			},
			sessions: { getActiveSession: () => undefined },
			cloud: { getCurrentTaskInfo: () => undefined, getCloudModelId: () => "cloud-model" },
			turnStateTracker: { get: () => undefined },
			messageTranslatorState: { getMinter: () => minter },
			getStateToPostToWebview: SdkController.prototype.getStateToPostToWebview,
		}

		const state = await SdkController.prototype.getStateToPostToWebview.call(controller as never)

		expect(buildBaseStateMock).toHaveBeenCalledTimes(2)
		expect(state.epoch).toBe(2)
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

	describe("after a Cline sign-in error offers to retry a prompt", () => {
		function controllerShowingSignInError(options: { existingTask?: boolean } = {}) {
			const controller = {
				task: undefined as TaskProxy | undefined,
				turnStateTracker: { set: vi.fn(), get: () => ({ phase: "error" }) },
				messageTranslatorState: { clearTurnOutcome: vi.fn() },
				messages: { appendAndEmit: vi.fn() },
				sessions: { getActiveSession: () => undefined },
				cloud: { isCloudSessionId: () => false },
				postStateToWebview: vi.fn(async () => {}),
				initTask: vi.fn(async () => "task-id"),
				followups: { askResponse: vi.fn(async () => {}) },
				cancelTask: vi.fn(async () => {}),
				askResponse(prompt?: string, images?: string[], files?: string[]) {
					return SdkController.prototype.askResponse.call(controller as never, prompt, images, files)
				},
			}
			const openTask = (taskId: string) => {
				controller.task = createTaskProxy(taskId, controller.askResponse, controller.cancelTask)
				return controller.task
			}
			if (options.existingTask) {
				openTask("existing-task")
			}
			SdkController.prototype["emitClineAuthError"].call(controller as never, "original prompt")
			const errorTask = controller.task
			if (!errorTask) {
				throw new Error("The sign-in error did not leave a task to answer")
			}
			return { controller, errorTask, openTask }
		}

		it("restarts a new task with the original prompt when Retry is clicked", async () => {
			const { controller, errorTask } = controllerShowingSignInError()
			await errorTask.handleWebviewAskResponse("yesButtonClicked")
			expect(controller.initTask).toHaveBeenCalledWith(
				"original prompt",
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
			)
			expect(controller.followups.askResponse).not.toHaveBeenCalled()
		})

		it("restarts a new task with a revised prompt submitted from the composer", async () => {
			const { controller, errorTask } = controllerShowingSignInError()
			await errorTask.handleWebviewAskResponse("messageResponse", "revised prompt", ["img"])
			expect(controller.initTask).toHaveBeenCalledWith(
				"revised prompt",
				["img"],
				undefined,
				undefined,
				undefined,
				undefined,
			)
			expect(controller.followups.askResponse).not.toHaveBeenCalled()
		})

		it("keeps the original prompt when the revised submission has attachments but no text", async () => {
			const { controller, errorTask } = controllerShowingSignInError()
			await errorTask.handleWebviewAskResponse("messageResponse", "  ", ["img"])
			expect(controller.initTask).toHaveBeenCalledWith(
				"original prompt",
				["img"],
				undefined,
				undefined,
				undefined,
				undefined,
			)
		})

		it("continues an existing conversation with a message submitted from the composer", async () => {
			const { controller, errorTask } = controllerShowingSignInError({ existingTask: true })
			await errorTask.handleWebviewAskResponse("messageResponse", "follow-up")
			expect(controller.initTask).not.toHaveBeenCalled()
			expect(controller.task).toBe(errorTask)
			expect(controller.followups.askResponse).toHaveBeenCalledWith(
				"follow-up",
				undefined,
				undefined,
				"messageResponse",
				"error",
			)

			// The follow-up answered the error, so a later approval continues the conversation.
			await errorTask.handleWebviewAskResponse("yesButtonClicked")
			expect(controller.initTask).not.toHaveBeenCalled()
		})

		it("does not restart the failed prompt from a task opened afterwards", async () => {
			const { controller, openTask } = controllerShowingSignInError()
			const historyTask = openTask("history-task")
			await historyTask.handleWebviewAskResponse("yesButtonClicked", "resume here")
			expect(controller.initTask).not.toHaveBeenCalled()
			expect(controller.followups.askResponse).toHaveBeenCalledWith(
				"resume here",
				undefined,
				undefined,
				"yesButtonClicked",
				"error",
			)
		})
	})

	describe("after a cloud start fails before it has a session", () => {
		const input = { prompt: "cloud prompt", images: ["img"], repoUrl: "https://github.com/cline/fixture", branch: "main" }
		const cloudTarget = { repoUrl: input.repoUrl, branch: input.branch }

		function controllerShowingCloudStartError() {
			const controller = {
				task: undefined as TaskProxy | undefined,
				turnStateTracker: { set: vi.fn(), get: () => ({ phase: "error" }) },
				messageTranslatorState: { clearTurnOutcome: vi.fn() },
				messages: { appendAndEmit: vi.fn() },
				sessions: { getActiveSession: () => undefined },
				cloud: { isCloudSessionId: () => true, getCurrentTaskInfo: () => ({ status: "unknown" }) },
				postStateToWebview: vi.fn(async () => {}),
				initTask: vi.fn(async () => "ses-retried"),
				followups: { askResponse: vi.fn(async () => {}) },
				cancelTask: vi.fn(async () => {}),
				askResponse(prompt?: string, images?: string[], files?: string[]) {
					return SdkController.prototype.askResponse.call(controller as never, prompt, images, files)
				},
			}
			const errorTask = createTaskProxy("cloud-provisioning-1", controller.askResponse, controller.cancelTask)
			controller.task = errorTask
			SdkController.prototype["offerCloudStartRetry"].call(controller as never, errorTask, input)
			return { controller, errorTask }
		}

		it("starts the same cloud task again when Retry is clicked", async () => {
			const { controller, errorTask } = controllerShowingCloudStartError()
			await errorTask.handleWebviewAskResponse("yesButtonClicked")
			expect(controller.initTask).toHaveBeenCalledWith(
				"cloud prompt",
				["img"],
				undefined,
				undefined,
				undefined,
				cloudTarget,
			)
			expect(controller.messages.appendAndEmit).not.toHaveBeenCalled()
		})

		it("starts a cloud task on the same target with a prompt typed into the composer", async () => {
			const { controller, errorTask } = controllerShowingCloudStartError()
			await errorTask.handleWebviewAskResponse("messageResponse", "revised prompt")
			expect(controller.initTask).toHaveBeenCalledWith(
				"revised prompt",
				undefined,
				undefined,
				undefined,
				undefined,
				cloudTarget,
			)
		})

		it("advances the turn phase when it refuses a response to a session that is gone", async () => {
			const { controller, errorTask } = controllerShowingCloudStartError()
			// The retry is consumed by the first response; a second one finds no session to send to.
			await errorTask.handleWebviewAskResponse("yesButtonClicked")
			controller.initTask.mockClear()

			await errorTask.handleWebviewAskResponse("yesButtonClicked")

			expect(controller.initTask).not.toHaveBeenCalled()
			expect(controller.messages.appendAndEmit).toHaveBeenCalledOnce()
			expect(controller.turnStateTracker.set).toHaveBeenCalledWith("error")
			expect(controller.turnStateTracker.set.mock.invocationCallOrder[0]).toBeLessThan(
				controller.postStateToWebview.mock.invocationCallOrder.at(-1)!,
			)
		})
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

describe("hasWorkspaceCheckpointForMessage", () => {
	const messages = [
		{ ts: 1, type: "say", say: "task", text: "start" },
		{ ts: 2, type: "say", say: "text", text: "done" },
		{ ts: 3, type: "say", say: "user_feedback", text: "continue" },
	]
	const sdkMessages = [
		{ role: "user", content: "start" },
		{ role: "assistant", content: "done" },
		{ role: "user", content: "continue" },
	]

	it("reads the live conversation of the active session", async () => {
		const readLiveMessages = vi.fn().mockResolvedValue(sdkMessages)
		const readMessages = vi.fn().mockResolvedValue([])
		const controller = {
			task: { taskId: "task-a", messageStateHandler: { getClineMessages: () => messages } },
			sessions: {
				getActiveSession: () => ({
					sessionId: "task-a",
					sdkHost: {
						get: async () => ({
							metadata: { checkpoint: { history: [{ ref: "checkpoint-b", createdAt: 1, runCount: 2 }] } },
						}),
						readLiveMessages,
						readMessages,
					},
				}),
			},
		}

		await expect(SdkController.prototype.hasWorkspaceCheckpointForMessage.call(controller as never, 3)).resolves.toBe(true)
		await expect(SdkController.prototype.hasWorkspaceCheckpointForMessage.call(controller as never, 1)).resolves.toBe(false)
		expect(readLiveMessages).toHaveBeenCalledWith("task-a")
		expect(readMessages).not.toHaveBeenCalled()
	})

	it("agrees with editMessageAndRegenerate on which messages exist while the transcript lags", async () => {
		// The persisted transcript is written after Core reports the turn done,
		// so it can still lack the newest user message while its checkpoint exists.
		const readLiveMessages = vi.fn().mockResolvedValue(sdkMessages)
		const readMessages = vi.fn().mockResolvedValue(sdkMessages.slice(0, 2))
		const restore = vi.fn().mockRejectedValue(new Error("stop at restore"))
		const controller = {
			task: { taskId: "task-a", messageStateHandler: { getClineMessages: () => messages } },
			sessions: {
				getActiveSession: () => ({
					sessionId: "task-a",
					isRunning: false,
					sdkHost: {
						get: async () => ({
							cwd: "C:/work",
							metadata: { checkpoint: { history: [{ ref: "checkpoint-b", createdAt: 1, runCount: 2 }] } },
						}),
						readLiveMessages,
						readMessages,
						restore,
					},
				}),
			},
			taskHistory: { findHistoryItem: async () => undefined },
			getWorkspaceRoot: async () => "C:/work",
			stateManager: { getGlobalSettingsKey: () => "act" },
			sessionConfigBuilder: { build: async () => ({ providerId: "anthropic", apiKey: "key", modelId: "model" }) },
			resolveContextMentions: async (text: string) => text,
		}

		await expect(SdkController.prototype.hasWorkspaceCheckpointForMessage.call(controller as never, 3)).resolves.toBe(true)
		await expect(
			SdkController.prototype.editMessageAndRegenerate.call(controller as never, {
				messageTs: 3,
				text: "continue, edited",
				restoreWorkspace: true,
			}),
		).rejects.toThrow("stop at restore")
		expect(restore).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "task-a", checkpointRunCount: 2 }))
		expect(readMessages).not.toHaveBeenCalled()
	})

	it("uses and disposes a temporary host for a history task", async () => {
		const tempHost = {
			get: vi.fn().mockResolvedValue({
				metadata: { checkpoint: { history: [{ ref: "checkpoint-a", createdAt: 1, runCount: 1 }] } },
			}),
			readMessages: vi.fn().mockResolvedValue(sdkMessages),
			dispose: vi.fn().mockRejectedValue(new Error("cleanup failed")),
		}
		const controller = {
			task: { taskId: "task-a", messageStateHandler: { getClineMessages: () => messages } },
			sessions: { getActiveSession: () => undefined },
			createRemoteConfigAwareSessionHost: vi.fn().mockResolvedValue(tempHost),
		}

		await expect(SdkController.prototype.hasWorkspaceCheckpointForMessage.call(controller as never, 1)).resolves.toBe(true)
		expect(tempHost.get).toHaveBeenCalledWith("task-a")
		expect(tempHost.dispose).toHaveBeenCalledWith("workspaceCheckpointForMessage")
	})

	it("reports no checkpoint when the host cannot be read", async () => {
		const controller = {
			task: { taskId: "task-a", messageStateHandler: { getClineMessages: () => messages } },
			sessions: { getActiveSession: () => undefined },
			createRemoteConfigAwareSessionHost: vi.fn().mockRejectedValue(new Error("host unavailable")),
		}

		await expect(SdkController.prototype.hasWorkspaceCheckpointForMessage.call(controller as never, 1)).resolves.toBe(false)
	})

	it("reports no checkpoint for messages that did not start a run", async () => {
		const answerMessages = [
			{ ts: 1, type: "say", say: "task", text: "start" },
			{ ts: 2, type: "ask", ask: "followup", text: "which file?" },
			{ ts: 3, type: "say", say: "user_feedback", text: "src/index.ts" },
		]
		const createRemoteConfigAwareSessionHost = vi.fn()
		const controller = {
			task: { taskId: "task-a", messageStateHandler: { getClineMessages: () => answerMessages } },
			sessions: { getActiveSession: () => undefined },
			createRemoteConfigAwareSessionHost,
		}

		await expect(SdkController.prototype.hasWorkspaceCheckpointForMessage.call(controller as never, 3)).resolves.toBe(false)
		expect(createRemoteConfigAwareSessionHost).not.toHaveBeenCalled()
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

describe("starting a cloud task", () => {
	it("leaves the turn phase to the coordinator so a start cancelled during policy loading stays idle", async () => {
		const run = vi.fn(async () => undefined)
		const controller = {
			cloud: { beginCloudTask: vi.fn(() => run) },
			waitForInitialRemoteConfig: vi.fn(async () => undefined),
			turnStateTracker: { set: vi.fn() },
			messageTranslatorState: { clearTurnOutcome: vi.fn() },
		}

		await SdkController.prototype.initTask.call(controller as never, "prompt", undefined, undefined, undefined, undefined, {
			repoUrl: "https://github.com/cline/fixture",
		})

		expect(controller.cloud.beginCloudTask.mock.invocationCallOrder[0]).toBeLessThan(
			controller.waitForInitialRemoteConfig.mock.invocationCallOrder[0],
		)
		expect(run).toHaveBeenCalledOnce()
		expect(controller.turnStateTracker.set).not.toHaveBeenCalled()
		expect(controller.messageTranslatorState.clearTurnOutcome).not.toHaveBeenCalled()
	})
})

describe("cancelling a provisioning cloud task", () => {
	it("returns to the home view instead of offering Resume Task", async () => {
		const phases: string[] = []
		const controller = {
			turnStateTracker: { set: (phase: string) => phases.push(phase) },
			cloud: { cancelPendingStartFor: vi.fn(() => true) },
			clearTask: vi.fn(async () => phases.push("cleared")),
			taskControl: { cancelTask: vi.fn() },
		}

		await SdkController.prototype.cancelTask.call(controller as never)

		expect(phases).toEqual(["resumable", "cleared"])
		expect(controller.taskControl.cancelTask).not.toHaveBeenCalled()
	})

	it("cancels the pending cloud start when the user starts a new task", async () => {
		const cancelPendingStart = vi.fn(() => true)
		const controller = {
			turnStateTracker: { set: vi.fn() },
			cloud: { cancelPendingStart },
			taskControl: { clearTask: vi.fn(async () => undefined) },
			postStateToWebview: vi.fn(async () => undefined),
		}

		await SdkController.prototype.clearTask.call(controller as never)

		expect(cancelPendingStart).toHaveBeenCalledOnce()
		expect(controller.taskControl.clearTask).toHaveBeenCalledOnce()
	})
})

describe("getTaskHistory with Cloud Only", () => {
	function record(sessionId: string, updatedAt: number, executionTarget?: "cloud") {
		return {
			sessionId,
			prompt: `task ${sessionId}`,
			startedAt: new Date(updatedAt).toISOString(),
			updatedAt: new Date(updatedAt).toISOString(),
			metadata: executionTarget ? { executionTarget } : {},
		}
	}

	it("finds cloud tasks that sit behind a full page of newer local tasks", async () => {
		// 60 local tasks are newer than the 2 cloud tasks, so a page of 50 merged
		// records holds no cloud task at all.
		const history = [
			...Array.from({ length: 60 }, (_, i) => record(`local-${i}`, 2_000_000 - i)),
			record("ses-a", 1_000_000, "cloud"),
			record("ses-b", 999_999, "cloud"),
		]
		const listHistory = vi.fn(async ({ limit = history.length, offset = 0 }: { limit?: number; offset?: number }) =>
			history.slice(offset, offset + limit),
		)
		const controller = {
			task: undefined,
			taskHistory: { listHistory },
			cloud: { getCurrentTaskInfo: () => undefined },
			getWorkspaceRoot: async () => "/workspace",
		}

		const page = await SdkController.prototype.getTaskHistory.call(
			controller as never,
			GetTaskHistoryRequest.create({ cloudOnly: true, limit: 50, offset: 0 }),
		)

		expect(page.tasks.map((task) => task.id)).toEqual(["ses-a", "ses-b"])
		expect(page.hasMore).toBe(false)
	})

	it("pages the filtered cloud tasks, not the merged list", async () => {
		const history = [
			...Array.from({ length: 5 }, (_, i) => record(`local-${i}`, 2_000_000 - i)),
			...Array.from({ length: 3 }, (_, i) => record(`ses-${i}`, 1_000_000 - i, "cloud")),
		]
		const listHistory = vi.fn(async ({ limit = history.length, offset = 0 }: { limit?: number; offset?: number }) =>
			history.slice(offset, offset + limit),
		)
		const controller = {
			task: undefined,
			taskHistory: { listHistory },
			cloud: { getCurrentTaskInfo: () => undefined },
			getWorkspaceRoot: async () => "/workspace",
		}
		const page = (offset: number) =>
			SdkController.prototype.getTaskHistory.call(
				controller as never,
				GetTaskHistoryRequest.create({ cloudOnly: true, limit: 2, offset }),
			)

		const first = await page(0)
		const second = await page(2)

		expect(first.tasks.map((task) => task.id)).toEqual(["ses-0", "ses-1"])
		expect(first.hasMore).toBe(true)
		expect(second.tasks.map((task) => task.id)).toEqual(["ses-2"])
		expect(second.hasMore).toBe(false)
	})
})

describe("cloud tasks stay in the cloud", () => {
	const stateManager = { getGlobalSettingsKey: (key: string) => (key === "mode" ? "plan" : undefined) }

	it("refuses to rebuild a cloud task's conversation as a local session", async () => {
		const startNewSession = vi.fn()
		const controller = {
			task: { taskId: "ses-cloud", messageStateHandler: { getClineMessages: () => [] } },
			sessions: { getActiveSession: () => undefined, startNewSession },
			stateManager,
		}

		await expect(
			SdkController.prototype.editMessageAndRegenerate.call(controller as never, { messageTs: 1, text: "edited" }),
		).rejects.toThrow("not available for cloud tasks")
		expect(startNewSession).not.toHaveBeenCalled()
	})

	it("renders a displayed cloud task in Act while the saved local mode is Plan", () => {
		const mode = (taskId: string | undefined) =>
			SdkController.prototype["getDisplayedTaskMode"].call({
				task: taskId ? { taskId } : undefined,
				stateManager,
			} as never)

		expect(mode("ses-cloud")).toBe("act")
		expect(mode("local-task")).toBe("plan")
		expect(mode(undefined)).toBe("plan")
	})
})
