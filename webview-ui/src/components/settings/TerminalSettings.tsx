import { HTMLAttributes } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { SquareTerminal } from "lucide-react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"

import { cn } from "@/lib/utils"
import { Slider } from "@/components/ui"

import { SetCachedStateField } from "./types"
import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type TerminalSettingsProps = HTMLAttributes<HTMLDivElement> & {
	terminalOutputLineLimit?: number
	terminalShellIntegrationTimeout?: number
	terminalShellIntegrationDisabled?: boolean
	terminalCommandDelay?: number
	terminalPowershellCounter?: boolean
	terminalZshClearEolMark?: boolean
	terminalZshOhMy?: boolean
	terminalZshP10k?: boolean
	terminalZdotdir?: boolean
	terminalCompressProgressBar?: boolean
	setCachedStateField: SetCachedStateField<
		| "terminalOutputLineLimit"
		| "terminalShellIntegrationTimeout"
		| "terminalShellIntegrationDisabled"
		| "terminalCommandDelay"
		| "terminalPowershellCounter"
		| "terminalZshClearEolMark"
		| "terminalZshOhMy"
		| "terminalZshP10k"
		| "terminalZdotdir"
		| "terminalCompressProgressBar"
	>
}

export const TerminalSettings = ({
	terminalOutputLineLimit,
	terminalShellIntegrationTimeout,
	terminalShellIntegrationDisabled,
	terminalCommandDelay,
	terminalPowershellCounter,
	terminalZshClearEolMark,
	terminalZshOhMy,
	terminalZshP10k,
	terminalZdotdir,
	terminalCompressProgressBar,
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
					<VSCodeCheckbox
						checked={terminalCompressProgressBar ?? true}
						onChange={(e: any) => setCachedStateField("terminalCompressProgressBar", e.target.checked)}
						data-testid="terminal-compress-progress-bar-checkbox">
						<span className="font-medium">{t("settings:terminal.compressProgressBar.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.compressProgressBar.description")}
					</div>
				</div>

				<div>
					<label className="block font-medium mb-1">
						{t("settings:terminal.shellIntegrationTimeout.label")}
					</label>
					<div className="flex items-center gap-2">
						<Slider
							min={5_000}
							max={60_000}
							step={1_000}
							value={[terminalShellIntegrationTimeout ?? 5_000]}
							onValueChange={([value]) =>
								setCachedStateField(
									"terminalShellIntegrationTimeout",
									Math.min(60_000, Math.max(5_000, value)),
								)
							}
						/>
						<span className="w-10">{(terminalShellIntegrationTimeout ?? 5000) / 1000}s</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.shellIntegrationTimeout.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={terminalShellIntegrationDisabled ?? false}
						onChange={(e: any) =>
							setCachedStateField("terminalShellIntegrationDisabled", e.target.checked)
						}>
						<span className="font-medium">{t("settings:terminal.shellIntegrationDisabled.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.shellIntegrationDisabled.description")}
					</div>
				</div>

				<div>
					<label className="block font-medium mb-1">{t("settings:terminal.commandDelay.label")}</label>
					<div className="flex items-center gap-2">
						<Slider
							min={0}
							max={1000}
							step={10}
							value={[terminalCommandDelay ?? 0]}
							onValueChange={([value]) =>
								setCachedStateField("terminalCommandDelay", Math.min(1000, Math.max(0, value)))
							}
						/>
						<span className="w-10">{terminalCommandDelay ?? 50}ms</span>
					</div>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.commandDelay.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={terminalPowershellCounter ?? false}
						onChange={(e: any) => setCachedStateField("terminalPowershellCounter", e.target.checked)}
						data-testid="terminal-powershell-counter-checkbox">
						<span className="font-medium">{t("settings:terminal.powershellCounter.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.powershellCounter.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={terminalZshClearEolMark ?? true}
						onChange={(e: any) => setCachedStateField("terminalZshClearEolMark", e.target.checked)}
						data-testid="terminal-zsh-clear-eol-mark-checkbox">
						<span className="font-medium">{t("settings:terminal.zshClearEolMark.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.zshClearEolMark.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={terminalZshOhMy ?? false}
						onChange={(e: any) => setCachedStateField("terminalZshOhMy", e.target.checked)}
						data-testid="terminal-zsh-oh-my-checkbox">
						<span className="font-medium">{t("settings:terminal.zshOhMy.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.zshOhMy.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={terminalZshP10k ?? false}
						onChange={(e: any) => setCachedStateField("terminalZshP10k", e.target.checked)}
						data-testid="terminal-zsh-p10k-checkbox">
						<span className="font-medium">{t("settings:terminal.zshP10k.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.zshP10k.description")}
					</div>
				</div>

				<div>
					<VSCodeCheckbox
						checked={terminalZdotdir ?? false}
						onChange={(e: any) => setCachedStateField("terminalZdotdir", e.target.checked)}
						data-testid="terminal-zdotdir-checkbox">
						<span className="font-medium">{t("settings:terminal.zdotdir.label")}</span>
					</VSCodeCheckbox>
					<div className="text-vscode-descriptionForeground text-sm mt-1">
						{t("settings:terminal.zdotdir.description")}
					</div>
				</div>
			</Section>
		</div>
	)
}
