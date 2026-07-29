import type { ChatForkRecord } from "@cline/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export { isChatForkSession } from "./chatForkSession";

export type ChatForkAuditPanelProps = {
	forks: ChatForkRecord[];
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
					{forks.map((fork) => (
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
					))}
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
							{focused.promote?.showItemIds?.length ? (
								<p className="text-muted-foreground">
									Show ids: {focused.promote.showItemIds.join(", ")}
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
