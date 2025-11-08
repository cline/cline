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
		<div className="bg-(--vscode-badge-background) text-(--vscode-badge-foreground) rounded-[3px] p-[14px]">
			<h3 className="font-bold text-base mb-3 mt-0">{bugData.title || t("report_bug_preview.bug_report_title")}</h3>

			<div className="space-y-3 text-sm">
				{bugData.what_happened && (
					<div>
						<div className="font-semibold">{t("report_bug_preview.what_happened")}</div>
						<MarkdownBlock markdown={bugData.what_happened} />
					</div>
				)}

				{bugData.steps_to_reproduce && (
					<div>
						<div className="font-semibold">{t("report_bug_preview.steps_to_reproduce")}</div>
						<MarkdownBlock markdown={bugData.steps_to_reproduce} />
					</div>
				)}

				{bugData.api_request_output && (
					<div>
						<div className="font-semibold">{t("report_bug_preview.relevant_api_request_output")}</div>
						<MarkdownBlock markdown={bugData.api_request_output} />
					</div>
				)}

				{bugData.provider_and_model && (
					<div>
						<div className="font-semibold">{t("report_bug_preview.provider_model")}</div>
						<MarkdownBlock markdown={bugData.provider_and_model} />
					</div>
				)}

				{bugData.operating_system && (
					<div>
						<div className="font-semibold">{t("report_bug_preview.operating_system")}</div>
						<MarkdownBlock markdown={bugData.operating_system} />
					</div>
				)}

				{bugData.system_info && (
					<div>
						<div className="font-semibold">{t("report_bug_preview.system_info")}</div>
						<MarkdownBlock markdown={bugData.system_info} />
					</div>
				)}

				{bugData.cline_version && (
					<div>
						<div className="font-semibold">{t("report_bug_preview.cline_version")}</div>
						<MarkdownBlock markdown={bugData.cline_version} />
					</div>
				)}

				{bugData.additional_context && (
					<div>
						<div className="font-semibold">{t("report_bug_preview.additional_context")}</div>
						<MarkdownBlock markdown={bugData.additional_context} />
					</div>
				)}
			</div>
		</div>
	)
}

export default ReportBugPreview
