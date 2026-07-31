"use client";

import { useCallback, useEffect, useId, useState } from "react";

export interface AgentPromptQueueItem {
	attachmentCount?: number;
	id: string;
	prompt: string;
	steer: boolean;
}

export interface AgentPromptQueueProps {
	items: AgentPromptQueueItem[];
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

function Icon({ name, small = false }: { name: IconName; small?: boolean }) {
	return (
		<svg
			aria-hidden="true"
			className={small ? "cline-ui-agent-prompt-queue__icon--small" : undefined}
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

async function runHostCallback(callback: () => Promise<void> | void) {
	try {
		await callback();
		return true;
	} catch {
		return false;
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
			setPendingId(item.id);
			try {
				if (await runHostCallback(() => onEdit(item.id, prompt))) cancelEdit();
			} finally {
				setPendingId(null);
			}
		},
		[cancelEdit, editingValue, onEdit, pendingId],
	);

	const runAction = useCallback(
		async (item: AgentPromptQueueItem, action: "steer" | "remove") => {
			if (pendingId) return;
			setPendingId(item.id);
			try {
				await runHostCallback(() =>
					action === "steer" ? onSteer(item.id) : onRemove(item.id),
				);
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
		if (items.length === 0) setExpanded(false);
	}, [items.length]);

	if (items.length === 0) return null;

	return (
		<div className="cline-ui-agent-prompt-queue">
			<button
				aria-controls={queueId}
				aria-expanded={expanded}
				className="cline-ui-agent-prompt-queue__toggle"
				onClick={() => setExpanded((value) => !value)}
				type="button"
			>
				<Icon name={expanded ? "chevron-down" : "chevron-right"} small />
				<span>
					{items.length} prompt{items.length === 1 ? "" : "s"} queued
				</span>
			</button>
			<div
				className="cline-ui-agent-prompt-queue__items"
				hidden={!expanded}
				id={queueId}
			>
				{items.map((item) => {
					const isEditing = editingId === item.id;
					const isPending = pendingId === item.id;
					const hasAttachments = (item.attachmentCount ?? 0) > 0;
					return (
						<div
							className="cline-ui-agent-prompt-queue__item"
							data-steer={item.steer || undefined}
							key={item.id}
						>
							<span
								className="cline-ui-agent-prompt-queue__status-icon"
								data-steer={item.steer || undefined}
							>
								<Icon name={item.steer ? "arrow-up" : "clock"} />
							</span>
							<div className="cline-ui-agent-prompt-queue__content">
								{isEditing ? (
									<textarea
										aria-label="Edit queued prompt"
										className="cline-ui-agent-prompt-queue__editor"
										disabled={isPending}
										onChange={(event) => setEditingValue(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Escape") {
												event.preventDefault();
												cancelEdit();
											}
											if (event.key === "Enter" && !event.shiftKey) {
												event.preventDefault();
												void submitEdit(item);
											}
										}}
										rows={1}
										value={editingValue}
									/>
								) : (
									<div className="cline-ui-agent-prompt-queue__summary">
										<span className="cline-ui-agent-prompt-queue__prompt">
											{item.prompt}
										</span>
										{hasAttachments ? (
											<span className="cline-ui-agent-prompt-queue__attachments">
												{item.attachmentCount} attachment
												{item.attachmentCount === 1 ? "" : "s"}
											</span>
										) : null}
										{item.steer ? (
											<span className="cline-ui-agent-prompt-queue__badge">
												Next turn
											</span>
										) : null}
									</div>
								)}
							</div>
							<div className="cline-ui-agent-prompt-queue__actions">
								{isEditing ? (
									<>
										<button
											aria-label="Save queued prompt"
											className="cline-ui-agent-prompt-queue__action"
											disabled={isPending || editingValue.trim().length === 0}
											onClick={() => void submitEdit(item)}
											type="button"
										>
											<Icon name="check" />
										</button>
										<button
											aria-label="Cancel editing queued prompt"
											className="cline-ui-agent-prompt-queue__action"
											disabled={isPending}
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
												className="cline-ui-agent-prompt-queue__action"
												disabled={isPending}
												onClick={() => void runAction(item, "steer")}
												title="Steer next"
												type="button"
											>
												<Icon name="arrow-up" />
											</button>
										) : null}
										<button
											aria-label="Edit queued prompt"
											className="cline-ui-agent-prompt-queue__action"
											disabled={isPending}
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
											className="cline-ui-agent-prompt-queue__action"
											disabled={isPending}
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
