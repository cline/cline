"use client";

import { useCallback, useEffect, useId, useState } from "react";

export interface AgentPromptQueueItem {
	attachmentCount?: number;
	id: string;
	prompt: string;
	steer: boolean;
}

export interface AgentPromptQueueProps {
	items: readonly AgentPromptQueueItem[];
	onEdit: (id: string, prompt: string) => Promise<void> | void;
	onRemove: (id: string) => Promise<void> | void;
	onSteer: (id: string) => Promise<void> | void;
}

type IconName =
	| "arrow-up"
	| "check"
	| "chevron-down"
	| "chevron-right"
	| "clock"
	| "pencil"
	| "trash"
	| "x";

const ACTION_CLASS_NAME =
	"cline-ui-agent-prompt-queue__action inline-flex cursor-pointer items-center justify-center rounded-cline-ui-md border-0 bg-transparent p-1.5 text-cline-ui-muted-foreground transition-[color,background-color] duration-150 ease-[ease] enabled:hover:bg-cline-ui-accent enabled:hover:text-cline-ui-foreground focus-visible:outline-2 focus-visible:outline-cline-ui-ring focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-50";

function Icon({ name, small = false }: { name: IconName; small?: boolean }) {
	return (
		<svg
			aria-hidden="true"
			className={[
				"shrink-0",
				small ? "cline-ui-agent-prompt-queue__icon--small size-3.5" : "size-4",
			].join(" ")}
			fill="none"
			stroke="currentColor"
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth="2"
			viewBox="0 0 24 24"
		>
			{name === "arrow-up" ? (
				<>
					<path d="m5 12 7-7 7 7" />
					<path d="M12 19V5" />
				</>
			) : null}
			{name === "check" ? <path d="M20 6 9 17l-5-5" /> : null}
			{name === "chevron-down" ? <path d="m6 9 6 6 6-6" /> : null}
			{name === "chevron-right" ? <path d="m9 18 6-6-6-6" /> : null}
			{name === "clock" ? (
				<>
					<path d="M12 6v6h4" />
					<circle cx="12" cy="12" r="10" />
				</>
			) : null}
			{name === "pencil" ? (
				<>
					<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
					<path d="m15 5 4 4" />
				</>
			) : null}
			{name === "trash" ? (
				<>
					<path d="M3 6h18" />
					<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
					<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
					<line x1="10" x2="10" y1="11" y2="17" />
					<line x1="14" x2="14" y1="11" y2="17" />
				</>
			) : null}
			{name === "x" ? (
				<>
					<path d="M18 6 6 18" />
					<path d="m6 6 12 12" />
				</>
			) : null}
		</svg>
	);
}

async function runHostCallback(
	callback: () => Promise<void> | void,
	fallbackMessage: string,
): Promise<string | null> {
	try {
		await callback();
		return null;
	} catch (error) {
		return error instanceof Error && error.message
			? error.message
			: fallbackMessage;
	}
}

