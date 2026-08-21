// Regression test for #13260: auto-approve checkboxes froze after "New Task".
//
// Toggling an auto-approve setting while a task view is open writes
// autoApprovalSettings into the StateManager's task-settings overlay
// (updateAutoApprovalSettings -> setTaskSettings), and the overlay shadows
// global settings in getGlobalSettingsKey(). If clearTask() leaves the overlay
// behind, every later toggle RPC is accepted into global state but every
// posted state still carries the overlay's old version — which the webview
// rejects as not newer, so the checkboxes never move again.
//
// Unlike the SdkTaskControlCoordinator unit tests (which assert clearTask
// calls clearTaskSettings), this test wires the REAL StateManager, the REAL
// updateAutoApprovalSettings handler, and the REAL coordinator clearTask()
// together, with the webview's version gate modeled on
// ExtensionStateContext.tsx, so the end-to-end invariant is what's pinned:
// after New Task, checkbox clicks must reach the webview.
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Controller } from "@/core/controller"
import { updateAutoApprovalSettings } from "@/core/controller/state/updateAutoApprovalSettings"
import { StateManager } from "@/core/storage/StateManager"
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "@/shared/AutoApprovalSettings"
import { AutoApprovalSettingsRequest } from "@/shared/proto/cline/state"
import { createStorageContext } from "@/shared/storage/storage-context"
import { SdkTaskControlCoordinator, type SdkTaskControlCoordinatorOptions } from "./sdk-task-control-coordinator"
import type { TaskProxy } from "./task-proxy"

vi.mock("@/services/logging/distinctId", () => ({
	initializeDistinctId: vi.fn(async () => undefined),
}))

describe("auto-approve settings after New Task (#13260)", () => {
	let clineDir: string
	let stateManager: StateManager
	let task: TaskProxy | undefined
	// What the webview last received via subscribeToState. It only accepts
	// autoApprovalSettings whose version is strictly greater than what it holds
	// (ExtensionStateContext.tsx).
	let webviewSettings: typeof DEFAULT_AUTO_APPROVAL_SETTINGS

	// Mirrors getStateToPostToWebview: autoApprovalSettings resolves through
	// getGlobalSettingsKey, where the task-settings overlay shadows global state.
	const resolveSettings = () => stateManager.getGlobalSettingsKey("autoApprovalSettings")

	const postStateToWebview = async () => {
		const incoming = resolveSettings()
		if ((incoming.version ?? 1) > (webviewSettings.version ?? 1)) {
			webviewSettings = incoming
		}
	}

	const makeTaskProxy = (taskId: string): TaskProxy =>
		({ taskId, messageStateHandler: { clear: () => {} } }) as unknown as TaskProxy

	const makeCoordinator = () =>
		new SdkTaskControlCoordinator({
			sessions: { endActiveSession: async () => {} },
			interactions: { clearPending: () => {} },
			messages: { cancelPendingSave: () => {} },
			taskHistory: {},
			getTask: () => task,
			setTask: (next: TaskProxy | undefined) => {
				task = next
			},
			onAskResponse: async () => {},
			resetMessageTranslator: () => {},
			postStateToWebview,
			clearTaskSettings: () => stateManager.clearTaskSettings(),
			setTurnPhase: () => {},
		} as unknown as SdkTaskControlCoordinatorOptions)

	const makeController = () =>
		({
			task,
			getStateToPostToWebview: async () => ({ autoApprovalSettings: resolveSettings() }),
			postStateToWebview,
			stateManager,
		}) as unknown as Controller

	// What the webview's useAutoApproveActions.updateAction sends on a checkbox click.
	const clickCheckbox = async (action: string, value: boolean) => {
		await updateAutoApprovalSettings(
			makeController(),
			AutoApprovalSettingsRequest.create({
				version: (webviewSettings.version ?? 1) + 1,
				actions: { ...webviewSettings.actions, [action]: value },
			}),
		)
	}

	beforeAll(async () => {
		clineDir = await fs.mkdtemp(path.join(os.tmpdir(), "cline-13260-regression-"))
		await StateManager.initialize(createStorageContext({ clineDir, workspacePath: clineDir }))
		stateManager = StateManager.get()
	})

	beforeEach(async () => {
		await stateManager.clearTaskSettings()
		stateManager.setGlobalState("autoApprovalSettings", { ...DEFAULT_AUTO_APPROVAL_SETTINGS })
		task = undefined
		webviewSettings = resolveSettings()
	})

	afterAll(async () => {
		await StateManager.get().flushPendingState()
		await StateManager.get().reInitialize()
		await fs.rm(clineDir, { recursive: true, force: true })
	})

	it("keeps checkboxes working after a mid-task toggle followed by New Task", async () => {
		// A task view is open (running or completed — the proxy stays installed
		// either way) and the user unchecks "Edit files". The handler writes the
		// setting to BOTH global state and the task overlay.
		task = makeTaskProxy("task-1")
		await clickCheckbox("editFiles", false)
		expect(webviewSettings.actions.editFiles).toBe(false)

		// User clicks "New Task" — the real coordinator path, which must drop the
		// overlay along with the task proxy.
		await makeCoordinator().clearTask()
		await postStateToWebview()
		expect(task).toBeUndefined()

		// The next checkbox click must reach the webview: accepted into global
		// state AND visible in the next posted state.
		const versionBefore = webviewSettings.version
		await clickCheckbox("readFiles", false)
		expect(webviewSettings.actions.readFiles).toBe(false)
		expect(webviewSettings.version).toBe(versionBefore + 1)
		// The mid-task toggle survives New Task.
		expect(webviewSettings.actions.editFiles).toBe(false)
	})

	it("freezes forever if the overlay outlives the task view (the failure mode the fix prevents)", async () => {
		// Same start: mid-task toggle populates the overlay.
		task = makeTaskProxy("task-1")
		await clickCheckbox("editFiles", false)
		const versionAfterToggle = webviewSettings.version

		// Buggy New Task: task proxy dropped, overlay left behind.
		task = undefined
		await postStateToWebview()

		// Every subsequent click is accepted into global state but never surfaces:
		// the stale overlay version shadows global in every posted state, and the
		// webview rejects non-newer versions. No amount of state posts recovers.
		await clickCheckbox("readFiles", false)
		await postStateToWebview()
		await clickCheckbox("useBrowser", false)
		await postStateToWebview()
		expect(webviewSettings.actions.readFiles).toBe(true)
		expect(webviewSettings.actions.useBrowser).toBe(true)
		expect(webviewSettings.version).toBe(versionAfterToggle)
	})

	it("never freezes when toggles happen with no task view open", async () => {
		// Control: with no task, only global state is written — no overlay exists,
		// so New Task has nothing to leak.
		await clickCheckbox("editFiles", false)
		await makeCoordinator().clearTask()
		await postStateToWebview()

		const versionBefore = webviewSettings.version
		await clickCheckbox("readFiles", false)
		expect(webviewSettings.actions.readFiles).toBe(false)
		expect(webviewSettings.version).toBe(versionBefore + 1)
	})
})
