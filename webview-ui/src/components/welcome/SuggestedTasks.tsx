import React, { useState, useEffect, useRef } from "react"
import { TaskServiceClient } from "@/services/grpc-client"

interface Task {
	id: string
	title: string
	description: string
	prompt: string
}

const tasks: Task[] = [
	{
		id: "web-app",
		title: "Build a Web App",
		description: "Create a modern React app with Vite and Tailwind",
		prompt: "Create a landing page for an app where LLMs can swipe on each other. Make it in React with Vite and tailwind, and then test it using the browser tool.",
	},
	{
		id: "cli-tool",
		title: "Create a CLI Tool",
		description: "Build a Node.js CLI for markdown analysis",
		prompt: "Create a Node.js CLI tool that can analyze a directory of markdown files and generate a summary of their contents, including word count, reading time, and most common topics. Include a progress bar for processing files.",
	},
	{
		id: "file-automation",
		title: "Automate",
		description: "Extract and organize TODO comments",
		prompt: "Help me organize my project's documentation by creating a script that finds all TODO comments in the codebase, extracts them into a structured markdown file, and sorts them by priority based on comment content.",
	},
]

export const SuggestedTasks: React.FC = () => {
	const [currentIndex, setCurrentIndex] = useState(0)
	const [previousIndex, setPreviousIndex] = useState(-1)
	const [isTransitioning, setIsTransitioning] = useState(false)
	const [isPaused, setIsPaused] = useState(false)
	const [direction, setDirection] = useState<"up" | "down">("down") // Track animation direction
	const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null)

	// Handle task selection
	const handleTaskClick = async (prompt: string) => {
		await TaskServiceClient.newTask({ text: prompt, images: [] })
	}

	// Function to handle arrow clicks and navigation
	const handleNavigation = (direction: "prev" | "next") => {
		if (isTransitioning) return

		// Pause auto-scrolling for 5 seconds
		setIsPaused(true)
		if (pauseTimeoutRef.current) {
			clearTimeout(pauseTimeoutRef.current)
		}
		pauseTimeoutRef.current = setTimeout(() => {
			setIsPaused(false)
		}, 5000)

		// Set the animation direction based on navigation direction
		setDirection(direction === "prev" ? "up" : "down")

		// Update the task
		setPreviousIndex(currentIndex)
		setIsTransitioning(true)

		if (direction === "next") {
			setCurrentIndex((prevIndex) => (prevIndex + 1) % tasks.length)
		} else {
			setCurrentIndex((prevIndex) => (prevIndex - 1 + tasks.length) % tasks.length)
		}

		setTimeout(() => {
			setIsTransitioning(false)
		}, 500)
	}

	// Auto-advance to next task (unless paused)
	useEffect(() => {
		if (isPaused) return

		const interval = setInterval(() => {
			setPreviousIndex(currentIndex)
			setIsTransitioning(true)
			setDirection("down") // Default auto-advance direction is down
			setCurrentIndex((prevIndex) => (prevIndex + 1) % tasks.length)

			// Reset transitioning state after animation completes
			setTimeout(() => {
				setIsTransitioning(false)
			}, 500) // Match this with the animation duration
		}, 2000) // Change task every 2 seconds

		return () => clearInterval(interval)
	}, [currentIndex, isPaused])

	// Clean up pause timeout on unmount
	useEffect(() => {
		return () => {
			if (pauseTimeoutRef.current) {
				clearTimeout(pauseTimeoutRef.current)
			}
		}
	}, [])

	const currentTask = tasks[currentIndex]
	const previousTask = previousIndex >= 0 ? tasks[previousIndex] : null

	return (
		<div className="px-6 py-2">
			{/* Define animations */}
			<style>
				{`
				@keyframes slideInFromTop {
					from {
						opacity: 0;
						transform: translateY(-100%);
					}
					to {
						opacity: 1;
						transform: translateY(0);
					}
				}
				
				@keyframes slideInFromBottom {
					from {
						opacity: 0;
						transform: translateY(100%);
					}
					to {
						opacity: 1;
						transform: translateY(0);
					}
				}
				
				@keyframes slideOutToBottom {
					from {
						opacity: 1;
						transform: translateY(0);
					}
					to {
						opacity: 0;
						transform: translateY(100%);
					}
				}
				
				@keyframes slideOutToTop {
					from {
						opacity: 1;
						transform: translateY(0);
					}
					to {
						opacity: 0;
						transform: translateY(-100%);
					}
				}
				
				.slide-in-from-top {
					animation: slideInFromTop 0.5s ease-out forwards;
				}
				
				.slide-in-from-bottom {
					animation: slideInFromBottom 0.5s ease-out forwards;
				}
				
				.slide-out-to-bottom {
					animation: slideOutToBottom 0.5s ease-out forwards;
				}
				
				.slide-out-to-top {
					animation: slideOutToTop 0.5s ease-out forwards;
				}
				`}
			</style>

			{/* Container with fixed height to prevent layout shift */}
			<div className="relative h-[80px] sm:h-[100px] mb-1 overflow-hidden">
				{/* Fixed navigation arrows (outside of cards) */}
				<div className="absolute left-2 top-0 bottom-0 flex flex-col justify-center items-center gap-1 z-20">
					{/* Up arrow */}
					<div
						className="flex items-center justify-center w-5 h-5 rounded-full bg-black/40 hover:bg-black/60 cursor-pointer transition-colors"
						onClick={() => handleNavigation("prev")}>
						<svg viewBox="0 0 16 16" className="w-3 h-3 text-white/70">
							<path d="M8 5.5l4 4-1 1-3-3-3 3-1-1 4-4z" fill="currentColor" />
						</svg>
					</div>

					{/* Down arrow */}
					<div
						className="flex items-center justify-center w-5 h-5 rounded-full bg-black/40 hover:bg-black/60 cursor-pointer transition-colors"
						onClick={() => handleNavigation("next")}>
						<svg viewBox="0 0 16 16" className="w-3 h-3 text-white/70">
							<path d="M8 10.5l-4-4 1-1 3 3 3-3 1 1-4 4z" fill="currentColor" />
						</svg>
					</div>
				</div>

				{/* Current task card with slide-in effect */}
				<div
					key={`current-${currentTask.id}`}
					onClick={() => handleTaskClick(currentTask.prompt)}
					className={`absolute inset-0 flex flex-col px-3 py-2 rounded-lg cursor-pointer
                    bg-gradient-to-br from-purple-600/15 to-blue-600/15
                    hover:from-purple-600/25 hover:to-blue-600/25
                    border border-white/10 hover:border-white/20
                    shadow-lg shadow-black/5 hover:shadow-xl hover:shadow-black/10
                    active:shadow-md
                    before:absolute before:inset-0 before:rounded-lg before:bg-white/5 before:opacity-0
                    before:transition-opacity hover:before:opacity-100
                    ${direction === "down" ? "slide-in-from-top" : "slide-in-from-bottom"}`}>
					{/* Task content (adjusted to make room for left arrows) */}
					<div className="relative flex flex-col justify-center flex-1 text-center pl-6">
						<h3 className="text-[0.7rem] sm:text-sm md:text-base font-semibold mb-1 sm:mb-2 text-white/95 group-hover:text-white">
							{currentTask.title}
						</h3>
						<p className="text-[0.6rem] sm:text-xs md:text-sm text-white/75 line-clamp-2 break-words leading-tight mx-auto">
							{currentTask.description}
						</p>
					</div>

					{/* Paper airplane icon (center-right) */}
					<div
						className="absolute right-2 sm:right-2.5 top-1/2 transform -translate-y-1/2 w-3 sm:w-3.5 h-3 sm:h-3.5 opacity-50 hover:opacity-100
                        transition-opacity duration-300 ease-out">
						<span className="codicon codicon-send text-white/70" style={{ fontSize: "14px" }}></span>
					</div>
				</div>

				{/* Previous task card with slide-out effect (only shown during transition) */}
				{isTransitioning && previousTask && (
					<div
						key={`previous-${previousTask.id}`}
						className={`absolute inset-0 flex flex-col px-3 py-2 rounded-lg
                        bg-gradient-to-br from-purple-600/15 to-blue-600/15
                        border border-white/10
                        ${direction === "down" ? "slide-out-to-bottom" : "slide-out-to-top"}
                        pointer-events-none`}>
						<div className="relative flex flex-col justify-center flex-1 text-center pl-6">
							<h3 className="text-[0.7rem] sm:text-sm md:text-base font-semibold mb-1 sm:mb-2 text-white/95">
								{previousTask.title}
							</h3>
							<p className="text-[0.6rem] sm:text-xs md:text-sm text-white/75 line-clamp-2 break-words leading-tight mx-auto">
								{previousTask.description}
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
