"use client";

import type {
	FactoryReviewDraft,
	FactoryReviewEvent,
	FactoryReviewPullRequest,
	FactoryReviewRefusalCode,
	FactoryRunState,
} from "@cline/shared";
import { factoryReviewReadableText } from "@cline/shared/browser";
import { AlertTriangle, Loader2, Pencil } from "lucide-react";
import { useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { MemoizedMarkdown, ThirdPartyMarkdown } from "@/components/ui/markdown";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { desktopClient } from "@/lib/desktop-client";
import { FACTORY_PR_REVIEW } from "@/lib/factory-copy";
import { cn } from "@/lib/utils";
import { Panel } from "./factory-ui";

type ReviewPost = NonNullable<FactoryRunState["reviewPost"]>;
type DraftComment = FactoryReviewDraft["comments"][number];

/**
 * The person's unsent changes to one draft: text only where they changed it
 * and the comments they left out. Kept for the browser session, so leaving
 * the card or reloading loses nothing. The event is not kept: the page always
 * opens on Comment.
 */
type ReviewEdits = {
	/** The draft these edits belong to (draftKey). */
	draft: string;
	body?: string;
	comments: Record<string, string>;
	excluded: string[];
};

const draftKey = (draft: Pick<FactoryReviewDraft, "headSha" | "createdAt">) =>
	`${draft.headSha}:${draft.createdAt}`;
const storageKey = (taskId: string) => `factory.reviewEdits.${taskId}`;
const emptyEdits = (draft: string): ReviewEdits => ({
	draft,
	comments: {},
	excluded: [],
});
const edited = (edits: ReviewEdits | undefined) =>
	Boolean(
		edits &&
			(edits.body !== undefined ||
				Object.keys(edits.comments).length ||
				edits.excluded.length),
	);

function readEdits(taskId: string): ReviewEdits | undefined {
	try {
		const raw = sessionStorage.getItem(storageKey(taskId));
		return raw ? (JSON.parse(raw) as ReviewEdits) : undefined;
	} catch {
		return undefined;
	}
}

/** A post or re-review the Hub refused (its code), or a failed call. */
type Refusal = {
	/** The draft it was refused for (draftKey). */
	draft: string;
	code?: FactoryReviewRefusalCode;
	message: string;
};

/**
 * Runs a review command: its reply, or the Hub's refusal with its code
 * (the sidecar passes `{ ok: false, error }` through for these commands).
 */
async function reviewCommand<T>(
	command: "task.factory.review.post" | "task.factory.review.rerun",
	args: Record<string, unknown>,
	options?: { timeoutMs: null },
): Promise<{ reply: T } | { refusal: Omit<Refusal, "draft"> }> {
	type Reply = T | { ok: false; error: { code: string; message: string } };
	try {
		const reply = await (options
			? desktopClient.invoke<Reply>(command, args, options)
			: desktopClient.invoke<Reply>(command, args));
		if (reply && typeof reply === "object" && "ok" in reply && !reply.ok)
			return {
				refusal: {
					code: reply.error.code as FactoryReviewRefusalCode,
					message: reply.error.message,
				},
			};
		return { reply: reply as T };
	} catch (cause) {
		return {
			refusal: {
				message: cause instanceof Error ? cause.message : String(cause ?? ""),
			},
		};
	}
}

/** Comments grouped by file, in the draft's order. */
function byFile(comments: readonly DraftComment[]) {
	const files = new Map<string, DraftComment[]>();
	for (const comment of comments)
		files.set(comment.path, [...(files.get(comment.path) ?? []), comment]);
	return [...files];
}

const SEVERITY_TONE: Record<DraftComment["severity"], string> = {
	blocker: "border-destructive/40 text-error-text",
	major: "border-amber-500/40 text-amber-700 dark:text-amber-300",
	minor: "border-border text-muted-foreground",
	nit: "border-border text-muted-foreground",
};

/**
 * A pull request review card's draft: the summary (with the reviewers'
 * findings and questions, exactly as posted) and each comment, editable and
 * individually left out, what they did not check and who reviewed; then one
 * Post control. Nothing reaches GitHub until the person confirms exactly
 * what is posted where.
 *
 * Edits belong to the draft they were made on. When Factory reviews the pull
 * request again, the new draft replaces the old one on screen and the page
 * says the earlier edits are not in it, offering the earlier summary back.
 */
export function FactoryReviewDraftPanel({
	taskId,
	reference,
	pullRequest,
	pullRequestNow,
	draft,
	post,
	postRunning,
	archived,
	onRefresh,
	onOpenSession,
}: {
	taskId: string;
	/** "acme/widgets#15". */
	reference: string;
	pullRequest?: FactoryReviewPullRequest;
	/** What a post or re-review last found on GitHub after the draft. */
	pullRequestNow?: FactoryRunState["reviewPullRequestNow"];
	draft: FactoryReviewDraft;
	post?: ReviewPost;
	/** The Hub says a post of this draft is running now. */
	postRunning: boolean;
	archived: boolean;
	onRefresh: () => Promise<void>;
	onOpenSession: (sessionId: string) => void;
}) {
	const key = draftKey(draft);
	const [edits, setEditsState] = useState<ReviewEdits>(() => {
		const saved = readEdits(taskId);
		return saved?.draft === key ? saved : emptyEdits(key);
	});
	// Edits to an earlier draft, when a new review replaced it.
	const [replaced, setReplaced] = useState<ReviewEdits | undefined>(() => {
		const saved = readEdits(taskId);
		return saved && saved.draft !== key && edited(saved) ? saved : undefined;
	});
	const [chosenEvent, setEvent] = useState<FactoryReviewEvent>("COMMENT");
	// A new draft arrived while the page was open: the edits stay with the
	// draft they were made on.
	if (edits.draft !== key) {
		setReplaced(edited(edits) ? edits : undefined);
		setEditsState(emptyEdits(key));
		setEvent("COMMENT");
	}
	const setEdits = (next: ReviewEdits) => {
		setEditsState(next);
		if (edited(next))
			sessionStorage.setItem(storageKey(taskId), JSON.stringify(next));
		else sessionStorage.removeItem(storageKey(taskId));
	};
	const posted = post?.state === "posted";
	// A post this page sent, or one the Hub says is running; a `posting`
	// record with neither is a post whose reply was lost.
	const [sending, setSending] = useState(false);
	const inFlight = sending || postRunning;
	const unconfirmed =
		post?.state === "posting" && post.headSha === draft.headSha && !inFlight;
	const [refusal, setRefusal] = useState<Refusal>();
	const shownRefusal = refusal?.draft === key ? refusal : undefined;
	const [note, setNote] = useState<string>();
	const [rerunning, setRerunning] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [editing, setEditing] = useState<string | null>(null);
	// GitHub refuses Approve and Request changes on the viewer's own pull
	// request; both logins are GitHub's, which matches them without case.
	const own =
		pullRequest?.viewerLogin !== undefined &&
		pullRequest.viewerLogin.toLowerCase() ===
			pullRequest.author.login.toLowerCase();
	const event: FactoryReviewEvent = own ? "COMMENT" : chosenEvent;
	const postsAs = FACTORY_PR_REVIEW.postsAs(
		pullRequest?.viewerLogin,
		pullRequest?.host,
	);

	const readOnly = posted || archived;
	// The person reads and edits the text without its escapes; the Hub makes
	// whatever is posted inert again, so unchanged text posts as drafted.
	const body = edits.body ?? factoryReviewReadableText(draft.body);
	const textOf = (comment: DraftComment) =>
		(readOnly ? undefined : edits.comments[comment.id]) ??
		factoryReviewReadableText(comment.body);
	const included = draft.comments.filter(
		(comment) => !edits.excluded.includes(comment.id),
	);
	// GitHub would refuse the post: the pull request moved or closed, as the
	// card last learned or as this page was just told.
	const stale =
		(pullRequestNow !== undefined &&
			pullRequestNow.headSha !== draft.headSha) ||
		shownRefusal?.code === "factory_review_stale_head";
	const closed =
		pullRequestNow?.open === false ||
		shownRefusal?.code === "factory_review_pr_closed";
	const blocked = stale || closed;
	const needsSummary =
		!body.trim() && (event !== "APPROVE" || included.length === 0);
	const canPost = !readOnly && !inFlight && !blocked && !needsSummary;

	async function send() {
		setConfirming(false);
		setSending(true);
		setRefusal(undefined);
		setNote(undefined);
		// The Hub holds the post's deadline; this page waits for its answer.
		const result = await reviewCommand(
			"task.factory.review.post",
			{
				taskId,
				allWorkspaces: true,
				expectedHead: draft.headSha,
				expectedDraft: draft.createdAt,
				event,
				body,
				comments: included.map((comment) => ({
					id: comment.id,
					body: textOf(comment),
				})),
			},
			{ timeoutMs: null },
		);
		if ("refusal" in result) setRefusal({ draft: key, ...result.refusal });
		else sessionStorage.removeItem(storageKey(taskId));
		setSending(false);
		await onRefresh().catch(() => undefined);
	}

	async function reviewAgain() {
		setRerunning(true);
		setNote(undefined);
		const result = await reviewCommand<{ unchanged?: boolean }>(
			"task.factory.review.rerun",
			{ taskId, allWorkspaces: true },
		);
		if ("refusal" in result) setRefusal({ draft: key, ...result.refusal });
		else if (result.reply?.unchanged) {
			setRefusal(undefined);
			setNote(FACTORY_PR_REVIEW.unchanged);
		}
		setRerunning(false);
		await onRefresh().catch(() => undefined);
	}

	const severity = (comment: DraftComment) => (
		<span
			className={cn(
				"shrink-0 rounded border px-1.5 text-[11px] leading-4 font-medium",
				SEVERITY_TONE[comment.severity],
			)}
		>
			{FACTORY_PR_REVIEW.severity[comment.severity]}
		</span>
	);
	const commentRow = (comment: DraftComment) => {
		const place = `${comment.path}:${comment.line}`;
		const kept = !edits.excluded.includes(comment.id);
		const open = editing === comment.id;
		const id = `factory-review-${comment.id}`;
		return (
			<li
				key={comment.id}
				data-factory-review-comment={comment.id}
				className="flex items-start gap-3 px-4 py-2.5"
			>
				{readOnly ? null : (
					<Checkbox
						id={id}
						className="mt-0.5"
						checked={kept}
						disabled={inFlight}
						aria-label={FACTORY_PR_REVIEW.include(place)}
						onCheckedChange={(checked) =>
							setEdits({
								...edits,
								excluded:
									checked === true
										? edits.excluded.filter((item) => item !== comment.id)
										: [...edits.excluded, comment.id],
							})
						}
					/>
				)}
				<div
					className={cn(
						"min-w-0 flex-1 space-y-1",
						!kept && !readOnly && "text-muted-foreground",
					)}
				>
					<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
						{severity(comment)}
						<span className="font-mono text-muted-foreground" title={place}>
							{FACTORY_PR_REVIEW.line(comment.line)}
						</span>
						{readOnly || !kept ? null : (
							<Button
								variant="ghost"
								size="xs"
								className="ml-auto h-6 px-1.5 text-xs"
								disabled={inFlight}
								aria-label={
									open
										? FACTORY_PR_REVIEW.done
										: FACTORY_PR_REVIEW.editComment(place)
								}
								onClick={() => {
									if (open && !edits.comments[comment.id]?.trim()) {
										const { [comment.id]: _, ...rest } = edits.comments;
										setEdits({ ...edits, comments: rest });
									}
									setEditing(open ? null : comment.id);
								}}
							>
								{open ? null : <Pencil className="mr-1 size-3" />}
								{open ? FACTORY_PR_REVIEW.done : FACTORY_PR_REVIEW.edit}
							</Button>
						)}
					</div>
					{open ? (
						<Textarea
							autoFocus
							aria-label={FACTORY_PR_REVIEW.editComment(place)}
							className="text-sm"
							maxLength={5_000}
							value={textOf(comment)}
							onChange={(change) =>
								setEdits({
									...edits,
									comments: {
										...edits.comments,
										[comment.id]: change.target.value,
									},
								})
							}
						/>
					) : (
						<label
							htmlFor={readOnly ? undefined : id}
							className={cn(
								"block whitespace-pre-wrap break-words text-sm",
								!kept &&
									!readOnly &&
									"line-through decoration-muted-foreground/60",
							)}
						>
							{textOf(comment)}
						</label>
					)}
				</div>
			</li>
		);
	};

	const files = byFile(draft.comments);

	return (
		<div className="space-y-4" data-factory-review-draft>
			<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
				{pullRequest ? (
					<span className="text-xs text-muted-foreground">
						{FACTORY_PR_REVIEW.facts(pullRequest)}
					</span>
				) : null}
				<span className="text-xs text-muted-foreground">
					{FACTORY_PR_REVIEW.reviewedAt(draft.headSha.slice(0, 7))}
					{stale ? (
						<span className="text-amber-700 dark:text-amber-300">
							{" "}
							· {FACTORY_PR_REVIEW.changedSince}
						</span>
					) : null}
				</span>
			</div>
			{replaced && !readOnly ? (
				<output className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-2.5 text-sm">
					<span className="min-w-0 flex-1">{FACTORY_PR_REVIEW.replaced}</span>
					{replaced.body !== undefined ? (
						<Button
							size="sm"
							variant="outline"
							onClick={() => {
								setEdits({ ...edits, body: replaced.body });
								setReplaced(undefined);
							}}
						>
							{FACTORY_PR_REVIEW.useEarlierSummary}
						</Button>
					) : null}
				</output>
			) : null}
			{posted && post?.bodyOnly ? (
				<p className="rounded-lg bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
					{FACTORY_PR_REVIEW.bodyOnly}
				</p>
			) : null}
			{posted ? (
				<p className="text-xs text-muted-foreground">
					{FACTORY_PR_REVIEW.postedReadOnly}
				</p>
			) : null}
			<div className="flex flex-col gap-4 @min-[760px]:grid @min-[760px]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] @min-[760px]:items-start">
				<div className="flex min-w-0 flex-col gap-4">
					<Panel
						aria-label={FACTORY_PR_REVIEW.summary}
						title={FACTORY_PR_REVIEW.summary}
						description={readOnly ? undefined : FACTORY_PR_REVIEW.summaryHint}
					>
						{readOnly ? (
							// The draft as posted: inert Markdown, so no HTML is rendered,
							// and nothing in it is fetched.
							<ThirdPartyMarkdown>
								<MemoizedMarkdown
									content={draft.body}
									classNames="text-sm break-words [&_:not(pre)>code]:break-all"
								/>
							</ThirdPartyMarkdown>
						) : (
							<Textarea
								aria-label={FACTORY_PR_REVIEW.summary}
								className="max-h-[50vh] min-h-40 text-sm leading-6"
								maxLength={60_000}
								disabled={inFlight}
								value={body}
								onChange={(change) =>
									setEdits({ ...edits, body: change.target.value })
								}
							/>
						)}
						{draft.notChecked.length ? (
							<section
								aria-label={FACTORY_PR_REVIEW.notChecked}
								className="space-y-1 pt-3"
							>
								<h4 className="text-xs font-medium text-muted-foreground">
									{FACTORY_PR_REVIEW.notChecked}
								</h4>
								<ul className="list-disc space-y-1 pl-5 text-sm">
									{draft.notChecked.map((item) => (
										<li key={item} className="break-words">
											{factoryReviewReadableText(item)}
										</li>
									))}
								</ul>
							</section>
						) : null}
					</Panel>
					{draft.reviewers.length ? (
						<section
							aria-label={FACTORY_PR_REVIEW.reviewers}
							className="space-y-1.5 px-1"
						>
							<h4 className="text-xs font-medium text-muted-foreground">
								{FACTORY_PR_REVIEW.reviewers}
							</h4>
							<ul className="space-y-1.5 text-sm">
								{draft.reviewers.map((reviewer) => (
									<li
										key={reviewer.reviewerIndex}
										className="flex flex-wrap items-baseline gap-x-2"
									>
										{reviewer.failed ? (
											<span className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
												<AlertTriangle className="size-3.5 shrink-0" />
												{FACTORY_PR_REVIEW.reviewerDidNotFinish(reviewer.label)}
											</span>
										) : (
											<span className="font-medium">{reviewer.label}</span>
										)}
										{reviewer.summary ? (
											<span className="min-w-0 break-words text-muted-foreground">
												{factoryReviewReadableText(reviewer.summary)}
											</span>
										) : null}
										{reviewer.sessionId ? (
											<Button
												variant="link"
												className="h-auto p-0 text-xs"
												onClick={() =>
													reviewer.sessionId &&
													onOpenSession(reviewer.sessionId)
												}
											>
												{FACTORY_PR_REVIEW.viewConversation}
											</Button>
										) : null}
									</li>
								))}
							</ul>
						</section>
					) : null}
				</div>
				<Panel
					aria-label={FACTORY_PR_REVIEW.comments}
					title={FACTORY_PR_REVIEW.comments}
					description={
						draft.comments.length && !readOnly
							? FACTORY_PR_REVIEW.included(
									included.length,
									draft.comments.length,
								)
							: undefined
					}
					bodyClassName="px-0 py-0"
				>
					{files.length ? (
						<div className="divide-y">
							{files.map(([path, comments]) => (
								<section key={path} aria-label={path}>
									<h4
										className="break-all bg-muted/30 px-4 py-1.5 font-mono text-xs"
										title={path}
									>
										{path}
									</h4>
									<ul className="divide-y">{comments.map(commentRow)}</ul>
								</section>
							))}
						</div>
					) : (
						<p className="px-5 py-4 text-sm text-muted-foreground">
							{FACTORY_PR_REVIEW.noComments}
						</p>
					)}
				</Panel>
			</div>
			{readOnly ? null : (
				<div
					data-testid="factory-review-post"
					className="sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 rounded-lg border bg-background/95 px-4 py-3 shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur"
				>
					<div className="mr-auto min-w-0 flex-1 basis-64 space-y-1 text-xs leading-5">
						{shownRefusal &&
						!blocked &&
						!(
							unconfirmed && shownRefusal.code === "factory_review_unconfirmed"
						) ? (
							<p role="alert" className="break-words text-error-text">
								{shownRefusal.message}
							</p>
						) : null}
						{closed ? (
							<p className="text-amber-700 dark:text-amber-300">
								{FACTORY_PR_REVIEW.closed}
							</p>
						) : stale ? (
							<p className="text-amber-700 dark:text-amber-300">
								{FACTORY_PR_REVIEW.stale}
							</p>
						) : unconfirmed ? (
							<p className="text-amber-700 dark:text-amber-300">
								{FACTORY_PR_REVIEW.unconfirmed}
							</p>
						) : null}
						{note ? <output className="block">{note}</output> : null}
						{blocked ? null : (
							<p className="text-muted-foreground">
								{inFlight ? (
									<span className="flex items-center gap-1.5">
										<Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
										{FACTORY_PR_REVIEW.posting}
									</span>
								) : needsSummary ? (
									FACTORY_PR_REVIEW.needsSummary
								) : (
									FACTORY_PR_REVIEW.willPost(
										included.length,
										reference,
										postsAs,
									)
								)}
							</p>
						)}
						{blocked ? null : own ? (
							<p className="text-muted-foreground">
								{FACTORY_PR_REVIEW.ownPullRequest}
							</p>
						) : draft.verdict !== "comment" ? (
							<p className="text-muted-foreground">
								{FACTORY_PR_REVIEW.suggested(draft.verdict)}
							</p>
						) : null}
					</div>
					<div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
						{stale && !closed ? (
							<Button
								variant="outline"
								disabled={rerunning}
								onClick={() => void reviewAgain()}
							>
								{FACTORY_PR_REVIEW.reviewAgain}
							</Button>
						) : null}
						{own || blocked ? null : (
							<ToggleGroup
								type="single"
								variant="outline"
								size="sm"
								aria-label={FACTORY_PR_REVIEW.event}
								value={event}
								disabled={inFlight || blocked}
								onValueChange={(value) => {
									if (value) setEvent(value as FactoryReviewEvent);
								}}
							>
								{(["COMMENT", "APPROVE", "REQUEST_CHANGES"] as const).map(
									(option) => (
										<ToggleGroupItem
											key={option}
											value={option}
											className="flex-none px-2.5 text-xs whitespace-nowrap"
										>
											{FACTORY_PR_REVIEW.events[option]}
										</ToggleGroupItem>
									),
								)}
							</ToggleGroup>
						)}
						{blocked ? null : (
							<Button disabled={!canPost} onClick={() => setConfirming(true)}>
								{FACTORY_PR_REVIEW.post}
							</Button>
						)}
					</div>
				</div>
			)}
			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{FACTORY_PR_REVIEW.confirmTitle(
								included.length,
								reference,
								postsAs,
							)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{FACTORY_PR_REVIEW.confirmBody(
								FACTORY_PR_REVIEW.eventPhrase[event],
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							{FACTORY_PR_REVIEW.keepEditing}
						</AlertDialogCancel>
						<AlertDialogAction onClick={() => void send()}>
							{FACTORY_PR_REVIEW.confirm}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
