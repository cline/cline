import React from "react"
import { ClaudeMessage } from "@shared/ExtensionMessage"

interface TaskHistoryItem {
	id: string
	description: string
	timestamp: number
	messages?: ClaudeMessage[]
}

interface TaskHistoryViewProps {
	tasks: TaskHistoryItem[]
	onSelectTask: (task: TaskHistoryItem) => void
	onClearHistory: () => void
}

const TaskHistoryView: React.FC<TaskHistoryViewProps> = ({ tasks, onSelectTask, onClearHistory }) => {
	return (
		<div className="task-history-view">
			<h2>Task History</h2>
			{tasks.length === 0 ? (
				<p>No tasks in history.</p>
			) : (
				<ul>
					{tasks.map((task) => (
						<li key={task.id} onClick={() => onSelectTask(task)}>
							<span>{new Date(task.timestamp).toLocaleString()}</span>
							<p>{task.description}</p>
							<p>Messages: {task.messages ? task.messages.length : 0}</p>
						</li>
					))}
				</ul>
			)}
			<button onClick={onClearHistory}>Clear History</button>
		</div>
	)
}

export default TaskHistoryView
