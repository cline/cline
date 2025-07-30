import React, { useEffect, useState } from "react"
import { Zap } from "lucide-react"
import { Trans } from "react-i18next"

import { useAppTranslation } from "@/i18n/TranslationContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Button, Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"
import { useRooPortal } from "@/components/ui/hooks/useRooPortal"
import { cn } from "@/lib/utils"
import { vscode } from "@/utils/vscode"
import { buildDocLink } from "@/utils/docLinks"

import { SlashCommandsList } from "./SlashCommandsList"

interface SlashCommandsPopoverProps {
	className?: string
}

export const SlashCommandsPopover: React.FC<SlashCommandsPopoverProps> = ({ className }) => {
	const { t } = useAppTranslation()
	const { commands } = useExtensionState()
	const [isOpen, setIsOpen] = useState(false)
	const portalContainer = useRooPortal("roo-portal")

	// Request commands when popover opens
	useEffect(() => {
		if (isOpen && (!commands || commands.length === 0)) {
			handleRefresh()
		}
	}, [isOpen, commands])

	const handleRefresh = () => {
		vscode.postMessage({ type: "requestCommands" })
	}

	const handleOpenChange = (open: boolean) => {
		setIsOpen(open)
		if (open) {
			// Always refresh when opening to get latest commands
			handleRefresh()
		}
	}

	const trigger = (
		<PopoverTrigger asChild>
			<Button
				variant="ghost"
				size="sm"
				className={cn(
					"h-7 w-7 p-0",
					"text-vscode-foreground opacity-85",
					"hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)]",
					"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
					className,
				)}>
				<Zap className="w-4 h-4" />
			</Button>
		</PopoverTrigger>
	)

	return (
		<Popover open={isOpen} onOpenChange={handleOpenChange}>
			<StandardTooltip content={t("chat:slashCommands.tooltip")}>{trigger}</StandardTooltip>

			<PopoverContent
				align="start"
				sideOffset={4}
				container={portalContainer}
				className="p-0 overflow-hidden min-w-80 max-w-9/10">
				<div className="flex flex-col w-full">
					{/* Header section */}
					<div className="p-3 border-b border-vscode-dropdown-border">
						<p className="m-0 text-xs text-vscode-descriptionForeground">
							<Trans
								i18nKey="chat:slashCommands.description"
								components={{
									DocsLink: (
										<a
											href={buildDocLink("features/slash-commands", "slash_commands")}
											target="_blank"
											rel="noopener noreferrer">
											Docs
										</a>
									),
								}}
							/>
						</p>
					</div>

					{/* Commands list */}
					<SlashCommandsList commands={commands || []} onRefresh={handleRefresh} />
				</div>
			</PopoverContent>
		</Popover>
	)
}
