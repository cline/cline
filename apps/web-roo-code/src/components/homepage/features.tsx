"use client"

import { motion } from "framer-motion"
import { FaRobot, FaCode, FaBrain, FaTools, FaTerminal, FaPuzzlePiece, FaGlobe } from "react-icons/fa"
import { FeaturesMobile } from "./features-mobile"

import { ReactNode } from "react"

export interface Feature {
	icon: ReactNode
	title: string
	description: string
	size: "small" | "large"
}

export const features: Feature[] = [
	{
		icon: <FaRobot className="h-6 w-6" />,
		title: "Your AI Dev Team in VS Code",
		description:
			"Roo Code puts a team of agentic AI assistants directly in your editor, with the power to plan, write, and fix code across multiple files.",
		size: "large",
	},
	{
		icon: <FaCode className="h-6 w-6" />,
		title: "Multiple Specialized Modes",
		description:
			"From coding to debugging to architecture, Roo Code has a mode for every dev scenario—just switch on the fly.",
		size: "small",
	},
	{
		icon: <FaBrain className="h-6 w-6" />,
		title: "Deep Project-wide Context",
		description:
			"Roo Code reads your entire codebase, preserving valid code through diff-based edits for seamless multi-file refactors.",
		size: "small",
	},
	{
		icon: <FaTools className="h-6 w-6" />,
		title: "Open-Source and Model-Agnostic",
		description:
			"Bring your own model or use local AI—no vendor lock-in. Roo Code is free, open, and adaptable to your needs.",
		size: "large",
	},
	{
		icon: <FaTerminal className="h-6 w-6" />,
		title: "Guarded Command Execution",
		description:
			"Approve or deny commands as needed. Roo Code automates your dev workflow while keeping oversight firmly in your hands.",
		size: "small",
	},
	{
		icon: <FaPuzzlePiece className="h-6 w-6" />,
		title: "Fully Customizable",
		description:
			"Create or tweak modes, define usage rules, and shape Roo Code’s behavior precisely—your code, your way.",
		size: "small",
	},
	{
		icon: <FaGlobe className="h-6 w-6" />,
		title: "Automated Browser Actions",
		description:
			"Seamlessly test and verify your web app directly from VS Code—Roo Code can open a browser, run checks, and more.",
		size: "small",
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
		<section className="relative overflow-hidden border-t border-border py-32">
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
							Powerful features for modern developers.
						</h2>
						<p className="mt-6 text-lg text-muted-foreground">
							Everything you need to build faster and write better code.
						</p>
					</motion.div>
				</div>

				{/* Mobile Carousel */}
				<FeaturesMobile />

				{/* Desktop Grid */}
				<motion.div
					className="relative mx-auto hidden max-w-[1200px] md:block"
					variants={containerVariants}
					initial="hidden"
					whileInView="visible"
					viewport={{ once: true }}>
					<div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3 lg:gap-8">
						{features.map((feature, index) => (
							<motion.div
								key={index}
								variants={itemVariants}
								className={`group relative ${feature.size === "large" ? "lg:col-span-2" : ""} ${index % 2 === 0 ? "lg:translate-y-12" : ""}`}>
								<div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-blue-500/30 via-cyan-500/30 to-purple-500/30 opacity-0 blur-sm transition-opacity duration-500 group-hover:opacity-100" />
								<div className="relative h-full rounded-2xl border border-border/50 bg-background/30 p-8 backdrop-blur-xl transition-colors duration-300 hover:border-border">
									<div className="mb-5 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-blue-500/5 to-cyan-500/5 p-2.5">
										<div className="rounded-lg bg-gradient-to-r from-blue-500/80 to-cyan-500/80 p-2.5">
											<div className="text-foreground/90">{feature.icon}</div>
										</div>
									</div>
									<h3 className="mb-3 text-xl font-medium text-foreground/90">{feature.title}</h3>
									<p className="leading-relaxed text-muted-foreground">{feature.description}</p>
								</div>
							</motion.div>
						))}
					</div>
				</motion.div>
			</div>
		</section>
	)
}
