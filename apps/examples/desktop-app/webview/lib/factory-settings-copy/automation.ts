/**
 * Factory settings words: Automation. Plan approval and draft PR review
 * keep their wording from `FACTORY_SETTINGS.general`.
 */

export const FS_AUTOMATION = {
	scope:
		"For new work in every project. Work already started keeps its settings.",
	waitsGroup: "When Factory waits for you",
	pullRequestsGroup: "Pull requests",
	pullRequestReady: "Draft or ready",
	repairsGroup: "Repairs",
	learningGroup: "Learning",
	newWorkGroup: "New work",
	duplicateCheck: "Check for duplicates when work is filed",
	duplicateCheckHint:
		"Factory points to an open or recently delivered card that already covers a new request instead of creating a second one. Asking to file it anyway always works.",
	duplicateCheckUnavailable: "Duplicate check: update Cline to change this.",
	splitLargeWork: "Split large work into parts",
	splitLargeWorkHint:
		"Scoping may propose splitting a large request into up to 6 cards that each deliver on their own. Nothing starts until you approve the breakdown on the card.",
	splitLargeWorkUnavailable:
		"Splitting large work: update Cline to change this.",
	notificationsGroup: "Notifications",
	needsReviewer:
		"“Mark ready when no review is needed” needs a reviewer on a different model.",
	setReviewer: "Set one in Roles & models",
	keepPassing: "Keep the PR passing",
	keepPassingHint:
		"After the draft PR opens, Factory watches its checks and review comments and fixes what they find, for up to 14 days.",
	repairRounds: "Fix rounds after review",
	repairRoundsHint:
		"How many times builders fix what reviewers found before the card stops. Larger changes get up to 3.",
	retries: "Retries per stage",
	retriesHint: "After a failed session or an unusable answer.",
	repoRules: "Suggest rules from repeated findings",
	repoRulesHint:
		"When reviewers flag the same thing on two cards within 30 days, Factory adds a card proposing a rule. At most 2 a week.",
	notifications: "How Factory alerts you",
	notificationsHint:
		"Questions, plans waiting for you and finished work use the app's notification settings.",
	openNotifications: "Open notification settings",
	numberInvalid: (min: number, max: number) =>
		`Enter a whole number from ${min} to ${max}.`,
} as const;
