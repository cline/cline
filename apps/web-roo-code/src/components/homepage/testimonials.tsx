"use client"

import { useRef, useCallback, useEffect } from "react"
import { motion } from "framer-motion"
import useEmblaCarousel from "embla-carousel-react"
import AutoPlay from "embla-carousel-autoplay"
import { ChevronLeft, ChevronRight, Star } from "lucide-react"

export interface Testimonial {
	name: string
	role: string
	origin: string
	quote: string
	image?: string
	stars?: number
}

export const testimonials: Testimonial[] = [
	{
		name: "Luca",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "Roo Code is an absolute game-changer! 🚀 It makes coding faster, easier, and more intuitive with its smart AI-powered suggestions, real-time debugging, and automation features. The seamless integration with VS Code is a huge plus, and the constant updates ensure it keeps getting better",
		stars: 5,
	},
	{
		name: "Taro Woollett-Chiba",
		role: "AI Product Lead",
		origin: "Vendidit",
		quote: "Easily the best AI code editor. Roo Code has the best features and capabilities, along with the best development team. I swear, they're the fastest to support new models and implement useful functionality whenever users mention it... simply amazing.",
	},
	{
		name: "Can Nuri",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "Roo Code is one of the most inspiring projects I have seen for a long time. It shapes the way I think and deal with software development.",
		stars: 5,
	},
	{
		name: "Michael",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "I switched from Windsurf to Roo Code in January and honestly, it's been a huge upgrade. Windsurf kept making mistakes and being dumb when I ask it for things. Roo just gets it. Projects that used to take a full day now wrap up before lunch. ",
		stars: 5,
	},
	{
		name: "Darien Hardin",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "By far the best coding tool I have used. Looking forward to where this goes in the future. Also, their Discord is an excellent resource with many knowledgeable users sharing their discoveries.",
		stars: 5,
	},
	{
		name: "Wiliam Azzam",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "I've tried Cursor, Windsurf, Cline, Trae and others, and although using RooCode with OpenRouter is more expensive, it is also far more effective. Its agents and initial setup, and learning how to use Code/Architect/Orchestrator, help a great deal in developing quality projects.",
		stars: 5,
	},
	{
		name: "Matěj Zapletal",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "Definitely the best AI coding agent extension.",
		stars: 5,
	},
	{
		name: "Ali Davachi",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "We tried the rest, now we are using the best.  The alternatives are more restrictive.  I didn't use competitors for a reason.  This team is killing it.",
		stars: 5,
	},
	{
		name: "Ryan Booth",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "I work inside Roo about 60+ hours a week and usually roo is building something at all hours of the day. An amazing tool by an amazing team!",
		stars: 5,
	},
	{
		name: "Matthew Martin",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "i spent a fortune trying to dial in various tools to get them to work the way i want, and then i found roocode.  customizable for your flavors on your terms.  this is what i always wanted.",
		stars: 5,
	},
	{
		name: "Edwin Jacques",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "The BEST. Super fast, no-nonsense, UI that makes sense, many API provider choices, responsive, helpful developer community.",
		stars: 5,
	},
	{
		name: "Sean McCann",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "Roo Code is impressively capable while staying refreshingly simple. It integrates seamlessly into VS Code and handles everything from generating code to refactoring with accuracy and speed. It feels like a natural part of the workflow—no clutter, just results. Extra points for the flexibility of the different agents and the ability to customize them to fit the job.",
		stars: 5,
	},
	{
		name: "Colin Tate",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "Absolutely amazing extension. I had tried Cursor previously, and this just beats it hands down. I've used it for several large projects now, and it is now my go-to for creating things that would normally take weeks or months. Highly recommended.",
		stars: 5,
	},
	{
		name: "Michael Scott",
		role: "Reviewer",
		origin: "VS Code Marketplace",
		quote: "I've used all the IDEs and all the assistants - Roo Code is hands down the best of them. It's also one of the few that lets you bring your own API keys - no subscriptions required, just pay as you need/go! Fantastic team and support as well!",
		stars: 5,
	},
]

