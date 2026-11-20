"use client";

import { ExternalLink, Globe, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	openExternalUrl,
	resolveDesktopBackendWsEndpoint,
} from "@/lib/desktop-client";
import { cn } from "@/lib/utils";
import { WorkspacePanelFrame } from "./workspace-panel-frame";

const URL_STORAGE_KEY = "cline.code.browser-url";

/**
 * Accepts what people type into an address bar: a bare port opens localhost,
 * local hosts default to http and everything else to https. `file:` URLs are
 * accepted too and are served by the sidecar (see `toFrameSrc`).
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
		if (url.protocol === "file:") {
			// Only local paths: no UNC-style hosts.
			return url.hostname === "" || url.hostname === "localhost"
				? url.href
				: null;
		}
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: null;
	} catch {
		return null;
	}
}

/**
 * The sidecar's preview-only token, derived one-way from the approval token
 * (must match `derivePreviewToken` in sidecar/preview-files.ts). The previewed
 * page can read its own address, so the approval token itself never goes there.
 */
async function previewToken(approvalToken: string): Promise<string> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(approvalToken),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode("preview-file"),
	);
	return Array.from(new Uint8Array(signature), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/**
 * The address a frame should load for a normalized URL. Frames can't open
 * `file:` documents from the app's origin, so those go through the sidecar's
 * `/preview-file` route instead.
 */
export async function toFrameSrc(
	url: string,
	wsEndpoint: string,
): Promise<string> {
	const parsed = new URL(url);
	if (parsed.protocol !== "file:") return url;
	const endpoint = new URL(wsEndpoint);
	const approvalToken = endpoint.searchParams.get("approval_token");
	if (!approvalToken) throw new Error("The sidecar endpoint has no token");
	const token = await previewToken(approvalToken);
	endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
	endpoint.pathname = `/preview-file/${token}${parsed.pathname}`;
	endpoint.search = "";
	endpoint.hash = parsed.hash;
	return endpoint.toString();
}

function readStoredUrl(): string | null {
	try {
		return window.localStorage.getItem(URL_STORAGE_KEY);
	} catch {
		return null;
	}
}

/** Sets the URL the panel opens on the next time it mounts. */
export function storeBrowserUrl(url: string): void {
	try {
		window.localStorage.setItem(URL_STORAGE_KEY, url);
	} catch {
		// Not remembering the URL is harmless.
	}
}

export function BrowserPanel({ onClose }: { onClose: () => void }) {
	const [url, setUrl] = useState(readStoredUrl);
	const [input, setInput] = useState(url ?? "");
	const [invalid, setInvalid] = useState(false);
	// Remounting the frame reloads it; its cross-origin document can't be told to.
	const [reloadKey, setReloadKey] = useState(0);

	const [frameSrc, setFrameSrc] = useState<string | null>(null);
	useEffect(() => {
		let cancelled = false;
		if (!url) {
			setFrameSrc(null);
			return;
		}
		if (!url.startsWith("file:")) {
			setFrameSrc(url);
			return;
		}
		setFrameSrc(null);
		void resolveDesktopBackendWsEndpoint()
			.then((endpoint) => toFrameSrc(url, endpoint))
			.then((src) => {
				if (!cancelled) setFrameSrc(src);
			})
			.catch(() => {
				if (!cancelled) setInvalid(true);
			});
		return () => {
			cancelled = true;
		};
	}, [url]);

	const navigate = () => {
		const next = normalizeBrowserUrl(input);
		if (!next) {
			setInvalid(true);
			return;
		}
		setInput(next);
		setUrl(next);
		setReloadKey((key) => key + 1);
		storeBrowserUrl(next);
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
						// The system browser is only handed web addresses.
						disabled={!url || url.startsWith("file:")}
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
				{frameSrc ? (
					// No allow-top-navigation: a frame-busting page must not be able
					// to navigate the app itself away.
					<iframe
						className="min-h-0 w-full flex-1 border-0 bg-white"
						key={reloadKey}
						sandbox="allow-downloads allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
						src={frameSrc}
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
