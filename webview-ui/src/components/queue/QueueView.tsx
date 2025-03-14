import { VSCodeButton, VSCodeTextField, VSCodeProgressRing, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
type QueueViewProps = {
	onDone: () => void
}

const QueueView = ({ onDone }: QueueViewProps) => {
	const { queueItems } = useExtensionState()
	const [newTask, setNewTask] = useState("")

	const handleAddTask = () => {
		if (newTask.trim()) {
			// Send message to extension to add new queue item
			const newQueueItem = {
				task: newTask,
				order: (queueItems?.[queueItems?.length - 1]?.order ?? 0) + 1,
				isCompleted: false,
			}
			vscode.postMessage({
				type: "updateQueue",
				queueItems: [...queueItems, newQueueItem],
			})
			setNewTask("") // Clear input after adding
		}
	}

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				padding: "0 0px",
				display: "flex",
				flexDirection: "column",
			}}>
			<div
				style={{
					height: "100%",
					padding: "0 20px",
					overflow: "auto",
				}}>
				<h3 style={{ color: "var(--vscode-foreground)", margin: 0 }}>Cline Queue</h3>

				{/* Add new task form */}
				<div style={{ marginTop: "20px", marginBottom: "20px", display: "flex", gap: "10px" }}>
					<VSCodeTextField
						placeholder="Enter new task..."
						value={newTask}
						onInput={(e) => setNewTask((e.target as HTMLInputElement).value)}
						style={{ flexGrow: 1 }}
					/>
					<VSCodeButton onClick={handleAddTask}>Add</VSCodeButton>
				</div>

				{/* Queue items list */}
				<div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
					{queueItems.length > 0 ? (
						queueItems.map((item) => (
							<div
								key={item.order}
								style={{
									padding: "10px",
									border: "1px solid var(--vscode-editor-lineHighlightBorder)",
									borderRadius: "4px",
								}}>
								{item.task}
							</div>
						))
					) : (
						<p>No tasks in queue. Add a new task above.</p>
					)}
				</div>

				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>
		</div>
	)
}

export default QueueView
