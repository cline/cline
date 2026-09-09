"use client";

import { Import } from "lucide-react";
import { useEffect, useState } from "react";
import { ImportSessionsDialog } from "@/components/import-sessions-dialog";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import { hasCompletedOnboarding } from "@/lib/onboarding";
import {
	dismissImportNotice,
	isImportNoticeDismissed,
	type ListImportableSessionsResponse,
	SESSION_IMPORT_TOOL_LABELS,
	SESSION_IMPORT_TOOL_ORDER,
	type SessionImportTool,
} from "@/lib/session-import";

type ImportableSummary = { count: number; tools: SessionImportTool[] };

// One scan per app run: every new chat remounts the pane, and the scan reads
// every transcript the other tools left on disk.
let scanPromise: Promise<ImportableSummary | null> | null = null;

function scanImportableSessions(): Promise<ImportableSummary | null> {
	scanPromise ??= (async () => {
		try {
			const response =
				await desktopClient.invoke<ListImportableSessionsResponse>(
					"list_importable_sessions",
					{},
					{ timeoutMs: 120_000 },
				);
			const sessions = (response.sessions ?? []).filter(
				(session) => !session.alreadyImportedSessionId,
			);
			if (sessions.length === 0) return null;
			const tools = SESSION_IMPORT_TOOL_ORDER.filter((tool) =>
				sessions.some((session) => session.tool === tool),
			);
			return { count: sessions.length, tools };
		} catch {
			return null;
		}
	})();
	return scanPromise;
}

/**
 * Shown on the welcome screen when Claude Code, Codex, or opencode history
 * exists on this machine that has not been imported yet. The onboarding
 * import step only reaches fresh installs; this is how everyone else learns
 * the feature exists without digging through Settings.
 */
export function WelcomeImportNotice() {
	const [found, setFound] = useState<ImportableSummary | null>(null);
	const [dismissed, setDismissed] = useState(() => isImportNoticeDismissed());
	const [dialogOpen, setDialogOpen] = useState(false);
	const [imported, setImported] = useState(false);

	useEffect(() => {
		// Onboarding has its own import step and runs its own scan while the
		// shell mounts hidden underneath it; finishing onboarding remounts the
		// pane, so the scan runs then if the user was not offered it there.
		if (dismissed || !hasCompletedOnboarding()) return;
		let cancelled = false;
		void scanImportableSessions().then((summary) => {
			if (!cancelled) setFound(summary);
		});
		return () => {
			cancelled = true;
		};
	}, [dismissed]);

	if (dismissed || !found) return null;

	const dismiss = () => {
		dismissImportNotice();
		setDismissed(true);
	};
	const toolList = found.tools
		.map((tool) => SESSION_IMPORT_TOOL_LABELS[tool])
		.join(found.tools.length === 2 ? " and " : ", ");
	const sessionsNoun = found.count === 1 ? "session" : "sessions";
	const pronoun = found.count === 1 ? "it" : "them";

	return (
		<>
			<output className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 backdrop-blur-sm">
				<div className="flex min-w-0 items-start gap-3">
					<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
						<Import className="size-4" />
					</span>
					<div className="min-w-0">
						<p className="text-sm font-semibold text-foreground">
							Bring your history from {toolList}
						</p>
						<p className="mt-0.5 text-[13px] text-muted-foreground">
							Cline found {found.count} {sessionsNoun} on this machine. Import{" "}
							{pronoun} to keep your past conversations and continue {pronoun}{" "}
							here.
						</p>
					</div>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<Button
						className="rounded-full"
						onClick={() => setDialogOpen(true)}
						size="sm"
						type="button"
					>
						Import sessions
					</Button>
					<Button
						className="rounded-full"
						onClick={dismiss}
						size="sm"
						type="button"
						variant="ghost"
					>
						Not now
					</Button>
				</div>
			</output>
			<ImportSessionsDialog
				onImported={() => {
					dismissImportNotice();
					setImported(true);
				}}
				onOpenChange={(open) => {
					setDialogOpen(open);
					// Keep the notice (and the dialog it owns) mounted until the
					// user closes the import results.
					if (!open && imported) setDismissed(true);
				}}
				open={dialogOpen}
			/>
		</>
	);
}
