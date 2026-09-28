"use client";

import { useState } from "react";
import { desktopClient, isTauriAvailable } from "@/lib/desktop-client";

export function StartupDiagnostics({ report }: { report: string | null }) {
	const [feedback, setFeedback] = useState("");
	const [busy, setBusy] = useState(false);
	if (!report) return null;
	async function share(save: boolean) {
		if (!report) return;
		setBusy(true);
		setFeedback("");
		try {
			if (!save) {
				await navigator.clipboard.writeText(report);
				setFeedback("Diagnostics copied");
			} else if (isTauriAvailable()) {
				const saved = await desktopClient.invoke<boolean>(
					"save_startup_diagnostics",
					{ report },
				);
				setFeedback(saved ? "Report saved" : "Save cancelled");
			} else {
				const url = URL.createObjectURL(
					new Blob([report], { type: "text/plain" }),
				);
				const link = document.createElement("a");
				link.href = url;
				link.download = "cline-startup-diagnostics.txt";
				link.click();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
				setFeedback("Report downloaded");
			}
		} catch {
			setFeedback(
				"Could not share diagnostics. You can select and copy the report below.",
			);
		} finally {
			setBusy(false);
		}
	}
	return (
		<details className="mt-4 rounded-md border bg-background p-3 text-sm">
			<summary>Startup diagnostics</summary>
			<p className="my-2 text-muted-foreground">
				Review this report before sharing it with Cline support. Nothing is
				uploaded automatically.
			</p>
			<div className="flex gap-3">
				<button type="button" disabled={busy} onClick={() => void share(false)}>
					Copy diagnostics
				</button>
				<button type="button" disabled={busy} onClick={() => void share(true)}>
					Save report
				</button>
			</div>
			<output>{feedback}</output>
			<pre className="mt-2 max-h-48 select-text overflow-auto whitespace-pre-wrap text-xs">
				{report}
			</pre>
		</details>
	);
}
