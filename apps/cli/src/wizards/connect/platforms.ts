export interface PlatformDef {
	id: string;
	name: string;
	type: "polling" | "webhook";
	hint: string;
	fields: FieldDef[];
	security?: SecurityDef;
}

export interface FieldDef {
	flag: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	help?: string[];
}

export interface SecurityFieldDef {
	key: string;
	label: string;
	placeholder?: string;
	help?: string[];
	requiredMessage: string;
	validate?: (value: string) => string | undefined;
}

export interface SecurityDef {
	prompt: string;
	fields: SecurityFieldDef[];
	buildHookCommand: (values: Record<string, string>) => string;
}

function validateTelegramUserId(value: string): string | undefined {
	return /^\d+$/.test(value)
		? undefined
		: "Telegram user ID must contain digits only";
}

function validateSlackTeamId(value: string): string | undefined {
	return /^T[A-Z0-9]+$/.test(value)
		? undefined
		: "Slack workspace ID must start with T and contain uppercase letters or digits only";
}

function validateSlackUserId(value: string): string | undefined {
	return /^[UW][A-Z0-9]+$/.test(value)
		? undefined
		: "Slack member ID must start with U or W and contain uppercase letters or digits only";
}

export const PLATFORMS: PlatformDef[] = [
	{
		id: "telegram",
		name: "Telegram",
		type: "polling",
		hint: "Easiest to set up. No public URL needed.",
		fields: [
			{
				flag: "-m",
				label: "Bot username",
				placeholder: "my_cline_bot",
				required: true,
				help: [
					"Open Telegram and start a chat with @BotFather",
					"Send /newbot and follow the prompts",
					"The username must end in 'bot'",
				],
			},
			{
				flag: "-k",
				label: "Bot token",
				placeholder: "7123456789:AAH...",
				required: true,
				help: [
					"BotFather gives you this after creating the bot",
					"It looks like 7123456789:AAHxxx...",
				],
			},
		],
		security: {
			prompt:
				"By default, anyone who finds your bot can message it and run tasks on your machine. Restrict access to your Telegram user ID?",
			fields: [
				{
					key: "userId",
					label: "Your Telegram user ID",
					placeholder: "123456789",
					help: [
						"Message @userinfobot on Telegram",
						"It will reply with your numeric user ID",
					],
					requiredMessage: "User ID is required to restrict access",
					validate: validateTelegramUserId,
				},
			],
			buildHookCommand: ({ userId }) =>
				`jq -r ".payload.actor.participantKey" | grep -q "telegram:id:${userId}" && echo '{"action":"allow"}' || echo '{"action":"deny"}'`,
		},
	},
	{
		id: "slack",
		name: "Slack",
		type: "webhook",
		hint: "Requires a Slack app and public URL.",
		fields: [
			{
				flag: "--bot-token",
				label: "Bot token",
				placeholder: "xoxb-...",
				required: true,
				help: [
					"Go to api.slack.com/apps and create a new app",
					"Add Bot Token Scopes: chat:write, app_mentions:read, channels:history, channels:read, im:history, im:read, im:write, users:read",
					"Install to workspace and copy the Bot Token",
				],
			},
			{
				flag: "--signing-secret",
				label: "Signing secret",
				required: true,
				help: ["Found in your app's Basic Information page"],
			},
			{
				flag: "--base-url",
				label: "Public base URL",
				placeholder: "https://example.com",
				required: true,
				help: [
					"Your publicly accessible URL for webhook callbacks",
					"Use ngrok or similar for local development",
				],
			},
		],
		security: {
			prompt: "Restrict which Slack users can interact with the bot?",
			fields: [
				{
					key: "teamId",
					label: "Allowed Slack workspace ID",
					placeholder: "T01ABC123",
					help: [
						"Open your Slack workspace URL in a browser",
						"The workspace ID is the segment after /client/, for example T01ABC123",
					],
					requiredMessage: "Workspace ID is required to restrict access",
					validate: validateSlackTeamId,
				},
				{
					key: "userId",
					label: "Allowed Slack member ID",
					placeholder: "U01ABC123",
					help: [
						"Click a user's name in Slack, then View full profile",
						"Click ... and Copy member ID",
					],
					requiredMessage: "Member ID is required to restrict access",
					validate: validateSlackUserId,
				},
			],
			buildHookCommand: ({ teamId, userId }) =>
				`jq -r ".payload.actor.participantKey" | grep -q "slack:team:${teamId}:user:${userId}" && echo '{"action":"allow"}' || echo '{"action":"deny"}'`,
		},
	},
	{
		id: "discord",
		name: "Discord",
		type: "webhook",
		hint: "Requires a Discord app and public URL.",
		fields: [
			{
				flag: "--application-id",
				label: "Application ID",
				required: true,
				help: [
					"Go to discord.com/developers/applications",
					"Create a new app, copy the Application ID",
				],
			},
			{
				flag: "--bot-token",
				label: "Bot token",
				required: true,
				help: ["Go to Bot section, create a bot, copy the token"],
			},
			{
				flag: "--public-key",
				label: "Public key",
				required: true,
				help: ["Found in General Information of your app"],
			},
			{
				flag: "--base-url",
				label: "Public base URL",
				placeholder: "https://example.com",
				required: true,
				help: ["Set this as the Interactions Endpoint URL"],
			},
		],
	},
	{
		id: "whatsapp",
		name: "WhatsApp",
		type: "webhook",
		hint: "Requires Meta developer account and public URL.",
		fields: [
			{
				flag: "--phone-number-id",
				label: "Phone number ID",
				required: true,
				help: ["From your WhatsApp Business account in Meta Developer portal"],
			},
			{
				flag: "--access-token",
				label: "Access token",
				required: true,
				help: ["Generate a permanent token in Meta Developer portal"],
			},
			{
				flag: "--app-secret",
				label: "App secret",
				required: true,
				help: ["Found in App Settings > Basic"],
			},
			{
				flag: "--verify-token",
				label: "Webhook verify token",
				placeholder: "my-verify-token",
				required: true,
				help: ["Any string you choose, used to verify webhook setup"],
			},
			{
				flag: "--base-url",
				label: "Public base URL",
				placeholder: "https://example.com",
				required: true,
			},
		],
	},
	{
		id: "gchat",
		name: "Google Chat",
		type: "webhook",
		hint: "Requires Google Cloud project and public URL.",
		fields: [
			{
				flag: "--credentials-json",
				label: "Service account credentials JSON",
				required: true,
				help: [
					"Create a service account in Google Cloud Console",
					"Download the credentials JSON file",
					"Paste the JSON content here",
				],
			},
			{
				flag: "--base-url",
				label: "Public base URL",
				placeholder: "https://example.com",
				required: true,
			},
		],
	},
	{
		id: "linear",
		name: "Linear",
		type: "webhook",
		hint: "React to Linear issues and comments.",
		fields: [
			{
				flag: "--api-key",
				label: "API key",
				required: true,
				help: ["Go to Linear Settings > API > Personal API keys"],
			},
			{
				flag: "--webhook-secret",
				label: "Webhook signing secret",
				required: true,
				help: [
					"Go to Settings > API > Webhooks, create one",
					"Copy the signing secret",
				],
			},
			{
				flag: "--base-url",
				label: "Public base URL",
				placeholder: "https://example.com",
				required: true,
			},
		],
	},
];
