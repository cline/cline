import React from "react"
import { useTranslation } from "react-i18next"
import MarkdownBlock from "../common/MarkdownBlock"

interface ReportBugPreviewProps {
	data: string
}

const ReportBugPreview: React.FC<ReportBugPreviewProps> = ({ data }) => {
	const { t } = useTranslation()
	// Parse the JSON data from the context string
	const bugData = React.useMemo(() => {
		try {
			return JSON.parse(data || "{}")
		} catch (e) {
			console.error("Failed to parse bug report data", e)
			return {}
		}
	}, [data])

	return (
		<div className="bg-badge-background/50 text-badge-foreground rounded-xs p-3">
			<h2 className="font-bold mb-3">{bugData.title || t("chat:reportBug.title")}</h2>

			<div className="space-y-3 text-sm">
				{bugData.what_happened && (
					<div>
						<div className="font-semibold">{t("chat:reportBug.whatHappened")}</div>
						<MarkdownBlock markdown={bugData.what_happened} />
					</div>
				)}

				{bugData.steps_to_reproduce && (
					<div>
						<div className="font-semibold">{t("chat:reportBug.stepsToReproduce")}</div>
						<MarkdownBlock markdown={bugData.steps_to_reproduce} />
					</div>
				)}

				{bugData.api_request_output && (
					<div>
						<div className="font-semibold">{t("chat:reportBug.apiRequestOutput")}</div>
						<MarkdownBlock markdown={bugData.api_request_output} />
					</div>
				)}

				{bugData.provider_and_model && (
					<div>
						<div className="font-semibold">{t("chat:reportBug.providerModel")}</div>
						<MarkdownBlock markdown={bugData.provider_and_model} />
					</div>
				)}

				{bugData.operating_system && (
					<div>
						<div className="font-semibold">{t("chat:reportBug.operatingSystem")}</div>
						<MarkdownBlock markdown={bugData.operating_system} />
					</div>
				)}

				{bugData.system_info && (
					<div>
						<div className="font-semibold">{t("chat:reportBug.systemInfo")}</div>
						<MarkdownBlock markdown={bugData.system_info} />
					</div>
				)}

				{bugData.cline_version && (
					<div>
						<div className="font-semibold">{t("chat:reportBug.clineVersion")}</div>
						<MarkdownBlock markdown={bugData.cline_version} />
					</div>
				)}

				{bugData.additional_context && (
					<div>
						<div className="font-semibold">{t("chat:reportBug.additionalContext")}</div>
						<MarkdownBlock markdown={bugData.additional_context} />
					</div>
				)}
			</div>
		</div>
	)
}

export default ReportBugPreview
