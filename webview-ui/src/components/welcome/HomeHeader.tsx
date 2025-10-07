import { EmptyRequest } from "@shared/proto/cline/common"
import { InfoIcon } from "lucide-react"
import ClineLogoVariable from "@/assets/ClineLogoVariable"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { UiServiceClient } from "@/services/grpc-client"

interface HomeHeaderProps {
	shouldShowQuickWins?: boolean
}

const HomeHeader = ({ shouldShowQuickWins = false }: HomeHeaderProps) => {
	const handleTakeATour = async () => {
		try {
			await UiServiceClient.openWalkthrough(EmptyRequest.create())
		} catch (error) {
			console.error("Error opening walkthrough:", error)
		}
	}

	return (
		<div className="flex flex-col items-center mb-5">
			<div className="my-5">
				<ClineLogoVariable className="size-16" />
			</div>
			<div className="text-center flex items-center justify-center">
				<h1 className="m-0 font-bold">What can I do for you?</h1>
				<Tooltip>
					<TooltipContent className="w-full" side="bottom">
						<span className="wrap-break-word text-base">
							I can develop software step-by-step by editing files, exploring projects, running commands, and using
							browsers. I can even extend my capabilities with MCP tools to assist beyond basic code completion.
						</span>
					</TooltipContent>
					<TooltipTrigger asChild>
						<InfoIcon className="ml-2 cursor-pointer text-link text-sm size-2" />
					</TooltipTrigger>
				</Tooltip>
			</div>
			{shouldShowQuickWins && (
				<div className="mt-4">
					<button
						className="flex items-center gap-2 px-4 py-2 rounded-full border border-border-panel bg-white/2 hover:bg-list-background-hover transition-colors duration-150 ease-in-out text-code-foreground text-sm font-medium cursor-pointer"
						onClick={handleTakeATour}
						type="button">
						Take a Tour
						<span className="codicon codicon-play scale-90"></span>
					</button>
				</div>
			)}
		</div>
	)
}

export default HomeHeader
