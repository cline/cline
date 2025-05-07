import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { memo, useState } from "react"
import { vscode } from "@src/utils/vscode"
import { TelemetrySetting } from "@roo/shared/TelemetrySetting"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { Trans } from "react-i18next"
import { cn } from "@/lib/utils"

const TelemetryBanner = () => {
	const { t } = useAppTranslation()
	const [hasChosen, setHasChosen] = useState(false)

	const handleAllow = () => {
		setHasChosen(true)
		vscode.postMessage({ type: "telemetrySetting", text: "enabled" satisfies TelemetrySetting })
	}

	const handleDeny = () => {
		setHasChosen(true)
		vscode.postMessage({ type: "telemetrySetting", text: "disabled" satisfies TelemetrySetting })
	}

	const handleOpenSettings = () => {
		window.postMessage({
			type: "action",
			action: "settingsButtonClicked",
			values: { section: "advanced" }, // Link directly to advanced settings with telemetry controls
		})
	}

	return (
		<div className={`bg-vscode-banner-background p-[12px_20px] flex flex-col gap-[10px] shrink-0 mb-[6px]`}>
			<div>
				<strong>{t("welcome:telemetry.title")}</strong>
				<div className="mt-1">
					{t("welcome:telemetry.anonymousTelemetry")}
					<div className="mt-1">
						<Trans
							i18nKey="welcome:telemetry.changeSettings"
							components={{
								settingsLink: <VSCodeLink href="#" onClick={handleOpenSettings} />,
							}}
						/>
						.
					</div>
				</div>
			</div>
			<div className={cn("flex gap-[8px] w-full")}>
				<VSCodeButton appearance="primary" onClick={handleAllow} disabled={hasChosen} className="flex-1">
					{t("welcome:telemetry.allow")}
				</VSCodeButton>
				<VSCodeButton appearance="secondary" onClick={handleDeny} disabled={hasChosen} className="flex-1">
					{t("welcome:telemetry.deny")}
				</VSCodeButton>
			</div>
		</div>
	)
}

export default memo(TelemetryBanner)
