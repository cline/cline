"use client";

import { Import } from "lucide-react";
import {
	SESSION_IMPORT_TOOL_LABELS,
	type SessionImportTool,
} from "@/lib/session-import";

/**
 * Sits at the top of a transcript imported from another coding agent. The
 * imported turns keep that tool's own tool names, input schemas, and
 * conventions (see the core session-import adapters), none of which Cline
 * translates, so resuming can go worse than a native session would. Without
 * the notice the transcript looks like any other Cline session and the user
 * has no way to know why the agent behaves differently here.
 */
export function ImportedSessionNotice({ tool }: { tool: SessionImportTool }) {
	const label = SESSION_IMPORT_TOOL_LABELS[tool];
	return (
		<output className="flex items-start gap-3 rounded-xl border border-amber-400/40 bg-amber-500/5 px-4 py-3">
			<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
				<Import className="size-4" />
			</span>
			<div className="min-w-0">
				<p className="text-sm font-semibold text-foreground">
					Imported from {label}
				</p>
				<p className="mt-0.5 text-[13px] text-muted-foreground">
					The earlier turns were recorded by {label}, whose tools and workflow
					differ from Cline&apos;s. You can keep going here, but results may not
					be as reliable as in a session started with Cline.
				</p>
			</div>
		</output>
	);
}