export function AgentPromptQueue({
	items,
	onEdit,
	onRemove,
	onSteer,
}: AgentPromptQueueProps) {
	const [editingId, setEditingId] = useState<string | null>(null);
	const [editingValue, setEditingValue] = useState("");
	const [pendingId, setPendingId] = useState<string | null>(null);
	const [actionError, setActionError] = useState<{
		id: string;
		message: string;
	} | null>(null);
	const [expanded, setExpanded] = useState(false);
	const queueId = useId();

	const cancelEdit = useCallback(() => {
		setEditingId(null);
		setEditingValue("");
	}, []);

	const submitEdit = useCallback(
		async (item: AgentPromptQueueItem) => {
			const prompt = editingValue.trim();
			if (!prompt || pendingId) return;
			setActionError(null);
			setPendingId(item.id);
			try {
				const message = await runHostCallback(
					() => onEdit(item.id, prompt),
					"Could not update the queued prompt.",
				);
				if (message) {
					setActionError({ id: item.id, message });
				} else {
					cancelEdit();
				}
			} finally {
				setPendingId(null);
			}
		},
		[cancelEdit, editingValue, onEdit, pendingId],
	);

	const runAction = useCallback(
		async (item: AgentPromptQueueItem, action: "steer" | "remove") => {
			if (pendingId) return;
			setActionError(null);
			setPendingId(item.id);
			try {
				const message = await runHostCallback(
					() => (action === "steer" ? onSteer(item.id) : onRemove(item.id)),
					action === "steer"
						? "Could not steer the queued prompt."
						: "Could not remove the queued prompt.",
				);
				if (message) setActionError({ id: item.id, message });
			} finally {
				setPendingId(null);
			}
		},
		[onRemove, onSteer, pendingId],
	);

	useEffect(() => {
		if (editingId && !items.some((item) => item.id === editingId)) {
			cancelEdit();
		}
	}, [cancelEdit, editingId, items]);

	useEffect(() => {
		if (actionError && !items.some((item) => item.id === actionError.id)) {
			setActionError(null);
		}
	}, [actionError, items]);

	useEffect(() => {
		if (items.length === 0) setExpanded(false);
	}, [items.length]);

	if (items.length === 0) return null;

	return (
		<div className="cline-ui-agent-prompt-queue mb-2">
			<button
				aria-controls={queueId}
				aria-expanded={expanded}
				className="cline-ui-agent-prompt-queue__toggle flex w-full cursor-pointer items-center gap-2 rounded-cline-ui-md border-0 bg-transparent px-1.5 py-1 text-left font-cline-ui-medium text-cline-ui-foreground text-cline-ui-xs transition-[background-color] duration-150 ease-[ease] hover:bg-cline-ui-accent/60 focus-visible:outline-2 focus-visible:outline-cline-ui-ring focus-visible:outline-offset-0"
				onClick={() => setExpanded((value) => !value)}
				type="button"
			>
				<Icon name={expanded ? "chevron-down" : "chevron-right"} small />
				<span>
					{items.length} prompt{items.length === 1 ? "" : "s"} queued
				</span>
			</button>
			<div
				className="cline-ui-agent-prompt-queue__items flex max-h-[40dvh] flex-col gap-0.5 overflow-y-auto py-1"
				hidden={!expanded}
				id={queueId}
			>
				{items.map((item) => {
					const isEditing = editingId === item.id;
					const isPending = pendingId === item.id;
					// While any action is in flight every action is a no-op, so
					// present every control as disabled rather than just the busy row.
					const isBusy = pendingId !== null;
					const hasAttachments = (item.attachmentCount ?? 0) > 0;
					return (
						<div
							aria-busy={isPending || undefined}
							className="cline-ui-agent-prompt-queue__item flex min-w-0 items-center gap-2 rounded-cline-ui-md p-1.5 hover:bg-[color-mix(in_oklab,var(--cline-ui-accent)_35%,transparent)] data-[steer=true]:bg-cline-ui-primary/5"
							data-steer={item.steer || undefined}
							key={item.id}
						>
							<span
								className="cline-ui-agent-prompt-queue__status-icon inline-flex size-4 shrink-0 text-cline-ui-muted-foreground data-[steer=true]:text-cline-ui-primary"
								data-steer={item.steer || undefined}
							>
								<Icon name={item.steer ? "arrow-up" : "clock"} />
							</span>
							<div className="cline-ui-agent-prompt-queue__content min-w-0 flex-1">
								{isEditing ? (
									<textarea
										aria-label="Edit queued prompt"
										className="cline-ui-agent-prompt-queue__editor block min-h-8 w-full resize-none rounded-cline-ui-md border border-cline-ui-border bg-cline-ui-background px-2 py-1.5 text-cline-ui-foreground text-cline-ui-xs leading-4 outline-none focus:border-[color-mix(in_oklab,var(--cline-ui-primary)_50%,transparent)] focus:shadow-[0_0_0_1px_color-mix(in_oklab,var(--cline-ui-primary)_20%,transparent)]"
										disabled={isPending}
										onChange={(event) => setEditingValue(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Escape") {
												event.preventDefault();
												cancelEdit();
											}
											if (
												event.key === "Enter" &&
												!event.shiftKey &&
												!event.nativeEvent.isComposing
											) {
												event.preventDefault();
												void submitEdit(item);
											}
										}}
										rows={1}
										value={editingValue}
									/>
								) : (
									<div className="cline-ui-agent-prompt-queue__summary flex min-w-0 items-center gap-2">
										<span className="cline-ui-agent-prompt-queue__prompt min-w-0 truncate text-cline-ui-foreground text-cline-ui-xs">
											{item.prompt}
										</span>
										{hasAttachments ? (
											<span className="cline-ui-agent-prompt-queue__attachments shrink-0 text-[10px] text-cline-ui-muted-foreground">
												{item.attachmentCount} attachment
												{item.attachmentCount === 1 ? "" : "s"}
											</span>
										) : null}
										{item.steer ? (
											<span className="cline-ui-agent-prompt-queue__badge shrink-0 rounded-full bg-cline-ui-primary/10 px-1.5 py-0.5 font-cline-ui-medium text-[10px] text-cline-ui-primary">
												Next turn
											</span>
										) : null}
									</div>
								)}
								{actionError?.id === item.id ? (
									<p
										className="cline-ui-agent-prompt-queue__error m-0 mt-1 text-cline-ui-destructive text-cline-ui-xs"
										role="alert"
									>
										{actionError.message}
									</p>
								) : null}
							</div>
							<div className="cline-ui-agent-prompt-queue__actions flex shrink-0 items-center gap-0.5">
								{isEditing ? (
									<>
										<button
											aria-label="Save queued prompt"
											className={ACTION_CLASS_NAME}
											disabled={isBusy || editingValue.trim().length === 0}
											onClick={() => void submitEdit(item)}
											type="button"
										>
											<Icon name="check" />
										</button>
										<button
											aria-label="Cancel editing queued prompt"
											className={ACTION_CLASS_NAME}
											disabled={isBusy}
											onClick={cancelEdit}
											type="button"
										>
											<Icon name="x" />
										</button>
									</>
								) : (
									<>
										{!item.steer ? (
											<button
												aria-label="Steer queued prompt"
												className={ACTION_CLASS_NAME}
												disabled={isBusy}
												onClick={() => void runAction(item, "steer")}
												title="Steer next"
												type="button"
											>
												<Icon name="arrow-up" />
											</button>
										) : null}
										<button
											aria-label="Edit queued prompt"
											className={ACTION_CLASS_NAME}
											disabled={isBusy}
											onClick={() => {
												setEditingId(item.id);
												setEditingValue(item.prompt);
											}}
											type="button"
										>
											<Icon name="pencil" />
										</button>
										<button
											aria-label="Remove queued prompt"
											className={ACTION_CLASS_NAME}
											disabled={isBusy}
											onClick={() => void runAction(item, "remove")}
											type="button"
										>
											<Icon name="trash" />
										</button>
									</>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}
