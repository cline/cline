import type { ClineCompactionInfo, ClineMessage } from "@shared/ExtensionMessage"
import type { TFunction } from "i18next"
import { FoldVerticalIcon, LoaderCircleIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

/** Mirrors the CLI's formatTokenCount (apps/cli/src/tui/utils/compaction-status.ts). */
function formatTokenCount(count: number): string {
	if (count < 1_000) {
		return `${count}`
	}
	if (count < 1_000_000) {
		return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`
	}
	return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
}

function parseCompactionInfo(text: string | undefined): ClineCompactionInfo | undefined {
	if (!text) {
		return undefined
	}
	try {
		const parsed = JSON.parse(text)
		if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
			return parsed as ClineCompactionInfo
		}
	} catch {
		// Fall through to undefined for malformed payloads.
	}
	return undefined
}

/** Mirrors the CLI's formatCompactionDividerLabel wording for product consistency. */
function formatCompactionLabel(info: ClineCompactionInfo, t: TFunction): string {
	if (info.status === "started") {
		return info.mode === "manual" ? t("chat:compaction.compacting") : t("chat:compaction.autoCompacting")
	}
	if (info.status === "failed") {
		return t("chat:compaction.failed")
	}
	if (info.status === "cancelled") {
		return t("chat:compaction.cancelled")
	}
	if (info.status === "skipped") {
		return t("chat:compaction.skipped")
	}
	const parts: string[] = [info.mode === "manual" ? t("chat:compaction.compactedManual") : t("chat:compaction.compacted")]
	if (typeof info.tokensBefore === "number" && typeof info.tokensAfter === "number") {
		parts.push(
			t("chat:compaction.tokensDelta", {
				before: formatTokenCount(info.tokensBefore),
				after: formatTokenCount(info.tokensAfter),
			}),
		)
	}
	if (typeof info.messagesBefore === "number" && typeof info.messagesAfter === "number") {
		parts.push(t("chat:compaction.messagesDelta", { before: info.messagesBefore, after: info.messagesAfter }))
	}
	return parts.join(" · ")
}

/**
 * Divider row for context compaction progress and results — the webview
 * counterpart of the CLI's CompactionDividerRow. Shows a spinner while a
 * compaction is running; the same message (same ts) is updated in place to
 * its terminal state when it finishes.
 */
export const CompactionRow = ({ message }: { message: ClineMessage }) => {
	const { t } = useTranslation()
	const info = parseCompactionInfo(message.text)
	if (!info) {
		// Virtuoso cannot handle zero-height items; render a spacer instead of null.
		return <div aria-hidden className="h-px" />
	}

	const inProgress = info.status === "started"
	const isFailed = info.status === "failed"
	const isMuted = info.status === "skipped" || info.status === "cancelled"

	return (
		<div
			className={cn("flex items-center gap-2 py-1.5 text-description", {
				"text-error": isFailed,
				"opacity-70": isMuted,
			})}>
			{inProgress ? (
				<LoaderCircleIcon className="size-2 shrink-0 animate-spin" />
			) : (
				<FoldVerticalIcon className="size-2 shrink-0" />
			)}
			<span className="min-w-0">
				{formatCompactionLabel(info, t)}
				{inProgress ? "…" : ""}
			</span>
			<div className="flex-1 min-w-4 border-t border-description/30" />
		</div>
	)
}

export default CompactionRow
