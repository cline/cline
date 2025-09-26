"use client"

import { motion } from "framer-motion"
import { Shield, Users2, ReplaceAll, Keyboard, LucideIcon, CheckCheck, GitPullRequest } from "lucide-react"
import Image from "next/image"

export interface Feature {
	icon: LucideIcon
	title: string
	description: string
	logos?: string[]
}

export const features: Feature[] = [
	{
		icon: Users2,
		title: "Specialized modes",
		description:
			"Planning, Architecture, Debugging and beyond: Roo's modes stay on-task and deliver. They even know when to hand off work to other modes. Create your own or download from the marketplace.",
	},
	{
		icon: ReplaceAll,
		title: "Model-agnostic",
		description: "Bring your own provider key or even run local inference — no markup, lock-in, no restrictions.",
		logos: ["Anthropic", "OpenAI", "Gemini", "Grok", "Qwen", "Kimi", "Mistral", "Ollama"],
	},
	{
		icon: CheckCheck,
		title: "Granular auto-approval",
		description:
			"Control each action and make Roo as autonomous as you want as you build confidence. Or go YOLO and let it rip.",
	},
	{
		icon: GitPullRequest,
		title: "Proudly open source",
		description:
			"Community-driven and fully auditable: no throttling or surprises about what's happening behind the scenes.",
	},
	{
		icon: Keyboard,
		title: "Highly customizable",
		description:
			"Fine-tune settings for Roo to work for you, like inference context, model properties, slash commands and more.",
	},
	{
		icon: Shield,
		title: "Secure and private by design",
		description:
			"Client-only architecture means no code leaves your machine unless you say so. SOC 2 Type II compliant.",
	},
]

export function Features() {
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
		<section className="relative overflow-hidden border-t border-border py-32">
			<motion.div
				className="absolute inset-0"
				initial="hidden"
				whileInView="visible"
				viewport={{ once: true }}
				variants={backgroundVariants}>
				<div className="absolute inset-y-0 left-1/2 h-full w-full max-w-[1200px] -translate-x-1/2">
					<div className="absolute left-1/2 top-1/2 h-[800px] w-full -translate-x-1/2 -translate-y-1/2 rounded-[100%] bg-blue-500/10 dark:bg-blue-700/30 blur-[120px]" />
				</div>
			</motion.div>
			<div className="container relative z-10 mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto mb-12 md:mb-24 max-w-4xl text-center">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						transition={{
							duration: 0.6,
							ease: [0.21, 0.45, 0.27, 0.9],
						}}>
						<h2 className="text-4xl font-bold tracking-tight sm:text-5xl">
							Power and flexibility to get stuff done.
						</h2>
						<p className="mt-6 text-lg text-muted-foreground">
							The features you need to build, debug and ship faster – without compromising quality.
						</p>
					</motion.div>
				</div>

				<motion.div
					className="relative mx-auto md:max-w-[1200px]"
					variants={containerVariants}
					initial="hidden"
					whileInView="visible"
					viewport={{ once: true }}>
					<ul className="grid grid-cols-1 place-items-center gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
						{features.map((feature, index) => {
							const Icon = feature.icon
							return (
								<li
									key={index}
									className="relative h-full border border-border rounded-2xl bg-background p-8 transition-all duration-300">
									<Icon className="size-6 text-foreground/80" />
									<h3 className="mb-3 mt-3 text-xl font-semibold text-foreground">{feature.title}</h3>
									<p className="leading-relaxed font-light text-muted-foreground">
										{feature.description}
									</p>
									{feature.logos && (
										<div className="mt-4 flex flex-wrap items-center gap-4">
											{feature.logos.map((logo) => (
												<Image
													key={logo}
													width={20}
													height={20}
													className="w-5 h-5 overflow-clip opacity-50 dark:invert"
													src={`/logos/${logo.toLowerCase()}.svg`}
													alt={`${logo} Logo`}
												/>
											))}
										</div>
									)}
								</li>
							)
						})}
					</ul>
				</motion.div>
			</div>
		</section>
	)
}
