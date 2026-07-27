/**
 * # MessageRowContext
 *
 * Provides `modifiedMessages` and `groupedMessages` to individual MessageRenderer
 * instances without forcing them into the `itemContent` closure.
 *
 * Without this context, Virtuoso's `itemContent` function must capture
 * `modifiedMessages` as a dependency. During streaming, `modifiedMessages`
 * changes on every chunk, which causes `itemContent` to be a new function
 * reference, which invalidates Virtuoso's internal rendering cache and forces
 * all visible rows to remount.
 *
 * By reading these values from context inside each MessageRenderer, the
 * `itemContent` function remains stable across streaming chunks — only the
 * active/last row that actually needs `modifiedMessages` re-renders.
 */

import type { ClineMessage } from "@shared/ExtensionMessage"
import { createContext, useContext } from "react"
import type { MessageHandlers } from "../types/chatTypes"

export interface MessageRowContextValue {
	/** Derived/modified messages for the current conversation */
	modifiedMessages: ClineMessage[]
	/** Grouped messages (result of groupMessages + groupLowStakesTools) */
	groupedMessages: (ClineMessage | ClineMessage[])[]
	/** Message action handlers */
	messageHandlers: MessageHandlers
	/** Row expansion state */
	expandedRows: Record<number, boolean>
	/** Input value for the textarea */
	inputValue: string
	/** Whether the footer area is active */
	footerActive: boolean
	/** Toggle row expansion */
	onToggleExpand: (ts: number, options?: { preserveAutoScroll?: boolean }) => void
	/** Report row height change for scroll pinning */
	onHeightChange: (isTaller: boolean) => void
	/** Report last row content change for scroll pinning */
	onLastRowContentChange: () => void
	/** Set quote text from selection */
	onSetQuote: (text: string | null) => void
}

export const MessageRowContext = createContext<MessageRowContextValue | null>(null)

/**
 * Hook to access the message row context.
 * Throws if used outside of a MessageRowContext.Provider.
 */
export function useMessageRowContext(): MessageRowContextValue {
	const ctx = useContext(MessageRowContext)
	if (!ctx) {
		throw new Error("useMessageRowContext must be used within a MessageRowContext.Provider")
	}
	return ctx
}
