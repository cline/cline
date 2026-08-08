import { beforeEach, describe, expect, it, type Mock, vi } from "vitest"
import {
	BackgroundEditNotifier,
	type BackgroundEditNotifierOptions,
	DONT_SHOW_AGAIN_ACTION,
	ENABLE_BACKGROUND_EDIT_ACTION,
} from "./background-edit-notifier"

describe("BackgroundEditNotifier", () => {
	let backgroundEditEnabled: boolean
	let hintDismissed: boolean
	let enableBackgroundEdit: Mock<() => void>
	let dismissHint: Mock<() => void>
	let postStateToWebview: Mock<() => Promise<void>>
	let showMessage: Mock<(message: string, items: string[]) => Promise<string | undefined>>

	function makeNotifier(overrides?: Partial<BackgroundEditNotifierOptions>): BackgroundEditNotifier {
		return new BackgroundEditNotifier({
			isBackgroundEditEnabled: () => backgroundEditEnabled,
			isHintDismissed: () => hintDismissed,
			enableBackgroundEdit,
			dismissHint,
			postStateToWebview,
			previewsBeforeNotify: 3,
			showMessage,
			...overrides,
		})
	}

	/** Resolves once the fire-and-forget show() promise chain has settled. */
	async function flush(): Promise<void> {
		await new Promise((resolve) => setTimeout(resolve, 0))
	}

	beforeEach(() => {
		backgroundEditEnabled = false
		hintDismissed = false
		enableBackgroundEdit = vi.fn()
		dismissHint = vi.fn()
		postStateToWebview = vi.fn().mockResolvedValue(undefined)
		showMessage = vi.fn().mockResolvedValue(undefined)
	})

	it("stays quiet until the preview threshold is reached", () => {
		const notifier = makeNotifier()
		notifier.onDiffPreviewOpened()
		notifier.onDiffPreviewOpened()
		expect(showMessage).not.toHaveBeenCalled()
	})

	it("shows the notification with both actions once the threshold is reached", async () => {
		const notifier = makeNotifier()
		notifier.onDiffPreviewOpened()
		notifier.onDiffPreviewOpened()
		notifier.onDiffPreviewOpened()
		await flush()

		expect(showMessage).toHaveBeenCalledTimes(1)
		const [message, items] = showMessage.mock.calls[0]
		expect(message).toContain("Background Edit")
		expect(items).toEqual([ENABLE_BACKGROUND_EDIT_ACTION, DONT_SHOW_AGAIN_ACTION])
	})

	it("never counts previews while Background Edit is already enabled", () => {
		backgroundEditEnabled = true
		const notifier = makeNotifier()
		for (let i = 0; i < 5; i++) {
			notifier.onDiffPreviewOpened()
		}
		expect(showMessage).not.toHaveBeenCalled()
	})

	it("never counts previews after the hint was dismissed in a previous session", () => {
		hintDismissed = true
		const notifier = makeNotifier()
		for (let i = 0; i < 5; i++) {
			notifier.onDiffPreviewOpened()
		}
		expect(showMessage).not.toHaveBeenCalled()
	})

	it("enables Background Edit, persists the dismissal, refreshes the webview, and confirms on Enable", async () => {
		showMessage.mockResolvedValueOnce(ENABLE_BACKGROUND_EDIT_ACTION)
		const notifier = makeNotifier()
		for (let i = 0; i < 3; i++) {
			notifier.onDiffPreviewOpened()
		}
		await flush()

		expect(enableBackgroundEdit).toHaveBeenCalledTimes(1)
		expect(postStateToWebview).toHaveBeenCalledTimes(1)
		expect(dismissHint).not.toHaveBeenCalled()
		// A follow-up confirmation toast tells the user where the setting lives
		expect(showMessage).toHaveBeenCalledTimes(2)
		const [confirmation, confirmationItems] = showMessage.mock.calls[1]
		expect(confirmation).toContain("Background Edit enabled")
		expect(confirmationItems).toEqual([])
	})

	it("persists only the dismissal on Don't Show Again", async () => {
		showMessage.mockResolvedValueOnce(DONT_SHOW_AGAIN_ACTION)
		const notifier = makeNotifier()
		for (let i = 0; i < 3; i++) {
			notifier.onDiffPreviewOpened()
		}
		await flush()

		expect(dismissHint).toHaveBeenCalledTimes(1)
		expect(enableBackgroundEdit).not.toHaveBeenCalled()
		expect(showMessage).toHaveBeenCalledTimes(1)
	})

	it("shows at most once per session, even when the notification is ignored", async () => {
		// showMessage resolves undefined = user dismissed the toast without clicking
		const notifier = makeNotifier()
		for (let i = 0; i < 10; i++) {
			notifier.onDiffPreviewOpened()
		}
		await flush()

		expect(showMessage).toHaveBeenCalledTimes(1)
		// Nothing is persisted, so a future session may offer it again
		expect(enableBackgroundEdit).not.toHaveBeenCalled()
		expect(dismissHint).not.toHaveBeenCalled()
	})

	it("survives a showMessage failure without throwing", async () => {
		showMessage.mockRejectedValueOnce(new Error("host bridge unavailable"))
		const notifier = makeNotifier()
		for (let i = 0; i < 3; i++) {
			notifier.onDiffPreviewOpened()
		}
		await flush()
		expect(showMessage).toHaveBeenCalledTimes(1)
	})
})
