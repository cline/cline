import { VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { useTranslation } from "react-i18next"
import { useState, useEffect } from "react"
import clsx from "clsx"

const tips = [
	{
		icon: "codicon-account",
		href: "https://docs.roocode.com/basic-usage/using-modes",
		titleKey: "rooTips.customizableModes.title",
		descriptionKey: "rooTips.customizableModes.description",
	},
	{
		icon: "codicon-list-tree",
		href: "https://docs.roocode.com/features/boomerang-tasks",
		titleKey: "rooTips.boomerangTasks.title",
		descriptionKey: "rooTips.boomerangTasks.description",
	},
]

interface RooTipsProps {
	cycle?: boolean
}

const RooTips = ({ cycle = false }: RooTipsProps) => {
	const { t } = useTranslation("chat")
	const [currentTipIndex, setCurrentTipIndex] = useState(Math.floor(Math.random() * tips.length))
	const [isFading, setIsFading] = useState(false)

	useEffect(() => {
		if (!cycle) return

		const intervalId = setInterval(() => {
			setIsFading(true) // Start fade out
			setTimeout(() => {
				setCurrentTipIndex((prevIndex) => (prevIndex + 1) % tips.length)
				setIsFading(false) // Start fade in
			}, 1000) // Fade duration
		}, 11000) // 10s display + 1s fade

		return () => clearInterval(intervalId) // Cleanup on unmount
	}, [cycle])

	const currentTip = tips[currentTipIndex]
	const topTwoTips = tips.slice(0, 2)

	return (
		<div
			className={clsx(
				"flex flex-col items-center justify-center px-5 py-2.5 gap-4",
				cycle && "h-[5em] overflow-visible m-5",
			)}>
			{/* If we need real estate, we show a compressed version of the tips. Otherwise, we expand it. */}
			{cycle ? (
				<>
					<div className="opacity-70 pb-1"> Did you know about...</div>
					<div
						className={clsx(
							"flex items-center gap-2 text-vscode-editor-foreground font-vscode max-w-[250px] transition-opacity duration-1000 ease-in-out",
							isFading ? "opacity-0" : "opacity-70",
						)}>
						{" "}
						<span className={`codicon ${currentTip.icon}`}></span>
						<span>
							<VSCodeLink href={currentTip.href}>{t(currentTip.titleKey)}</VSCodeLink>:{" "}
							{t(currentTip.descriptionKey)}
						</span>
					</div>
				</>
			) : (
				topTwoTips.map((tip) => (
					<div
						key={tip.titleKey}
						className="flex items-center gap-2 text-vscode-editor-foreground font-vscode max-w-[250px]">
						<span className={`codicon ${tip.icon}`}></span>
						<span>
							<VSCodeLink className="forced-color-adjust-none" href={tip.href}>
								{t(tip.titleKey)}
							</VSCodeLink>
							: {t(tip.descriptionKey)}
						</span>
					</div>
				))
			)}
		</div>
	)
}

export default RooTips
