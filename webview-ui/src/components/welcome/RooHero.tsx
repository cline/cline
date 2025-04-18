import { useState } from "react"
import { useAppTranslation } from "../../i18n/TranslationContext"
import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"

const WelcomeView = () => {
	// Import translation but don't use it yet
	useAppTranslation()

	const [imagesBaseUri] = useState(() => {
		const w = window as any
		return w.IMAGES_BASE_URI || ""
	})

	return (
		<div className="flex flex-col items-center justify-center h-full px-5 py-2.5">
			<div
				style={{
					backgroundColor: "var(--vscode-foreground)",
					WebkitMaskImage: `url('${imagesBaseUri}/roo-logo.svg')`,
					WebkitMaskRepeat: "no-repeat",
					WebkitMaskSize: "contain",
					maskImage: `url('${imagesBaseUri}/roo-logo.svg')`,
					maskRepeat: "no-repeat",
					maskSize: "contain",
				}}
				className="mx-auto">
				<img src={imagesBaseUri + "/roo-logo.svg"} alt="Roo logo" className="h-8 opacity-0" />
			</div>

			<h2 className="text-3xl font-semibold leading-none text-vscode-editor-foreground mb-2 whitespace-nowrap font-vscode">
				Roo Code
			</h2>

			<p className="text-vscode-editor-foreground leading-tight mb-6 font-vscode text-center">
				Generate, refactor, and debug code with AI assistance.
				<br />
				Check out our <VSCodeLink href="https://docs.roocode.com/">documentation</VSCodeLink> to learn more.
			</p>

			<div className="flex flex-col items-start space-y-2 text-vscode-editor-foreground font-vscode max-w-[250px]">
				<div className="flex items-center gap-2">
					<span className="codicon codicon-list-tree"></span>
					<span>
						<VSCodeLink href="https://docs.roocode.com/features/boomerang-tasks">
							Boomerang Tasks
						</VSCodeLink>
						: Orchestrate complex workflows with subtasks
					</span>
				</div>
				<div className="flex items-center gap-2">
					<span className="codicon codicon-pinned"></span>
					<span>
						<VSCodeLink href="https://docs.roocode.com/basic-usage/using-modes">Sticky Models</VSCodeLink>:
						Each mode remembers your last used model
					</span>
				</div>
			</div>
		</div>
	)
}

export default WelcomeView
