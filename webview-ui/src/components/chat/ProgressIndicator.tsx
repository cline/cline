import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react"

export const ProgressIndicator = () => (
	<div className="w-4 h-4 flex items-center justify-center">
		<div className="scale-[.55] origin-center">
			<VSCodeProgressRing />
		</div>
	</div>
)
