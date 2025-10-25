import { CheckIcon, LightbulbIcon, LucideProps, TerminalIcon } from "lucide-react"
import { ForwardRefExoticComponent, RefAttributes } from "react"
import { PLATFORM_CONFIG, PlatformType } from "@/config/platform.config"
import { isMacOSOrLinux } from "@/utils/platformUtils"

type ButtonIcon = ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>

type ReleaseNew = {
	icon: ButtonIcon
	title: string
	description: string
	action: { text: string; link: string }
	command?: string
	buttons: {
		text: string
		type: "link" | "view"
		value: string
		variant: "default" | "secondary"
		disabled?: boolean
		icon?: ButtonIcon
	}[]
	hidden?: boolean
	hideFromStandalone?: boolean
}

export const RELEASE_NOTES = [
	{
		title: "Cline CLI (Preview)",
		description: "Run Cline from the command line with experimental Subagent support.",
		link: "http://cline.bot/blog/cline-cli-my-undying-love-of-cline-core",
	},
	{
		title: "Multi-Root Workspaces",
		description: "Work across multiple projects simultaneously (Enable in feature settings)",
	},
	{
		title: "Auto-Retry Failed API Requests",
		description: "No more interrupted auto-approved tasks due to server errors",
	},
]

export const RELEASE_NEWS: ReleaseNew[] = [
	{
		icon: TerminalIcon,
		title: "Cline for CLI is here!",
		description:
			"Install to use Cline directly in your terminal and enable subagent capabilities. Cline can spawn cline commands to handle focused tasks like exploring large codebases for information. This keeps your main context window clean by running these operations in separate subprocesses.",
		action: { text: "Learn More", link: "http://cline.bot/blog/cline-cli-my-undying-love-of-cline-core" },
		command: "npm install -g cline",
		buttons: [
			{
				text: "Installed",
				type: "link",
				value: "https://example.com/feature-a",
				variant: "secondary",
				icon: CheckIcon,
				disabled: true,
			},
			{ text: "Enable Subagents", type: "view", value: "settings", variant: "default" },
		],
		hidden: !isMacOSOrLinux() && PLATFORM_CONFIG.type === PlatformType.VSCODE,
	},
	{
		icon: LightbulbIcon,
		title: "Cline in the Right Sidebar",
		description:
			"Keep your files visible when chatting with Cline. Drag the Cline icon to the right sidebar panel for a better experience.",
		action: { text: "See how →", link: "https://docs.cline.bot/features/customization/opening-cline-in-sidebar" },
		buttons: [],
	},
]
