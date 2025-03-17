import { VSCodeButton, VSCodeCheckbox, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import { useState } from "react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import { vscode } from "../../utils/vscode"
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core"
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { sleep } from "../../utils/sleep"

type QueueViewProps = {
	onDone: () => void
}

// Define the shape of a queue item
interface QueueItem {
	task: string
	order: number
	isCompleted: boolean
}

// SortableItem component for drag and drop functionality
interface SortableItemProps {
	id: string
	item: QueueItem
	index: number
	onDelete: (index: number) => void
	onStart: (text: string, order: number, preTaskId?: string) => Promise<void>
	onClose: () => void
}

const SortableItem = ({ id, item, index, onDelete, onStart, onClose }: SortableItemProps) => {
	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
		backgroundColor: "var(--vscode-editor-background)",
		border: "1px solid var(--vscode-widget-border)",
		borderRadius: "4px",
		padding: "10px",
		marginBottom: "5px",
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		cursor: isDragging ? "grabbing" : "grab",
	}

	const handleStartAndClose = async (task: string, order: number, preTaskId?: string) => {
		await onStart(task, order, preTaskId)
		onClose()
	}

	return (
		<div ref={setNodeRef} style={style} {...attributes} {...listeners}>
			<div style={{ display: "flex", alignItems: "center", gap: "8px", flexGrow: 1 }}>
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<b>{item.order}.</b>
				</div>
				<div
					style={{
						flexGrow: 1,
						textDecoration: item.isCompleted ? "line-through" : "none",
						color: item.isCompleted ? "var(--vscode-disabledForeground)" : "var(--vscode-foreground)",
					}}>
					{item.task}
				</div>
			</div>
			<div style={{ display: "flex", gap: "5px" }}>
				<div
					style={{
						fontSize: "12px",
						color: "var(--vscode-descriptionForeground)",
						display: "flex",
						alignItems: "center",
						marginRight: "10px",
					}}>
					<svg
						width="16"
						height="16"
						viewBox="0 0 16 16"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						style={{ marginRight: "4px" }}>
						<path d="M7 2H9V14H7V2Z" fill="currentColor" />
						<path d="M2 7H14V9H2V7Z" fill="currentColor" />
					</svg>
					<span>Drag to reorder</span>
				</div>
				<VSCodeButton
					appearance="icon"
					onClick={(e) => {
						e.stopPropagation()
						onDelete(index)
					}}>
					<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
						<path
							d="M8 8.7L11.5 12.2L12.2 11.5L8.7 8L12.2 4.5L11.5 3.8L8 7.3L4.5 3.8L3.8 4.5L7.3 8L3.8 11.5L4.5 12.2L8 8.7Z"
							fill="currentColor"
						/>
					</svg>
				</VSCodeButton>
				{!item.isCompleted && (
					<VSCodeButton
						appearance="icon"
						onClick={(e) => {
							e.stopPropagation()
							handleStartAndClose(item.task, item.order)
						}}>
						<svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
							<path d="M4 3L12 8L4 13V3Z" fill="currentColor" />
						</svg>
					</VSCodeButton>
				)}
			</div>
		</div>
	)
}

