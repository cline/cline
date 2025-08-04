import useEmblaCarousel from "embla-carousel-react"
import AutoScroll from "embla-carousel-auto-scroll"
import { testimonials } from "@/components/homepage/testimonials"

export function TestimonialsMobile() {
	const [emblaRef] = useEmblaCarousel({ loop: true }, [
		AutoScroll({
			playOnInit: true,
			speed: 1, // pixels per second - slower for smoother scrolling
			stopOnInteraction: true,
			stopOnMouseEnter: true,
		}),
	])

	return (
		<div className="md:hidden">
			<div className="overflow-hidden px-4" ref={emblaRef}>
				<div className="flex">
					{testimonials.map((testimonial) => (
						<div className="min-w-0 flex-[0_0_100%] px-4" key={testimonial.id}>
							<div className="relative rounded-2xl border border-border/50 bg-background/30 p-8 backdrop-blur-xl dark:border-border/70 dark:bg-background/40">
								<svg
									className="absolute left-8 top-8 h-8 w-8 text-blue-500/30 dark:text-blue-400/50"
									fill="currentColor"
									viewBox="0 0 32 32">
									<defs>
										<filter id="glow-mobile">
											<feGaussianBlur stdDeviation="3" result="coloredBlur" />
											<feMerge>
												<feMergeNode in="coloredBlur" />
												<feMergeNode in="SourceGraphic" />
											</feMerge>
										</filter>
									</defs>
									<path
										d="M9.352 4C4.456 7.456 1 13.12 1 19.36c0 5.088 3.072 8.064 6.624 8.064 3.36 0 5.856-2.688 5.856-5.856 0-3.168-2.208-5.472-5.088-5.472-.576 0-1.344.096-1.536.192.48-3.264 3.552-7.104 6.624-9.024L9.352 4zm16.512 0c-4.8 3.456-8.256 9.12-8.256 15.36 0 5.088 3.072 8.064 6.624 8.064 3.264 0 5.856-2.688 5.856-5.856 0-3.168-2.304-5.472-5.184-5.472-.576 0-1.248.096-1.44.192.48-3.264 3.456-7.104 6.528-9.024L25.864 4z"
										className="dark:filter dark:drop-shadow-[0_0_8px_rgba(96,165,250,0.4)]"
									/>
								</svg>

								<blockquote className="mt-12">
									<p className="text-lg font-light italic leading-relaxed text-muted-foreground dark:text-foreground/70">
										&quot;{testimonial.quote}&quot;
									</p>

									<footer className="mt-6">
										<div className="h-px w-12 bg-gradient-to-r from-blue-500/50 to-transparent dark:from-blue-400/70" />
										<p className="mt-4 font-medium text-foreground/90 dark:text-foreground">
											{testimonial.name}
										</p>
										<p className="text-sm text-muted-foreground dark:text-muted-foreground/80">
											{testimonial.role} at {testimonial.company}
										</p>
									</footer>
								</blockquote>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	)
}
