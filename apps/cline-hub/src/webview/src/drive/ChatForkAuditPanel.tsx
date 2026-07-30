import type { ChatForkRecord, ShowBacklogItem } from "@cline/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { showIdsForFork } from "./chatForkSession";

export { isChatForkSession, showIdsForFork } from "./chatForkSession";

export type ChatForkAuditPanelProps = {
	forks: ChatForkRecord[];
	/** Director show backlog — used to list shows created/linked for a Do. */
	showBacklog?: ShowBacklogItem[];
	focusedAuditHandle: string | null;
	auditMessages: unknown[];
	summaryOnly: boolean;
	open: boolean;
	onClose: () => void;
	onOpenAudit: (auditHandle: string) => void;
	onRetain: (workerSessionId: string, retain: boolean) => void;
	className?: string;
};

export function ChatForkAuditPanel({
	forks,
	showBacklog = [],
	focusedAuditHandle,
	auditMessages,
	summaryOnly,
	open,
	onClose,
	onOpenAudit,
	onRetain,
	className,
}: ChatForkAuditPanelProps) {
	if (!open) {
		return null;
	}

	const focused = forks.find(
		(fork) =>
			fork.workerSessionId === focusedAuditHandle ||
			fork.promote?.auditHandle === focusedAuditHandle,
	);
	const focusedShowIds = focused
		? showIdsForFork(focused, showBacklog)
		: [];

	return (
		<aside
			aria-label="Worker audit"
			className={cn(
				"flex min-h-[12rem] w-full flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm",
				className,
			)}
		>
			<div className="flex items-center justify-between gap-2">
				<h3 className="font-medium">Workers</h3>
				<Button onClick={onClose} size="sm" type="button" variant="ghost">
					Close
				</Button>
			</div>
			{forks.length === 0 ? (
				<p className="text-xs text-muted-foreground">
					No invisible workers. Claims appear here while retained for audit.
				</p>
			) : (
				<ul className="flex flex-col gap-2">
					{forks.map((fork) => {
						const showIds = showIdsForFork(fork, showBacklog);
						return (
							<li
								className="rounded border border-border/60 p-2"
								key={fork.workerSessionId}
							>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div>
										<p className="font-medium">{fork.seed.title}</p>
										<p className="text-xs text-muted-foreground">
											{fork.lifecycle} · {fork.seed.doItemId}
										</p>
										{showIds.length > 0 ? (
											<p className="text-xs text-muted-foreground">
												Shows: {showIds.join(", ")}
											</p>
										) : null}
									</div>
									<div className="flex gap-1">
										<Button
											onClick={() => onOpenAudit(fork.workerSessionId)}
											size="sm"
											type="button"
											variant="outline"
										>
											Open audit
										</Button>
										{fork.promote ? (
											<Button
												onClick={() =>
													onRetain(
														fork.workerSessionId,
														!fork.promote?.retainForAudit,
													)
												}
												size="sm"
												type="button"
												variant="ghost"
											>
												{fork.promote.retainForAudit ? "Drop" : "Retain"}
											</Button>
										) : null}
									</div>
								</div>
							</li>
						);
					})}
				</ul>
			)}
			{focused ? (
				<div className="mt-2 rounded border border-dashed border-border p-2">
					<p className="mb-1 text-xs font-medium text-muted-foreground">
						Audit · {focused.seed.title}
					</p>
					{summaryOnly || focused.lifecycle === "dropped" ? (
						<div className="space-y-1 text-xs">
							<p>{focused.promote?.summary ?? "No summary"}</p>
							{focusedShowIds.length ? (
								<p className="text-muted-foreground">
									Show ids: {focusedShowIds.join(", ")}
								</p>
							) : null}
							{focused.seed.linkedShowTemplateIds.length > 0 ? (
								<p className="text-muted-foreground">
									Templates:{" "}
									{focused.seed.linkedShowTemplateIds.join(", ")}
								</p>
							) : null}
						</div>
					) : (
						<pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs">
							{JSON.stringify(auditMessages, null, 2)}
						</pre>
					)}
				</div>
			) : null}
		</aside>
	);
}
