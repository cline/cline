"use client"

import { useEffect, useState, useCallback } from "react"
import useEmblaCarousel from "embla-carousel-react"
import Autoplay from "embla-carousel-autoplay"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { features } from "@/components/homepage/features"

export function FeaturesMobile() {
	// configure autoplay with Embla
	const autoplayPlugin = Autoplay({
		delay: 5000,
		stopOnInteraction: true,
		stopOnMouseEnter: true,
		rootNode: (emblaRoot) => emblaRoot,
	})

	const [emblaRef, emblaApi] = useEmblaCarousel(
		{
			loop: true,
			containScroll: "trimSnaps",
		},
		[autoplayPlugin],
	)

	const [selectedIndex, setSelectedIndex] = useState(0)
	const [scrollSnaps, setScrollSnaps] = useState<number[]>([])

	const scrollTo = useCallback((index: number) => emblaApi && emblaApi.scrollTo(index), [emblaApi])

	/* eslint-disable  @typescript-eslint/no-explicit-any */
	const onInit = useCallback((emblaApi: any) => {
		setScrollSnaps(emblaApi.scrollSnapList())
	}, [])

	/* eslint-disable  @typescript-eslint/no-explicit-any */
	const onSelect = useCallback((emblaApi: any) => {
		setSelectedIndex(emblaApi.selectedScrollSnap())
	}, [])

	useEffect(() => {
		if (!emblaApi) return

		onInit(emblaApi)
		onSelect(emblaApi)
		emblaApi.on("reInit", onInit)
		emblaApi.on("select", onSelect)

		return () => {
			emblaApi.off("reInit", onInit)
			emblaApi.off("select", onSelect)
		}
	}, [emblaApi, onInit, onSelect])

	return (
		<div className="md:hidden">
			<div className="relative px-4">
				<div className="overflow-hidden" ref={emblaRef}>
					<div className="flex">
						{features.map((feature, index) => (
							<div className="flex min-w-0 flex-[0_0_100%] px-4" key={index}>
								<div className="relative h-full min-h-[280px] rounded-2xl border border-border/50 bg-background/30 p-6 backdrop-blur-xl transition-colors duration-300 hover:border-border hover:bg-gray-900/20">
									<div className="mb-2 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/5 to-cyan-500/5 p-2.5">
										<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
											<div className="text-foreground/90">{feature.icon}</div>
										</div>
									</div>
									<h3 className="mb-3 text-xl font-medium text-foreground/90">{feature.title}</h3>
									<p className="leading-relaxed text-muted-foreground">{feature.description}</p>
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Navigation Controls */}
				<div className="mt-6 flex items-center justify-between px-4">
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="icon"
							className="h-8 w-8 rounded-full border-border/50 bg-background/80 hover:bg-background"
							onClick={() => emblaApi?.scrollPrev()}>
							<ChevronLeft className="h-4 w-4 text-foreground/80" />
							<span className="sr-only">Previous slide</span>
						</Button>
						<Button
							variant="outline"
							size="icon"
							className="h-8 w-8 rounded-full border-border/50 bg-background/80 hover:bg-background"
							onClick={() => emblaApi?.scrollNext()}>
							<ChevronRight className="h-4 w-4 text-foreground/80" />
							<span className="sr-only">Next slide</span>
						</Button>
					</div>

					<div className="flex gap-2">
						{scrollSnaps.map((_, index) => (
							<button
								key={index}
								type="button"
								className={`h-3 w-3 rounded-full border border-border p-0 ${index === selectedIndex ? "bg-foreground" : "bg-background"}`}
								onClick={() => scrollTo(index)}
								aria-label={`Go to slide ${index + 1}`}
							/>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}
