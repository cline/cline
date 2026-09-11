export interface QuickWinTask {
	id: string
	/** i18n key for the card title (welcome namespace) */
	title: string
	/** i18n key for the card description (welcome namespace) */
	description: string
	icon?: string
	actionCommand: string
	/** Task text sent to the AI as-is; intentionally not localized */
	prompt: string
	buttonText?: string
}

export const quickWinTasks: QuickWinTask[] = [
	{
		id: "nextjs_notetaking_app",
		title: "welcome:quickWins.nextjsApp.title",
		description: "welcome:quickWins.nextjsApp.description",
		icon: "WebAppIcon",
		actionCommand: "cline/createNextJsApp",
		prompt: "Make a beautiful Next.js notetaking app, using Tailwind CSS for styling. Set up the basic structure and a simple UI for adding and viewing notes.",
		buttonText: ">",
	},
	{
		id: "terminal_cli_tool",
		title: "welcome:quickWins.cliTool.title",
		description: "welcome:quickWins.cliTool.description",
		icon: "TerminalIcon",
		actionCommand: "cline/createCliTool",
		prompt: "Make a terminal CLI tool using Node.js that organizes files in a directory by type, size, or date. It should have options to sort files into folders, show file statistics, find duplicates, and clean up empty directories. Include colorful output and progress indicators.",
		buttonText: ">",
	},
	{
		id: "snake_game",
		title: "welcome:quickWins.snakeGame.title",
		description: "welcome:quickWins.snakeGame.description",
		icon: "GameIcon",
		actionCommand: "cline/createSnakeGame",
		prompt: "Make a classic Snake game using HTML, CSS, and JavaScript. The game should be playable in the browser, with keyboard controls for the snake, a scoring system, and a game over state.",
		buttonText: ">",
	},
]
