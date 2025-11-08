import { NewTaskRequest } from "@shared/proto/cline/task"
import React from "react"
import { useTranslation } from "react-i18next"
import { TaskServiceClient } from "@/services/grpc-client"
import QuickWinCard from "./QuickWinCard"
import { getQuickWinTasks } from "./quickWinTasks"

export const SuggestedTasks: React.FC<{ shouldShowQuickWins: boolean }> = ({ shouldShowQuickWins }) => {
	const { t } = useTranslation("common")
	const quickWinTasks = getQuickWinTasks(t)

	const handleExecuteQuickWin = async (prompt: string) => {
		await TaskServiceClient.newTask(NewTaskRequest.create({ text: prompt, images: [] }))
	}

	if (shouldShowQuickWins) {
		return (
			<div className="px-4 pt-1 pb-3 select-none">
				{" "}
				<h2 className="text-sm font-medium mb-2.5 text-center text-gray">
					{t("suggested_tasks.title", { wins: t("suggested_tasks.wins") })}
				</h2>
				<div className="flex flex-col space-y-1">
					{" "}
					{quickWinTasks.map((task) => (
						<QuickWinCard key={task.id} onExecute={() => handleExecuteQuickWin(task.prompt)} task={task} />
					))}
				</div>
			</div>
		)
	}
}
