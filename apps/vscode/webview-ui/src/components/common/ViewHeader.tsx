import { ArrowLeftIcon } from "lucide-react"
import { getEnvironmentColor } from "@/utils/environmentColors"
import type { Environment } from "../../../../src/shared/config-types"

const ENV_DISPLAY_NAMES: Record<Environment, string> = {
	production: "Production",
	staging: "Staging",
	local: "Local",
	selfHosted: "Self-hosted",
}

type ViewHeaderProps = {
	title: string
	onDone: () => void
	showEnvironmentSuffix?: boolean
	environment?: Environment
}

const ViewHeader = ({ title, onDone, showEnvironmentSuffix, environment }: ViewHeaderProps) => {
	const showSubtext = showEnvironmentSuffix && environment && environment !== "production"
	const capitalizedEnv = environment ? ENV_DISPLAY_NAMES[environment] : ""
	const titleColor = environment && environment !== "production" ? getEnvironmentColor(environment) : "#eceef0"

	return (
		<div className="flex justify-between items-center h-12 px-5 mb-3 bg-[#0e0f10] border-b border-white/[0.07] shrink-0">
			<div className="flex items-center gap-3 relative">
				<button
					aria-label="Back to chat"
					className="inline-flex items-center justify-center size-7 rounded-md bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[#c8cdd4] hover:text-[#ffffff] transition-colors cursor-pointer"
					onClick={onDone}
					type="button">
					<ArrowLeftIcon size={14} strokeWidth={1.8} />
				</button>
				<h3 className="m-0 text-[14.5px] font-medium tracking-[-0.01em]" style={{ color: titleColor }}>
					{title}
				</h3>
				{showSubtext && (
					<span className="text-[11px] font-geist-mono px-2 py-0.5 rounded bg-white/[0.05] text-[#8f959e] whitespace-nowrap">
						{capitalizedEnv}
					</span>
				)}
			</div>
			<button
				className="h-7 px-3.5 rounded-md bg-[#eceef0] hover:bg-white text-[#0e0f10] border-0 text-[12px] font-medium transition-colors cursor-pointer"
				onClick={onDone}
				type="button">
				Done
			</button>
		</div>
	)
}

export default ViewHeader
