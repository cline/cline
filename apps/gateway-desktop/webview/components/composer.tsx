"use client";

import type { DesktopProjection } from "@shared/projection";
import { SearchCombobox } from "@cline/ui";
import {
	CornerDownLeft,
	Info,
	ListPlus,
	RotateCcw,
	Square,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ModelSelector } from "@/components/model-selector";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { BridgeClient } from "@/lib/bridge-client";
import { createClientRequestId, planComposer } from "@/lib/composer";

const DEFAULT_CONTEXT_WINDOW = 1_000_000;
const OPEN_FOLDER_VALUE = "__open_folder__";

function formatTokens(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
	return value.toLocaleString();
}

function UsageRow({
	label,
	value,
	muted = true,
}: {
	label: string;
	value: string;
	muted?: boolean;
}) {
	return (
		<div className="flex items-center justify-between gap-3">
			<span className={muted ? "text-muted-foreground" : ""}>{label}</span>
			<span className="font-mono tabular-nums">{value}</span>
		</div>
	);
}

function ContextUsage({ projection }: { projection: DesktopProjection }) {
	const [open, setOpen] = useState(false);
	const session = projection.activeSession;
	const usage = session?.usage;
	const used = usage?.inputTokens ?? 0;
	const limit = DEFAULT_CONTEXT_WINDOW;
	const percent = Math.min(100, Math.round((used / limit) * 100));
	const remaining = Math.max(0, limit - used);

	return (
		<div className="relative">
			<button
				aria-expanded={open}
				aria-label="Show context window usage"
				className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				onClick={() => setOpen((value) => !value)}
				type="button"
			>
				<span
					className="size-3.5 rounded-full"
					style={{
						background: `conic-gradient(var(--color-ring) ${percent}%, var(--color-muted) ${percent}% 100%)`,
					}}
				/>
			</button>
			{open ? (
				<div className="absolute right-0 bottom-full z-20 mb-2 w-72 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
					<div className="mb-2 flex items-center justify-between">
						<div className="flex items-center gap-1.5">
							<span className="font-medium">Context window</span>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										aria-label="About context window usage"
										className="rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
										type="button"
									>
										<Info aria-hidden className="size-3.5" />
									</button>
								</TooltipTrigger>
								<TooltipContent side="top">
									The gateway currently reports aggregate input/output usage.
									The input total is used as the context estimate.
								</TooltipContent>
							</Tooltip>
						</div>
						<span className="font-mono text-muted-foreground">
							{formatTokens(used)} / {formatTokens(limit)} ({percent}%)
						</span>
					</div>
					<div
						aria-label={`${percent}% of context window used`}
						aria-valuemax={100}
						aria-valuemin={0}
						aria-valuenow={percent}
						className="mb-3 h-1.5 overflow-hidden rounded-full bg-muted"
						role="progressbar"
					>
						<div
							className="h-full rounded-full bg-ring transition-[width]"
							style={{ width: `${percent}%` }}
						/>
					</div>
					<div className="space-y-1.5">
						<UsageRow label="Input tokens" value={formatTokens(used)} />
						<UsageRow
							label="Output tokens"
							value={formatTokens(usage?.outputTokens ?? 0)}
						/>
						<UsageRow
							label="Messages"
							value={(session?.messages.length ?? 0).toLocaleString()}
						/>
						<UsageRow
							label="Active tools"
							value={(session?.tools.length ?? 0).toLocaleString()}
						/>
						<div className="my-1 border-t" />
						<UsageRow
							label="Free space"
							value={formatTokens(remaining)}
							muted={false}
						/>
					</div>
				</div>
			) : null}
		</div>
	);
}

function WorkspaceSelector({
	projection,
	onChange,
}: {
	projection: DesktopProjection;
	onChange: (workspaceId: string) => void;
}) {
	if (projection.workspaces.length === 0) return null;
	return (
		<SearchCombobox
			ariaLabel="Workspace for the next new chat"
			className="max-w-48 text-xs"
			emptyText="No workspaces found."
			onValueChange={onChange}
			options={[
				...projection.workspaces.map((workspace) => ({
					label: workspace.label,
					value: workspace.workspaceId,
				})),
				{ label: "Open Folder…", value: OPEN_FOLDER_VALUE },
			]}
			placement="top"
			searchPlaceholder="Search workspaces"
			value={projection.selectedWorkspaceId ?? ""}
		/>
	);
}

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

	const selectWorkspace = useCallback(
		(workspaceId: string) => {
			const request =
				workspaceId === OPEN_FOLDER_VALUE
					? client.send({ command: "workspace.open" })
					: client.send({ command: "workspace.select", workspaceId });
			void request.catch((failure: { message?: string; code?: string }) => {
				setError(
					failure.message ?? failure.code ?? "Could not select workspace",
				);
			});
		},
		[client],
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
				{error && (
					<p className="gwd-selectable text-xs text-destructive">{error}</p>
				)}
				<div className="flex items-end gap-1.5 rounded-xl border bg-card px-2 py-1.5 shadow-sm transition-colors focus-within:border-ring/70 focus-within:ring-1 focus-within:ring-ring/40">
					<Textarea
						className="max-h-[132px] min-h-9 flex-1 resize-none border-0 bg-card px-1.5 py-1.5 font-sans text-sm leading-5 shadow-none focus-visible:ring-0 dark:bg-card"
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
						rows={1}
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
								className={
									text.trim() ? "text-foreground" : "text-muted-foreground"
								}
								disabled={Boolean(plan.disabledReason) || !text.trim()}
								onClick={() => submit("primary")}
								size="xs"
								title={primaryLabel}
								variant="ghost"
							>
								<CornerDownLeft aria-hidden className="size-3.5" />
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
				<div className="flex min-w-0 items-center justify-between px-1">
					<div className="flex min-w-0 items-center gap-2">
						<WorkspaceSelector
							onChange={selectWorkspace}
							projection={projection}
						/>
						<ModelSelector
							disabled={plan.primary === "steer_active_run"}
							modelId={modelId}
							onModelChange={setModelId}
							onProviderChange={selectProvider}
							providerId={providerId}
							providers={projection.providers}
						/>
					</div>
					<ContextUsage projection={projection} />
				</div>
			</div>
		</div>
	);
}
