import { EmptyRequest } from "@shared/proto/cline/common"
import ClineLogoVariable from "@/assets/ClineLogoVariable"
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
		<div className="flex flex-col items-center pt-10 pb-6 px-4 select-none">
			<div className="mb-5 size-12 rounded-2xl bg-[#151618] border border-white/[0.08] shadow-[0_4px_20px_rgba(0,0,0,0.3)] flex items-center justify-center">
				<ClineLogoVariable className="size-6 text-[#eceef0]" environment={environment} />
			</div>
			<div className="text-center flex flex-col items-center">
				<h1 className="m-0 text-[22px] font-medium tracking-[-0.025em] text-[#eceef0]">How can I help you today?</h1>
				<p className="m-0 mt-1.5 text-[13px] text-[#7c828b] font-normal">
					Minimal workspace · Reference files with{" "}
					<span className="font-geist-mono text-[12px] text-[#a6acb5] bg-white/[0.05] px-1.5 py-0.5 rounded">@</span>{" "}
					or commands with{" "}
					<span className="font-geist-mono text-[12px] text-[#a6acb5] bg-white/[0.05] px-1.5 py-0.5 rounded">/</span>
				</p>
			</div>
			{shouldShowQuickWins && (
				<div className="mt-5">
					<button
						className="flex items-center gap-2 px-4 py-1.5 rounded-lg border border-white/[0.09] bg-[#151618] hover:bg-[#1e2024] transition-colors duration-150 ease-in-out text-[#d8dbe0] text-[12.5px] font-medium cursor-pointer"
						onClick={handleTakeATour}
						type="button">
						Take a Tour
						<span className="codicon codicon-play scale-90" />
					</button>
				</div>
			)}
		</div>
	)
}

export default HomeHeader
