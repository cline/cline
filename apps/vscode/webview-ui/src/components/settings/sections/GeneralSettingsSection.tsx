import { VSCodeCheckbox, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { LayoutPanelLeftIcon } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useStudioWorkspacePanes } from "@/hooks/useStudioWorkspacePanes"
import PreferredLanguageSetting from "../PreferredLanguageSetting"
import Section from "../Section"
import { updateSetting } from "../utils/settingsHandlers"

interface GeneralSettingsSectionProps {
	renderSectionHeader: (tabId: string) => JSX.Element | null
}

const GeneralSettingsSection = ({ renderSectionHeader }: GeneralSettingsSectionProps) => {
	const { telemetrySetting, remoteConfigSettings } = useExtensionState()
	const { showExplorerAndEditor, setShowExplorerAndEditor } = useStudioWorkspacePanes()

	return (
		<div>
			{renderSectionHeader("general")}
			<Section>
				{/* Workspace & Layout Card */}
				<div>
					<div className="text-[11px] font-geist-mono font-medium text-[#70767f] uppercase tracking-[0.1em] mb-2.5 px-0.5">
						Workspace Layout
					</div>
					<div className="rounded-xl bg-[#151618] border border-white/[0.08] p-4">
						<div className="flex items-start justify-between gap-4">
							<div className="flex items-start gap-3">
								<div className="mt-0.5 size-8 rounded-lg bg-white/[0.05] border border-white/[0.07] flex items-center justify-center shrink-0 text-[#c8cdd4]">
									<LayoutPanelLeftIcon size={15} strokeWidth={1.8} />
								</div>
								<div>
									<VSCodeCheckbox
										checked={showExplorerAndEditor}
										data-testid="toggle-explorer-editor-checkbox"
										onChange={(e: any) => {
											const checked = e.target.checked === true
											setShowExplorerAndEditor(checked)
										}}>
										<span className="text-[13.5px] font-medium text-[#eceef0]">
											Mostra File Explorer ed Editor dei file
										</span>
									</VSCodeCheckbox>
									<p className="text-[12px] mt-1.5 mb-0 text-[#858b94] leading-relaxed">
										Quando attivo, visualizza il File Explorer a sinistra e l'editor singolo al centro accanto
										a Cline. Disattiva questa opzione per nasconderli e mostrare esclusivamente la chat di
										Cline a tutta finestra.
									</p>
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Language Card */}
				<div>
					<div className="text-[11px] font-geist-mono font-medium text-[#70767f] uppercase tracking-[0.1em] mb-2.5 px-0.5">
						Language
					</div>
					<div className="rounded-xl bg-[#151618] border border-white/[0.08] p-4">
						<PreferredLanguageSetting />
					</div>
				</div>

				{/* Privacy & Telemetry Card */}
				<div>
					<div className="text-[11px] font-geist-mono font-medium text-[#70767f] uppercase tracking-[0.1em] mb-2.5 px-0.5">
						Privacy & Telemetry
					</div>
					<div className="rounded-xl bg-[#151618] border border-white/[0.08] p-4">
						<Tooltip>
							<TooltipContent hidden={remoteConfigSettings?.telemetrySetting === undefined}>
								This setting is managed by your organization's remote configuration
							</TooltipContent>
							<TooltipTrigger asChild>
								<div className="flex items-center gap-2">
									<VSCodeCheckbox
										checked={telemetrySetting !== "disabled"}
										disabled={remoteConfigSettings?.telemetrySetting === "disabled"}
										onChange={(e: any) => {
											const checked = e.target.checked === true
											updateSetting("telemetrySetting", checked ? "enabled" : "disabled")
										}}>
										<span className="text-[13.5px] font-medium text-[#eceef0]">
											Allow error and usage reporting
										</span>
									</VSCodeCheckbox>
									{!!remoteConfigSettings?.telemetrySetting && (
										<i className="codicon codicon-lock text-description text-sm" />
									)}
								</div>
							</TooltipTrigger>
						</Tooltip>

						<p className="text-[12px] mt-2 mb-0 text-[#858b94] leading-relaxed">
							Help improve Cline by sending usage data and error reports. Reports don't include your code or
							prompts, except for requests to the Cline and ClinePass providers. See the{" "}
							<VSCodeLink
								className="text-inherit"
								href="https://docs.cline.bot/more-info/telemetry"
								style={{ fontSize: "inherit", textDecoration: "underline" }}>
								telemetry overview
							</VSCodeLink>{" "}
							and{" "}
							<VSCodeLink
								className="text-inherit"
								href="https://cline.bot/privacy"
								style={{ fontSize: "inherit", textDecoration: "underline" }}>
								privacy policy
							</VSCodeLink>
							.
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}

export default GeneralSettingsSection
