import { HTMLAttributes, useState } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { Info, Download, Upload, TriangleAlert } from "lucide-react"

import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"

import { Package } from "@roo/package"
import { TelemetrySetting } from "@roo/TelemetrySetting"

import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type AboutProps = HTMLAttributes<HTMLDivElement> & {
	telemetrySetting: TelemetrySetting
	setTelemetrySetting: (setting: TelemetrySetting) => void
}

export const About = ({ telemetrySetting, setTelemetrySetting, className, ...props }: AboutProps) => {
	const { t } = useAppTranslation()
	const [shouldThrowError, setShouldThrowError] = useState(false)

	// Function to trigger error for testing ErrorBoundary
	const triggerTestError = () => {
		setShouldThrowError(true)
	}

	// Named function to make it easier to identify in stack traces
	function throwTestError() {
		// Intentionally cause a type error by accessing a property on undefined
		const obj: any = undefined
		obj.nonExistentMethod()
	}

	// Test component that throws an error when shouldThrow is true
	const ErrorThrower = ({ shouldThrow = false }) => {
		if (shouldThrow) {
			// Use a named function to make it easier to identify in stack traces
			throwTestError()
		}
		return null
	}

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			{/* Test component that throws an error when shouldThrow is true */}
			<ErrorThrower shouldThrow={shouldThrowError} />
			<SectionHeader
				description={
					Package.sha
						? `Version: ${Package.version} (${Package.sha.slice(0, 8)})`
						: `Version: ${Package.version}`
				}>
				<div className="flex items-center gap-2">
					<Info className="w-4" />
					<div>{t("settings:sections.about")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={telemetrySetting === "enabled"}
						onChange={(e: any) => {
							const checked = e.target.checked === true
							setTelemetrySetting(checked ? "enabled" : "disabled")
						}}>
						{t("settings:footer.telemetry.label")}
					</VSCodeCheckbox>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						<Trans
							i18nKey="settings:footer.telemetry.description"
							components={{
								privacyLink: <VSCodeLink href="https://roocode.com/privacy" />,
							}}
						/>
					</p>
				</div>

				<div>
					<Trans
						i18nKey="settings:footer.feedback"
						components={{
							githubLink: <VSCodeLink href="https://github.com/RooCodeInc/Roo-Code" />,
							redditLink: <VSCodeLink href="https://reddit.com/r/RooCode" />,
							discordLink: <VSCodeLink href="https://discord.gg/roocode" />,
						}}
					/>
				</div>

				<div className="flex flex-wrap items-center gap-2 mt-2">
					<Button onClick={() => vscode.postMessage({ type: "exportSettings" })} className="w-28">
						<Upload className="p-0.5" />
						{t("settings:footer.settings.export")}
					</Button>
					<Button onClick={() => vscode.postMessage({ type: "importSettings" })} className="w-28">
						<Download className="p-0.5" />
						{t("settings:footer.settings.import")}
					</Button>
					<Button
						variant="destructive"
						onClick={() => vscode.postMessage({ type: "resetState" })}
						className="w-28">
						<TriangleAlert className="p-0.5" />
						{t("settings:footer.settings.reset")}
					</Button>

					{/* Test button for ErrorBoundary - only visible in development */}
					<Button variant="destructive" onClick={triggerTestError} className="w-auto">
						<TriangleAlert className="p-0.5" />
						Test ErrorBoundary
					</Button>
				</div>
			</Section>
		</div>
	)
}
