import React, { useState, useEffect, useRef } from "react"
import { ToolUseBlock, ToolUseBlockHeader } from "../common/ToolUseBlock"
import MarkdownBlock from "../common/MarkdownBlock"

interface TodoItem {
	id?: string
	content: string
	status?: "completed" | "in_progress" | string
}

/**
 * @description
 * Editable Todo List component. Each time the todo list changes (edit, add, delete, status switch), the parent component will be notified via the onChange callback.
 * The parent component should synchronize the latest todos to the model in onChange.
 */
interface UpdateTodoListToolBlockProps {
	todos?: TodoItem[]
	content?: string
	/**
	 * Callback when todos change, be sure to implement and notify the model with the latest todos
	 * @param todos Latest todo list
	 */
	onChange: (todos: TodoItem[]) => void
	/** Whether editing is allowed (controlled externally) */
	editable?: boolean
	userEdited?: boolean
}

const STATUS_OPTIONS = [
	{ value: "", label: "Not Started", color: "var(--vscode-foreground)", border: "#bbb", bg: "transparent" },
	{
		value: "in_progress",
		label: "In Progress",
		color: "var(--vscode-charts-yellow)",
		border: "var(--vscode-charts-yellow)",
		bg: "rgba(255, 221, 51, 0.15)",
	},
	{
		value: "completed",
		label: "Completed",
		color: "var(--vscode-charts-green)",
		border: "var(--vscode-charts-green)",
		bg: "var(--vscode-charts-green)",
	},
]

const genId = () => Math.random().toString(36).slice(2, 10)

