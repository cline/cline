"use client";

import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	WindowTitleBar,
	WindowTitleBarProvider,
} from "@/components/window-title-bar";
import type { useHubStartup } from "@/hooks/use-hub-startup";
import { desktopClient } from "@/lib/desktop-client";

const BACKEND_UNRESPONSIVE_MS = 30_000;

/**
 * Shown instead of the app while local Hub startup is in progress or has failed, so the
 * user gets Retry and a diagnostics export instead of Hub errors from
 * whichever feature they tried first.
 */
export function HubStartupScreen({
	transport,
	hub,
}: ReturnType<typeof useHubStartup>) {
	const connected = transport === "connected";
	const [backendUnresponsive, setBackendUnresponsive] = useState(false);
	const [exportStatus, setExportStatus] = useState<string | null>(null);

	// The client keeps reconnecting on its own; only call it out once it has
	// been unreachable for a while.
	useEffect(() => {
		setBackendUnresponsive(false);
		if (connected) return;
		const timer = setTimeout(
			() => setBackendUnresponsive(true),
			BACKEND_UNRESPONSIVE_MS,
		);
		return () => clearTimeout(timer);
	}, [connected]);

	const exportDiagnostics = async () => {
		setExportStatus("Exporting diagnostics…");
		try {
			const result = await desktopClient.invoke<{ path: string }>(
				"export_diagnostics",
			);
			setExportStatus(`Diagnostics saved to ${result.path}`);
		} catch (error) {
			setExportStatus(error instanceof Error ? error.message : String(error));
		}
	};

	let content: ReactNode;
	if (!connected && backendUnresponsive) {
		content = (
			<>
				<h1 className="text-base font-medium">
					Cline's desktop backend isn't responding
				</h1>
				<p className="text-sm text-muted-foreground">
					Cline keeps trying in the background. Reload to try again now.
				</p>
				<Button onClick={() => window.location.reload()}>Reload</Button>
			</>
		);
	} else if (connected && hub.state === "failed") {
		content = (
			<>
				<h1 className="text-base font-medium">
					Cline couldn't connect to its Hub
				</h1>
				<p className="text-sm text-muted-foreground">
					{hub.error} Retry, or export diagnostics and share the file with the
					Cline team if this keeps happening.
				</p>
				<div className="flex gap-2">
					<Button onClick={() => void desktopClient.invoke("retry_hub")}>
						Retry
					</Button>
					<Button variant="outline" onClick={() => void exportDiagnostics()}>
						Export diagnostics
					</Button>
				</div>
				{exportStatus ? (
					<p className="break-all text-xs text-muted-foreground">
						{exportStatus}
					</p>
				) : null}
			</>
		);
	} else {
		content = (
			<>
				<Loader2
					aria-hidden="true"
					className="size-6 animate-spin text-muted-foreground"
				/>
				<output className="text-sm text-muted-foreground">
					Starting Cline…
				</output>
			</>
		);
	}

	// Below dialogs (z-50) so the Hub update prompt stays on top. The title bar
	// keeps the drag region and, on frameless Windows, the window controls.
	return (
		<main className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
			<WindowTitleBarProvider contentEnabled={false}>
				<WindowTitleBar
					className="absolute inset-x-0 top-0"
					hostContent={false}
				/>
			</WindowTitleBarProvider>
			<div className="flex max-w-md flex-col items-center gap-4">{content}</div>
		</main>
	);
}
