import { useMemo, useRef, useState, useEffect } from "react"
import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"

import { CheckpointMenu } from "./CheckpointMenu"
import { checkpointSchema } from "./schema"
import { GitCommitVertical } from "lucide-react"

type CheckpointSavedProps = {
	ts: number
	commitHash: string
	currentHash?: string
	checkpoint?: Record<string, unknown>
}

export const CheckpointSaved = ({ checkpoint, ...props }: CheckpointSavedProps) => {
	const { t } = useTranslation()
	const isCurrent = props.currentHash === props.commitHash
	const [isPopoverOpen, setIsPopoverOpen] = useState(false)
	const [isClosing, setIsClosing] = useState(false)
	const closeTimer = useRef<number | null>(null)

	useEffect(() => {
		return () => {
			if (closeTimer.current) {
				window.clearTimeout(closeTimer.current)
				closeTimer.current = null
			}
		}
	}, [])

	const handlePopoverOpenChange = (open: boolean) => {
		setIsPopoverOpen(open)
		if (open) {
			setIsClosing(false)
			if (closeTimer.current) {
				window.clearTimeout(closeTimer.current)
				closeTimer.current = null
			}
		} else {
			setIsClosing(true)
			closeTimer.current = window.setTimeout(() => {
				setIsClosing(false)
				closeTimer.current = null
			}, 200) // keep menu visible briefly to avoid popover jump
		}
	}

	const menuVisible = isPopoverOpen || isClosing

	const metadata = useMemo(() => {
		if (!checkpoint) {
			return undefined
		}

		const result = checkpointSchema.safeParse(checkpoint)

		if (!result.success) {
			return undefined
		}

		return result.data
	}, [checkpoint])

	if (!metadata) {
		return null
	}

	return (
		<div className="group flex items-center justify-between gap-2 pt-2 pb-3 ">
			<div className="flex items-center gap-2 text-blue-400 whitespace-nowrap">
				<GitCommitVertical className="w-4" />
				<span className="font-semibold">{t("chat:checkpoint.regular")}</span>
				{isCurrent && <span className="text-muted">({t("chat:checkpoint.current")})</span>}
			</div>
			<span
				className="block w-full h-[2px] mt-[2px] text-xs"
				style={{
					backgroundImage:
						"linear-gradient(90deg, rgba(0, 188, 255, .65), rgba(0, 188, 255, .65) 80%, rgba(0, 188, 255, 0) 99%)",
				}}></span>

			{/* Keep menu visible while popover is open or briefly after close to prevent jump */}
			<div
				data-testid="checkpoint-menu-container"
				className={cn("h-4 -mt-2", menuVisible ? "block" : "hidden group-hover:block")}>
				<CheckpointMenu
					{...props}
					checkpoint={metadata}
					open={isPopoverOpen}
					onOpenChange={handlePopoverOpenChange}
				/>
			</div>
		</div>
	)
}
