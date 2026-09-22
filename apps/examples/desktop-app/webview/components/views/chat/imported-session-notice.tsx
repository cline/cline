"use client";

import { Import } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import {
	SESSION_IMPORT_TOOL_LABELS,
	type SessionImportTool,
} from "@/lib/session-import";

/**
 * Heads a transcript imported from another coding agent. Its turns keep that
 * agent's tool names and schemas, which Cline does not translate; without the
 * notice the session looks native and the user has no way to know why
 * continuing it may go differently.
 */
export function ImportedSessionNotice({ tool }: { tool: SessionImportTool }) {
	const { t } = useTranslation();
	const label = SESSION_IMPORT_TOOL_LABELS[tool];
	return (
		<output className="flex items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-500/5 px-4 py-3">
			<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
				<Import className="size-4" />
			</span>
			<div className="min-w-0">
				<p className="text-sm font-semibold text-foreground">
					{t("chat.messages.imported.title", { tool: label })}
				</p>
				<p className="mt-0.5 text-[13px] text-muted-foreground">
					{t("chat.messages.imported.description", { tool: label })}
				</p>
			</div>
		</output>
	);
}
