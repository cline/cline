"use client";

import { Check, Copy, Download, Loader2, Play, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/lib/desktop-client";
import type { LocalModelsStatus } from "@/lib/local-models";
import { cn } from "@/lib/utils";

const DEFAULT_URL = "http://localhost:11434";
const LINUX_INSTALL_COMMAND = "curl -fsSL https://ollama.com/install.sh | sh";

const DOWNLOADS: Record<string, { label: string; url: string }> = {
	darwin: {
		label: "Download Ollama for macOS",
		url: "https://ollama.com/download/mac",
	},
	win32: {
		label: "Download Ollama for Windows",
		url: "https://ollama.com/download/windows",
	},
};

function StatusLine({
	tone,
	children,
	refreshing,
	onRefresh,
}: {
	tone: "pending" | "ok" | "error";
	children: React.ReactNode;
	refreshing: boolean;
	onRefresh: () => void;
}) {
	return (
		<div className="flex items-center gap-2 text-sm">
			<span
				className={cn(
					"inline-block size-2 shrink-0 rounded-full",
					tone === "ok"
						? "bg-emerald-500"
						: tone === "error"
							? "bg-destructive"
							: "bg-muted-foreground/40",
				)}
			/>
			<span className="flex-1 text-foreground">{children}</span>
			<Button
				aria-label="Check again"
				disabled={refreshing}
				onClick={onRefresh}
				size="icon"
				title="Check again"
				type="button"
				variant="ghost"
			>
				<RefreshCw className={refreshing ? "animate-spin" : ""} />
			</Button>
		</div>
	);
}

function CopyableCommand({ command }: { command: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex items-center gap-2 rounded-md border bg-muted/40 py-1 pr-1 pl-3">
			<code className="flex-1 overflow-x-auto whitespace-nowrap text-xs">
				{command}
			</code>
			<Button
				aria-label="Copy command"
				onClick={() => {
					void navigator.clipboard.writeText(command).then(() => {
						setCopied(true);
						window.setTimeout(() => setCopied(false), 1500);
					});
				}}
				size="xs"
				type="button"
				variant="ghost"
			>
				{copied ? <Check /> : <Copy />}
				{copied ? "Copied" : "Copy"}
			</Button>
		</div>
	);
}

function InstallSteps({ platform }: { platform: string }) {
	const download = DOWNLOADS[platform];
	return (
		<ol className="flex list-decimal flex-col gap-3 pl-5 text-sm text-muted-foreground marker:text-muted-foreground">
			<li>
				<span className="text-foreground">Install Ollama.</span> It's free, open
				source, and runs models on your own hardware.
				<div className="mt-2 flex flex-col gap-2">
					{download ? (
						<div>
							<Button
								onClick={() => void openExternalUrl(download.url)}
								size="sm"
								type="button"
							>
								<Download />
								{download.label}
							</Button>
						</div>
					) : (
						<CopyableCommand command={LINUX_INSTALL_COMMAND} />
					)}
					{platform === "darwin" ? (
						<span className="text-xs">
							Or with Homebrew: <code>brew install ollama</code>
						</span>
					) : null}
				</div>
			</li>
			<li>
				<span className="text-foreground">Open Ollama.</span>{" "}
				{platform === "linux"
					? "The installer starts it as a background service."
					: "It runs in the background from the menu bar or system tray."}
			</li>
			<li>
				<span className="text-foreground">Come back here.</span> This page
				notices Ollama on its own, then you can download a model.
			</li>
		</ol>
	);
}

export function OllamaSetup({
	status,
	refreshing,
	onRefresh,
	onStart,
}: {
	status: LocalModelsStatus | undefined;
	refreshing: boolean;
	onRefresh: () => void;
	onStart: () => Promise<void>;
}) {
	const [starting, setStarting] = useState(false);
	const [startError, setStartError] = useState<string>();

	if (!status) {
		return (
			<StatusLine onRefresh={onRefresh} refreshing={refreshing} tone="pending">
				Checking for Ollama…
			</StatusLine>
		);
	}

	const url = status.baseUrl || DEFAULT_URL;
	if (status.ollamaReachable) {
		return (
			<StatusLine onRefresh={onRefresh} refreshing={refreshing} tone="ok">
				Ollama {status.ollamaVersion} is running
				{status.baseUrl ? (
					<span className="text-muted-foreground"> at {url}</span>
				) : null}
			</StatusLine>
		);
	}

	const install = status.ollamaInstall;
	if (install && !install.localServer) {
		return (
			<div className="flex flex-col gap-2">
				<StatusLine onRefresh={onRefresh} refreshing={refreshing} tone="error">
					Can't reach Ollama at {url}
				</StatusLine>
				<p className="text-sm text-muted-foreground">
					Make sure the server is running and reachable from this computer, or
					change the URL under Providers → Ollama.
				</p>
			</div>
		);
	}

	if (install?.installed) {
		const start = async () => {
			setStarting(true);
			setStartError(undefined);
			try {
				await onStart();
			} catch (error) {
				setStartError(error instanceof Error ? error.message : String(error));
			} finally {
				setStarting(false);
			}
		};
		return (
			<div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3">
				<StatusLine onRefresh={onRefresh} refreshing={refreshing} tone="error">
					Ollama is installed but not running
				</StatusLine>
				<p className="text-sm text-muted-foreground">
					Start it to download and run models. It keeps running in the
					background after you close Cline.
				</p>
				<div>
					<Button
						disabled={starting}
						onClick={() => void start()}
						size="sm"
						type="button"
					>
						{starting ? <Loader2 className="animate-spin" /> : <Play />}
						{starting ? "Starting Ollama…" : "Start Ollama"}
					</Button>
				</div>
				{startError ? (
					<p className="text-xs text-destructive" role="alert">
						{startError}
					</p>
				) : null}
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-3 rounded-lg border bg-card px-4 py-3">
			<StatusLine onRefresh={onRefresh} refreshing={refreshing} tone="error">
				Ollama isn't installed
			</StatusLine>
			<InstallSteps platform={status.hardware.platform} />
		</div>
	);
}
