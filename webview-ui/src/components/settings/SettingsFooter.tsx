import { HTMLAttributes } from "react"

import { VSCodeButton, VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { TelemetrySetting } from "../../../../src/shared/TelemetrySetting"

type SettingsFooterProps = HTMLAttributes<HTMLDivElement> & {
	version: string
	telemetrySetting: TelemetrySetting
	setTelemetrySetting: (setting: TelemetrySetting) => void
}

export const SettingsFooter = ({
	version,
	telemetrySetting,
	setTelemetrySetting,
	className,
	...props
}: SettingsFooterProps) => (
	<div className={cn("text-vscode-descriptionForeground p-5", className)} {...props}>
		<p style={{ wordWrap: "break-word", margin: 0, padding: 0 }}>
			If you have any questions or feedback, feel free to open an issue at{" "}
			<VSCodeLink href="https://github.com/RooVetGit/Roo-Code" style={{ display: "inline" }}>
				github.com/RooVetGit/Roo-Code
			</VSCodeLink>{" "}
			or join{" "}
			<VSCodeLink href="https://www.reddit.com/r/RooCode/" style={{ display: "inline" }}>
				reddit.com/r/RooCode
			</VSCodeLink>
		</p>
		<p className="italic">Roo Code v{version}</p>
		<div className="mt-4 mb-4">
			<div>
				<VSCodeCheckbox
					style={{ marginBottom: "5px" }}
					checked={telemetrySetting === "enabled"}
					onChange={(e: any) => {
						const checked = e.target.checked === true
						setTelemetrySetting(checked ? "enabled" : "disabled")
					}}>
					Allow anonymous error and usage reporting
				</VSCodeCheckbox>
				<p
					style={{
						fontSize: "12px",
						marginTop: "5px",
						color: "var(--vscode-descriptionForeground)",
					}}>
					Help improve Roo Code by sending anonymous usage data and error reports. No code, prompts, or
					personal information is ever sent. See our{" "}
					<VSCodeLink
						href="https://github.com/RooVetGit/Roo-Code/blob/main/PRIVACY.md"
						style={{ fontSize: "inherit" }}>
						privacy policy
					</VSCodeLink>{" "}
					for more details.
				</p>
			</div>
		</div>
		<div className="flex justify-between items-center gap-3">
			<p>Reset all global state and secret storage in the extension.</p>
			<VSCodeButton
				onClick={() => vscode.postMessage({ type: "resetState" })}
				appearance="secondary"
				className="shrink-0">
				<span className="codicon codicon-warning text-vscode-errorForeground mr-1" />
				Reset
			</VSCodeButton>
		</div>
	</div>
)
