import { useState, useCallback } from "react"
import { CheckIcon, Cross2Icon } from "@radix-ui/react-icons"
import { useTranslation } from "react-i18next"

import { Button, Popover, PopoverContent, PopoverTrigger, StandardTooltip } from "@/components/ui"
import { useRooPortal } from "@/components/ui/hooks"

import { vscode } from "@src/utils/vscode"
import { Checkpoint } from "./schema"

type CheckpointMenuProps = {
	ts: number
	commitHash: string
	currentHash?: string
	checkpoint: Checkpoint
}

export const CheckpointMenu = ({ ts, commitHash, currentHash, checkpoint }: CheckpointMenuProps) => {
	const { t } = useTranslation()
	const [isOpen, setIsOpen] = useState(false)
	const [isConfirming, setIsConfirming] = useState(false)
	const portalContainer = useRooPortal("roo-portal")

	const isCurrent = currentHash === commitHash
	const isFirst = checkpoint.isFirst
	const isDiffAvailable = !isFirst
	const isRestoreAvailable = !isFirst || !isCurrent

	const previousCommitHash = checkpoint?.from

	const onCheckpointDiff = useCallback(() => {
		vscode.postMessage({
			type: "checkpointDiff",
			payload: { ts, previousCommitHash, commitHash, mode: "checkpoint" },
		})
	}, [ts, previousCommitHash, commitHash])

	const onPreview = useCallback(() => {
		vscode.postMessage({ type: "checkpointRestore", payload: { ts, commitHash, mode: "preview" } })
		setIsOpen(false)
	}, [ts, commitHash])

	const onRestore = useCallback(() => {
		vscode.postMessage({ type: "checkpointRestore", payload: { ts, commitHash, mode: "restore" } })
		setIsOpen(false)
	}, [ts, commitHash])

	return (
		<div className="flex flex-row gap-1">
			{isDiffAvailable && (
				<StandardTooltip content={t("chat:checkpoint.menu.viewDiff")}>
					<Button variant="ghost" size="icon" onClick={onCheckpointDiff}>
						<span className="codicon codicon-diff-single" />
					</Button>
				</StandardTooltip>
			)}
			{isRestoreAvailable && (
				<Popover
					open={isOpen}
					onOpenChange={(open) => {
						setIsOpen(open)
						setIsConfirming(false)
					}}>
					<PopoverTrigger asChild>
						<StandardTooltip content={t("chat:checkpoint.menu.restore")}>
							<Button variant="ghost" size="icon">
								<span className="codicon codicon-history" />
							</Button>
						</StandardTooltip>
					</PopoverTrigger>
					<PopoverContent align="end" container={portalContainer}>
						<div className="flex flex-col gap-2">
							{!isCurrent && (
								<div className="flex flex-col gap-1 group hover:text-foreground">
									<Button variant="secondary" onClick={onPreview}>
										{t("chat:checkpoint.menu.restoreFiles")}
									</Button>
									<div className="text-muted transition-colors group-hover:text-foreground">
										{t("chat:checkpoint.menu.restoreFilesDescription")}
									</div>
								</div>
							)}
							{!isFirst && (
								<div className="flex flex-col gap-1 group hover:text-foreground">
									<div className="flex flex-col gap-1 group hover:text-foreground">
										{!isConfirming ? (
											<Button variant="secondary" onClick={() => setIsConfirming(true)}>
												{t("chat:checkpoint.menu.restoreFilesAndTask")}
											</Button>
										) : (
											<>
												<Button variant="default" onClick={onRestore} className="grow">
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
											<div className="text-destructive font-bold">
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
			)}
		</div>
	)
}
