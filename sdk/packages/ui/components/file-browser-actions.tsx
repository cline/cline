"use client";

import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, Copy, EllipsisVertical, FolderOpen, Globe } from "lucide-react";
import { useRef, useState } from "react";
import { IconButton } from "./button.js";

export interface FileBrowserActionHandlers {
	/** Reveal the file using the host's file manager or open its remote source URL. */
	onOpenFileLocation?: (path: string) => void | Promise<void>;
	/** Override the browser Clipboard API, for example in an editor webview. */
	onCopyPath?: (path: string) => void | Promise<void>;
}

export function FileBrowserActions({
	path,
	onOpenFileLocation,
	onCopyPath,
	onError,
	portalContainer,
}: FileBrowserActionHandlers & {
	path: string;
	onError: (message: string | null) => void;
	portalContainer?: HTMLElement | null;
}) {
	const LocationIcon = /^https?:\/\//i.test(path) ? Globe : FolderOpen;
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);

	// A result that arrives after the file changes is ignored: the host keys this
	// menu by path and only shows errors for the current one.
	const runAction = async (action: "open" | "copy") => {
		if (pending.current) return;
		pending.current = true;
		setBusy(true);
		onError(null);
		if (action === "copy") setCopied(false);
		try {
			if (action === "open") {
				await onOpenFileLocation?.(path);
			} else {
				if (onCopyPath) await onCopyPath(path);
				else await navigator.clipboard.writeText(path);
				setCopied(true);
			}
		} catch {
			onError(
				action === "open"
					? "Could not open file location."
					: "Could not copy path.",
			);
		} finally {
			pending.current = false;
			setBusy(false);
		}
	};

	return (
		<>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger asChild>
					<IconButton
						aria-label="File actions"
						aria-busy={busy || undefined}
						icon={EllipsisVertical}
						size="xs"
						title="File actions"
						variant="ghost"
						tone="neutral"
					/>
				</DropdownMenu.Trigger>
				<DropdownMenu.Portal container={portalContainer}>
					<DropdownMenu.Content
						align="end"
						sideOffset={4}
						collisionPadding={8}
						className="cline-ui-file-browser__menu"
					>
						<DropdownMenu.Item
							className="cline-ui-file-browser__menu-item"
							disabled={!onOpenFileLocation || busy}
							onSelect={() => void runAction("open")}
						>
							<LocationIcon aria-hidden="true" />
							Open file location
						</DropdownMenu.Item>
						<DropdownMenu.Item
							className="cline-ui-file-browser__menu-item"
							disabled={busy}
							onSelect={() => void runAction("copy")}
						>
							{copied ? (
								<Check aria-hidden="true" />
							) : (
								<Copy aria-hidden="true" />
							)}
							Copy path
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
			<output className="cline-ui-file-browser__action-status">
				{copied ? "Path copied." : ""}
			</output>
		</>
	);
}
