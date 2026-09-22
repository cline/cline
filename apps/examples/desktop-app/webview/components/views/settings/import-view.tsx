"use client";

import { Import } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ImportSessionsDialog } from "@/components/import-sessions-dialog";
import { Button } from "@/components/ui/button";
import { desktopClient } from "@/lib/desktop-client";
import { getTranslator, useTranslation } from "@/lib/i18n";
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
	const { t, plural } = getTranslator();
	if (!scan.installedTools.includes(tool)) {
		return t("settings.import.notDetected");
	}
	const sessions = scan.sessions.filter((session) => session.tool === tool);
	if (sessions.length === 0) return t("settings.import.noSessions");
	const imported = sessions.filter(
		(session) => session.alreadyImportedSessionId,
	).length;
	const found = plural("settings.import.sessionsFound", sessions.length);
	return imported > 0
		? t("settings.import.alreadyImported", { count: imported, found })
		: found;
}

export function ImportContent() {
	const { t } = useTranslation();
	const [scan, setScan] = useState<ListImportableSessionsResponse | null>(null);
	const [scanError, setScanError] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	// A slow initial scan can finish after the post-import rescan; only the
	// latest request may update the counts.
	const scanRequestRef = useRef(0);

	const rescan = useCallback(async () => {
		const requestId = ++scanRequestRef.current;
		setScanError(null);
		try {
			const response =
				await desktopClient.invoke<ListImportableSessionsResponse>(
					"list_importable_sessions",
					{},
					{ timeoutMs: 120_000 },
				);
			if (scanRequestRef.current !== requestId) return;
			setScan({
				installedTools: response.installedTools ?? [],
				sessions: response.sessions ?? [],
			});
		} catch (error) {
			if (scanRequestRef.current !== requestId) return;
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
						{t("settings.import.action")}
					</Button>
				}
				description={t("settings.import.description")}
				title={t("settings.section.import")}
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
										? t("settings.import.scanFailed")
										: t("settings.import.scanning")}
							</p>
						</div>
					</div>
				))}
				{scanError ? (
					<p className="mt-4 text-sm text-destructive" role="alert">
						{t("settings.import.scanError", { error: scanError })}
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
