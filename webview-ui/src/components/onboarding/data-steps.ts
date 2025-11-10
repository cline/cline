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
		title: "onboarding.how_will_you_use_cline",
		description: "onboarding.select_option_get_started",
		buttons: [
			{ text: "onboarding.continue", action: "next", variant: "default" },
			{ text: "onboarding.login_to_cline", action: "signin", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.FREE]: {
		title: "onboarding.select_free_model",
		buttons: [
			{ text: "onboarding.create_my_account", action: "signup", variant: "default" },
			{ text: "onboarding.back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.POWER]: {
		title: "onboarding.select_your_model",
		buttons: [
			{ text: "onboarding.create_my_account", action: "signup", variant: "default" },
			{ text: "onboarding.back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.BYOK]: {
		title: "onboarding.configure_provider",
		buttons: [
			{ text: "onboarding.continue", action: "done", variant: "default" },
			{ text: "onboarding.back", action: "back", variant: "secondary" },
		],
	},
	2: {
		title: "onboarding.almost_there",
		description: "onboarding.complete_account_creation",
		buttons: [{ text: "onboarding.back", action: "back", variant: "secondary" }],
	},
} as const

export const USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	{
		title: "onboarding.absolutely_free",
		description: "onboarding.get_started_no_cost",
		type: NEW_USER_TYPE.FREE,
	},
	{
		title: "onboarding.frontier_model",
		description: "onboarding.claude_gpt_etc",
		type: NEW_USER_TYPE.POWER,
	},
	{
		title: "onboarding.bring_own_api_key",
		description: "onboarding.use_provider_choice",
		type: NEW_USER_TYPE.BYOK,
	},
]
