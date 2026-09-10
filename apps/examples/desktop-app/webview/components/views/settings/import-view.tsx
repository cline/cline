"use client";

import { Import } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ImportSessionsDialog } from "@/components/import-sessions-dialog";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import {
	type ListImportableSessionsResponse,
	SESSION_IMPORT_TOOL_LABELS,
	SESSION_IMPORT_TOOL_ORDER,
	type SessionImportTool,
} from "@/lib/session-import";
import { PageFrame, PageHeader } from "../page-layout";

function toolStatus(
	tool: SessionImportTool,
	scan: ListImportableSessionsResponse,
): string {
	if (!scan.installedTools.includes(tool)) {
		return "Not detected on this machine";
	}
	const sessions = scan.sessions.filter((session) => session.tool === tool);
	if (sessions.length === 0) return "No sessions found";
	const imported = sessions.filter(
		(session) => session.alreadyImportedSessionId,
	).length;
	const found = `${sessions.length} session${sessions.length === 1 ? "" : "s"} found`;
	return imported > 0 ? `${found} · ${imported} already imported` : found;
}

export function ImportContent() {
	const [scan, setScan] = useState<ListImportableSessionsResponse | null>(null);
	const [scanError, setScanError] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);

	const rescan = useCallback(async () => {
		setScanError(null);
		try {
			const response =
				await desktopClient.invoke<ListImportableSessionsResponse>(
					"list_importable_sessions",
					{},
					{ timeoutMs: 120_000 },
				);
			setScan({
				installedTools: response.installedTools ?? [],
				sessions: response.sessions ?? [],
			});
		} catch (error) {
			setScanError(error instanceof Error ? error.message : String(error));
		}
	}, []);

	useEffect(() => {
		void rescan();
	}, [rescan]);

	return (
		<PageFrame>
			<PageHeader
				actions={
					<Button onClick={() => setDialogOpen(true)} type="button">
						<Import className="size-4" />
						Import sessions
					</Button>
				}
				description="Bring your conversation history from other coding tools into Cline. Imported sessions show up in your history and can be continued here."
				title="Import"
			/>
			<section className="max-w-2xl">
				{SESSION_IMPORT_TOOL_ORDER.map((tool, index) => (
					<div
						className={
							index === 0
								? "flex items-center justify-between gap-5 border-y py-4"
								: "flex items-center justify-between gap-5 border-b py-4"
						}
						key={tool}
					>
						<div className="flex flex-col gap-1">
							<p className="text-base font-semibold text-foreground">
								{SESSION_IMPORT_TOOL_LABELS[tool]}
							</p>
							<p className="text-sm text-muted-foreground">
								{scan
									? toolStatus(tool, scan)
									: scanError
										? "Scan failed"
										: "Scanning…"}
							</p>
						</div>
					</div>
				))}
				{scanError ? (
					<p className="mt-4 text-sm text-destructive" role="alert">
						Couldn't scan for sessions: {scanError}
					</p>
				) : null}
			</section>
			<ImportSessionsDialog
				onOpenChange={(open) => {
					setDialogOpen(open);
					// Counts reflect whatever the dialog just imported.
					if (!open) void rescan();
				}}
				open={dialogOpen}
			/>
		</PageFrame>
	);
}
