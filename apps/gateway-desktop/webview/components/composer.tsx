"use client";

import type { DesktopProjection } from "@shared/projection";
import { ListPlus, Loader2, RotateCcw, Send, Square } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ModelSelector } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { BridgeClient } from "@/lib/bridge-client";
import { createClientRequestId, planComposer } from "@/lib/composer";

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
	const currentRun = projection.activeSession?.currentRun;
	const running = currentRun?.state === "running";
	const responding = running && Boolean(projection.activeSession?.streaming);
	const [providerId, setProviderId] = useState(
		projection.selectedProviderId ?? projection.providers[0]?.providerId ?? "",
	);
	const [modelId, setModelId] = useState(
		projection.selectedModelId ??
			projection.providers.find(
				(provider) => provider.providerId === providerId,
			)?.modelIds[0] ??
			"",
	);

	useEffect(() => {
		if (!providerId && projection.selectedProviderId) {
			setProviderId(projection.selectedProviderId);
			setModelId(projection.selectedModelId ?? "");
		}
	}, [projection.selectedModelId, projection.selectedProviderId, providerId]);

	const selectProvider = useCallback(
		(nextProviderId: string) => {
			setProviderId(nextProviderId);
			setModelId(
				projection.providers.find(
					(provider) => provider.providerId === nextProviderId,
				)?.modelIds[0] ?? "",
			);
		},
		[projection.providers],
	);

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
							...(projection.selectedWorkspaceId && !projection.activeSession
								? { workspaceId: projection.selectedWorkspaceId }
								: {}),
							...(providerId ? { providerId } : {}),
							...(modelId ? { modelId } : {}),
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
		[text, botId, plan, client, projection, providerId, modelId],
	);

	const primaryLabel =
		plan.primary === "steer_active_run"
			? "Steer active run"
			: plan.primary === "start_first_session"
				? "Start session"
				: "Send turn";

	const abort = useCallback(() => {
		if (!currentRun || currentRun.state !== "running") return;
		void client
			.send({
				command: "run.abort",
				clientRequestId: createClientRequestId(),
				runId: currentRun.runId,
			})
			.catch((failure: { message?: string; code?: string }) => {
				setError(failure.message ?? failure.code ?? "Could not abort the run");
			});
	}, [client, currentRun]);

	const retry = useCallback(() => {
		if (!currentRun?.retryable) return;
		void client
			.send({
				command: "run.retry",
				clientRequestId: createClientRequestId(),
				runId: currentRun.runId,
			})
			.catch((failure: { message?: string; code?: string }) => {
				setError(failure.message ?? failure.code ?? "Could not retry the run");
			});
	}, [client, currentRun]);

	return (
		<div
			className="shrink-0 border-t bg-background px-5 py-4"
			data-testid="composer"
		>
			<div className="mx-auto flex max-w-(--breakpoint-lg) flex-col gap-2">
				{running ? (
					<div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
						<Loader2 className="size-3 animate-spin" />
						{responding ? "Model is responding…" : "Waiting for model response…"}
					</div>
				) : null}
				{error && (
					<p className="gwd-selectable text-xs text-destructive">{error}</p>
				)}
				<div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring">
					<Textarea
						className="max-h-40 min-h-13 flex-1 resize-none border-0 bg-transparent font-sans text-sm shadow-none focus-visible:ring-0"
						data-testid="composer-input"
						disabled={Boolean(plan.disabledReason)}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (
								event.key === "Enter" &&
								!event.shiftKey &&
								!event.nativeEvent.isComposing
							) {
								event.preventDefault();
								submit("primary");
							}
						}}
						placeholder={
							plan.disabledReason ??
							(plan.primary === "start_first_session"
								? "First prompt creates the session lazily…"
								: plan.primary === "steer_active_run"
									? "Steer the active run, or queue as the next turn…"
									: "Send a message…")
						}
						value={text}
					/>
					<div className="flex flex-col gap-1">
						{running ? (
							<Button
								aria-label="Abort running task"
								data-testid="composer-abort"
								onClick={abort}
								size="xs"
								title="Abort task"
								variant="ghost"
							>
								<Square aria-hidden className="size-3" />
							</Button>
						) : !text.trim() && currentRun?.retryable ? (
							<Button
								aria-label="Retry failed run"
								data-testid="retry-run"
								onClick={retry}
								size="xs"
								title="Retry"
								variant="ghost"
							>
								<RotateCcw aria-hidden className="size-3" />
							</Button>
						) : (
							<Button
								data-testid="composer-primary"
								disabled={Boolean(plan.disabledReason) || !text.trim()}
								onClick={() => submit("primary")}
								size="xs"
								title={primaryLabel}
								variant="ghost"
							>
								<Send aria-hidden className="size-3" />
							</Button>
						)}
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
				<div className="flex min-w-0 items-center px-1">
					<ModelSelector
						disabled={plan.primary === "steer_active_run"}
						modelId={modelId}
						onModelChange={setModelId}
						onProviderChange={selectProvider}
						providerId={providerId}
						providers={projection.providers}
					/>
				</div>
			</div>
		</div>
	);
}
