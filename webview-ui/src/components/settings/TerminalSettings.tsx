import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SquareTerminal } from "lucide-react"

import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui"

import { SetCachedStateField } from "./types"
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
					<label className="block font-medium mb-1">{t("settings:terminal.outputLineLimit.label")}</label>
					<div className="flex items-center gap-2">
						<Slider
							min={100}
							max={5000}
							step={100}
							value={[terminalOutputLineLimit ?? 500]}
							onValueChange={([value]) => setCachedStateField("terminalOutputLineLimit", value)}
							data-testid="terminal-output-limit-slider"
						/>
						<span className="w-10">{terminalOutputLineLimit ?? 500}</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.outputLineLimit.description")}
					</div>
				</div>

				<div>
					<label className="block font-medium mb-1">
						{t("settings:terminal.shellIntegrationTimeout.label")}
					</label>
					<div className="flex items-center gap-2">
						<Slider
							min={1000}
							max={60000}
							step={1000}
							value={[terminalShellIntegrationTimeout ?? 5000]}
							onValueChange={([value]) =>
								setCachedStateField(
									"terminalShellIntegrationTimeout",
									Math.min(60000, Math.max(1000, value)),
								)
							}
						/>
						<span className="w-10">{(terminalShellIntegrationTimeout ?? 5000) / 1000}s</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.shellIntegrationTimeout.description")}
					</div>
				</div>
			</Section>
		</div>
	)
}