export function Testimonials() {
	const containerRef = useRef<HTMLDivElement>(null)
	const [emblaRef, emblaApi] = useEmblaCarousel(
		{
			loop: true,
			align: "center",
			skipSnaps: false,
			containScroll: false,
		},
		[
			AutoPlay({
				playOnInit: true,
				delay: 3_500,
				stopOnInteraction: false,
				stopOnMouseEnter: true,
				stopOnFocusIn: true,
			}),
		],
	)

	const scrollPrev = useCallback(() => {
		if (emblaApi) emblaApi.scrollPrev()
	}, [emblaApi])

	const scrollNext = useCallback(() => {
		if (emblaApi) emblaApi.scrollNext()
	}, [emblaApi])

	// Re-init auto-play on user interaction
	useEffect(() => {
		if (!emblaApi) return

		const autoPlay = emblaApi?.plugins()?.autoPlay as
			| {
					isPlaying?: () => boolean
					play?: () => void
			  }
			| undefined
		if (!autoPlay) return

		const handleInteraction = () => {
			const isPlaying = autoPlay.isPlaying && autoPlay.isPlaying()
			if (!isPlaying) {
				setTimeout(() => {
					if (autoPlay.play) {
						autoPlay.play()
					}
				}, 2000)
			}
		}

		emblaApi.on("pointerUp", handleInteraction)

		return () => {
			emblaApi.off("pointerUp", handleInteraction)
		}
	}, [emblaApi])

	const containerVariants = {
		hidden: { opacity: 0 },
		visible: {
			opacity: 1,
			transition: {
				duration: 0.6,
				ease: [0.21, 0.45, 0.27, 0.9],
			},
		},
	}

	return (
		<section ref={containerRef} className="relative overflow-hidden border-t border-border py-32">
			<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2">
				<div className="absolute left-1/2 top-1/2 h-[400px] w-full -translate-x-1/2 -translate-y-1/2 rounded-[100%] bg-violet-500/10 dark:bg-violet-700/30 blur-[120px]" />
			</div>

			<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto mb-8 md:max-w-2xl text-center">
					<h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
						Developers <em>really</em> shipping with AI are using Roo Code
					</h2>
					<p className="mt-6 text-lg text-muted-foreground">
						Join more than 1M people revolutionizing their workflow worldwide
					</p>
				</div>

				<motion.div
					className="relative -mx-4 md:mx-auto max-w-[1400px]"
					variants={containerVariants}
					initial="hidden"
					whileInView="visible"
					viewport={{ once: true }}>
					{/* Previous Button */}
					<button
						onClick={scrollPrev}
						className="absolute left-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-border/50 bg-background/80 p-2 backdrop-blur-xl transition-all duration-300 hover:scale-110 hover:shadow-lg md:left-4 md:p-3 lg:left-8"
						aria-label="Previous testimonial">
						<ChevronLeft className="h-5 w-5 text-muted-foreground transition-colors hover:text-foreground md:h-6 md:w-6" />
					</button>

					{/* Next Button */}
					<button
						onClick={scrollNext}
						className="absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-border/50 bg-background/80 p-2 backdrop-blur-xl transition-all duration-300 hover:scale-110 hover:shadow-lg md:right-4 md:p-3 lg:right-8"
						aria-label="Next testimonial">
						<ChevronRight className="h-5 w-5 text-muted-foreground transition-colors hover:text-foreground md:h-6 md:w-6" />
					</button>

					{/* Gradient Overlays */}
					<div className="hidden md:block absolute inset-y-0 left-0 z-10 w-[10%] bg-gradient-to-r from-background to-transparent pointer-events-none md:w-[15%]" />
					<div className="hidden md:block absolute inset-y-0 right-0 z-10 w-[10%] bg-gradient-to-l from-background to-transparent pointer-events-none md:w-[15%]" />

					{/* Embla Carousel Container */}
					<div className="overflow-hidden" ref={emblaRef}>
						<div className="flex">
							{testimonials.map((testimonial) => (
								<div
									key={testimonial.name}
									className="relative min-w-0 flex-[0_0_85%] px-2 md:flex-[0_0_70%] md:px-4 lg:flex-[0_0_30%]">
									<div className="group relative py-10 h-full">
										<div className="relative flex h-full flex-col rounded-2xl border border-border bg-background transition-all duration-500 ease-out group-hover:scale-[1.02] group-hover:border-border group-hover:bg-background/40 group-hover:shadow-xl dark:border-border/70 dark:bg-background/40 dark:group-hover:border-border dark:group-hover:bg-background/60 dark:group-hover:shadow-[0_20px_50px_rgba(59,130,246,0.15)]">
											<div className="flex flex-1 flex-col p-4 md:p-6">
												<div className="flex-1">
													<p className="relative text-sm leading-relaxed text-muted-foreground transition-colors duration-300 group-hover:text-foreground/80 dark:text-foreground/70 dark:group-hover:text-foreground/90">
														{testimonial.quote}
													</p>
												</div>

												<div className="relative mt-4 md:mt-6">
													<h3 className="font-medium text-foreground/90 transition-colors duration-300 dark:text-foreground">
														{testimonial.name}
													</h3>
													<p className="text-sm text-muted-foreground transition-colors duration-300 dark:text-muted-foreground/80">
														{testimonial.role} at {testimonial.origin}
														{testimonial.stars && (
															<span className="flex items-center mt-1">
																{" "}
																{Array.from({ length: testimonial.stars }, (_, i) => (
																	<Star key={i} className="size-4 fill-violet-500" />
																))}
															</span>
														)}
													</p>
												</div>
											</div>
										</div>
									</div>
								</div>
							))}
						</div>
					</div>
				</motion.div>
			</div>
		</section>
	)
}
