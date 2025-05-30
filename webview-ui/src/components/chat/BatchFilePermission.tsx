import { memo } from "react"

import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"
import { vscode } from "@src/utils/vscode"
import { removeLeadingNonAlphanumeric } from "@src/utils/removeLeadingNonAlphanumeric"

interface FilePermissionItem {
	path: string
	lineSnippet?: string
	isOutsideWorkspace?: boolean
	key: string
	content?: string // full path
}

interface BatchFilePermissionProps {
	files: FilePermissionItem[]
	onPermissionResponse?: (response: { [key: string]: boolean }) => void
	ts: number
}

export const BatchFilePermission = memo(({ files = [], onPermissionResponse, ts }: BatchFilePermissionProps) => {
	// Don't render if there are no files or no response handler
	if (!files?.length || !onPermissionResponse) {
		return null
	}

	return (
		<div className="pt-[5px]">
			{/* Individual files */}
			<div className="flex flex-col gap-0 border border-border rounded-md p-1">
				{files.map((file) => {
					return (
						<div key={`${file.path}-${ts}`} className="flex items-center gap-2">
							<ToolUseBlock className="flex-1">
								<ToolUseBlockHeader
									onClick={() => vscode.postMessage({ type: "openFile", text: file.content })}>
									{file.path?.startsWith(".") && <span>.</span>}
									<span className="whitespace-nowrap overflow-hidden text-ellipsis text-left mr-2 rtl">
										{removeLeadingNonAlphanumeric(file.path ?? "") + "\u200E"}
										{file.lineSnippet && ` ${file.lineSnippet}`}
									</span>
									<div className="flex-grow"></div>
									<span className="codicon codicon-link-external text-[13.5px] my-[1px]" />
								</ToolUseBlockHeader>
							</ToolUseBlock>
						</div>
					)
				})}
			</div>
		</div>
	)
})

BatchFilePermission.displayName = "BatchFilePermission"
