"use client"

import { ChevronsUpDown } from "lucide-react"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface ModelDropdownProps {
	modelIds: string[]
	provider: string
	selectedModelId?: string
	onSelect: (modelId: string) => void
}

export const ModelDropdown: React.FC<ModelDropdownProps> = ({ modelIds, onSelect, selectedModelId }) => {
	const [open, setOpen] = React.useState(false)

	return (
		<Popover modal={true} onOpenChange={setOpen} open={open}>
			<PopoverTrigger>
				<Button
					aria-expanded={open}
					className="w-full justify-between bg-input-background rounded-sm px-2"
					role="combobox"
					variant="outline">
					{selectedModelId || "Select model..."}
					<ChevronsUpDown className="opacity-50 text-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[var(--radix-popover-trigger-width)] bg-input-background z-[3000]" showArrow={false}>
				<Command className="w-full max-h-80" value={selectedModelId}>
					<CommandInput className="h-8" placeholder="Search model..." />
					<CommandList>
						<CommandEmpty>No model found.</CommandEmpty>
						<CommandGroup className="max-h-">
							{modelIds.map((model) => (
								<CommandItem
									className="w-ful"
									key={model}
									onSelect={(value) => {
										onSelect(value)
										setOpen(false)
									}}
									value={model}>
									{model}
								</CommandItem>
							))}
						</CommandGroup>
					</CommandList>
				</Command>
			</PopoverContent>
		</Popover>
	)
}
