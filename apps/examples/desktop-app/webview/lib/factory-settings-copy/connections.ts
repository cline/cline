/**
 * Factory settings words: Connections.
 */

import { plural } from "./shell";

export const FS_CONNECTIONS = {
	scope:
		"The accounts and tools Factory uses. Sign-in happens in the app's settings or in a terminal; this page shows what is ready.",
	checkAgain: "Check again",
	checking: "Checking…",
	githubGroup: "GitHub",
	providersGroup: "Model providers",
	providersHint: "used by the default workflow",
	manageProviders: "Manage providers",
	issuesGroup: "Issue sources",
	toolsGroup: "Tools",

	gh: "GitHub CLI",
	ghPurpose:
		"Opens draft PRs, follows up on checks and comments, and reads GitHub issues you paste into New work.",
	ghSignedIn: (host: string, login: string | undefined, version?: string) =>
		`Signed in to ${host}${login ? ` as ${login}` : ""}${version ? ` · gh ${version}` : ""}.`,
	ghNotInstalled:
		"Factory can't open draft PRs. Install the GitHub CLI, then check again.",
	ghNotSignedIn:
		"Factory can't open draft PRs. Run this in a terminal, then check again:",
	ghCheckFailed: (error: string) =>
		`Couldn't check the GitHub CLI: ${error} Check again in a moment.`,
	signInCommand: "gh auth login",
	copyCommand: "Copy command",
	openGhSite: "Open cli.github.com",
	ghSite: "https://cli.github.com",
	hosts: "Hosts",
	path: "Path",
	version: "Version",

	connected: "Connected",
	notConnected: "Not connected",
	notInstalled: "Not installed",
	notSignedIn: "Not signed in",
	couldntCheck: "Couldn't check",
	ready: "Ready",
	notSetUp: "Not set up",

	connect: "Connect",
	providerStops: (provider: string) =>
		`Work stops at the first of these roles until ${provider} is connected.`,
	appModel: "The chat's model",
	appModelHint: (roles: string) =>
		`${roles}. These roles use the model chosen in the chat.`,
	providersUnavailable: "Model providers: not available in this build.",
	roles: {
		designer: "Scoping agent",
		planReviewer: "Plan checker",
		builder: "Builder",
		tester: "Tester",
		reviewer: "Code reviewer",
		manager: "Manager",
	},

	linear: "Linear issues",
	linearHint:
		"Paste an issue link into New work. Reads LINEAR_API_KEY from the environment the app starts in.",
	howTo: "How to",
	linearDetails: "Details",
	linearSet:
		"Factory reads LINEAR_API_KEY or LINEAR_ACCESS_TOKEN from the environment Cline starts in. To change it, set it again and restart Cline.",
	linearStep1:
		"Create a personal API key in Linear: Settings › Security & access.",
	linearStep2:
		"Set it in the environment Cline starts in, then restart Cline and check again. On a Mac:",
	linearCommand: "launchctl setenv LINEAR_API_KEY <your key>",
	openLinear: "Open Linear settings",
	linearSite: "https://linear.app/settings/account/security",

	mcp: "MCP servers",
	mcpHint: (count: number, off: number) =>
		count === 0
			? "No MCP servers are set up in the app."
			: `${plural(count, "MCP server")} set up in the app${off ? `, ${off} turned off` : ""}.`,
	mcpSearch: "The MCP servers set up in the app.",
	mcpUnavailable: "MCP servers: not available in this build.",
	openMcp: "Open MCP settings",

	connectionsUnavailable: (hub: boolean) =>
		hub
			? "GitHub and Linear: Update Cline to see them."
			: "GitHub and Linear: not available in this build.",
	openFailed: "Couldn't open the browser.",
} as const;
