import { ClineMessage, ClineSayTool } from "@shared/ExtensionMessage"
import { StringRequest } from "@shared/proto/cline/common"
import {
	ChevronDownIcon,
	ChevronRightIcon,
	FileCode2Icon,
	FilePlus2Icon,
	FoldVerticalIcon,
	ImageUpIcon,
	LightbulbIcon,
	Link2Icon,
	PencilIcon,
	SearchIcon,
	SquareArrowOutUpRightIcon,
	SquareMinusIcon,
} from "lucide-react"
import { lazy, memo, Suspense } from "react"
import { cn } from "@/lib/utils"
import { FileServiceClient, UiServiceClient } from "@/services/grpc-client"
import CodeAccordian, { cleanPathPrefix } from "../common/CodeAccordian"
import { DiffEditRow } from "./DiffEditRow"

// V12 方案5 — search results are only shown for search_files tool messages, so
// the renderer is split into its own chunk.
const SearchResultsDisplay = lazy(() => import("./SearchResultsDisplay"))

const SearchResultsSkeleton = () => (
	<div className="py-1 text-muted-foreground text-sm">
		<span className="codicon codicon-loading codicon-modifier-animated" /> Loading search results...
	</div>
)

const HEADER_CLASSNAMES = "flex items-center gap-2.5 mb-3"
const InvisibleSpacer = () => <div aria-hidden className="h-px" />

interface ToolUseRowProps {
	tool: ClineSayTool
	message: ClineMessage
	isExpanded: boolean
	onToggleExpand: () => void
	backgroundEditEnabled: boolean
}

const colorMap: Record<string, string> = {
	red: "var(--vscode-errorForeground)",
	yellow: "var(--vscode-editorWarning-foreground)",
	green: "var(--vscode-charts-green)",
}

function ToolIcon({ name, color, rotation, title }: { name: string; color?: string; rotation?: number; title?: string }) {
	return (
		<span
			className={`codicon codicon-${name} ph-no-capture`}
			style={{
				color: color ? colorMap[color] || color : "var(--vscode-foreground)",
				marginBottom: "-1.5px",
				transform: rotation ? `rotate(${rotation}deg)` : undefined,
			}}
			title={title}
		/>
	)
}

function isImageFile(filePath: string): boolean {
	const imageExtensions = [".png", ".jpg", ".jpeg", ".webp"]
	const extension = filePath.toLowerCase().split(".").pop()
	return extension ? imageExtensions.includes("." + extension) : false
}

