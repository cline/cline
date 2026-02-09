import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { memo } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { cn } from "@/lib/utils"
import { getBeadsmithEnvironmentClassname } from "@/utils/environmentColors"
import { AccountWelcomeView } from "./AccountWelcomeView"

type AccountViewProps = {
	onDone: () => void
}

const AccountView = ({ onDone }: AccountViewProps) => {
	const { environment } = useExtensionState()
	const titleColor = getBeadsmithEnvironmentClassname(environment)

	return (
		<div className="fixed inset-0 flex flex-col overflow-hidden pt-[10px] pl-[20px]">
			<div className="flex justify-between items-center mb-[17px] pr-[17px]">
				<h3 className={cn("text-(--vscode-foreground) m-0", titleColor)}>About Beadsmith</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>
			<div className="grow overflow-hidden pr-[8px] flex flex-col">
				<div className="h-full mb-1.5">
					<AccountWelcomeView />
				</div>
			</div>
		</div>
	)
}

export default memo(AccountView)
