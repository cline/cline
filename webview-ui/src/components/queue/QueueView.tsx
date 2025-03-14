import {
	VSCodeButton,
	VSCodeTextField,
	VSCodeProgressRing,
	VSCodeDropdown,
	VSCodeOption,
	VSCodeCheckbox,
} from "@vscode/webview-ui-toolkit/react"
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

type QueueViewProps = {
	onDone: () => void
}

// Define the shape of a queue item
interface QueueItem {
	task: string
	order: number
	isCompleted: boolean
}

const QueueView = ({ onDone }: QueueViewProps) => {
	const { queueItems } = useExtensionState()
	const [newTask, setNewTask] = useState("")

	// Set up sensors for drag and drop
	const sensors = useSensors(
		useSensor(PointerSensor),
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

	// Handle delete task
	const handleDeleteTask = (orderToDelete: number) => {
		// Filter out the item with the specified order
		const updatedQueueItems = queueItems.filter((item) => item.order !== orderToDelete)

		// Send message to extension to update queue items
		vscode.postMessage({
			type: "updateQueue",
			queueItems: updatedQueueItems,
		})
	}

	// Handle drag end for reordering items
	const handleDragEnd = (event: DragEndEvent) => {
		const { active, over } = event

		// If no destination or the same position, do nothing
		if (!over || active.id === over.id) {
			return
		}

		// Find the indexes in the array
		const oldIndex = queueItems.findIndex((item) => item.order.toString() === active.id)
		const newIndex = queueItems.findIndex((item) => item.order.toString() === over.id)

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
	}

	// Sortable item component
	const SortableItem = ({ item, index }: { item: QueueItem; index: number }) => {
		const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
			id: item.order.toString(),
		})

		const style = {
			transform: CSS.Transform.toString(transform),
			transition,
			padding: "10px",
			border: "1px solid var(--vscode-editor-lineHighlightBorder)",
			borderRadius: "4px",
			display: "flex",
			justifyContent: "space-between",
			alignItems: "center",
			background: "var(--vscode-editor-background)",
		}

		return (
			<div ref={setNodeRef} style={style} {...attributes} {...listeners}>
				<div
					style={{
						display: "flex",
						alignItems: "center",
						gap: "8px",
						flexGrow: 1,
					}}>
					<span title="Drag to reorder" style={{ cursor: "grab", fontSize: "16px" }}>
						⋮⋮
					</span>
					<span
						style={{
							textDecoration: item.isCompleted ? "line-through" : "none",
							opacity: item.isCompleted ? 0.7 : 1,
						}}>
						{item.task}
					</span>
				</div>
				<div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
					<span style={{ fontSize: "12px", opacity: 0.7 }}>#{item.order}</span>
					<VSCodeButton
						appearance="icon"
						onClick={() => handleDeleteTask(item.order)}
						title="Delete task"
						aria-label="Delete task">
						<span style={{ fontSize: "16px" }}>❌</span>
					</VSCodeButton>
				</div>
			</div>
		)
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

				{/* Queue items list with drag and drop */}
				<div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "20px" }}>
					{queueItems.length > 0 ? (
						<DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
							<SortableContext
								items={queueItems.map((item) => item.order.toString())}
								strategy={verticalListSortingStrategy}>
								<div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
									{queueItems.map((item, index) => (
										<SortableItem key={item.order.toString()} item={item} index={index} />
									))}
								</div>
							</SortableContext>
						</DndContext>
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
