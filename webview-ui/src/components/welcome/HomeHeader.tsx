import { EmptyRequest } from "@shared/proto/cline/common"
import { Play } from "lucide-react"

import AiHydroLogoVariable from "@/assets/AiHydroLogoVariable"
import HeroTooltip from "@/components/common/HeroTooltip"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

interface HomeHeaderProps {
	shouldShowQuickWins?: boolean
}

const HomeHeader = ({ shouldShowQuickWins = false }: HomeHeaderProps) => {
	const { environment } = useExtensionState()

	const handleTakeATour = async () => {
		try {
			await UiServiceClient.openWalkthrough(EmptyRequest.create())
		} catch (error) {
			console.error("Error opening walkthrough:", error)
		}
	}

	return (
		<div className="flex flex-col items-center mb-6 pt-4 animate-fade-in-up">
			{/* Logo with glow effect */}
			<div className="relative mb-5">
				<div className="animate-float">
					<AiHydroLogoVariable className="size-20" environment={environment} />
				</div>
				<div className="absolute -inset-4 rounded-full bg-gradient-to-br from-aihydro-ocean-blue/10 to-aihydro-teal/10 blur-2xl -z-10" />
			</div>

			{/* Title with gradient accent */}
			<div className="text-center flex items-center justify-center gap-2 mb-2">
				<h2 className="m-0 text-xl font-semibold text-[var(--vscode-foreground)]">{"What can I help you with?"}</h2>
				<HeroTooltip
					className="max-w-[300px]"
					content={
						"I can assist with hydrological modeling, watershed analysis, CAMELS data processing, streamflow analysis, and scientific workflows. I can fetch USGS data, compute signatures, run hydrological models, and help with Python-based hydrology computations."
					}
					placement="bottom">
					<span className="codicon codicon-info cursor-pointer text-link text-sm opacity-60 hover:opacity-100 transition-opacity" />
				</HeroTooltip>
			</div>

			{/* Subtitle */}
			<p className="text-xs text-[var(--vscode-descriptionForeground)] text-center max-w-sm mb-4 leading-relaxed">
				Hydrology research, coding, data analysis, model building — just ask.
			</p>

			{/* Tour Button */}
			{shouldShowQuickWins && (
				<div className="mt-2 animate-fade-in-up stagger-1">
					<button
						className="group flex items-center gap-2 px-5 py-2.5 rounded-full
							border border-aihydro-ocean-blue/30 bg-aihydro-ocean-blue/5
							hover:bg-aihydro-ocean-blue/15 hover:border-aihydro-ocean-blue/50
							active:scale-[0.98]
							transition-all duration-200 ease-out
							text-aihydro-ocean-light text-sm font-medium cursor-pointer"
						onClick={handleTakeATour}
						type="button">
						<span>Take a Tour</span>
						<Play className="transition-transform duration-200 group-hover:translate-x-0.5" size={14} />
					</button>
				</div>
			)}
		</div>
	)
}

export default HomeHeader
