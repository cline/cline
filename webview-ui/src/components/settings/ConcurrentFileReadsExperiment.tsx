import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { Slider } from "@/components/ui/slider"

interface ConcurrentFileReadsExperimentProps {
	enabled: boolean
	onEnabledChange: (value: boolean) => void
	maxConcurrentFileReads: number
	onMaxConcurrentFileReadsChange: (value: number) => void
}

export const ConcurrentFileReadsExperiment = ({
	enabled,
	onEnabledChange,
	maxConcurrentFileReads,
	onMaxConcurrentFileReadsChange,
}: ConcurrentFileReadsExperimentProps) => {
	const { t } = useAppTranslation()

	const handleChange = (value: boolean) => {
		onEnabledChange(value)
		// Set to 1 if disabling to reset the setting
		if (!value) {
			onMaxConcurrentFileReadsChange(1)
		} else {
			// When enabling, ensure we have a valid value > 1
			if (!maxConcurrentFileReads || maxConcurrentFileReads <= 1) {
				onMaxConcurrentFileReadsChange(15)
			}
		}
	}

	return (
		<div>
			<div className="flex items-center gap-2">
				<VSCodeCheckbox
					checked={enabled}
					onChange={(e: any) => handleChange(e.target.checked)}
					data-testid="concurrent-file-reads-checkbox">
					<span className="font-medium">{t("settings:experimental.CONCURRENT_FILE_READS.name")}</span>
				</VSCodeCheckbox>
			</div>
			<p className="text-vscode-descriptionForeground text-sm mt-0">
				{t("settings:experimental.CONCURRENT_FILE_READS.description")}
			</p>

			{enabled && (
				<div className="flex flex-col gap-3 pl-3 border-l-2 border-vscode-button-background">
					<div>
						<span className="block text-sm mb-1">
							{t("settings:contextManagement.maxConcurrentFileReads.label")}
						</span>
						<div className="flex items-center gap-2">
							<Slider
								min={2}
								max={100}
								step={1}
								value={[Math.max(2, maxConcurrentFileReads)]}
								onValueChange={([value]) => onMaxConcurrentFileReadsChange(value)}
								data-testid="max-concurrent-file-reads-slider"
							/>
							<span className="w-10 text-sm">{Math.max(2, maxConcurrentFileReads)}</span>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
