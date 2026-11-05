"use client";

import { ExternalLink, Globe, RotateCw, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openExternalUrl } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";
import { WorkspacePanelFrame } from "./workspace-panel-frame";

const URL_STORAGE_KEY = "cline.code.browser-url";

/**
 * Accepts what people type into an address bar: a bare port opens localhost,
 * local hosts default to http and everything else to https.
 */
export function normalizeBrowserUrl(input: string): string | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	let candidate = trimmed;
	if (/^\d+$/.test(trimmed)) {
		candidate = `http://localhost:${trimmed}`;
	} else if (!/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) {
		const local = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(trimmed);
		candidate = `${local ? "http" : "https"}://${trimmed}`;
	}
	try {
		const url = new URL(candidate);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

function readStoredUrl(): string | null {
	try {
		return window.localStorage.getItem(URL_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function BrowserPanel({ onClose }: { onClose: () => void }) {
	const [url, setUrl] = useState(readStoredUrl);
	const [input, setInput] = useState(url ?? "");
	const [invalid, setInvalid] = useState(false);
	// Remounting the frame reloads it; its cross-origin document can't be told to.
	const [reloadKey, setReloadKey] = useState(0);

	const navigate = () => {
		const next = normalizeBrowserUrl(input);
		if (!next) {
			setInvalid(true);
			return;
		}
		setInput(next);
		setUrl(next);
		setReloadKey((key) => key + 1);
		try {
			window.localStorage.setItem(URL_STORAGE_KEY, next);
		} catch {
			// Not remembering the URL is harmless.
		}
	};

	return (
		<WorkspacePanelFrame id="browser-panel">
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-card px-1.5">
					<Button
						aria-label="Reload"
						className="size-6 shrink-0 text-muted-foreground"
						disabled={!url}
						onClick={() => setReloadKey((key) => key + 1)}
						size="icon-sm"
						title="Reload"
						type="button"
						variant="ghost"
					>
						<RotateCw className="size-3.5" />
					</Button>
					<form
						className="min-w-0 flex-1"
						onSubmit={(event) => {
							event.preventDefault();
							navigate();
						}}
					>
						<input
							aria-invalid={invalid}
							aria-label="URL"
							autoCapitalize="off"
							autoCorrect="off"
							className={cn(
								"h-6 w-full rounded-md border border-transparent bg-secondary px-2 font-mono text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring",
								invalid &&
									"border-destructive focus-visible:border-destructive",
							)}
							onChange={(event) => {
								setInput(event.target.value);
								setInvalid(false);
							}}
							onFocus={(event) => event.currentTarget.select()}
							placeholder="localhost:3000"
							spellCheck={false}
							value={input}
						/>
					</form>
					<Button
						aria-label="Open in browser"
						className="size-6 shrink-0 text-muted-foreground"
						disabled={!url}
						onClick={() => url && void openExternalUrl(url)}
						size="icon-sm"
						title="Open in browser"
						type="button"
						variant="ghost"
					>
						<ExternalLink className="size-3.5" />
					</Button>
					<Button
						aria-label="Hide browser"
						className="size-6 shrink-0 text-muted-foreground"
						onClick={onClose}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<X className="size-3.5" />
					</Button>
				</div>
				{url ? (
					// No allow-top-navigation: a frame-busting page must not be able
					// to navigate the app itself away.
					<iframe
						className="min-h-0 w-full flex-1 border-0 bg-white"
						key={reloadKey}
						sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
						src={url}
						title="Browser"
					/>
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
						<Globe className="size-5" />
						<p>
							Enter a URL to preview a page, like the dev server for the app
							Cline is building.
						</p>
					</div>
				)}
			</div>
		</WorkspacePanelFrame>
	);
}
