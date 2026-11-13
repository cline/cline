"use client";

import { MessageSquare } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import {
	type FactoryGuidanceRepositoryState,
	type FactoryGuidanceRole,
	type FactoryGuidanceScope,
	type FactoryGuidanceScopeState,
	type FactoryGuidanceTarget,
	type FactorySettingsClient,
	factorySettingsErrorMessage,
	isRefused,
	isUnavailable,
} from "@/lib/factory-settings-client";
import { FS_GUIDANCE } from "@/lib/factory-settings-copy/guidance";
import { FS_SHELL } from "@/lib/factory-settings-copy/shell";
import { cn } from "@/lib/utils";
import { FactoryGuidanceDiffView } from "../../../../chat/messages/factory-guidance-approval";
import {
	ActionButton,
	ConfirmDialog,
	SettingsBanner,
	StatusPill,
} from "../../../factory-settings-rows";
import type { FactoryTone } from "../../../factory-ui";
import { GuidanceText } from "./guidance-text";
import { diffLines, guidanceDiff } from "./line-diff";

const G = FS_GUIDANCE;

/** A history version to put back: opens the review of that text. */
export type RestoreRequest = {
	scope: FactoryGuidanceScope;
	text: string;
	note: string;
	nonce: number;
};

type Problem = { message: string; reload?: boolean; hint?: string };

/** The status pill of one scope. */
function scopeStatus(
	state: FactoryGuidanceScopeState | FactoryGuidanceRepositoryState,
): { tone: FactoryTone; text: string } {
	if (state.status === "invalid" || state.truncated)
		return { tone: "danger", text: G.statusInvalid };
	if (state.status === "changed") {
		const repository = state as Partial<FactoryGuidanceRepositoryState>;
		return repository.needsAcceptance && !repository.accepted
			? { tone: "attention", text: G.statusNotInUse }
			: { tone: "attention", text: G.statusChanged };
	}
	if (state.status === "none") return { tone: "neutral", text: G.statusEmpty };
	const repository = state as Partial<FactoryGuidanceRepositoryState>;
	return repository.inUse === false
		? { tone: "neutral", text: G.statusNotInUse }
		: { tone: "success", text: G.statusInUse };
}

/**
 * One scope of one target ("Yours" or "This repository"): the text, its
 * status and its actions. Edit → Review change (the diff) → Save is the one
 * confirmation before `factory_set_guidance`; a file changed outside Factory
 * shows the change marked, with Accept change / Discard change.
 */
