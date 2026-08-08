import { HostProvider } from "@/hosts/host-provider"
import { ShowMessageType } from "@/shared/proto/index.host"
import { Logger } from "@/shared/services/Logger"

/**
 * How many diff previews must open in one extension-host session before the
 * notification appears. The first diff is often fine (or even wanted); by the
 * third the focus-stealing is clearly repetitive.
 */
const DIFF_PREVIEWS_BEFORE_NOTIFY = 3

export const ENABLE_BACKGROUND_EDIT_ACTION = "Enable Background Edit"
export const DONT_SHOW_AGAIN_ACTION = "Don't Show Again"

const NOTIFICATION_MESSAGE =
	"Tired of Cline's diff previews taking over your editor? Background Edit applies changes quietly and shows diffs in the chat instead."

const ENABLED_CONFIRMATION_MESSAGE =
	"Background Edit enabled. File changes will now show up in the chat. You can turn it off anytime in Cline Settings > Features."

export interface BackgroundEditNotifierOptions {
	isBackgroundEditEnabled: () => boolean
	isHintDismissed: () => boolean
	/** Persists backgroundEditEnabled and the dismissal flag. */
	enableBackgroundEdit: () => void
	/** Persists the dismissal flag only. */
	dismissHint: () => void
	/** Pushes refreshed state so the settings toggle and chat rendering update. */
	postStateToWebview: () => Promise<void>
	/** Test seam; defaults to DIFF_PREVIEWS_BEFORE_NOTIFY. */
	previewsBeforeNotify?: number
	/** Test seam; defaults to a host-bridge information notification. */
	showMessage?: (message: string, items: string[]) => Promise<string | undefined>
}

/**
 * Suggests enabling Background Edit through a native VS Code notification once
 * the diff preview has repeatedly opened during a session — the moment the
 * focus-stealing complaint actually builds up.
 *
 * Deliberately conservative about when it appears:
 * - never while Background Edit is already on, or after the user has interacted
 *   with the suggestion once (either action persists `backgroundEditHintDismissed`)
 * - only after several diff previews have opened this session, not on the first
 * - at most once per extension-host session, even if the notification is ignored
 *   (an ignored toast just collapses into the bell; re-showing it would be nagging)
 */
export class BackgroundEditNotifier {
	private previewsOpened = 0
	private shownThisSession = false

	constructor(private readonly options: BackgroundEditNotifierOptions) {}

	/** Called by the diff-edit coordinator each time a diff preview tab opens. */
	onDiffPreviewOpened(): void {
		if (this.shownThisSession || this.options.isBackgroundEditEnabled() || this.options.isHintDismissed()) {
			return
		}
		this.previewsOpened++
		if (this.previewsOpened < (this.options.previewsBeforeNotify ?? DIFF_PREVIEWS_BEFORE_NOTIFY)) {
			return
		}
		this.shownThisSession = true
		// Fire-and-forget: the notification waits on user input and must never
		// block the edit flow that triggered it.
		void this.show().catch((error) => {
			Logger.warn(`[BackgroundEditNotifier] Failed to show notification: ${error}`)
		})
	}

	private async show(): Promise<void> {
		const selected = await this.showMessage(NOTIFICATION_MESSAGE, [ENABLE_BACKGROUND_EDIT_ACTION, DONT_SHOW_AGAIN_ACTION])

		if (selected === ENABLE_BACKGROUND_EDIT_ACTION) {
			this.options.enableBackgroundEdit()
			await this.options.postStateToWebview()
			// Confirmation includes where to find the setting again; no buttons.
			void this.showMessage(ENABLED_CONFIRMATION_MESSAGE, []).catch(() => {})
		} else if (selected === DONT_SHOW_AGAIN_ACTION) {
			this.options.dismissHint()
		}
		// Dismissed without clicking (or ignored): don't persist anything — the
		// session guard already prevents re-showing until the next session.
	}

	private showMessage(message: string, items: string[]): Promise<string | undefined> {
		if (this.options.showMessage) {
			return this.options.showMessage(message, items)
		}
		return HostProvider.window
			.showMessage({
				type: ShowMessageType.INFORMATION,
				message,
				options: { items },
			})
			.then((response) => response.selectedOption)
	}
}
