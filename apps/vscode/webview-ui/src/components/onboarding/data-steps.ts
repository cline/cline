export enum NEW_USER_TYPE {
	CLINE_PASS = "cline-pass",
	FREE = "free",
	POWER = "power",
	BYOK = "byok",
}

type UserTypeSelection = {
	/** i18n key for the option title (onboarding namespace) */
	title: string
	/** i18n key for the option description (onboarding namespace) */
	description: string
	type: NEW_USER_TYPE
	learnMoreUrl?: string
}

// `title`, `description`, and button `text` hold i18n keys; call t() at the render site.
export const STEP_CONFIG = {
	0: {
		title: "onboarding:steps.userType.title",
		description: "onboarding:steps.userType.description",
		buttons: [
			{ text: "onboarding:buttons.continue", action: "next", variant: "default" },
			{ text: "onboarding:buttons.login", action: "signin", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.CLINE_PASS]: {
		title: "onboarding:steps.clinePass.title",
		buttons: [
			{ text: "onboarding:buttons.createAccount", action: "signup", variant: "default" },
			{ text: "onboarding:buttons.back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.FREE]: {
		title: "onboarding:steps.free.title",
		buttons: [
			{ text: "onboarding:buttons.createAccount", action: "signup", variant: "default" },
			{ text: "onboarding:buttons.back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.POWER]: {
		title: "onboarding:steps.power.title",
		buttons: [
			{ text: "onboarding:buttons.createAccount", action: "signup", variant: "default" },
			{ text: "onboarding:buttons.back", action: "back", variant: "secondary" },
		],
	},
	[NEW_USER_TYPE.BYOK]: {
		title: "onboarding:steps.byok.title",
		buttons: [
			{ text: "onboarding:buttons.continue", action: "done", variant: "default" },
			{ text: "onboarding:buttons.back", action: "back", variant: "secondary" },
		],
	},
	2: {
		title: "onboarding:steps.accountWait.title",
		description: "onboarding:steps.accountWait.description",
		buttons: [{ text: "onboarding:buttons.back", action: "back", variant: "secondary" }],
	},
} as const

const CLINE_PASS_USER_TYPE_SELECTION: UserTypeSelection = {
	title: "onboarding:userTypes.clinePass.title",
	description: "onboarding:userTypes.clinePass.description",
	type: NEW_USER_TYPE.CLINE_PASS,
	learnMoreUrl: "https://docs.cline.bot/getting-started/clinepass",
}

const BASE_USER_TYPE_SELECTIONS: UserTypeSelection[] = [
	{
		title: "onboarding:userTypes.free.title",
		description: "onboarding:userTypes.free.description",
		type: NEW_USER_TYPE.FREE,
	},
	{
		title: "onboarding:userTypes.power.title",
		description: "onboarding:userTypes.power.description",
		type: NEW_USER_TYPE.POWER,
	},
	{
		title: "onboarding:userTypes.byok.title",
		description: "onboarding:userTypes.byok.description",
		type: NEW_USER_TYPE.BYOK,
	},
]

/** Free leads (and is the default); ClinePass is inserted second when its models are available. */
export function getUserTypeSelections(hasClinePassModels: boolean): UserTypeSelection[] {
	if (!hasClinePassModels) {
		return BASE_USER_TYPE_SELECTIONS
	}
	const [free, ...rest] = BASE_USER_TYPE_SELECTIONS
	return [free, CLINE_PASS_USER_TYPE_SELECTION, ...rest]
}
