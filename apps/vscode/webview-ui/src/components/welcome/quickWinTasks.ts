export interface QuickWinTask {
	id: string
	title: string
	description: string
	icon?: string
	actionCommand: string
	prompt: string
	buttonText?: string
}

export const quickWinTasks: QuickWinTask[] = [
	{
		id: "nextjs_notetaking_app",
		title: "Build a Next.js App",
		description: "Create a beautiful notetaking app with Next.js and Tailwind",
		icon: "WebAppIcon",
		actionCommand: "cline/createNextJsApp",
		prompt: "Make a beautiful Next.js notetaking app, using Tailwind CSS for styling. Set up the basic structure and a simple UI for adding and viewing notes.",
		buttonText: ">",
	},
	{
		id: "terminal_cli_tool",
		title: "Craft a CLI Tool",
		description: "Develop a powerful terminal CLI to automate a cool task",
		icon: "TerminalIcon",
		actionCommand: "cline/createCliTool",
		prompt: "Make a terminal CLI tool using Node.js that organizes files in a directory by type, size, or date. It should have options to sort files into folders, show file statistics, find duplicates, and clean up empty directories. Include colorful output and progress indicators.",
		buttonText: ">",
	},
	{
		id: "snake_game",
		title: "Develop a Game",
		description: "Code a classic Snake game that runs in the browser.",
		icon: "GameIcon",
		actionCommand: "cline/createSnakeGame",
		prompt: "Make a classic Snake game using HTML, CSS, and JavaScript. The game should be playable in the browser, with keyboard controls for the snake, a scoring system, and a game over state.",
		buttonText: ">",
	},
]
