import type { Meta, StoryObj } from "@storybook/react-vite"
import type { CSSProperties } from "react"
import { Environment } from "../../../src/shared/config-types"
import ClineLogoSanta from "./ClineLogoSanta"
import ClineLogoVariable from "./ClineLogoVariable"
import ClineLogoWhite from "./ClineLogoWhite"

const themeVariables = {
	"--vscode-icon-foreground": "#1c1c24",
	"--vscode-foreground": "#1c1c24",
	"--vscode-activityWarningBadge-background": "#d97706",
	"--vscode-focusBorder": "#2563eb",
} as CSSProperties

const LogoGallery = () => (
	<div className="grid min-h-screen grid-cols-2 gap-6 bg-zinc-100 p-8" style={themeVariables}>
		<div className="flex flex-col items-center gap-3 rounded-xl bg-white p-8 text-zinc-900">
			<ClineLogoVariable className="size-24" />
			<span>Light theme</span>
		</div>
		<div
			className="flex flex-col items-center gap-3 rounded-xl bg-zinc-950 p-8 text-white"
			style={{ "--vscode-icon-foreground": "white" } as CSSProperties}>
			<ClineLogoWhite className="size-24" />
			<span>Dark theme</span>
		</div>
		<div className="flex flex-col items-center gap-3 rounded-xl bg-white p-8 text-zinc-900">
			<div className="flex items-center gap-8">
				<ClineLogoVariable className="size-20" environment={Environment.local} />
				<ClineLogoVariable className="size-20" environment={Environment.staging} />
			</div>
			<span>Local and staging</span>
		</div>
		<div
			className="flex flex-col items-center gap-3 rounded-xl bg-zinc-950 p-8 text-white"
			style={{ "--vscode-icon-foreground": "white" } as CSSProperties}>
			<ClineLogoSanta className="h-24 w-auto" />
			<span>Seasonal treatment</span>
		</div>
	</div>
)

const meta: Meta<typeof LogoGallery> = {
	title: "Brand/Cline Logo",
	component: LogoGallery,
	parameters: { layout: "fullscreen" },
}

export default meta
type Story = StoryObj<typeof LogoGallery>

export const AllTreatments: Story = {}
