"use client";

import {
	createContext,
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useContext,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Opens a file mentioned in the transcript. Provided by the chat pane only
 * when the host can open files itself (`HostCapabilities.transcriptFileLinks`);
 * without a provider every consumer renders plain text, so hosts that don't
 * opt in see exactly the markup they had before.
 */
export type TranscriptFileOpener = (target: {
	path: string;
	line?: number;
}) => void;

const TranscriptFileLinkContext = createContext<TranscriptFileOpener | null>(
	null,
);

export function TranscriptFileLinkProvider({
	children,
	onOpenFile,
}: {
	children: ReactNode;
	onOpenFile: TranscriptFileOpener | null | undefined;
}) {
	return (
		<TranscriptFileLinkContext.Provider value={onOpenFile ?? null}>
			{children}
		</TranscriptFileLinkContext.Provider>
	);
}

export function useTranscriptFileOpener(): TranscriptFileOpener | null {
	return useContext(TranscriptFileLinkContext);
}

/**
 * A file reference the user can open. Rendered as a `span[role=link]`, not
 * an anchor or button, because it often sits inside a tool row's disclosure
 * `<button>` (nested interactive elements are invalid HTML) — so it stops the
 * click from also toggling the row.
 */
export function TranscriptFileLink({
	path,
	line,
	className,
	children,
}: {
	path: string;
	line?: number;
	className?: string;
	children: ReactNode;
}) {
	const open = useTranscriptFileOpener();
	if (!open) return <>{children}</>;
	const activate = (event: MouseEvent | KeyboardEvent) => {
		event.preventDefault();
		event.stopPropagation();
		open({ path, line });
	};
	return (
		// biome-ignore lint/a11y/useSemanticElements: an <a>/<button> can't nest inside the tool row's disclosure <button>.
		<span
			className={cn(
				"cursor-pointer underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none",
				className,
			)}
			data-slot="transcript-file-link"
			onClick={activate}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") activate(event);
			}}
			role="link"
			tabIndex={0}
			title={line ? `Open ${path}:${line}` : `Open ${path}`}
		>
			{children}
		</span>
	);
}

// Inline `code` the model writes ("see `src/app.tsx:42`"). Conservative on
// purpose — no spaces, no URL scheme, and a final extension containing a
// letter — so identifiers (`useState`), commands (`bun test`), versions
// (`1.2.3`) and URLs stay plain text.
const INLINE_PATH_PATTERN =
	/^(?![a-z][a-z0-9+.-]*:\/\/)((?:\.{1,2}\/|\/|~\/)?(?:[\w@.-]+\/)*[\w@-][\w@.-]*\.(?=[a-z0-9]*[a-z])[a-z0-9]{1,8})(?::(\d+)(?::\d+)?)?$/i;

/** Parses an inline-code token as a file path (+ optional `:line[:col]`). */
export function parseInlineFilePath(
	text: string,
): { path: string; line?: number } | null {
	const value = text.trim();
	if (value.length === 0 || value.length > 260) return null;
	const match = INLINE_PATH_PATTERN.exec(value);
	if (!match) return null;
	return {
		path: match[1],
		line: match[2] ? Number.parseInt(match[2], 10) : undefined,
	};
}
