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
		title: "构建Next.js应用",
		description: "使用Next.js和Tailwind创建一个美观的笔记应用",
		icon: "WebAppIcon",
		actionCommand: "cline/createNextJsApp",
		prompt: "制作一个美观的Next.js笔记应用，使用Tailwind CSS进行样式设计。建立基本结构和简单的添加与查看笔记的用户界面。",
		buttonText: ">",
	},
	{
		id: "terminal_cli_tool",
		title: "制作CLI工具",
		description: "开发一个强大的终端CLI来自动化一个很酷的任务",
		icon: "TerminalIcon",
		actionCommand: "cline/createCliTool",
		prompt: "使用Node.js制作一个终端CLI工具，能够按类型、大小或日期组织目录中的文件。它应该有选项将文件分类到文件夹中，显示文件统计信息，查找重复文件，以及清理空目录。包含彩色输出和进度指示器。",
		buttonText: ">",
	},
	{
		id: "snake_game",
		title: "开发游戏",
		description: "编写一个在浏览器中运行的经典贪吃蛇游戏。",
		icon: "GameIcon",
		actionCommand: "cline/createSnakeGame",
		prompt: "使用HTML、CSS和JavaScript制作一个经典贪吃蛇游戏。游戏应该可以在浏览器中玩，使用键盘控制蛇的移动，有计分系统和游戏结束状态。",
		buttonText: ">",
	},
]
