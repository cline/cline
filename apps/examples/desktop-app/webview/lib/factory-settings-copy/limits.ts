/** Factory settings words: Limits & spending. */

export const FS_LIMITS = {
	scope:
		"On this computer, across every project. Changes apply right away, including to work that is running.",
	pausedTitle: "New work is paused.",
	pausedBody: "Running work continues; nothing new starts.",
	resume: "Resume",
	runningGroup: "Running",
	spendingGroup: "Spending",
	builtInGroup: "Built-in limits",
	builtInGroupHint: "cannot be changed",
	workAtOnce: "Work at once",
	workAtOnceHint: "Other work waits in the queue.",
	dailyLimit: "Daily spending limit",
	dailyLimitHint:
		"Factory stops starting and running work when today's spending reaches this.",
	spentToday: (spent: string) => `${spent} spent today · resets at midnight`,
	noDailyLimit: "No limit: Factory keeps spending until you stop it.",
	cardLimit: "Card spending limit",
	cardLimitHint:
		"A card stops, even mid-run, when it has spent this much. For new work.",
	builtIn: "Time and step limits",
	builtInHint: "Limits Factory applies on its own.",
	showBuiltIn: "Show the limits",
	hideBuiltIn: "Hide the limits",
	builtInItems: [
		["Role session", "30 minutes unless the role sets less (Roles & models)"],
		[
			"Quick plan check",
			"20 steps, 5 minutes, for plans that arrive already scoped",
		],
		["Feedback analysis", "12 steps, 5 minutes, only when you leave feedback"],
		["PR follow-up", "Stops 14 days after delivery"],
		[
			"Automatic recovery",
			"2 restarts after an interruption, 2 re-scopes after a plan fault",
		],
		["Repository workflows", "Capped at $10 per card"],
	] as const,
} as const;
