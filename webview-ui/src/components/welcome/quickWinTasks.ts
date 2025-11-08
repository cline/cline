import { TFunction } from "i18next"

export interface QuickWinTask {
	id: string
	title: string
	description: string
	icon?: string
	actionCommand: string
	prompt: string
	buttonText?: string
}

// 创建一个函数来获取翻译后的任务列表
export const getQuickWinTasks = (t: TFunction) => [
	{
		id: "nextjs_notetaking_app",
		title: t("quick_win_tasks.nextjs_notetaking_app.title"),
		description: t("quick_win_tasks.nextjs_notetaking_app.description"),
		icon: "WebAppIcon",
		actionCommand: "cline/createNextJsApp",
		prompt: "Make a beautiful Next.js notetaking app, using Tailwind CSS for styling. Set up the basic structure and a simple UI for adding and viewing notes.",
		buttonText: ">",
	},
	{
		id: "terminal_cli_tool",
		title: t("quick_win_tasks.terminal_cli_tool.title"),
		description: t("quick_win_tasks.terminal_cli_tool.description"),
		icon: "TerminalIcon",
		actionCommand: "cline/createCliTool",
		prompt: "Make a terminal CLI tool using Node.js that organizes files in a directory by type, size, or date. It should have options to sort files into folders, show file statistics, find duplicates, and clean up empty directories. Include colorful output and progress indicators.",
		buttonText: ">",
	},
	{
		id: "snake_game",
		title: t("quick_win_tasks.snake_game.title"),
		description: t("quick_win_tasks.snake_game.description"),
		icon: "GameIcon",
		actionCommand: "cline/createSnakeGame",
		prompt: "Make a classic Snake game using HTML, CSS, and JavaScript. The game should be playable in the browser, with keyboard controls for the snake, a scoring system, and a game over state.",
		buttonText: ">",
	},
]
