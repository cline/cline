"use client"

import { useRef } from "react"
import { motion } from "framer-motion"
import Image from "next/image"
import { TestimonialsMobile } from "./testimonials-mobile"

export interface Testimonial {
	id: number
	name: string
	role: string
	company: string
	image?: string
	quote: string
}

export const testimonials: Testimonial[] = [
	{
		id: 1,
		name: "Luca",
		role: "Reviewer",
		company: "VS Code Marketplace",
		quote: "Roo Code is an absolute game-changer! 🚀 It makes coding faster, easier, and more intuitive with its smart AI-powered suggestions, real-time debugging, and automation features. The seamless integration with VS Code is a huge plus, and the constant updates ensure it keeps getting better",
	},
	{
		id: 2,
		name: "Taro Woollett-Chiba",
		role: "AI Product Lead",
		company: "Vendidit",
		quote: "Easily the best AI code editor. Roo Code has the best features and capabilities, along with the best development team. I swear, they're the fastest to support new models and implement useful functionality whenever users mention it... simply amazing.",
	},
	{
		id: 3,
		name: "Can Nuri",
		role: "Reviewer",
		company: "VS Code Marketplace",
		quote: "Roo Code is one of the most inspiring projects I have seen for a long time. It shapes the way I think and deal with software development.",
	},
	{
		id: 4,
		name: "Michael",
		role: "Reviewer",
		company: "VS Code Marketplace",
		quote: "I switched from Windsurf to Roo Code in January and honestly, it's been a huge upgrade. Windsurf kept making mistakes and being dumb when I ask it for things. Roo just gets it. Projects that used to take a full day now wrap up before lunch. ",
	},
]

export function Testimonials() {
	const containerRef = useRef<HTMLDivElement>(null)

	const containerVariants = {
		hidden: { opacity: 0 },
		visible: {
			opacity: 1,
			transition: {
				staggerChildren: 0.15,
				delayChildren: 0.3,
			},
		},
	}

	const itemVariants = {
		hidden: {
			opacity: 0,
			y: 20,
		},
		visible: {
			opacity: 1,
			y: 0,
			transition: {
				duration: 0.6,
				ease: [0.21, 0.45, 0.27, 0.9],
			},
		},
	}

	const backgroundVariants = {
		hidden: {
			opacity: 0,
		},
		visible: {
			opacity: 1,
			transition: {
				duration: 1.2,
				ease: "easeOut",
			},
		},
	}

	return (
		<section ref={containerRef} className="relative overflow-hidden border-t border-border py-32">
			<motion.div
				className="absolute inset-0"
				initial="hidden"
				whileInView="visible"
				viewport={{ once: true }}
				variants={backgroundVariants}>
				<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2">
					<div className="absolute left-1/2 top-1/2 h-[800px] w-full -translate-x-1/2 -translate-y-1/2 rounded-[100%] bg-blue-500/10 blur-[120px]" />
				</div>
			</motion.div>
			<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto mb-24 max-w-3xl text-center">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						transition={{
							duration: 0.6,
							ease: [0.21, 0.45, 0.27, 0.9],
						}}>
						<h2 className="bg-gradient-to-b from-foreground to-foreground/70 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-5xl">
							Empowering developers worldwide.
						</h2>
						<p className="mt-6 text-lg text-muted-foreground">
							Join thousands of developers who are revolutionizing their workflow with AI-powered
							assistance.
						</p>
					</motion.div>
				</div>

				{/* Mobile Carousel */}
				<TestimonialsMobile />

				{/* Desktop Grid */}
				<motion.div
					className="relative mx-auto hidden max-w-[1200px] md:block"
					variants={containerVariants}
					initial="hidden"
					whileInView="visible"
					viewport={{ once: true }}>
					<div className="relative grid grid-cols-1 gap-12 md:grid-cols-2">
						{testimonials.map((testimonial, index) => (
							<motion.div
								key={testimonial.id}
								variants={itemVariants}
								className={`group relative ${index % 2 === 0 ? "md:translate-y-4" : "md:translate-y-12"}`}>
								<div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-blue-500/30 via-cyan-500/30 to-purple-500/30 opacity-0 blur-sm transition-all duration-500 ease-out group-hover:opacity-100" />
								<div className="relative h-full rounded-2xl border border-border/50 bg-background/30 backdrop-blur-xl transition-all duration-500 ease-out group-hover:border-border group-hover:bg-background/40">
									{testimonial.image && (
										<div className="absolute -right-3 -top-3 h-16 w-16 overflow-hidden rounded-xl border border-border/50 bg-background/50 p-1.5 backdrop-blur-xl transition-all duration-500 ease-out group-hover:scale-105">
											<div className="relative h-full w-full overflow-hidden rounded-lg">
												<Image
													src={testimonial.image || "/placeholder_pfp.png"}
													alt={testimonial.name}
													fill
													className="object-cover"
												/>
											</div>
										</div>
									)}

									<div className="p-8">
										<div className="mb-6">
											<svg
												className="h-8 w-8 text-blue-500/20"
												fill="currentColor"
												viewBox="0 0 32 32">
												<path d="M9.352 4C4.456 7.456 1 13.12 1 19.36c0 5.088 3.072 8.064 6.624 8.064 3.36 0 5.856-2.688 5.856-5.856 0-3.168-2.208-5.472-5.088-5.472-.576 0-1.344.096-1.536.192.48-3.264 3.552-7.104 6.624-9.024L9.352 4zm16.512 0c-4.8 3.456-8.256 9.12-8.256 15.36 0 5.088 3.072 8.064 6.624 8.064 3.264 0 5.856-2.688 5.856-5.856 0-3.168-2.304-5.472-5.184-5.472-.576 0-1.248.096-1.44.192.48-3.264 3.456-7.104 6.528-9.024L25.864 4z" />
											</svg>
										</div>

										<p className="relative mb-6 text-lg leading-relaxed text-muted-foreground">
											{testimonial.quote}
										</p>

										<div className="relative">
											<div className="mb-4 h-px w-12 bg-gradient-to-r from-blue-500/50 to-transparent" />
											<h3 className="font-medium text-foreground/90">{testimonial.name}</h3>
											<p className="text-sm text-muted-foreground">
												{testimonial.role} at {testimonial.company}
											</p>
										</div>
									</div>
								</div>
							</motion.div>
						))}
					</div>
				</motion.div>
			</div>
		</section>
	)
}
