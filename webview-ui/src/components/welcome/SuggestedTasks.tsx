import React, { useState, useEffect, useRef } from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import { useExtensionState } from "../../context/ExtensionStateContext"
import QuickWinCard from "./QuickWinCard"
import { QuickWinTask, quickWinTasks } from "./quickWinTasks" // Import QuickWinTask interface
import { vscode } from "../../utils/vscode" // Assuming this path is correct

const QUICK_WINS_HISTORY_THRESHOLD = 3000

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
	const [isPaused, setIsPaused] = useState(false)
	const [direction, setDirection] = useState<"up" | "down">("down") // Track animation direction
	const pauseTimeoutRef = useRef<NodeJS.Timeout | null>(null)
	const [isUpHovered, setIsUpHovered] = useState(false)
	const [isDownHovered, setIsDownHovered] = useState(false)
	const { taskHistory } = useExtensionState()

	const showQuickWins = !taskHistory || taskHistory.length < QUICK_WINS_HISTORY_THRESHOLD

	// Updated to use the prompt from QuickWinTask
	const handleExecuteQuickWin = async (prompt: string) => {
		await TaskServiceClient.newTask({ text: prompt, images: [] })
	}

	// Handle task selection for the carousel
	const handleTaskClick = async (prompt: string) => {
		await TaskServiceClient.newTask({ text: prompt, images: [] })
	}

	// Function to handle arrow clicks and navigation for the carousel
	const handleNavigation = (direction: "prev" | "next") => {
		// Pause auto-scrolling for 5 seconds
		setIsPaused(true)
		if (pauseTimeoutRef.current) {
			clearTimeout(pauseTimeoutRef.current)
		}
		pauseTimeoutRef.current = setTimeout(() => {
			setIsPaused(false)
		}, 2000)

		// Set the animation direction
		setDirection(direction === "prev" ? "up" : "down")

		// Update the current index
		if (direction === "next") {
			setCurrentIndex((prevIndex) => (prevIndex + 1) % tasks.length)
		} else {
			setCurrentIndex((prevIndex) => (prevIndex - 1 + tasks.length) % tasks.length)
		}
	}

	// Auto-advance to next task (unless paused)
	useEffect(() => {
		if (isPaused) return

		const interval = setInterval(() => {
			setDirection("down") // Default auto-advance direction is down
			setCurrentIndex((prevIndex) => (prevIndex + 1) % tasks.length)
		}, 3000) // Change task every 3 seconds

		return () => clearInterval(interval)
	}, [isPaused])

	// Clean up pause timeout on unmount
	useEffect(() => {
		return () => {
			if (pauseTimeoutRef.current) {
				clearTimeout(pauseTimeoutRef.current)
			}
		}
	}, [])

	const currentTask = tasks[currentIndex] // This is for the carousel

	if (showQuickWins) {
		return (
			<div className="px-4 pt-1 pb-3 select-none">
				{" "}
				{/* Adjusted padding */}
				<h2
					className="text-sm font-medium mb-2.5 text-center" // Adjusted margin-bottom and added text-center
					style={{ color: "var(--vscode-editor-foreground)" }}>
					Quick <span style={{ color: "var(--vscode-terminal-ansiBrightCyan)" }}>[Wins]</span> with Cline
				</h2>
				{/* Container for Quick Win Cards: simple vertical stack */}
				<div className="flex flex-col space-y-1">
					{" "}
					{/* Adjusted space-y */}
					{quickWinTasks.map(
						(
							task: QuickWinTask, // Add type annotation for task
						) => (
							<QuickWinCard key={task.id} task={task} onExecute={() => handleExecuteQuickWin(task.prompt)} />
						),
					)}
				</div>
			</div>
		)
	}

	// Else, show the existing carousel
	return (
		<div className="px-6 py-2 select-none">
			{/* Container with fixed height to prevent layout shift */}
			<div className="relative h-[80px] sm:h-[100px] mb-1 overflow-hidden">
				{/* Fixed navigation arrows (outside of cards) */}
				<div className="absolute left-2 top-0 bottom-0 flex flex-col justify-center items-center gap-1 z-20">
					{/* Up arrow */}
					<div
						className="flex items-center justify-center w-5 h-5 rounded-full cursor-pointer transition-colors select-none"
						style={{
							backgroundColor: isUpHovered
								? "var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.31))"
								: "var(--vscode-editorWidget-background, rgba(60, 60, 60, 0.4))",
						}}
						onClick={() => handleNavigation("prev")}
						onMouseEnter={() => setIsUpHovered(true)}
						onMouseLeave={() => setIsUpHovered(false)}>
						<span
							className="codicon codicon-chevron-up"
							style={{
								fontSize: "14px",
								color: "var(--vscode-foreground, rgba(255, 255, 255, 0.9))",
							}}></span>
					</div>

					{/* Down arrow */}
					<div
						className="flex items-center justify-center w-5 h-5 rounded-full cursor-pointer transition-colors select-none"
						style={{
							backgroundColor: isDownHovered
								? "var(--vscode-list-hoverBackground, rgba(90, 93, 94, 0.31))"
								: "var(--vscode-editorWidget-background, rgba(60, 60, 60, 0.4))",
						}}
						onClick={() => handleNavigation("next")}
						onMouseEnter={() => setIsDownHovered(true)}
						onMouseLeave={() => setIsDownHovered(false)}>
						<span
							className="codicon codicon-chevron-down"
							style={{
								fontSize: "14px",
								color: "var(--vscode-foreground, rgba(255, 255, 255, 0.9))",
							}}></span>
					</div>
				</div>

				{/* Task card with high contrast theme variables */}
				<div
					key={`task-${currentTask.id}`}
					onClick={() => handleTaskClick(currentTask.prompt)}
					className="absolute inset-0 flex flex-col px-3 py-2 rounded-lg cursor-pointer select-none
                  border border-white/30
                  shadow-lg shadow-black/10 hover:shadow-xl hover:shadow-black/20
                  active:shadow-md
                  transition-transform duration-500 ease-out"
					style={{
						backgroundColor: "var(--vscode-statusBarItem-prominentBackground, var(--vscode-button-background))",
						transform: "translateY(0)",
						transition: "transform 0.5s ease-out, background-color 0.3s ease",
					}}>
					{/* Task content (adjusted to make room for left arrows) */}
					<div className="relative flex flex-col justify-center flex-1 text-center pl-6">
						<h3 className="text-[0.7rem] sm:text-sm md:text-base font-semibold mb-1 sm:mb-2 text-white/95 group-hover:text-white select-none">
							{currentTask.title}
						</h3>
						<p className="text-[0.6rem] sm:text-xs md:text-sm text-white/90 line-clamp-2 break-words leading-tight mx-auto select-none">
							{currentTask.description}
						</p>
					</div>

					{/* Paper airplane icon (center-right) */}
					<div
						className="absolute right-2 sm:right-2.5 top-1/2 transform -translate-y-1/2 w-3 sm:w-3.5 h-3 sm:h-3.5 opacity-70 hover:opacity-100
                      transition-opacity duration-300 ease-out">
						<span className="codicon codicon-send text-white/90" style={{ fontSize: "14px" }}></span>
					</div>
				</div>
			</div>
		</div>
	)
}
