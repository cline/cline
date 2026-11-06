import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { basenamePath, formatRelativeTime } from "@/hooks/use-session-history";
import { toast } from "@/hooks/use-toast";
import { desktopClient } from "@/lib/desktop-client";
import {
	getSessionMetadataTitle,
	type SessionHistoryItem,
} from "@/lib/session-history";

interface ExportDiagnosticsDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function sessionLabel(session: SessionHistoryItem): string {
	return (
		getSessionMetadataTitle(session.metadata) ||
		session.prompt?.trim() ||
		session.sessionId
	);
}

export function ExportDiagnosticsDialog({
	open,
	onOpenChange,
}: ExportDiagnosticsDialogProps) {
	const [sessions, setSessions] = useState<SessionHistoryItem[]>([]);
	const [selected, setSelected] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		setLoading(true);
		setError(null);
		desktopClient
			.invoke<SessionHistoryItem[]>("list_discovered_sessions")
			.then((items) => {
				if (cancelled) return;
				// Cloud sessions have no local files to include.
				const local = (Array.isArray(items) ? items : []).filter(
					(item) => item.origin !== "cloud" && !item.isSubagent,
				);
				setSessions(local);
				// The most recent session is almost always the one the bug was in.
				setSelected(new Set(local.slice(0, 1).map((item) => item.sessionId)));
			})
			.catch((cause) => {
				if (cancelled) return;
				setSessions([]);
				setError(cause instanceof Error ? cause.message : String(cause));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [open]);

	const toggle = (sessionId: string, checked: boolean) => {
		setSelected((previous) => {
			const next = new Set(previous);
			if (checked) next.add(sessionId);
			else next.delete(sessionId);
			return next;
		});
	};

	const exportBundle = async () => {
		setExporting(true);
		setError(null);
		try {
			const result = await desktopClient.invoke<{ path: string }>(
				"export_diagnostics",
				{ sessionIds: [...selected] },
			);
			toast({
				title: "Diagnostics exported",
				description: result.path,
			});
			onOpenChange(false);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setExporting(false);
		}
	};

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent className="grid max-h-[min(640px,calc(100dvh-2rem))] w-[min(560px,calc(100vw-2rem))] max-w-none grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] gap-4 sm:max-w-none">
				<DialogHeader className="min-w-0">
					<DialogTitle>Export diagnostics</DialogTitle>
					<DialogDescription>
						Saves a text file with app info, recent logs, and the metadata of
						the sessions you pick. Prompts, conversation contents, and API keys
						are never included.
					</DialogDescription>
				</DialogHeader>
				<div className="flex min-h-0 min-w-0 flex-col gap-2">
					<p className="text-sm font-medium text-foreground">Sessions</p>
					{loading ? (
						<div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							Loading sessions…
						</div>
					) : sessions.length === 0 ? (
						<p className="py-6 text-sm text-muted-foreground">
							No local sessions on this machine yet.
						</p>
					) : (
						<div className="min-h-0 overflow-y-auto rounded-md border">
							{sessions.map((session) => {
								const id = `export-diagnostics-${session.sessionId}`;
								return (
									<label
										className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-muted/50"
										htmlFor={id}
										key={session.sessionId}
									>
										<Checkbox
											checked={selected.has(session.sessionId)}
											id={id}
											onCheckedChange={(checked) =>
												toggle(session.sessionId, checked === true)
											}
										/>
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate text-sm text-foreground">
												{sessionLabel(session)}
											</span>
											<span className="truncate text-xs text-muted-foreground">
												{basenamePath(session.workspaceRoot || session.cwd)}
												{" · "}
												{formatRelativeTime(
													session.lastActivityAt ?? session.startedAt,
												)}
											</span>
										</span>
									</label>
								);
							})}
						</div>
					)}
					{error ? (
						<p className="text-sm text-destructive" role="alert">
							{error}
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button
						disabled={exporting}
						onClick={() => onOpenChange(false)}
						variant="outline"
					>
						Cancel
					</Button>
					<Button disabled={exporting || loading} onClick={exportBundle}>
						{exporting ? <Loader2 className="size-4 animate-spin" /> : null}
						Export
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
