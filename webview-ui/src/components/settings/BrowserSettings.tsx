import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { SquareMousePointer } from "lucide-react"
import { HTMLAttributes, useEffect, useMemo, useState } from "react"

import { cn } from "@/lib/utils"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue, Slider } from "@/components/ui"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { vscode } from "@/utils/vscode"

import { Section } from "./Section"
import { SectionHeader } from "./SectionHeader"
import { SetCachedStateField } from "./types"

type BrowserSettingsProps = HTMLAttributes<HTMLDivElement> & {
	browserToolEnabled?: boolean
	browserViewportSize?: string
	screenshotQuality?: number
	remoteBrowserHost?: string
	remoteBrowserEnabled?: boolean
	setCachedStateField: SetCachedStateField<
		| "browserToolEnabled"
		| "browserViewportSize"
		| "screenshotQuality"
		| "remoteBrowserHost"
		| "remoteBrowserEnabled"
	>
}

export const BrowserSettings = ({
	browserToolEnabled,
	browserViewportSize,
	screenshotQuality,
	remoteBrowserHost,
	remoteBrowserEnabled,
	setCachedStateField,
	...props
}: BrowserSettingsProps) => {
	const { t } = useAppTranslation()

	const [testingConnection, setTestingConnection] = useState(false)
	const [testResult, setTestResult] = useState<{ success: boolean; text: string } | null>(null)
	const [discovering, setDiscovering] = useState(false)

	// We don't need a local state for useRemoteBrowser since we're using the
	// `enableRemoteBrowser` prop directly. This ensures the checkbox always
	// reflects the current global state.

	// Set up message listener for browser connection results.
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data

			if (message.type === "browserConnectionResult") {
				setTestResult({ success: message.success, text: message.text })
				setTestingConnection(false)
				setDiscovering(false)
			}
		}

		window.addEventListener("message", handleMessage)

		return () => {
			window.removeEventListener("message", handleMessage)
		}
	}, [])

	const testConnection = async () => {
		setTestingConnection(true)
		setTestResult(null)

		try {
			// Send a message to the extension to test the connection.
			vscode.postMessage({ type: "testBrowserConnection", text: remoteBrowserHost })
		} catch (error) {
			setTestResult({
				success: false,
				text: `Error: ${error instanceof Error ? error.message : String(error)}`,
			})
			setTestingConnection(false)
		}
	}

	const options = useMemo(
		() => [
			{
				value: "1280x800",
				label: t("settings:browser.viewport.options.largeDesktop"),
			},
			{
				value: "900x600",
				label: t("settings:browser.viewport.options.smallDesktop"),
			},
			{ value: "768x1024", label: t("settings:browser.viewport.options.tablet") },
			{ value: "360x640", label: t("settings:browser.viewport.options.mobile") },
		],
		[t],
	)

	return (
		<div {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<SquareMousePointer className="w-4" />
					<div>{t("settings:sections.browser")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<VSCodeCheckbox
						checked={browserToolEnabled}
						onChange={(e: any) => setCachedStateField("browserToolEnabled", e.target.checked)}>
						<span className="font-medium">{t("settings:browser.enable.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:browser.enable.description")}
					</div>
				</div>

				{browserToolEnabled && (
					<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
						<div>
							<label className="block font-medium mb-1">{t("settings:browser.viewport.label")}</label>
							<Select
								value={browserViewportSize}
								onValueChange={(value) => setCachedStateField("browserViewportSize", value)}>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("settings:common.select")} />
								</SelectTrigger>
								<SelectContent>
									<SelectGroup>
										{options.map(({ value, label }) => (
											<SelectItem key={value} value={value}>
												{label}
											</SelectItem>
										))}
									</SelectGroup>
								</SelectContent>
							</Select>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:browser.viewport.description")}
							</div>
						</div>

						<div>
							<label className="block font-medium mb-1">
								{t("settings:browser.screenshotQuality.label")}
							</label>
							<div className="flex items-center gap-2">
								<Slider
									min={1}
									max={100}
									step={1}
									value={[screenshotQuality ?? 75]}
									onValueChange={([value]) => setCachedStateField("screenshotQuality", value)}
								/>
								<span className="w-10">{screenshotQuality ?? 75}%</span>
							</div>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:browser.screenshotQuality.description")}
							</div>
						</div>

						<div>
							<VSCodeCheckbox
								checked={remoteBrowserEnabled}
								onChange={(e: any) => {
									// Update the global state - remoteBrowserEnabled now means "enable remote browser connection".
									setCachedStateField("remoteBrowserEnabled", e.target.checked)

									if (!e.target.checked) {
										// If disabling remote browser, clear the custom URL.
										setCachedStateField("remoteBrowserHost", undefined)
									}
								}}>
								<label className="block font-medium mb-1">{t("settings:browser.remote.label")}</label>
							</VSCodeCheckbox>
							<div className="text-vscode-descriptionForeground text-sm mt-1">
								{t("settings:browser.remote.description")}
							</div>
						</div>

						{remoteBrowserEnabled && (
							<>
								<div className="flex items-center gap-2">
									<VSCodeTextField
										value={remoteBrowserHost ?? ""}
										onChange={(e: any) =>
											setCachedStateField("remoteBrowserHost", e.target.value || undefined)
										}
										placeholder={t("settings:browser.remote.urlPlaceholder")}
										className="grow"
									/>
									<VSCodeButton disabled={testingConnection} onClick={testConnection}>
										{testingConnection || discovering
											? t("settings:browser.remote.testingButton")
											: t("settings:browser.remote.testButton")}
									</VSCodeButton>
								</div>
								{testResult && (
									<div
										className={cn(
											"p-2 rounded-xs text-sm",
											testResult.success
												? "bg-green-800/20 text-green-400"
												: "bg-red-800/20 text-red-400",
										)}>
										{testResult.text}
									</div>
								)}
								<div className="text-vscode-descriptionForeground text-sm mt-1">
									{t("settings:browser.remote.instructions")}
								</div>
							</>
						)}
					</div>
				)}
			</Section>
		</div>
	)
}