const QueueView = ({ onDone }: QueueViewProps) => {
	const { queueItems, autoRunQueue } = useExtensionState()
	const [newTask, setNewTask] = useState("")

	// Set up sensors for drag and drop
	const sensors = useSensors(
		useSensor(PointerSensor, {
			activationConstraint: {
				distance: 5, // Minimum distance before drag starts
			},
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

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

	const handleDeleteTask = (index: number) => {
		// Filter out the item at the specified index
		const updatedQueueItems = queueItems.filter((_, itemIndex) => itemIndex !== index)

		// Send message to extension to update queue items
		vscode.postMessage({
			type: "updateQueue",
			queueItems: updatedQueueItems,
		})
	}

	const handleStartTask = async (text: string, order: number) => {
		if (order === 1) {
			vscode.postMessage({
				type: "newTask",
				text,
			})
		} else {
			vscode.postMessage({
				type: "askResponse",
				askResponse: "messageResponse",
				text,
			})
		}
		vscode.postMessage({
			type: "updateQueue",
			queueItems: queueItems.map((item) => (item.order === order ? { ...item, isCompleted: true } : item)),
		})
		await sleep(150)
	}

	const handleClear = () => {
		vscode.postMessage({
			type: "updateQueue",
			queueItems: [],
		})
		setNewTask("")
	}

	const handleStart = async () => {
		const nextTask = queueItems.find((item) => !item.isCompleted)
		if (nextTask) {
			if (nextTask?.order === 1) {
				vscode.postMessage({
					type: "newTask",
					text: nextTask.task,
				})
			} else {
				vscode.postMessage({
					type: "askResponse",
					askResponse: "messageResponse",
					text: nextTask.task,
				})
			}
			vscode.postMessage({
				type: "updateQueue",
				queueItems: queueItems.map((item) => (item.order === nextTask.order ? { ...item, isCompleted: true } : item)),
			})
			await sleep(150)
			onDone()
		}
	}

	// Handle drag end for reordering items
	const handleDragEnd = (event: DragEndEvent) => {
		try {
			const { active, over } = event

			// If no destination or the same position, do nothing
			if (!over || active.id === over.id) {
				return
			}

			// Find the indexes in the array
			const oldIndex = queueItems.findIndex((item) => item.order.toString() === active.id)
			const newIndex = queueItems.findIndex((item) => item.order.toString() === over.id)

			// Validate indexes
			if (oldIndex === -1 || newIndex === -1) {
				console.error("Invalid indexes in drag operation", { oldIndex, newIndex, active, over })
				return
			}

			// Create a new array with the moved item
			const newItems = arrayMove(queueItems, oldIndex, newIndex)

			// Update orders to match the new position
			const updatedItems = newItems.map((item, index) => ({
				...item,
				order: index + 1,
			}))

			// Send updated queue to the extension
			vscode.postMessage({
				type: "updateQueue",
				queueItems: updatedItems,
			})
		} catch (error) {
			console.error("Error in drag end handler:", error)
		}
	}

	// Handle key press for adding tasks
	const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			handleAddTask()
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

				{/* Add toggle for auto run queue */}
				<div style={{ marginTop: "20px", marginBottom: "20px", display: "flex", gap: "10px" }}>
					<VSCodeCheckbox
						checked={autoRunQueue}
						onChange={() => vscode.postMessage({ type: "setAutoRunQueue", autoRunQueue: !autoRunQueue })}>
						Auto run next item
					</VSCodeCheckbox>
				</div>
				{/* Add new task form */}
				<div style={{ marginTop: "20px", marginBottom: "20px", display: "flex", gap: "10px" }}>
					<VSCodeTextField
						placeholder="Enter new task..."
						value={newTask}
						onInput={(e) => setNewTask((e.target as HTMLInputElement).value)}
						onKeyPress={handleKeyPress}
						style={{ flexGrow: 1 }}
					/>
					<VSCodeButton onClick={handleAddTask}>Add</VSCodeButton>
				</div>

				{/* Queue items list with drag and drop */}
				<div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
					{queueItems.length > 0 ? (
						<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
							<SortableContext
								items={queueItems.map((item) => item.order.toString())}
								strategy={verticalListSortingStrategy}>
								<div style={{ display: "flex", flexDirection: "column" }}>
									{queueItems.map((item, index) => (
										<SortableItem
											key={item.order.toString()}
											id={item.order.toString()}
											item={item}
											index={index}
											onDelete={handleDeleteTask}
											onStart={handleStartTask}
											onClose={onDone}
										/>
									))}
								</div>
							</SortableContext>
						</DndContext>
					) : (
						<p style={{ color: "var(--vscode-descriptionForeground)", fontStyle: "italic" }}>
							No tasks in queue. Add a new task above.
						</p>
					)}
				</div>

				<div style={{ display: "flex", gap: "10px", marginBottom: "20px", justifyContent: "space-between" }}>
					<VSCodeButton onClick={handleStart} appearance="primary">
						Start
					</VSCodeButton>
					<div style={{ display: "flex", gap: "10px" }}>
						<VSCodeButton onClick={handleClear} appearance="secondary">
							Clear All
						</VSCodeButton>
						<VSCodeButton onClick={onDone}>Done</VSCodeButton>
					</div>
				</div>
			</div>
		</div>
	)
}

export default QueueView
