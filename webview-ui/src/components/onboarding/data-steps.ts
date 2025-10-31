export enum NEW_USER_TYPE {
	FREE = "free",
	POWER = "power",
	BYOK = "byok",
}

type UserTypeSelection = {
	title: string
	description: string
	type: NEW_USER_TYPE
}

export const STEP_CONFIG = {
	0: {
		title: "Become a CLINE user!",
		description:
			"Cline is free for individual developers. Pay only for AI inference on a usage basis - no subscriptions, no vendor lock-in!",
		buttons: [
			{ text: "Continue", action: "next", variant: "default" },
			{ text: "Login to Cline", action: "auth", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.FREE]: {
		title: "Select a free model",
		buttons: [
			{ text: "Create my Account", action: "auth", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.POWER]: {
		title: "Select your model",
		buttons: [
			{ text: "Create my Account", action: "auth", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.BYOK]: {
		title: "Configure your provider",
		buttons: [
			{ text: "Ready", action: "done", variant: "default" },
			{ text: "Back", action: "back", variant: "secondary" },
		],
	},
} as const

export const USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	{ title: "Absolutely Free", description: "More context of this key feature", type: NEW_USER_TYPE.FREE },
	{ title: "Power User", description: "Unlock advanced features and capabilities", type: NEW_USER_TYPE.POWER },
	{ title: "I have my own key", description: "Use your own API credentials", type: NEW_USER_TYPE.BYOK },
]
