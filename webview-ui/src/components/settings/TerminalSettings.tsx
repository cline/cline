import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SquareTerminal } from "lucide-react"

import { cn } from "@/lib/utils"

import { SetCachedStateField } from "./types"
import { sliderLabelStyle } from "./styles"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type TerminalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	terminalOutputLineLimit?: number
	terminalShellIntegrationTimeout?: number
	setCachedStateField: SetCachedStateField<"terminalOutputLineLimit" | "terminalShellIntegrationTimeout">
}

export const TerminalSettings = ({
	terminalOutputLineLimit,
	terminalShellIntegrationTimeout,
	setCachedStateField,
	className,
	...props
}: TerminalSettingsProps) => {
	const { t } = useAppTranslation()

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<SquareTerminal className="w-4" />
					<div>{t("settings:sections.terminal")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:terminal.outputLineLimit.label")}</span>
						<div className="flex items-center gap-2">
							<input
								type="range"
								min="100"
								max="5000"
								step="100"
								value={terminalOutputLineLimit ?? 500}
								onChange={(e) =>
									setCachedStateField("terminalOutputLineLimit", parseInt(e.target.value))
								}
								className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
								data-testid="terminal-output-limit-slider"
							/>
							<span style={{ ...sliderLabelStyle }}>{terminalOutputLineLimit ?? 500}</span>
						</div>
					</div>
					<p className="text-vscode-descriptionForeground text-sm mt-0">
						{t("settings:terminal.outputLineLimit.description")}
					</p>
				</div>

				<div>
					<div className="flex flex-col gap-2">
						<span className="font-medium">{t("settings:terminal.shellIntegrationTimeout.label")}</span>
						<div className="flex items-center gap-2">
							<input
								type="range"
								min="1000"
								max="60000"
								step="1000"
								value={terminalShellIntegrationTimeout}
								onChange={(e) =>
									setCachedStateField(
										"terminalShellIntegrationTimeout",
										Math.min(60000, Math.max(1000, parseInt(e.target.value))),
									)
								}
								className="h-2 focus:outline-0 w-4/5 accent-vscode-button-background"
							/>
							<span style={{ ...sliderLabelStyle }}>
								{(terminalShellIntegrationTimeout ?? 5000) / 1000}s
							</span>
						</div>
						<p className="text-vscode-descriptionForeground text-sm mt-0">
							{t("settings:terminal.shellIntegrationTimeout.description")}
						</p>
					</div>
				</div>
			</Section>
		</div>
	)
}