const UpdateTodoListToolBlock: React.FC<UpdateTodoListToolBlockProps> = ({
	todos = [],
	content,
	onChange,
	editable = true,
	userEdited = false,
}) => {
	const [editTodos, setEditTodos] = useState<TodoItem[]>(
		todos.length > 0 ? todos.map((todo) => ({ ...todo, id: todo.id || genId() })) : [],
	)
	const [adding, setAdding] = useState(false)
	const [newContent, setNewContent] = useState("")
	const newInputRef = useRef<HTMLInputElement>(null)
	const [deleteId, setDeleteId] = useState<string | null>(null)
	const [isEditing, setIsEditing] = useState(false)

	// Automatically exit edit mode when external editable becomes false
	useEffect(() => {
		if (!editable && isEditing) {
			setIsEditing(false)
		}
	}, [editable, isEditing])

	// Check if onChange is passed
	useEffect(() => {
		if (typeof onChange !== "function") {
			console.warn(
				"UpdateTodoListToolBlock: onChange callback not passed, cannot notify model after todo changes!",
			)
		}
		// Only check once on mount
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// Sync when external props.todos changes
	useEffect(() => {
		setEditTodos(todos.length > 0 ? todos.map((todo) => ({ ...todo, id: todo.id || genId() })) : [])
	}, [todos])

	// Auto focus on new item
	useEffect(() => {
		if (adding && newInputRef.current) {
			newInputRef.current.focus()
		}
	}, [adding])

	// Edit content
	const handleContentChange = (id: string, value: string) => {
		const newTodos = editTodos.map((todo) => (todo.id === id ? { ...todo, content: value } : todo))
		setEditTodos(newTodos)
		onChange?.(newTodos)
	}

	// Change status
	const handleStatusChange = (id: string, status: string) => {
		const newTodos = editTodos.map((todo) => (todo.id === id ? { ...todo, status } : todo))
		setEditTodos(newTodos)
		onChange?.(newTodos)
	}

	// Delete (confirmation dialog)
	const handleDelete = (id: string) => {
		setDeleteId(id)
	}
	const confirmDelete = () => {
		if (!deleteId) return
		const newTodos = editTodos.filter((todo) => todo.id !== deleteId)
		setEditTodos(newTodos)
		onChange?.(newTodos)
		setDeleteId(null)
	}
	const cancelDelete = () => setDeleteId(null)

	// Add
	const handleAdd = () => {
		if (!newContent.trim()) return
		const newTodo: TodoItem = {
			id: genId(),
			content: newContent.trim(),
			status: "",
		}
		const newTodos = [...editTodos, newTodo]
		setEditTodos(newTodos)
		onChange?.(newTodos)
		setNewContent("")
		setAdding(false)
	}

	// Add on Enter
	const handleNewInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Enter") {
			handleAdd()
		} else if (e.key === "Escape") {
			setAdding(false)
			setNewContent("")
		}
	}

	if (userEdited) {
		return (
			<ToolUseBlock>
				<ToolUseBlockHeader>
					<div className="flex items-center w-full" style={{ width: "100%" }}>
						<span
							className="codicon codicon-feedback mr-1.5"
							style={{ color: "var(--vscode-charts-yellow)" }}
						/>
						<span className="font-bold mr-2" style={{ fontWeight: "bold" }}>
							User Edit
						</span>
						<div className="flex-grow" />
					</div>
				</ToolUseBlockHeader>
				<div className="overflow-x-auto max-w-full" style={{ padding: "12px 0 8px 0" }}>
					<span className="text-vscode-descriptionForeground">User Edits</span>
				</div>
			</ToolUseBlock>
		)
	}

	return (
		<>
			<ToolUseBlock>
				<ToolUseBlockHeader>
					<div className="flex items-center w-full" style={{ width: "100%" }}>
						<span
							className="codicon codicon-checklist mr-1.5"
							style={{ color: "var(--vscode-foreground)" }}
						/>
						<span className="font-bold mr-2" style={{ fontWeight: "bold" }}>
							Todo List Updated
						</span>
						<div className="flex-grow" />
						{editable && (
							<button
								onClick={() => setIsEditing(!isEditing)}
								style={{
									border: isEditing
										? "1px solid var(--vscode-button-border)"
										: "1px solid var(--vscode-button-secondaryBorder)",
									background: isEditing
										? "var(--vscode-button-background)"
										: "var(--vscode-button-secondaryBackground)",
									color: isEditing
										? "var(--vscode-button-foreground)"
										: "var(--vscode-button-secondaryForeground)",
									borderRadius: 4,
									padding: "2px 8px",
									cursor: "pointer",
									fontSize: 13,
									marginLeft: 8,
								}}>
								{isEditing ? "Done" : "Edit"}
							</button>
						)}
					</div>
				</ToolUseBlockHeader>
				<div className="overflow-x-auto max-w-full" style={{ padding: "6px 0 2px 0" }}>
					{Array.isArray(editTodos) && editTodos.length > 0 ? (
						<ul style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
							{editTodos.map((todo, idx) => {
								let icon
								if (todo.status === "completed") {
									icon = (
										<span
											style={{
												display: "inline-block",
												width: 8,
												height: 8,
												borderRadius: "50%",
												background: "var(--vscode-charts-green)",
												marginRight: 6,
												marginTop: 7,
												flexShrink: 0,
											}}
										/>
									)
								} else if (todo.status === "in_progress") {
									icon = (
										<span
											style={{
												display: "inline-block",
												width: 8,
												height: 8,
												borderRadius: "50%",
												background: "var(--vscode-charts-yellow)",
												marginRight: 6,
												marginTop: 7,
												flexShrink: 0,
											}}
										/>
									)
								} else {
									icon = (
										<span
											style={{
												display: "inline-block",
												width: 8,
												height: 8,
												borderRadius: "50%",
												border: "1px solid var(--vscode-descriptionForeground)",
												background: "transparent",
												marginRight: 6,
												marginTop: 7,
												flexShrink: 0,
											}}
										/>
									)
								}
								return (
									<li
										key={todo.id || idx}
										style={{
											marginBottom: 2,
											display: "flex",
											alignItems: "flex-start",
											minHeight: 20,
										}}>
										{icon}
										{isEditing ? (
											<input
												type="text"
												value={todo.content}
												placeholder="Enter todo item"
												onChange={(e) => handleContentChange(todo.id!, e.target.value)}
												style={{
													flex: 1,
													minWidth: 0,
													fontWeight: 500,
													color: "var(--vscode-input-foreground)",
													background: "var(--vscode-input-background)",
													border: "none",
													outline: "none",
													fontSize: 13,
													marginRight: 6,
													padding: "1px 3px",
													borderBottom: "1px solid var(--vscode-input-border)",
												}}
												onBlur={(e) => {
													if (!e.target.value.trim()) {
														handleDelete(todo.id!)
													}
												}}
											/>
										) : (
											<span
												style={{
													flex: 1,
													minWidth: 0,
													fontWeight: 500,
													color:
														todo.status === "completed"
															? "var(--vscode-charts-green)"
															: todo.status === "in_progress"
																? "var(--vscode-charts-yellow)"
																: "var(--vscode-foreground)",
													fontSize: 13,
													marginRight: 6,
													padding: "1px 3px",
													lineHeight: "1.4",
												}}>
												{todo.content}
											</span>
										)}
										{isEditing && (
											<select
												value={todo.status || ""}
												onChange={(e) => handleStatusChange(todo.id!, e.target.value)}
												style={{
													marginRight: 6,
													borderRadius: 4,
													border: "1px solid var(--vscode-input-border)",
													background: "var(--vscode-input-background)",
													color: "var(--vscode-input-foreground)",
													fontSize: 12,
													padding: "1px 4px",
												}}>
												{STATUS_OPTIONS.map((opt) => (
													<option key={opt.value} value={opt.value}>
														{opt.label}
													</option>
												))}
											</select>
										)}
										{isEditing && (
											<button
												onClick={() => handleDelete(todo.id!)}
												style={{
													border: "none",
													background: "transparent",
													color: "#f14c4c",
													cursor: "pointer",
													fontSize: 14,
													marginLeft: 2,
													padding: 0,
													lineHeight: 1,
												}}
												title="Remove">
												×
											</button>
										)}
									</li>
								)
							})}
							{adding ? (
								<li style={{ marginTop: 2, display: "flex", alignItems: "center" }}>
									<span style={{ width: 14, marginRight: 6 }} />
									<input
										ref={newInputRef}
										type="text"
										value={newContent}
										placeholder="Enter todo item, press Enter to add"
										onChange={(e) => setNewContent(e.target.value)}
										onKeyDown={handleNewInputKeyDown}
										style={{
											flex: 1,
											minWidth: 0,
											fontWeight: 500,
											color: "var(--vscode-foreground)",
											background: "transparent",
											border: "none",
											outline: "none",
											fontSize: 13,
											marginRight: 6,
											padding: "1px 3px",
											borderBottom: "1px solid #eee",
										}}
									/>
									<button
										onClick={handleAdd}
										disabled={!newContent.trim()}
										style={{
											border: "1px solid var(--vscode-button-border)",
											background: "var(--vscode-button-background)",
											color: "var(--vscode-button-foreground)",
											borderRadius: 4,
											padding: "1px 7px",
											cursor: newContent.trim() ? "pointer" : "not-allowed",
											fontSize: 12,
											marginRight: 4,
										}}>
										Add
									</button>
									<button
										onClick={() => {
											setAdding(false)
											setNewContent("")
										}}
										style={{
											border: "1px solid var(--vscode-button-secondaryBorder)",
											background: "var(--vscode-button-secondaryBackground)",
											color: "var(--vscode-button-secondaryForeground)",
											borderRadius: 4,
											padding: "1px 7px",
											cursor: "pointer",
											fontSize: 12,
										}}>
										Cancel
									</button>
								</li>
							) : (
								<li style={{ marginTop: 2 }}>
									{isEditing && (
										<button
											onClick={() => setAdding(true)}
											style={{
												border: "1px dashed var(--vscode-button-secondaryBorder)",
												background: "var(--vscode-button-secondaryBackground)",
												color: "var(--vscode-button-secondaryForeground)",
												borderRadius: 4,
												padding: "1px 8px",
												cursor: "pointer",
												fontSize: 12,
											}}>
											+ Add Todo
										</button>
									)}
								</li>
							)}
						</ul>
					) : (
						<MarkdownBlock markdown={content} />
					)}
				</div>
				{/* Delete confirmation dialog */}
				{deleteId && (
					<div
						style={{
							position: "fixed",
							left: 0,
							top: 0,
							right: 0,
							bottom: 0,
							background: "rgba(0,0,0,0.15)",
							zIndex: 9999,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
						}}
						onClick={cancelDelete}>
						<div
							style={{
								background: "#fff",
								borderRadius: 8,
								boxShadow: "0 2px 16px rgba(0,0,0,0.15)",
								padding: "16px 20px",
								minWidth: 200,
								zIndex: 10000,
							}}
							onClick={(e) => e.stopPropagation()}>
							<div style={{ marginBottom: 12, fontSize: 14, color: "#333" }}>
								Are you sure you want to delete this todo item?
							</div>
							<div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
								<button
									onClick={cancelDelete}
									style={{
										border: "1px solid #bbb",
										background: "transparent",
										color: "#888",
										borderRadius: 4,
										padding: "2px 10px",
										cursor: "pointer",
										fontSize: 12,
									}}>
									Cancel
								</button>
								<button
									onClick={confirmDelete}
									style={{
										border: "1px solid #f14c4c",
										background: "#f14c4c",
										color: "#fff",
										borderRadius: 4,
										padding: "2px 10px",
										cursor: "pointer",
										fontSize: 12,
									}}>
									Delete
								</button>
							</div>
						</div>
					</div>
				)}
			</ToolUseBlock>
		</>
	)
}

export default UpdateTodoListToolBlock