const ToolUseRow = memo(({ tool, message, isExpanded, onToggleExpand, backgroundEditEnabled }: ToolUseRowProps) => {
	switch (tool.tool) {
		case "editedExistingFile": {
			const content = tool?.content || ""
			const isApplyingPatch = content?.startsWith("%%bash") && !content.endsWith("*** End Patch\nEOF")
			const editToolTitle = isApplyingPatch
				? "Cline is creating patches to edit this file:"
				: "Cline wants to edit this file:"
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<PencilIcon className="size-2" />
						{tool.operationIsLocatedInWorkspace === false && (
							<ToolIcon
								color="yellow"
								name="sign-out"
								rotation={-90}
								title="This file is outside of your workspace"
							/>
						)}
						<span style={{ fontWeight: "bold" }}>{editToolTitle}</span>
					</div>
					{backgroundEditEnabled && tool.path && (tool.diff || tool.content) ? (
						<DiffEditRow
							isLoading={message.partial}
							patch={tool.diff || tool.content!}
							path={tool.path}
							startLineNumbers={tool.startLineNumbers}
						/>
					) : (
						<CodeAccordian
							code={tool.content}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
							path={tool.path!}
						/>
					)}
				</div>
			)
		}
		case "fileDeleted":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<SquareMinusIcon className="size-2" />
						{tool.operationIsLocatedInWorkspace === false && (
							<ToolIcon
								color="yellow"
								name="sign-out"
								rotation={-90}
								title="This file is outside of your workspace"
							/>
						)}
						<span style={{ fontWeight: "bold" }}>Cline wants to delete this file:</span>
					</div>
					<CodeAccordian
						code={tool.content}
						isExpanded={isExpanded}
						onToggleExpand={onToggleExpand}
						path={tool.path!}
					/>
				</div>
			)
		case "newFileCreated":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<FilePlus2Icon className="size-2" />
						{tool.operationIsLocatedInWorkspace === false && (
							<ToolIcon
								color="yellow"
								name="sign-out"
								rotation={-90}
								title="This file is outside of your workspace"
							/>
						)}
						<span className="font-bold">Cline wants to create a new file:</span>
					</div>
					{backgroundEditEnabled && tool.path && tool.content ? (
						<DiffEditRow patch={tool.content} path={tool.path} startLineNumbers={tool.startLineNumbers} />
					) : (
						<CodeAccordian
							code={tool.content!}
							isExpanded={isExpanded}
							isLoading={message.partial}
							onToggleExpand={onToggleExpand}
							path={tool.path!}
						/>
					)}
				</div>
			)
		case "readFile": {
			const isImage = isImageFile(tool.path || "")
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						{isImage ? <ImageUpIcon className="size-2" /> : <FileCode2Icon className="size-2" />}
						{tool.operationIsLocatedInWorkspace === false && (
							<ToolIcon
								color="yellow"
								name="sign-out"
								rotation={-90}
								title="This file is outside of your workspace"
							/>
						)}
						<span className="font-bold">Cline wants to read this file:</span>
					</div>
					<div className="bg-code rounded-sm overflow-hidden border border-editor-group-border">
						<div
							className={cn("text-description flex items-center cursor-pointer select-none py-2 px-2.5", {
								"cursor-default select-text": isImage,
							})}
							onClick={() => {
								if (!isImage) {
									FileServiceClient.openFile(StringRequest.create({ value: tool.content })).catch((err) =>
										console.error("Failed to open file:", err),
									)
								}
							}}>
							{tool.path?.startsWith(".") && <span>.</span>}
							{tool.path && !tool.path.startsWith(".") && <span>/</span>}
							<span className="ph-no-capture whitespace-nowrap overflow-hidden text-ellipsis mr-2 text-left [direction: rtl]">
								{cleanPathPrefix(tool.path ?? "") + "\u200E"}
								{tool.readLineStart != null ? (
									<span className="opacity-80">
										{" "}
										({tool.readLineStart}
										{tool.readLineEnd != null ? "-" + tool.readLineEnd : "+"})
									</span>
								) : null}
							</span>
							<div className="grow" />
							{!isImage && <SquareArrowOutUpRightIcon className="size-2" />}
						</div>
					</div>
				</div>
			)
		}
		case "listFilesTopLevel":
		case "listFilesRecursive": {
			const isRecursive = tool.tool === "listFilesRecursive"
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<ToolIcon name="folder-opened" />
						{tool.operationIsLocatedInWorkspace === false && (
							<ToolIcon color="yellow" name="sign-out" rotation={-90} title="This is outside of your workspace" />
						)}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask"
								? isRecursive
									? "Cline wants to recursively view all files in this directory:"
									: "Cline wants to view the top level files in this directory:"
								: isRecursive
									? "Cline recursively viewed all files in this directory:"
									: "Cline viewed the top level files in this directory:"}
						</span>
					</div>
					<CodeAccordian
						code={tool.content!}
						isExpanded={isExpanded}
						language="shell-session"
						onToggleExpand={onToggleExpand}
						path={tool.path!}
					/>
				</div>
			)
		}
		case "listCodeDefinitionNames":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<ToolIcon name="file-code" />
						{tool.operationIsLocatedInWorkspace === false && (
							<ToolIcon
								color="yellow"
								name="sign-out"
								rotation={-90}
								title="This file is outside of your workspace"
							/>
						)}
						<span style={{ fontWeight: "bold" }}>
							{message.type === "ask"
								? "Cline wants to view source code definition names used in this directory:"
								: "Cline viewed source code definition names used in this directory:"}
						</span>
					</div>
					<CodeAccordian
						code={tool.content!}
						isExpanded={isExpanded}
						language="shell-session"
						onToggleExpand={onToggleExpand}
						path={tool.path!}
					/>
				</div>
			)
		case "searchFiles":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<ToolIcon name="search" />
						{tool.operationIsLocatedInWorkspace === false && (
							<ToolIcon color="yellow" name="sign-out" rotation={-90} title="This is outside of your workspace" />
						)}
						<span className="font-bold">
							Cline wants to search this directory for <code className="break-all">{tool.regex}</code>:
						</span>
					</div>
					<Suspense fallback={<SearchResultsSkeleton />}>
						<SearchResultsDisplay
							content={tool.content!}
							filePattern={tool.filePattern}
							isExpanded={isExpanded}
							onToggleExpand={onToggleExpand}
							path={tool.path!}
						/>
					</Suspense>
				</div>
			)
		case "summarizeTask":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<FoldVerticalIcon className="size-2" />
						<span className="font-bold">Cline is condensing the conversation:</span>
					</div>
					<div className="bg-code overflow-hidden border border-editor-group-border rounded-[3px]">
						<div
							aria-label={isExpanded ? "Collapse summary" : "Expand summary"}
							className="text-description py-2 px-2.5 cursor-pointer select-none"
							onClick={onToggleExpand}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault()
									e.stopPropagation()
									onToggleExpand()
								}
							}}
							tabIndex={0}>
							{isExpanded ? (
								<div>
									<div className="flex items-center mb-2">
										<span className="font-bold mr-1">Summary:</span>
										<div className="grow" />
										<ChevronDownIcon className="my-0.5 shrink-0 size-4" />
									</div>
									<span className="ph-no-capture break-words whitespace-pre-wrap">{tool.content}</span>
								</div>
							) : (
								<div className="flex items-center">
									<span className="ph-no-capture whitespace-nowrap overflow-hidden text-ellipsis text-left flex-1 mr-2 [direction:rtl]">
										{tool.content + "\u200E"}
									</span>
									<ChevronRightIcon className="my-0.5 shrink-0 size-4" />
								</div>
							)}
						</div>
					</div>
				</div>
			)
		case "webFetch":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<Link2Icon className="size-2" />
						{tool.operationIsLocatedInWorkspace === false && (
							<ToolIcon color="yellow" name="sign-out" rotation={-90} title="This URL is external" />
						)}
						<span className="font-bold">
							{message.type === "ask"
								? "Cline wants to fetch content from this URL:"
								: "Cline fetched content from this URL:"}
						</span>
					</div>
					<div
						className="bg-code rounded-xs overflow-hidden border border-editor-group-border py-2 px-2.5 cursor-pointer select-none"
						onClick={() => {
							if (tool.path) {
								UiServiceClient.openUrl(StringRequest.create({ value: tool.path })).catch((err) => {
									console.error("Failed to open URL:", err)
								})
							}
						}}>
						<span className="ph-no-capture whitespace-nowrap overflow-hidden text-ellipsis mr-2 [direction:rtl] text-left text-link underline">
							{tool.path + "\u200E"}
						</span>
					</div>
				</div>
			)
		case "webSearch":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<SearchIcon className="size-2 rotate-90" />
						{tool.operationIsLocatedInWorkspace === false && (
							<ToolIcon color="yellow" name="sign-out" rotation={-90} title="This search is external" />
						)}
						<span className="font-bold">
							{message.type === "ask" ? "Cline wants to search the web for:" : "Cline searched the web for:"}
						</span>
					</div>
					<div className="bg-code border border-editor-group-border overflow-hidden rounded-xs select-text py-[9px] px-2.5">
						<span className="ph-no-capture whitespace-nowrap overflow-hidden text-ellipsis mr-2 text-left [direction:rtl]">
							{tool.path + "\u200E"}
						</span>
					</div>
				</div>
			)
		case "useSkill":
			return (
				<div>
					<div className={HEADER_CLASSNAMES}>
						<LightbulbIcon className="size-2" />
						<span className="font-bold">Cline loaded the skill:</span>
					</div>
					<div className="bg-code border border-editor-group-border overflow-hidden rounded-xs py-[9px] px-2.5">
						<span className="ph-no-capture font-medium">{tool.path}</span>
					</div>
				</div>
			)
		default:
			return <InvisibleSpacer />
	}
})

ToolUseRow.displayName = "ToolUseRow"

export default ToolUseRow
