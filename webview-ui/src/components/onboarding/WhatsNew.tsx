import { Int64Request } from "@shared/proto/index.cline"
import { ArrowLeftIcon, ArrowRightIcon, CopyIcon, RssIcon } from "lucide-react"
import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { StateServiceClient } from "@/services/grpc-client"
import { RELEASE_NEWS } from "./news"

type WhatsNewProps = {
	version?: string
	hideAnnouncement: () => void
}

export const CURRENT_MODEL_BANNER_VERSION = 3

export const WhatsNew = (_props: WhatsNewProps) => {
	const [currentIndex, setCurrentIndex] = useState(0)
	const news = RELEASE_NEWS[currentIndex]

	const handleNext = useCallback(() => {
		setCurrentIndex((prev) => (prev + 1) % RELEASE_NEWS.length)
		StateServiceClient.updateModelBannerVersion(Int64Request.create({ value: CURRENT_MODEL_BANNER_VERSION })).catch(
			console.error,
		)
	}, [])

	const handlePrev = useCallback(() => {
		setCurrentIndex((prev) => (prev - 1 + RELEASE_NEWS.length) % RELEASE_NEWS.length)
	}, [])

	const NewsIcon = news.icon

	return (
		<div className="flex flex-col w-full h-full p-5">
			<div className="flex justify-between align-center">
				<div className="text-description flex items-center font-medium mb-3 text-xs [&_svg]:size-2 gap-1">
					<RssIcon />
					<span className="font-medium uppercase">What's New</span>
				</div>
				<Button
					className="font-medium uppercase text-xs text-description hover:text-foreground"
					size="text"
					variant="icon">
					View All
				</Button>
			</div>

			<Card className="pt-4">
				<CardHeader className="flex gap-4 flex-col">
					<CardTitle className="[&_svg]:size-2 flex items-center gap-2">
						{NewsIcon && <NewsIcon />} {news.title}
					</CardTitle>
					<CardDescription>
						{news.description}
						{news.action?.link && (
							<Button size="text" variant="link">
								{news.action.text}
							</Button>
						)}
					</CardDescription>
				</CardHeader>

				<CardContent className="w-full">
					{news.command && (
						<div className="mb-3 p-2 rounded flex items-center justify-between bg-code font-mono text-sm">
							{news.command}
							<Button size="icon" variant="icon">
								<CopyIcon />
							</Button>
						</div>
					)}
					{news.buttons && news.buttons.length > 0 && (
						<div className="gap-3 flex">
							{news.buttons.map((button) => {
								const ButtonIcon = button.icon
								return (
									<Button
										className="w-full [&_svg]:size-2"
										disabled={button.disabled}
										key={button.text}
										variant={button.variant === "secondary" ? "secondary" : "default"}>
										{ButtonIcon && <ButtonIcon />} {button.text}
									</Button>
								)
							})}
						</div>
					)}
				</CardContent>

				<CardFooter className="flex justify-between align-center">
					<div className="text-xs">
						<span>{currentIndex + 1}</span>
						<span className="text-muted-foreground">/{RELEASE_NEWS.length}</span>
					</div>
					<div>
						<Button
							aria-label="Previous"
							className="text-muted-foreground"
							disabled={currentIndex === 0}
							onClick={handlePrev}
							size="icon"
							variant="icon">
							<ArrowLeftIcon />
						</Button>
						<Button
							aria-label="Next"
							className="text-muted-foreground"
							disabled={RELEASE_NEWS.length === currentIndex + 1}
							onClick={handleNext}
							size="icon"
							variant="icon">
							<ArrowRightIcon />
						</Button>
					</div>
				</CardFooter>
			</Card>
		</div>
	)
}
