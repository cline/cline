"use client";

import { ListPlus, Navigation, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BridgeClient } from "@/lib/bridge-client";
import { createClientRequestId, planComposer } from "@/lib/composer";
import type { DesktopProjection } from "@shared/projection";

/**
 * Composer semantics (validated by lib/composer tests):
 * no session → first submit creates one; idle → FIFO turn;
 * running → primary steers, secondary queues the next turn.
 */
export function Composer({
	client,
	projection,
}: {
	client: BridgeClient;
	projection: DesktopProjection;
}) {
	const [text, setText] = useState("");
	const [error, setError] = useState<string | undefined>();
	const plan = planComposer(projection);
	const botId = projection.selectedBotId;

	const submit = useCallback(
		(mode: "primary" | "secondary") => {
			const trimmed = text.trim();
			if (!trimmed || !botId || plan.disabledReason) {
				return;
			}
			const action = mode === "secondary" ? plan.secondary : plan.primary;
			if (!action) {
				return;
			}
			const clientRequestId = createClientRequestId();
			const request =
				action === "steer_active_run" && plan.activeRunId
					? client.send({
							command: "run.steer",
							clientRequestId,
							runId: plan.activeRunId,
							text: trimmed,
						})
					: client.send({
							command: "run.start",
							clientRequestId,
							botId,
							...(projection.activeSession &&
							projection.activeSession.botId === botId
								? { sessionId: projection.activeSession.sessionId }
								: {}),
							...(projection.selectedWorkspaceId &&
							!projection.activeSession
								? { workspaceId: projection.selectedWorkspaceId }
								: {}),
							prompt: trimmed,
						});
			void request
				.then(() => {
					setText("");
					setError(undefined);
				})
				.catch((failure: { message?: string; code?: string }) => {
					setError(failure.message ?? failure.code ?? "Command failed");
				});
		},
		[text, botId, plan, client, projection],
	);

	const primaryLabel =
		plan.primary === "steer_active_run"
			? "Steer active run"
			: plan.primary === "start_first_session"
				? "Start session"
				: "Send turn";

	return (
		<div className="flex flex-col gap-2 border-t p-3" data-testid="composer">
			{error && (
				<p className="gwd-selectable text-xs text-destructive">{error}</p>
			)}
			<div className="flex items-end gap-2">
				<Textarea
					className="max-h-40 min-h-[60px] flex-1 resize-none font-sans text-sm"
					data-testid="composer-input"
					disabled={Boolean(plan.disabledReason)}
					onChange={(event) => setText(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
							event.preventDefault();
							submit("primary");
						}
					}}
					placeholder={
						plan.disabledReason ??
						(plan.primary === "start_first_session"
							? "First prompt creates the session lazily…"
							: plan.primary === "steer_active_run"
								? "Steer the active run (⌘⏎), or queue as the next turn…"
								: "Send the next FIFO turn (⌘⏎)…")
					}
					value={text}
				/>
				<div className="flex flex-col gap-1">
					<Button
						data-testid="composer-primary"
						disabled={Boolean(plan.disabledReason) || !text.trim()}
						onClick={() => submit("primary")}
						size="sm"
					>
						{plan.primary === "steer_active_run" ? (
							<Navigation aria-hidden className="size-3" />
						) : (
							<Send aria-hidden className="size-3" />
						)}
						{primaryLabel}
					</Button>
					{plan.secondary === "queue_turn" && (
						<Button
							data-testid="composer-secondary"
							disabled={!text.trim()}
							onClick={() => submit("secondary")}
							size="sm"
							variant="outline"
						>
							<ListPlus aria-hidden className="size-3" />
							Queue next turn
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
