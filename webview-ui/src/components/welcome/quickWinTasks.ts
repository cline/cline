export interface QuickWinTask {
	id: string
	title: string
	description: string // This will serve as the subheadline
	icon?: string // Placeholder for icon name or SVG path
	actionCommand: string // Can still be useful for telemetry or specific backend handling
	prompt: string // The primary driver for initiating the task
	buttonText?: string // Will likely be a chevron or handled by an icon
}

export const quickWinTasks: QuickWinTask[] = [
	{
		id: "nextjs_notetaking_app",
		title: "Build a Next.js App",
		description: "Create a beautiful notetaking application with Next.js and Tailwind CSS.",
		icon: "WebAppIcon", // Placeholder - suggest a browser or modern app icon
		actionCommand: "cline/createNextJsApp",
		prompt: "Make a beautiful Next.js notetaking app, using Tailwind CSS for styling. Set up the basic structure and a simple UI for adding and viewing notes.",
		buttonText: ">",
	},
	{
		id: "terminal_cli_tool",
		title: "Craft a CLI Tool",
		description: "Develop a powerful terminal CLI to automate a cool task.",
		icon: "TerminalIcon", // Placeholder - suggest a terminal or command prompt icon
		actionCommand: "cline/createCliTool",
		prompt: "Make a terminal CLI tool using Node.js that fetches the current weather for a given city using a free weather API and displays it in a user-friendly format.",
		buttonText: ">",
	},
	{
		id: "snake_game",
		title: "Develop a Game",
		description: "Code a classic Snake game that runs in the browser.",
		icon: "GameIcon", // Placeholder - suggest a game controller or pixel art icon
		actionCommand: "cline/createSnakeGame",
		prompt: "Make a classic Snake game using HTML, CSS, and JavaScript. The game should be playable in the browser, with keyboard controls for the snake, a scoring system, and a game over state.",
		buttonText: ">",
	},
]
