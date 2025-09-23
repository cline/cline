import { useState, useCallback } from "react"
import { CheckIcon, Cross2Icon } from "@radix-ui/react-icons"
import { useTranslation } from "react-i18next"

import { Button, Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"
import { useRooPortal } from "@/components/ui/hooks"

import { vscode } from "@src/utils/vscode"
import { Checkpoint } from "./schema"

type CheckpointMenuBaseProps = {
	ts: number
	commitHash: string
	currentHash?: string
	checkpoint: Checkpoint
}
type CheckpointMenuControlledProps = {
	open: boolean
	onOpenChange: (open: boolean) => void
}
type CheckpointMenuUncontrolledProps = {
	open?: undefined
	onOpenChange?: undefined
}
type CheckpointMenuProps = CheckpointMenuBaseProps & (CheckpointMenuControlledProps | CheckpointMenuUncontrolledProps)

export const CheckpointMenu = ({
	ts,
	commitHash,
	currentHash,
	checkpoint,
	open,
	onOpenChange,
}: CheckpointMenuProps) => {
	const { t } = useTranslation()
	const [internalOpen, setInternalOpen] = useState(false)
	const [isConfirming, setIsConfirming] = useState(false)
	const portalContainer = useRooPortal("roo-portal")

	const isCurrent = currentHash === commitHash

	const previousCommitHash = checkpoint?.from

	const isOpen = open ?? internalOpen
	const setOpen = onOpenChange ?? setInternalOpen

	const onCheckpointDiff = useCallback(() => {
		vscode.postMessage({
			type: "checkpointDiff",
			payload: { ts, previousCommitHash, commitHash, mode: "checkpoint" },
		})
	}, [ts, previousCommitHash, commitHash])

	const onPreview = useCallback(() => {
		vscode.postMessage({ type: "checkpointRestore", payload: { ts, commitHash, mode: "preview" } })
		setOpen(false)
	}, [ts, commitHash, setOpen])

	const onRestore = useCallback(() => {
		vscode.postMessage({ type: "checkpointRestore", payload: { ts, commitHash, mode: "restore" } })
		setOpen(false)
	}, [ts, commitHash, setOpen])

	const handleOpenChange = useCallback(
		(open: boolean) => {
			setOpen(open)
			if (!open) {
				setIsConfirming(false)
			}
		},
		[setOpen],
	)

	return (
		<div className="flex flex-row gap-1">
			<StandardTooltip content={t("chat:checkpoint.menu.viewDiff")}>
				<Button variant="ghost" size="icon" onClick={onCheckpointDiff}>
					<span className="codicon codicon-diff-single" />
				</Button>
			</StandardTooltip>
			<Popover open={isOpen} onOpenChange={handleOpenChange}>
				<StandardTooltip content={t("chat:checkpoint.menu.restore")}>
					<PopoverTrigger asChild>
						<Button variant="ghost" size="icon" aria-label={t("chat:checkpoint.menu.restore")}>
							<span className="codicon codicon-history" />
						</Button>
					</PopoverTrigger>
				</StandardTooltip>
				<PopoverContent align="end" container={portalContainer}>
					<div className="flex flex-col gap-2">
						{!isCurrent && (
							<div className="flex flex-col gap-1 group hover:text-foreground">
								<Button variant="secondary" onClick={onPreview} data-testid="restore-files-btn">
									{t("chat:checkpoint.menu.restoreFiles")}
								</Button>
								<div className="text-muted transition-colors group-hover:text-foreground">
									{t("chat:checkpoint.menu.restoreFilesDescription")}
								</div>
							</div>
						)}
						{!isCurrent && (
							<div className="flex flex-col gap-1 group hover:text-foreground">
								<div className="flex flex-col gap-1 group hover:text-foreground">
									{!isConfirming ? (
										<Button
											variant="secondary"
											onClick={() => setIsConfirming(true)}
											data-testid="restore-files-and-task-btn">
											{t("chat:checkpoint.menu.restoreFilesAndTask")}
										</Button>
									) : (
										<>
											<Button
												variant="default"
												onClick={onRestore}
												className="grow"
												data-testid="confirm-restore-btn">
												<div className="flex flex-row gap-1">
													<CheckIcon />
													<div>{t("chat:checkpoint.menu.confirm")}</div>
												</div>
											</Button>
											<Button variant="secondary" onClick={() => setIsConfirming(false)}>
												<div className="flex flex-row gap-1">
													<Cross2Icon />
													<div>{t("chat:checkpoint.menu.cancel")}</div>
												</div>
											</Button>
										</>
									)}
									{isConfirming ? (
										<div
											data-testid="checkpoint-confirm-warning"
											className="text-destructive font-bold">
											{t("chat:checkpoint.menu.cannotUndo")}
										</div>
									) : (
										<div className="text-muted transition-colors group-hover:text-foreground">
											{t("chat:checkpoint.menu.restoreFilesAndTaskDescription")}
										</div>
									)}
								</div>
							</div>
						)}
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)
}
