"use client"

import { useState, useRef, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, ArrowRight, Code2, Users2, Zap } from "lucide-react"
import Link from "next/link"

interface FeatureProps {
	icon: React.ComponentType<{ className?: string }>
	color: "blue" | "purple" | "green"
	title: string
	description: string
}

function Feature({ icon: Icon, color, title, description }: FeatureProps) {
	const bgColor = {
		blue: "bg-blue-500/20",
		purple: "bg-purple-500/20",
		green: "bg-green-500/20",
	}[color]

	const textColor = {
		blue: "text-blue-400",
		purple: "text-purple-400",
		green: "text-green-400",
	}[color]

	return (
		<div className="space-y-1.5 sm:space-y-2">
			<div className="flex items-center gap-1 space-x-2">
				<div className={`rounded-full ${bgColor} p-3 ${textColor}`}>
					<Icon className="h-6 w-6" />
				</div>
				<h3 className="text-base font-semibold sm:text-lg">{title}</h3>
			</div>
			<p className="text-sm text-gray-400 sm:text-base">{description}</p>
		</div>
	)
}

const version = "v3.8.0"

export function WhatsNewButton() {
	const [isOpen, setIsOpen] = useState(false)
	const buttonRef = useRef<HTMLDivElement>(null)
	const canvasRef = useRef<HTMLCanvasElement>(null)

	// animated border effect
	useEffect(() => {
		const canvas = canvasRef.current
		const button = buttonRef.current

		if (!canvas || !button) return

		const ctx = canvas.getContext("2d")
		if (!ctx) return

		// set canvas size to match button size with extra space for glow
		const updateCanvasSize = () => {
			const rect = button.getBoundingClientRect()
			// add extra padding for the glow effect
			canvas.width = rect.width + 8
			canvas.height = rect.height + 8

			// position the canvas precisely
			canvas.style.width = `${canvas.width}px`
			canvas.style.height = `${canvas.height}px`
		}

		updateCanvasSize()
		window.addEventListener("resize", updateCanvasSize)

		// animation variables
		let animationId: number
		let position = 0

		const animate = () => {
			if (!ctx || !canvas) return

			// clear canvas
			ctx.clearRect(0, 0, canvas.width, canvas.height)

			// calculate border path
			const width = canvas.width - 4
			const height = canvas.height - 4
			const x = 2
			const y = 2
			const radius = height / 2

			// draw rounded rectangle path
			ctx.beginPath()
			ctx.moveTo(x + radius, y)
			ctx.lineTo(x + width - radius, y)
			ctx.arcTo(x + width, y, x + width, y + radius, radius)
			ctx.lineTo(x + width, y + height - radius)
			ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius)
			ctx.lineTo(x + radius, y + height)
			ctx.arcTo(x, y + height, x, y + height - radius, radius)
			ctx.lineTo(x, y + radius)
			ctx.arcTo(x, y, x + radius, y, radius)
			ctx.closePath()

			// create rotating gradient effect
			position = (position + 0.016) % (Math.PI * 2)

			const centerX = canvas.width / 2
			const centerY = canvas.height / 2
			const blueColor = "70, 130, 255"

			// create rotating gradient
			const gradient = ctx.createConicGradient(position, centerX, centerY)

			// add color stops for a single flowing stream
			gradient.addColorStop(0, `rgba(${blueColor}, 0)`)
			gradient.addColorStop(0.2, `rgba(${blueColor}, 0.8)`)
			gradient.addColorStop(0.4, `rgba(${blueColor}, 0)`)
			gradient.addColorStop(1, `rgba(${blueColor}, 0)`)

			// apply gradient
			ctx.strokeStyle = gradient
			ctx.lineWidth = 1.5
			ctx.stroke()

			// add subtle glow effect
			ctx.shadowColor = `rgba(${blueColor}, 0.6)`
			ctx.shadowBlur = 5
			ctx.strokeStyle = `rgba(${blueColor}, 0.3)`
			ctx.lineWidth = 0.5
			ctx.stroke()

			animationId = requestAnimationFrame(animate)
		}

		animate()

		return () => {
			window.removeEventListener("resize", updateCanvasSize)
			if (animationId) cancelAnimationFrame(animationId)
		}
	}, [])

	return (
		<>
			<div className="relative inline-flex" ref={buttonRef}>
				<canvas
					ref={canvasRef}
					className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
					style={{ pointerEvents: "none" }}
				/>
				<Link
					href="#"
					onClick={(e) => {
						e.preventDefault()
						setIsOpen(true)
					}}
					className="relative z-10 flex items-center space-x-2 rounded-full bg-black px-4 py-2 text-sm font-medium text-white transition-all hover:bg-gray-900">
					<span>See what&apos;s new in {version}</span>
					<ArrowRight className="h-3.5 w-3.5" />
				</Link>
			</div>

			<AnimatePresence>
				{isOpen && (
					<>
						<motion.div
							className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm"
							initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
							animate={{ opacity: 1, backdropFilter: "blur(8px)" }}
							exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
							transition={{ duration: 0.2 }}
						/>
						<div className="fixed inset-0 z-50 overflow-y-auto" onClick={() => setIsOpen(false)}>
							<div className="flex min-h-full items-center justify-center p-4">
								<motion.div
									className="relative w-full max-w-2xl rounded-lg border border-gray-800 bg-black p-6 sm:p-8"
									initial={{ opacity: 0, y: 20, scale: 0.95 }}
									animate={{ opacity: 1, y: 0, scale: 1 }}
									exit={{ opacity: 0, y: 20, scale: 0.95 }}
									transition={{
										type: "spring",
										damping: 20,
										stiffness: 400,
										mass: 0.6,
										duration: 0.25,
									}}
									onClick={(e) => {
										// prevent clicks inside the panel from closing it
										e.stopPropagation()
									}}>
									<div className="flex items-center justify-between gap-4">
										<h2 className="text-xl font-bold sm:text-2xl">
											What&apos;s New in Roo Code {version}
										</h2>
										<button
											onClick={() => setIsOpen(false)}
											className="flex-shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-gray-800 hover:text-white">
											<X className="h-5 w-5" />
										</button>
									</div>

									<div className="mt-4 space-y-4 sm:mt-6 sm:space-y-6">
										<Feature
											icon={Code2}
											color="blue"
											title="AI-Powered Code Generation"
											description="Generate high-quality code snippets and entire components with our new AI assistant. Trained on millions of code repositories to understand your project context."
										/>
										<Feature
											icon={Users2}
											color="purple"
											title="Real-time Collaboration"
											description="Work together with your team in real-time with our new collaborative editing features. See changes as they happen and resolve conflicts automatically."
										/>
										<Feature
											icon={Zap}
											color="green"
											title="Performance Optimizations"
											description="We've completely rewritten our core engine for blazing fast performance. Experience up to 10x faster build times and smoother development workflow."
										/>
									</div>
								</motion.div>
							</div>
						</div>
					</>
				)}
			</AnimatePresence>
		</>
	)
}
