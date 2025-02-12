import { useState, useEffect, useCallback } from "react"
import { CheckIcon, Cross2Icon } from "@radix-ui/react-icons"

import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/ui"

import { vscode } from "../../../utils/vscode"
import { Checkpoint } from "./schema"

type CheckpointMenuProps = {
	ts: number
	commitHash: string
	currentHash?: string
	checkpoint: Checkpoint
}

export const CheckpointMenu = ({ ts, commitHash, currentHash, checkpoint }: CheckpointMenuProps) => {
	const [portalContainer, setPortalContainer] = useState<HTMLElement>()
	const [isOpen, setIsOpen] = useState(false)
	const [isConfirming, setIsConfirming] = useState(false)

	const isCurrent = currentHash === commitHash
	const isFirst = checkpoint.isFirst

	const isDiffAvailable = !isFirst
	const isRestoreAvailable = !isFirst || !isCurrent

	const onCheckpointDiff = useCallback(() => {
		vscode.postMessage({ type: "checkpointDiff", payload: { ts, commitHash, mode: "checkpoint" } })
	}, [ts, commitHash])

	const onPreview = useCallback(() => {
		vscode.postMessage({ type: "checkpointRestore", payload: { ts, commitHash, mode: "preview" } })
		setIsOpen(false)
	}, [ts, commitHash])

	const onRestore = useCallback(() => {
		vscode.postMessage({ type: "checkpointRestore", payload: { ts, commitHash, mode: "restore" } })
		setIsOpen(false)
	}, [ts, commitHash])

	useEffect(() => {
		// The dropdown menu uses a portal from @shadcn/ui which by default renders
		// at the document root. This causes the menu to remain visible even when
		// the parent ChatView component is hidden (during settings/history view).
		// By moving the portal inside ChatView, the menu will properly hide when
		// its parent is hidden.
		setPortalContainer(document.getElementById("chat-view-portal") || undefined)
	}, [])

	return (
		<div className="flex flex-row gap-1">
			{isDiffAvailable && (
				<Button variant="ghost" size="icon" onClick={onCheckpointDiff} title="View Diff">
					<span className="codicon codicon-diff-single" />
				</Button>
			)}
			{isRestoreAvailable && (
				<Popover
					open={isOpen}
					onOpenChange={(open) => {
						setIsOpen(open)
						setIsConfirming(false)
					}}>
					<PopoverTrigger asChild>
						<Button variant="ghost" size="icon" title="Restore Checkpoint">
							<span className="codicon codicon-history" />
						</Button>
					</PopoverTrigger>
					<PopoverContent align="end" container={portalContainer}>
						<div className="flex flex-col gap-2">
							{!isCurrent && (
								<div className="flex flex-col gap-1 group hover:text-foreground">
									<Button variant="secondary" onClick={onPreview}>
										Restore Files
									</Button>
									<div className="text-muted transition-colors group-hover:text-foreground">
										Restores your project's files back to a snapshot taken at this point.
									</div>
								</div>
							)}
							{!isFirst && (
								<div className="flex flex-col gap-1 group hover:text-foreground">
									<div className="flex flex-col gap-1 group hover:text-foreground">
										{!isConfirming ? (
											<Button variant="secondary" onClick={() => setIsConfirming(true)}>
												Restore Files & Task
											</Button>
										) : (
											<>
												<Button variant="default" onClick={onRestore} className="grow">
													<div className="flex flex-row gap-1">
														<CheckIcon />
														<div>Confirm</div>
													</div>
												</Button>
												<Button variant="secondary" onClick={() => setIsConfirming(false)}>
													<div className="flex flex-row gap-1">
														<Cross2Icon />
														<div>Cancel</div>
													</div>
												</Button>
											</>
										)}
										{isConfirming ? (
											<div className="text-destructive font-bold">
												This action cannot be undone.
											</div>
										) : (
											<div className="text-muted transition-colors group-hover:text-foreground">
												Restores your project's files back to a snapshot taken at this point and
												deletes all messages after this point.
											</div>
										)}
									</div>
								</div>
							)}
						</div>
					</PopoverContent>
				</Popover>
			)}
		</div>
	)
}
