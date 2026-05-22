import { NewTaskRequest } from "@shared/proto/cline/task"
import { Zap } from "lucide-react"
import React from "react"
import { TaskServiceClient } from "@/services/grpc-client"
import QuickWinCard from "./QuickWinCard"
import { QuickWinTask, quickWinTasks } from "./quickWinTasks"

export const SuggestedTasks: React.FC<{ shouldShowQuickWins: boolean }> = ({ shouldShowQuickWins }) => {
	const handleExecuteQuickWin = async (prompt: string) => {
		await TaskServiceClient.newTask(NewTaskRequest.create({ text: prompt, images: [] }))
	}

	if (!shouldShowQuickWins) {
		return null
	}

	return (
		<div className="px-5 pt-2 pb-4 select-none max-w-lg mx-auto w-full animate-fade-in-up stagger-2">
			{/* Section Header */}
			<div className="flex items-center justify-center gap-2 mb-4">
				<Zap className="text-aihydro-cyan" size={14} />
				<h2 className="text-xs font-semibold text-center text-[var(--vscode-descriptionForeground)] uppercase tracking-widest m-0">
					Quick Wins
				</h2>
				<Zap className="text-aihydro-cyan" size={14} />
			</div>

			{/* Cards */}
			<div className="flex flex-col space-y-1">
				{quickWinTasks.map((task: QuickWinTask, index: number) => (
					<div
						className="animate-fade-in-scale"
						key={task.id}
						style={{ animationDelay: `${0.1 + index * 0.08}s`, opacity: 0 }}>
						<QuickWinCard onExecute={() => handleExecuteQuickWin(task.prompt)} task={task} />
					</div>
				))}
			</div>
		</div>
	)
}
