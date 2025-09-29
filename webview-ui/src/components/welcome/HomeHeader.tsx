import { EmptyRequest } from "@shared/proto/cline/common"
import { InfoIcon } from "lucide-react"
import ClineLogoVariable from "@/assets/ClineLogoVariable"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
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
				<h2 className="m-0 text-md font-bold">What can I do for you?</h2>
				<HoverCard>
					<HoverCardContent className="h-full wrap-break-word">
						<div className="space-y-1 text-description text-xs break-words">
							I can develop software step-by-step by editing files, exploring projects, running commands, and using
							browsers. I can even extend my capabilities with MCP tools to assist beyond basic code completion.
						</div>
					</HoverCardContent>
					<HoverCardTrigger asChild>
						<InfoIcon className="ml-2 cursor-pointer text-link text-sm size-3" />
					</HoverCardTrigger>
				</HoverCard>
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
