import type {
	AgendaTaskRecord,
	AgendaTaskRunRecord,
	FactoryArchiveRecord,
	FactoryAutoArchiveSettings,
	FactoryCardState,
} from "@cline/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why Factory archives a delivered card by itself now, or undefined.
 *
 * Only a card the board shows under Delivered and that waits on nobody
 * (`card`, from factoryCardState) qualifies, and never an unposted review
 * draft, a result that still asks for a stamp, or one PR follow-up is
 * working on. Then: its pull request's recorded outcome, unless the card was
 * restored after it; or no activity for `archiveAfterDays`.
 */
export function factoryAutoArchiveReason(input: {
	task: AgendaTaskRecord;
	run: AgendaTaskRunRecord | undefined;
	card: FactoryCardState;
	settings: FactoryAutoArchiveSettings;
	now: number;
}): FactoryArchiveRecord | undefined {
	const { task, run, card, settings } = input;
	if (
		card.kind !== "delivered" ||
		card.waitingOn !== "nobody" ||
		card.reasonCode === "review_draft_ready"
	)
		return undefined;
	const state = run?.factory;
	if (
		state &&
		(state.pullRequestWatch?.pending ||
			(state.phase !== "ready" && state.phase !== "watching"))
	)
		return undefined;
	const outcome = state?.pullRequestOutcome;
	if (
		settings.archiveOnPullRequestClose &&
		outcome &&
		outcome.at > (task.factoryArchive?.restoredAt ?? "")
	)
		return { reason: outcome.state === "merged" ? "pr_merged" : "pr_closed" };
	const days = settings.archiveAfterDays;
	if (days === null) return undefined;
	// A merged or closed pull request needs no stamp any more.
	if (!outcome && state?.humanReview?.required && !state.humanApproval)
		return undefined;
	return input.now - factoryLastActivity(task, run) >= days * DAY_MS
		? { reason: "quiet", days }
		: undefined;
}

/**
 * The card's latest activity, in ms: any lifecycle write or edit of the
 * card (delivery, a person's edit or answer, a restore all set `updatedAt`),
 * the run's delivery, the person's feedback and stamp, each session PR
 * follow-up ran, and the pull request's outcome. Not the run's `updatedAt`:
 * every follow-up poll rewrites it.
 */
function factoryLastActivity(
	task: AgendaTaskRecord,
	run: AgendaTaskRunRecord | undefined,
): number {
	const state = run?.factory;
	return Math.max(
		...[
			task.updatedAt,
			run?.completedAt,
			state?.audit?.reviewedAt,
			state?.humanApproval?.approvedAt,
			state?.pullRequestOutcome?.at,
			...(state?.attempts ?? []).map((attempt) =>
				attempt.status === "completed" || attempt.status === "failed"
					? attempt.completedAt
					: attempt.createdAt,
			),
		].map((at) => Date.parse(at ?? "") || 0),
	);
}
