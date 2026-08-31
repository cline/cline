"use client";

import { AlertCircle, CheckCircle2, Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { basenamePath, formatRelativeTime } from "@/hooks/use-session-history";
import { desktopClient } from "@/lib/desktop-client";
import {
	type ImportableSession,
	importSelectionKey,
	type ListImportableSessionsResponse,
	SESSION_IMPORT_TOOL_LABELS,
	SESSION_IMPORT_TOOL_ORDER,
	type SessionImportProgressEvent,
	type SessionImportResult,
} from "@/lib/session-import";
import { cn } from "@/lib/utils";

type ImportPhase = "loading" | "pick" | "importing" | "done";

type ImportSessionsDialogProps = {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** Called after at least one session imported successfully. */
	onImported?: () => void;
};

function matchesQuery(session: ImportableSession, query: string): boolean {
	if (!query) return true;
	const haystack =
		`${session.title} ${session.cwd} ${session.preview ?? ""}`.toLowerCase();
	return query
		.toLowerCase()
		.split(/\s+/)
		.every((term) => haystack.includes(term));
}

export function ImportSessionsDialog({
	open,
	onOpenChange,
	onImported,
}: ImportSessionsDialogProps) {
	const [phase, setPhase] = useState<ImportPhase>("loading");
	const [scanError, setScanError] = useState<string | null>(null);
	const [sessions, setSessions] = useState<ImportableSession[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [query, setQuery] = useState("");
	const [progress, setProgress] = useState<{ done: number; total: number }>({
		done: 0,
		total: 0,
	});
	const [results, setResults] = useState<SessionImportResult[]>([]);

	const scan = useCallback(async () => {
		setPhase("loading");
		setScanError(null);
		try {
			const response =
				await desktopClient.invoke<ListImportableSessionsResponse>(
					"list_importable_sessions",
					{},
					// Scanning reads every source session file once; large
					// histories can take longer than the default RPC timeout.
					{ timeoutMs: 120_000 },
				);
			setSessions(response.sessions ?? []);
			setPhase("pick");
		} catch (error) {
			setScanError(error instanceof Error ? error.message : String(error));
			setPhase("pick");
		}
	}, []);

	// Fresh state on every open, then scan.
	useEffect(() => {
		if (!open) return;
		setSelected(new Set());
		setQuery("");
		setResults([]);
		setProgress({ done: 0, total: 0 });
		void scan();
	}, [open, scan]);

	useEffect(() => {
		if (!open) return;
		return desktopClient.subscribe("session_import_progress", (payload) => {
			const event = payload as SessionImportProgressEvent | undefined;
			if (!event || typeof event.index !== "number") return;
			setProgress({ done: event.index + 1, total: event.total });
			if (event.result) {
				setResults((previous) => [...previous, event.result]);
			}
		});
	}, [open]);

	const visibleSessions = useMemo(
		() => sessions.filter((session) => matchesQuery(session, query.trim())),
		[sessions, query],
	);

	const groups = useMemo(
		() =>
			SESSION_IMPORT_TOOL_ORDER.map((tool) => ({
				tool,
				sessions: visibleSessions.filter((session) => session.tool === tool),
			})).filter((group) => group.sessions.length > 0),
		[visibleSessions],
	);

	const selectableKeys = useCallback(
		(items: ImportableSession[]) =>
			items
				.filter((session) => !session.alreadyImportedSessionId)
				.map((session) => importSelectionKey(session.tool, session.sourceId)),
		[],
	);

	const toggleAll = (items: ImportableSession[], checked: boolean) => {
		setSelected((previous) => {
			const next = new Set(previous);
			for (const key of selectableKeys(items)) {
				if (checked) next.add(key);
				else next.delete(key);
			}
			return next;
		});
	};

	const startImport = async () => {
		const selections = sessions
			.filter((session) =>
				selected.has(importSelectionKey(session.tool, session.sourceId)),
			)
			.map((session) => ({ tool: session.tool, sourceId: session.sourceId }));
		if (selections.length === 0) return;
		setPhase("importing");
		setResults([]);
		setProgress({ done: 0, total: selections.length });
		try {
			const response = await desktopClient.invoke<{
				results: SessionImportResult[];
			}>("import_sessions", { selections }, { timeoutMs: null });
			// The progress events already streamed results; trust the final
			// response as the authoritative list.
			setResults(response.results ?? []);
			if ((response.results ?? []).some((result) => result.ok)) {
				onImported?.();
			}
		} catch (error) {
			setResults([
				{
					tool: "claude-code",
					sourceId: "",
					ok: false,
					error: error instanceof Error ? error.message : String(error),
				},
			]);
		}
		setPhase("done");
	};

	const succeeded = results.filter((result) => result.ok);
	const failures = results.filter((result) => !result.ok);
	const importableCount = sessions.filter(
		(session) => !session.alreadyImportedSessionId,
	).length;

	return (
		<Dialog
			onOpenChange={(next) => {
				// Don't let a stray overlay click abandon a running import.
				if (!next && phase === "importing") return;
				onOpenChange(next);
			}}
			open={open}
		>
			<DialogContent className="grid h-[min(680px,calc(100dvh-2rem))] w-[min(620px,calc(100vw-2rem))] max-w-none grid-rows-[auto_minmax(0,1fr)_auto] gap-4 overflow-hidden">
				<DialogHeader>
					<DialogTitle>Import sessions</DialogTitle>
					<DialogDescription>
						Bring your conversation history from other coding tools into Cline.
						Imported sessions appear in your history and can be continued here.
					</DialogDescription>
				</DialogHeader>

				{phase === "loading" ? (
					<div className="flex min-h-0 flex-col items-center justify-center gap-3 text-muted-foreground">
						<Loader2 className="size-5 animate-spin" />
						<p className="text-sm">Scanning for sessions…</p>
					</div>
				) : null}

				{phase === "pick" ? (
					<div className="flex min-h-0 flex-col gap-3">
						{scanError ? (
							<p className="text-sm text-destructive" role="alert">
								Couldn't scan for sessions: {scanError}
							</p>
						) : null}
						{sessions.length === 0 && !scanError ? (
							<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center">
								<p className="text-sm font-medium text-foreground">
									No sessions found
								</p>
								<p className="max-w-sm text-sm text-muted-foreground">
									Cline looks for local history from Claude Code, Codex, and
									opencode. Nothing importable turned up on this machine.
								</p>
							</div>
						) : null}
						{sessions.length > 0 ? (
							<>
								<div className="relative">
									<Search className="-translate-y-1/2 pointer-events-none absolute left-2.5 top-1/2 size-4 text-muted-foreground" />
									<Input
										aria-label="Filter sessions"
										className="h-8 pl-8"
										onChange={(event) => setQuery(event.target.value)}
										placeholder="Filter by title or folder"
										value={query}
									/>
								</div>
								<div className="min-h-0 flex-1 overflow-y-auto pr-1">
									{groups.map((group) => {
										const keys = selectableKeys(group.sessions);
										const selectedInGroup = keys.filter((key) =>
											selected.has(key),
										).length;
										const allChecked =
											keys.length > 0 && selectedInGroup === keys.length;
										return (
											<section className="mb-4" key={group.tool}>
												<div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-background py-1.5">
													<Checkbox
														aria-label={`Select all ${SESSION_IMPORT_TOOL_LABELS[group.tool]} sessions`}
														checked={
															allChecked
																? true
																: selectedInGroup > 0
																	? "indeterminate"
																	: false
														}
														disabled={keys.length === 0}
														onCheckedChange={(checked) =>
															toggleAll(group.sessions, checked === true)
														}
													/>
													<h3 className="text-sm font-semibold text-foreground">
														{SESSION_IMPORT_TOOL_LABELS[group.tool]}
													</h3>
													<span className="text-xs text-muted-foreground">
														{group.sessions.length}
													</span>
												</div>
												<ul>
													{group.sessions.map((session) => {
														const key = importSelectionKey(
															session.tool,
															session.sourceId,
														);
														const alreadyImported = Boolean(
															session.alreadyImportedSessionId,
														);
														const checked = selected.has(key);
														const checkboxId = `import-session-${key}`;
														return (
															<li key={key}>
																<label
																	className={cn(
																		"flex cursor-pointer items-start gap-2.5 rounded-md px-1.5 py-2 hover:bg-muted/40",
																		alreadyImported &&
																			"cursor-default opacity-60",
																	)}
																	htmlFor={checkboxId}
																>
																	<Checkbox
																		aria-label={`Import "${session.title}"`}
																		checked={checked}
																		className="mt-0.5"
																		disabled={alreadyImported}
																		id={checkboxId}
																		onCheckedChange={(next) =>
																			setSelected((previous) => {
																				const nextSet = new Set(previous);
																				if (next === true) nextSet.add(key);
																				else nextSet.delete(key);
																				return nextSet;
																			})
																		}
																	/>
																	<span className="min-w-0 flex-1">
																		<span className="flex items-center gap-2">
																			<span className="truncate text-sm text-foreground">
																				{session.title}
																			</span>
																			{alreadyImported ? (
																				<Badge
																					className="shrink-0"
																					variant="secondary"
																				>
																					Imported
																				</Badge>
																			) : null}
																		</span>
																		<span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
																			<span>
																				{formatRelativeTime(
																					session.updatedAtMs,
																				)}
																			</span>
																			<span aria-hidden>·</span>
																			<span>
																				{session.messageCount} message
																				{session.messageCount === 1 ? "" : "s"}
																			</span>
																			{session.cwd ? (
																				<>
																					<span aria-hidden>·</span>
																					<span className="truncate">
																						{basenamePath(session.cwd)}
																					</span>
																				</>
																			) : null}
																		</span>
																	</span>
																</label>
															</li>
														);
													})}
												</ul>
											</section>
										);
									})}
									{groups.length === 0 ? (
										<p className="py-8 text-center text-sm text-muted-foreground">
											No sessions match "{query.trim()}".
										</p>
									) : null}
								</div>
							</>
						) : null}
					</div>
				) : null}

				{phase === "importing" ? (
					<div className="flex min-h-0 flex-col gap-4">
						<div className="flex flex-col gap-2">
							<div className="flex items-center justify-between text-sm">
								<span className="text-foreground">Importing sessions…</span>
								<span className="text-muted-foreground">
									{progress.done} / {progress.total}
								</span>
							</div>
							<Progress
								value={
									progress.total > 0
										? (progress.done / progress.total) * 100
										: 0
								}
							/>
						</div>
						<ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1 text-sm">
							{results.map((result) => (
								<li
									className="flex items-center gap-2"
									key={importSelectionKey(result.tool, result.sourceId)}
								>
									{result.ok ? (
										<CheckCircle2 className="size-4 shrink-0 text-muted-foreground" />
									) : (
										<AlertCircle className="size-4 shrink-0 text-destructive" />
									)}
									<span className="truncate text-muted-foreground">
										{result.title ?? result.sourceId}
									</span>
								</li>
							))}
						</ul>
					</div>
				) : null}

				{phase === "done" ? (
					<div className="flex min-h-0 flex-col gap-3">
						<p className="text-sm text-foreground">
							{succeeded.length > 0
								? `Imported ${succeeded.length} session${succeeded.length === 1 ? "" : "s"}.`
								: "No sessions were imported."}
							{failures.length > 0
								? ` ${failures.length} failed.`
								: succeeded.length > 0
									? " They're in your history now."
									: ""}
						</p>
						{failures.length > 0 ? (
							<ul className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 text-sm">
								{failures.map((failure) => (
									<li
										className="flex items-start gap-2"
										key={importSelectionKey(failure.tool, failure.sourceId)}
									>
										<AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
										<span className="min-w-0">
											<span className="block truncate text-foreground">
												{failure.title ?? failure.sourceId}
											</span>
											<span className="block text-xs text-muted-foreground">
												{failure.error}
											</span>
										</span>
									</li>
								))}
							</ul>
						) : null}
					</div>
				) : null}

				<DialogFooter>
					{phase === "pick" ? (
						<>
							<span className="mr-auto self-center text-xs text-muted-foreground">
								{selected.size > 0
									? `${selected.size} selected`
									: importableCount > 0
										? `${importableCount} available`
										: ""}
							</span>
							<Button
								onClick={() => onOpenChange(false)}
								type="button"
								variant="ghost"
							>
								Cancel
							</Button>
							<Button
								disabled={selected.size === 0}
								onClick={() => void startImport()}
								type="button"
							>
								Import{selected.size > 0 ? ` ${selected.size}` : ""}
							</Button>
						</>
					) : null}
					{phase === "importing" ? (
						<Button disabled type="button">
							<Loader2 className="size-4 animate-spin" />
							Importing…
						</Button>
					) : null}
					{phase === "done" ? (
						<Button onClick={() => onOpenChange(false)} type="button">
							Done
						</Button>
					) : null}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
