"use client";

import { AgentChangedFile, AgentChangesPanel } from "@cline/ui";
import { ToolFileDiff } from "@cline/ui/components/agent-chat/tool-diff";
import { AppWindow, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import type { SessionDiffHunk, SessionFileDiff } from "@/lib/session-diff";
import { resolveWorkspaceFilePath } from "@/lib/workspace-paths";
import { EditorIcon } from "./editor-icons";

type DiffViewProps = {
	environmentId: string;
	fileDiffs: SessionFileDiff[];
	cwd?: string;
	onClose: () => void;
};

type EditorOption = {
	id: string;
	label: string;
};

export function DiffView({
	environmentId,
	fileDiffs,
	cwd,
	onClose,
}: DiffViewProps) {
	const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
	const [editors, setEditors] = useState<EditorOption[]>([]);

	useEffect(() => {
		let cancelled = false;
		desktopClient
			.invoke<EditorOption[]>("list_available_editors")
			.then((list) => {
				if (!cancelled && Array.isArray(list)) setEditors(list);
			})
			.catch(() => {
				// Older sidecars don't support the command; the menu still
				// offers the system default opener.
			});
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<AgentChangesPanel
			title="Uncommitted changes"
			fileCount={fileDiffs.length}
			onClose={onClose}
			renderScroll={(content) => (
				<ScrollArea className="min-h-0 flex-1">{content}</ScrollArea>
			)}
			emptyMessage={
				fileDiffs.length === 0
					? "No file changes in this session yet."
					: undefined
			}
		>
			<div className="flex flex-col">
				{fileDiffs.map((file) => (
					<DiffFileSection
						key={file.path}
						cwd={cwd}
						editors={editors}
						environmentId={environmentId}
						file={file}
						collapsed={collapsedFiles.has(file.path)}
						onToggle={() =>
							setCollapsedFiles((previous) => {
								const next = new Set(previous);
								if (next.has(file.path)) next.delete(file.path);
								else next.add(file.path);
								return next;
							})
						}
					/>
				))}
			</div>
		</AgentChangesPanel>
	);
}

function DiffFileSection({
	file,
	collapsed,
	onToggle,
	cwd,
	editors,
	environmentId,
}: {
	file: SessionFileDiff;
	collapsed: boolean;
	onToggle: () => void;
	cwd?: string;
	editors: EditorOption[];
	environmentId: string;
}) {
	const [copied, setCopied] = useState(false);
	const [opening, setOpening] = useState(false);
	const copyResetTimerRef = useRef<number | null>(null);
	const resolvedPath = resolveWorkspaceFilePath(file.path, cwd);

	const handleCopyPath = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(resolvedPath);
			setCopied(true);
			if (copyResetTimerRef.current !== null) {
				window.clearTimeout(copyResetTimerRef.current);
			}
			copyResetTimerRef.current = window.setTimeout(() => {
				setCopied(false);
				copyResetTimerRef.current = null;
			}, 1600);
		} catch {
			toast({
				variant: "destructive",
				title: "Copy failed",
				description: "The file path could not be copied to the clipboard.",
			});
		}
	}, [resolvedPath]);

	const handleOpenInEditor = useCallback(
		async (editor?: string) => {
			setOpening(true);
			try {
				await desktopClient.invoke("open_file_in_editor", {
					environmentId,
					path: file.path,
					...(cwd?.trim() ? { cwd } : {}),
					...(editor ? { editor } : {}),
				});
			} catch (error) {
				toast({
					variant: "destructive",
					title: "Could not open file",
					description:
						error instanceof Error
							? error.message
							: "The file could not be opened in an editor.",
				});
			} finally {
				setOpening(false);
			}
		},
		[cwd, environmentId, file.path],
	);

	return (
		<AgentChangedFile
			path={file.path}
			expanded={!collapsed}
			onExpandedChange={onToggle}
			additions={file.additions}
			deletions={file.deletions}
			copied={copied}
			onCopyPath={() => void handleCopyPath()}
			actions={
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							aria-label={`Open ${file.path} in editor`}
							className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50 data-[state=open]:opacity-100 data-[state=open]:bg-surface-hover data-[state=open]:text-foreground"
							disabled={opening}
							title="Open in editor"
							type="button"
						>
							<ExternalLink className="h-3.5 w-3.5" />
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-52">
						<DropdownMenuLabel>Open in</DropdownMenuLabel>
						{editors.map((editor) => (
							<DropdownMenuItem
								key={editor.id}
								onSelect={() => void handleOpenInEditor(editor.id)}
							>
								<EditorIcon editorId={editor.id} />
								{editor.label}
							</DropdownMenuItem>
						))}
						{editors.length > 0 && <DropdownMenuSeparator />}
						<DropdownMenuItem
							onSelect={() => void handleOpenInEditor("default")}
						>
							<AppWindow aria-hidden />
							System default
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			}
		>
			{file.hunks.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No hunk details available.
				</p>
			) : (
				// The index disambiguates repeated same-shaped hunks (e.g.
				// a file created twice with identical contents); hunks
				// never reorder within a file, so it is a stable key.
				file.hunks.map((hunk, index) => (
					<DiffHunk
						hunk={hunk}
						key={`${file.path}-${index}-${hunk.oldStart}-${hunk.newStart}-${hunk.old.length}-${hunk.new.length}`}
						path={file.path}
					/>
				))
			)}
		</AgentChangedFile>
	);
}

function DiffHunk({ hunk, path }: { hunk: SessionDiffHunk; path: string }) {
	// A hunk with no old side that starts at line 1 on both sides carries the
	// complete new contents (editor `create`, apply_patch Add File). Chat tool
	// rows render those with complete-file semantics (real line numbers);
	// everything else is a file fragment, which hides line numbers — see
	// ToolCallRow in chat-messages.tsx. Matching that keeps both surfaces
	// visually in agreement.
	const isCompleteNewContents =
		hunk.old.length === 0 && hunk.oldStart === 1 && hunk.newStart === 1;

	return (
		<ToolFileDiff
			background="var(--background)"
			className="cline-chat-selectable"
			fragment={!isCompleteNewContents}
			newText={hunk.new}
			oldText={isCompleteNewContents ? undefined : hunk.old}
			path={path}
		/>
	);
}
