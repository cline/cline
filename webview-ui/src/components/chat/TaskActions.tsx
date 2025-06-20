import { useState } from "react"
import prettyBytes from "pretty-bytes"
import { useTranslation } from "react-i18next"

import type { HistoryItem } from "@roo-code/types"

import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import {
	Button,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Command,
	CommandList,
	CommandItem,
	CommandGroup,
} from "@/components/ui"

import { DeleteTaskDialog } from "../history/DeleteTaskDialog"
import { IconButton } from "./IconButton"

interface TaskActionsProps {
	item?: HistoryItem
	buttonsDisabled: boolean
}

export const TaskActions = ({ item, buttonsDisabled }: TaskActionsProps) => {
	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const [shareDropdownOpen, setShareDropdownOpen] = useState(false)
	const { t } = useTranslation()
	const { sharingEnabled } = useExtensionState()

	const handleShare = (visibility: "organization" | "public") => {
		vscode.postMessage({
			type: "shareCurrentTask",
			visibility,
		})
		setShareDropdownOpen(false)
	}

	return (
		<div className="flex flex-row gap-1">
			{item?.id && sharingEnabled && (
				<Popover open={shareDropdownOpen} onOpenChange={setShareDropdownOpen}>
					<PopoverTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							disabled={buttonsDisabled}
							className="h-6 w-6 p-0 hover:bg-vscode-toolbar-hoverBackground"
							title={t("chat:task.share")}>
							<span className="codicon codicon-link text-xs"></span>
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-56 p-0" align="start">
						<Command>
							<CommandList>
								<CommandGroup>
									<CommandItem
										onSelect={() => handleShare("organization")}
										className="cursor-pointer">
										<div className="flex items-center gap-2">
											<span className="codicon codicon-organization text-sm"></span>
											<div className="flex flex-col">
												<span className="text-sm">{t("chat:task.shareWithOrganization")}</span>
												<span className="text-xs text-vscode-descriptionForeground">
													{t("chat:task.shareWithOrganizationDescription")}
												</span>
											</div>
										</div>
									</CommandItem>
									<CommandItem onSelect={() => handleShare("public")} className="cursor-pointer">
										<div className="flex items-center gap-2">
											<span className="codicon codicon-globe text-sm"></span>
											<div className="flex flex-col">
												<span className="text-sm">{t("chat:task.sharePublicly")}</span>
												<span className="text-xs text-vscode-descriptionForeground">
													{t("chat:task.sharePubliclyDescription")}
												</span>
											</div>
										</div>
									</CommandItem>
								</CommandGroup>
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
			)}
			<IconButton
				iconClass="codicon-desktop-download"
				title={t("chat:task.export")}
				disabled={buttonsDisabled}
				onClick={() => vscode.postMessage({ type: "exportCurrentTask" })}
			/>
			{!!item?.size && item.size > 0 && (
				<>
					<div className="flex items-center">
						<IconButton
							iconClass="codicon-trash"
							title={t("chat:task.delete")}
							disabled={buttonsDisabled}
							onClick={(e) => {
								e.stopPropagation()

								if (e.shiftKey) {
									vscode.postMessage({ type: "deleteTaskWithId", text: item.id })
								} else {
									setDeleteTaskId(item.id)
								}
							}}
						/>
						<span className="ml-1 text-xs text-vscode-foreground opacity-85">{prettyBytes(item.size)}</span>
					</div>
					{deleteTaskId && (
						<DeleteTaskDialog
							taskId={deleteTaskId}
							onOpenChange={(open) => !open && setDeleteTaskId(null)}
							open
						/>
					)}
				</>
			)}
		</div>
	)
}