export function GuidanceScopeBlock({
	id,
	role,
	scope,
	workspaceRoot,
	title,
	label,
	heading,
	meta,
	state,
	maxChars,
	fallback,
	editable,
	disabled,
	client,
	restore,
	onTarget,
	onReload,
	onAsk,
	onSaved,
}: {
	/** The block's `data-setting` id. */
	id: string;
	role: FactoryGuidanceRole;
	scope: FactoryGuidanceScope;
	workspaceRoot?: string;
	/** The target's name ("Builders"). */
	title: string;
	/** "Yours", "Repository". */
	label: string;
	/** Beside the label: the project select, path, character count. */
	heading?: ReactNode;
	meta: string;
	state: FactoryGuidanceScopeState | FactoryGuidanceRepositoryState;
	maxChars: number;
	/** Text shown and edited when nothing is saved (the built-in readme). */
	fallback?: string;
	editable: boolean;
	disabled: boolean;
	client: FactorySettingsClient;
	restore?: RestoreRequest;
	onTarget: (target: FactoryGuidanceTarget) => void;
	onReload: () => void;
	onAsk: () => void;
	onSaved: () => void;
}) {
	const [mode, setMode] = useState<"view" | "edit" | "review">("view");
	const [draft, setDraft] = useState("");
	const [note, setNote] = useState<string>(G.note);
	const [problem, setProblem] = useState<Problem>();
	const [busy, setBusy] = useState(false);
	const [discarding, setDiscarding] = useState(false);
	const [discardError, setDiscardError] = useState<string>();
	const rootRef = useRef<HTMLDivElement>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const reviewRef = useRef<HTMLElement>(null);
	const current = state.status === "none" ? (fallback ?? "") : state.content;
	const repository = state as Partial<FactoryGuidanceRepositoryState>;
	const changed = state.status === "changed";
	const unaccepted =
		changed && repository.needsAcceptance && !repository.accepted;
	const canEdit =
		editable && !changed && state.status !== "invalid" && !state.truncated;

	// A Restore from History: review that text against the current one.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only a new request (its nonce) opens the review.
	useEffect(() => {
		if (!restore || restore.scope !== scope) return;
		setDraft(restore.text);
		setNote(restore.note);
		setProblem(undefined);
		setMode("review");
		rootRef.current?.scrollIntoView?.({ block: "start" });
	}, [restore?.nonce]);

	useEffect(() => {
		if (mode === "edit") {
			const editor = editorRef.current;
			editor?.focus();
			// The caret starts after the text, where additions usually go.
			editor?.setSelectionRange(editor.value.length, editor.value.length);
		}
		if (mode === "review") reviewRef.current?.focus();
	}, [mode]);

	const startEdit = () => {
		setDraft(current);
		setNote(G.note);
		setProblem(undefined);
		setMode("edit");
	};

	const refusal = (cause: unknown): Problem => {
		if (isUnavailable(cause))
			return {
				message:
					cause.reason === "hub" ? FS_SHELL.hubTooOld : FS_SHELL.notAvailable,
			};
		if (isRefused(cause)) {
			if (cause.code === "factory_guidance_stale")
				return { message: G.stale, hint: G.staleHint, reload: true };
			if (
				cause.code === "factory_guidance_changed_outside" ||
				cause.code === "factory_guidance_nothing_to_resolve" ||
				cause.code === "factory_unknown_project"
			)
				return { message: cause.message, reload: true };
		}
		return { message: factorySettingsErrorMessage(cause, FS_SHELL.saveFailed) };
	};

	const save = async () => {
		setBusy(true);
		setProblem(undefined);
		try {
			const reply = await client.setGuidance({
				role,
				scope,
				...(scope === "repository" ? { workspaceRoot } : {}),
				expectedHash: state.hash,
				content: draft,
				note,
			});
			onTarget(reply.target);
			onSaved();
			setMode("view");
		} catch (cause) {
			if (isRefused(cause) && cause.code === "factory_guidance_unchanged") {
				setMode("view");
				return;
			}
			setProblem(refusal(cause));
			// The draft stays in the editor, so it can be fixed or copied.
			setMode("edit");
		} finally {
			setBusy(false);
		}
	};

	const resolve = async (decision: "accept" | "discard") => {
		setBusy(true);
		setProblem(undefined);
		setDiscardError(undefined);
		try {
			const reply = await client.resolveGuidance({
				role,
				scope,
				...(scope === "repository" ? { workspaceRoot } : {}),
				expectedHash: state.hash,
				decision,
			});
			onTarget(reply.target);
			onSaved();
			setDiscarding(false);
		} catch (cause) {
			const next = refusal(cause);
			if (decision === "discard") setDiscardError(next.message);
			setProblem(next);
		} finally {
			setBusy(false);
		}
	};

	const empty = state.status === "none" && fallback === undefined;
	const status =
		state.status === "none" && fallback !== undefined
			? { tone: "neutral" as const, text: G.builtIn }
			: scopeStatus(state);
	const length = (mode === "view" ? current : draft).length;
	const over = draft.length - maxChars;
	const askButton = (
		<ActionButton
			disabled={disabled}
			aria-label={`${G.change}, ${title}, ${label}`}
			onClick={onAsk}
		>
			<MessageSquare aria-hidden className="size-3.5" />
			{G.change}
		</ActionButton>
	);

	let body: ReactNode;
	if (mode === "edit") {
		body = (
			<div className="space-y-2">
				<Textarea
					ref={editorRef}
					aria-label={G.editorLabel(title, label)}
					aria-describedby={`${id}-counter`}
					aria-invalid={over > 0 || undefined}
					value={draft}
					rows={Math.min(18, Math.max(6, draft.split("\n").length + 1))}
					disabled={busy}
					className="text-[13px] leading-[19px]"
					onChange={(event) => setDraft(event.target.value)}
				/>
				<div className="flex flex-wrap items-center gap-2">
					<p
						id={`${id}-counter`}
						className={cn(
							"text-xs tabular-nums",
							over > 0 ? "text-destructive" : "text-muted-foreground",
						)}
					>
						{over > 0
							? G.over(over, maxChars)
							: G.counter(draft.length, maxChars)}
					</p>
					<div className="ml-auto flex gap-1.5">
						<ActionButton
							disabled={busy}
							onClick={() => {
								setProblem(undefined);
								setMode("view");
							}}
						>
							{G.cancel}
						</ActionButton>
						<ActionButton
							primary
							disabled={busy || over > 0 || draft === current}
							onClick={() => {
								setProblem(undefined);
								setMode("review");
							}}
						>
							{G.review}
						</ActionButton>
					</div>
				</div>
			</div>
		);
	} else if (mode === "review") {
		const diff = guidanceDiff(
			state.status === "none" ? "" : state.content,
			draft,
		);
		body = (
			<section
				ref={reviewRef}
				tabIndex={-1}
				aria-labelledby={`${id}-review-heading`}
				data-guidance-review=""
				className="space-y-2 outline-none"
			>
				<p id={`${id}-review-heading`} className="text-sm font-medium">
					{G.reviewHeading}
				</p>
				<p className="sr-only">
					{diffLines(state.status === "none" ? "" : state.content, draft)
						.filter((line) => line.kind !== "same")
						.map(
							(line) =>
								`${line.kind === "added" ? G.added : G.removed}: ${line.text}`,
						)
						.join(". ")}
				</p>
				<FactoryGuidanceDiffView diff={diff} path={state.path} />
				<p className="text-xs text-muted-foreground">
					{draft.trim() ? G.reviewNote : `${G.removesFile} ${G.reviewNote}`}
				</p>
				<div className="flex justify-end gap-1.5">
					<ActionButton disabled={busy} onClick={() => setMode("edit")}>
						{G.keepEditing}
					</ActionButton>
					<ActionButton
						primary
						disabled={busy || disabled}
						onClick={() => void save()}
					>
						{G.save}
					</ActionButton>
				</div>
			</section>
		);
	} else if (empty) {
		body = (
			<div className="space-y-2.5" data-guidance-empty="">
				<p className="text-xs text-muted-foreground">
					{G.empty(G.targetWord[role])}
				</p>
				<div className="flex flex-wrap gap-1.5">
					{editable ? (
						<ActionButton
							disabled={disabled}
							aria-label={`${G.write}, ${title}, ${label}`}
							onClick={startEdit}
						>
							{G.write}
						</ActionButton>
					) : null}
					<ActionButton
						disabled={disabled}
						aria-label={`${G.askFactory}, ${title}, ${label}`}
						onClick={onAsk}
					>
						{G.askFactory}
					</ActionButton>
				</div>
			</div>
		);
	} else {
		body = (
			<div className="space-y-2">
				{state.status === "none" && fallback !== undefined ? (
					<p className="text-xs text-muted-foreground">{G.builtInNote}</p>
				) : null}
				{state.truncated ? (
					<p className="text-xs text-destructive">
						{G.truncatedNote(maxChars)}
					</p>
				) : null}
				{state.status === "invalid" && state.reason ? (
					<p className="text-xs text-destructive">{state.reason}</p>
				) : null}
				<GuidanceText
					text={
						changed && state.acceptedContent !== undefined ? undefined : current
					}
					lines={
						changed && state.acceptedContent !== undefined
							? diffLines(state.acceptedContent, state.content)
							: undefined
					}
				/>
			</div>
		);
	}

	return (
		<div
			ref={rootRef}
			data-setting={id}
			data-guidance-scope={scope}
			className="mb-5"
		>
			<div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
				<div className="flex min-w-0 flex-1 basis-[220px] items-center gap-x-2.5 overflow-hidden">
					<h4 id={`${id}-title`} className="shrink-0 text-[13px] font-semibold">
						{label}
					</h4>
					{heading}
					<span className="min-w-0 truncate text-xs whitespace-nowrap text-muted-foreground tabular-nums">
						{mode === "view" ? meta : G.counter(length, maxChars)}
					</span>
				</div>
				<span className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1.5">
					<StatusPill tone={status.tone}>{status.text}</StatusPill>
					{mode === "view" && canEdit && !empty ? (
						<ActionButton
							disabled={disabled}
							aria-label={G.editLabel(title, label)}
							onClick={startEdit}
						>
							{G.edit}
						</ActionButton>
					) : null}
					{mode === "view" && !empty ? askButton : null}
				</span>
			</div>
			{changed ? (
				<div className="mb-2 [&>output]:mt-0">
					<SettingsBanner
						tone="attention"
						title={unaccepted ? G.newTitle : G.changedTitle}
						actions={
							<>
								<ActionButton
									disabled={disabled || busy}
									onClick={() => {
										setDiscardError(undefined);
										setDiscarding(true);
									}}
								>
									{G.discard}
								</ActionButton>
								<ActionButton
									primary
									disabled={disabled || busy}
									onClick={() => void resolve("accept")}
								>
									{G.accept}
								</ActionButton>
							</>
						}
					>
						{unaccepted
							? G.newBody(G.keepsUsing[role])
							: G.changedBody(G.keepsUsing[role])}
					</SettingsBanner>
				</div>
			) : null}
			{problem ? (
				<div
					role="alert"
					className="mb-2 flex flex-wrap items-center gap-2 text-xs text-destructive"
				>
					<span>{problem.message}</span>
					{problem.hint ? (
						<span className="text-muted-foreground">{problem.hint}</span>
					) : null}
					{problem.reload ? (
						<ActionButton
							onClick={() => {
								setProblem(undefined);
								onReload();
							}}
						>
							{G.reload}
						</ActionButton>
					) : null}
				</div>
			) : null}
			<div
				className={cn(
					"rounded-lg border px-3.5 py-3",
					mode === "view" && "bg-card/40",
				)}
			>
				{body}
			</div>
			<ConfirmDialog
				open={discarding}
				title={G.discardTitle}
				body={
					unaccepted || state.acceptedHash === undefined
						? G.discardRemovesBody(state.path ?? G.targetWord[role])
						: G.discardBody
				}
				verb={G.discard}
				busy={busy}
				error={discardError}
				onConfirm={() => void resolve("discard")}
				onCancel={() => setDiscarding(false)}
			/>
		</div>
	);
}
