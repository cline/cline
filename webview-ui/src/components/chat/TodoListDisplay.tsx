import { useState, useRef, useMemo, useEffect } from "react"

export function TodoListDisplay({ todos }: { todos: any[] }) {
	const [isCollapsed, setIsCollapsed] = useState(true)
	const ulRef = useRef<HTMLUListElement>(null)
	const itemRefs = useRef<(HTMLLIElement | null)[]>([])
	const scrollIndex = useMemo(() => {
		const inProgressIdx = todos.findIndex((todo: any) => todo.status === "in_progress")
		if (inProgressIdx !== -1) return inProgressIdx
		return todos.findIndex((todo: any) => todo.status !== "completed")
	}, [todos])

	// Find the most important todo to display when collapsed
	const mostImportantTodo = useMemo(() => {
		const inProgress = todos.find((todo: any) => todo.status === "in_progress")
		if (inProgress) return inProgress
		return todos.find((todo: any) => todo.status !== "completed")
	}, [todos])
	useEffect(() => {
		if (isCollapsed) return
		if (!ulRef.current) return
		if (scrollIndex === -1) return
		const target = itemRefs.current[scrollIndex]
		if (target && ulRef.current) {
			const ul = ulRef.current
			const targetTop = target.offsetTop - ul.offsetTop
			const targetHeight = target.offsetHeight
			const ulHeight = ul.clientHeight
			const scrollTo = targetTop - (ulHeight / 2 - targetHeight / 2)
			ul.scrollTop = scrollTo
		}
	}, [todos, isCollapsed, scrollIndex])
	if (!Array.isArray(todos) || todos.length === 0) return null

	const totalCount = todos.length
	const completedCount = todos.filter((todo: any) => todo.status === "completed").length

	const allCompleted = completedCount === totalCount && totalCount > 0

	// Create the status icon for the most important todo
	const getMostImportantTodoIcon = () => {
		if (allCompleted) {
			return (
				<span
					style={{
						display: "inline-block",
						width: 8,
						height: 8,
						borderRadius: "50%",
						background: "var(--vscode-charts-green)",
						marginRight: 8,
						marginLeft: 2,
						flexShrink: 0,
					}}
				/>
			)
		}

		if (!mostImportantTodo) {
			return (
				<span
					className="codicon codicon-checklist"
					style={{
						color: "var(--vscode-foreground)",
						marginRight: 8,
						marginLeft: 2,
						flexShrink: 0,
						fontSize: 14,
					}}
				/>
			)
		}

		if (mostImportantTodo.status === "completed") {
			return (
				<span
					style={{
						display: "inline-block",
						width: 8,
						height: 8,
						borderRadius: "50%",
						background: "var(--vscode-charts-green)",
						marginRight: 8,
						marginLeft: 2,
						flexShrink: 0,
					}}
				/>
			)
		}

		if (mostImportantTodo.status === "in_progress") {
			return (
				<span
					style={{
						display: "inline-block",
						width: 8,
						height: 8,
						borderRadius: "50%",
						background: "var(--vscode-charts-yellow)",
						marginRight: 8,
						marginLeft: 2,
						flexShrink: 0,
					}}
				/>
			)
		}

		// Default not-started todo
		return (
			<span
				style={{
					display: "inline-block",
					width: 8,
					height: 8,
					borderRadius: "50%",
					border: "1px solid var(--vscode-descriptionForeground)",
					background: "transparent",
					marginRight: 8,
					marginLeft: 2,
					flexShrink: 0,
				}}
			/>
		)
	}

	return (
		<div
			className="border border-t-0 rounded-b-xs relative"
			style={{
				margin: "0",
				padding: "6px 10px",
				background: "var(--vscode-editor-background,transparent)",
				borderColor: "var(--vscode-panel-border)",
			}}>
			<div
				style={{
					display: "flex",
					alignItems: "center",
					gap: 2,
					marginBottom: 0,
					cursor: "pointer",
					userSelect: "none",
				}}
				onClick={() => setIsCollapsed((v) => !v)}>
				{getMostImportantTodoIcon()}
				<span
					style={{
						fontWeight: 500,
						color: allCompleted
							? "var(--vscode-charts-green)"
							: mostImportantTodo?.status === "in_progress"
								? "var(--vscode-charts-yellow)"
								: "var(--vscode-foreground)",
						flex: 1,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}>
					{allCompleted ? "All tasks completed!" : mostImportantTodo?.content || "No pending tasks"}
				</span>
				<div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
					<span
						className="codicon codicon-checklist"
						style={{
							color: "var(--vscode-descriptionForeground)",
							fontSize: 12,
						}}
					/>
					<span
						style={{
							color: "var(--vscode-descriptionForeground)",
							fontSize: 12,
							fontWeight: 500,
						}}>
						{completedCount}/{totalCount}
					</span>
				</div>
			</div>
			{/* Floating panel for expanded state */}
			{!isCollapsed && (
				<>
					{/* Backdrop */}
					<div
						style={{
							position: "fixed",
							top: 0,
							left: 0,
							right: 0,
							bottom: 0,
							background: "rgba(0, 0, 0, 0.1)",
							zIndex: 1000,
						}}
						onClick={() => setIsCollapsed(true)}
					/>
					{/* Floating panel */}
					<div
						style={{
							position: "absolute",
							top: "100%",
							left: 0,
							right: 0,
							marginTop: 4,
							background: "var(--vscode-editor-background)",
							border: "1px solid var(--vscode-panel-border)",
							borderRadius: 6,
							boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
							zIndex: 1001,
							maxHeight: "400px",
							minHeight: "200px",
							overflow: "hidden",
						}}>
						{/* Panel header */}
						<div
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "space-between",
								padding: "12px 16px",
								borderBottom: "1px solid var(--vscode-panel-border)",
								background: "var(--vscode-editor-background)",
							}}>
							<div style={{ display: "flex", alignItems: "center", gap: 8 }}>
								<span
									className="codicon codicon-checklist"
									style={{ color: "var(--vscode-foreground)" }}
								/>
								<span style={{ fontWeight: "bold", fontSize: 14 }}>Todo List</span>
								<span
									style={{
										color: "var(--vscode-descriptionForeground)",
										fontSize: 13,
										fontWeight: 500,
									}}>
									{completedCount}/{totalCount}
								</span>
							</div>
							<span
								className="codicon codicon-chevron-up"
								style={{
									fontSize: 14,
									opacity: 0.7,
									cursor: "pointer",
									padding: "4px",
									borderRadius: "2px",
								}}
								onClick={(e) => {
									e.stopPropagation()
									setIsCollapsed(true)
								}}
								onMouseEnter={(e) => {
									e.currentTarget.style.opacity = "1"
									e.currentTarget.style.background = "var(--vscode-toolbar-hoverBackground)"
								}}
								onMouseLeave={(e) => {
									e.currentTarget.style.opacity = "0.7"
									e.currentTarget.style.background = "transparent"
								}}
							/>
						</div>
						{/* Todo list */}
						<ul
							ref={ulRef}
							style={{
								margin: 0,
								paddingLeft: 0,
								listStyle: "none",
								maxHeight: "340px",
								overflowY: "auto",
								padding: "12px 16px",
							}}>
							{todos.map((todo: any, idx: number) => {
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
												marginRight: 8,
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
												marginRight: 8,
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
												marginRight: 8,
												marginTop: 7,
												flexShrink: 0,
											}}
										/>
									)
								}
								return (
									<li
										key={todo.id || todo.content}
										ref={(el) => (itemRefs.current[idx] = el)}
										style={{
											marginBottom: 8,
											display: "flex",
											alignItems: "flex-start",
											minHeight: 20,
											lineHeight: "1.4",
										}}>
										{icon}
										<span
											style={{
												fontWeight: 500,
												color:
													todo.status === "completed"
														? "var(--vscode-charts-green)"
														: todo.status === "in_progress"
															? "var(--vscode-charts-yellow)"
															: "var(--vscode-foreground)",
												wordBreak: "break-word",
											}}>
											{todo.content}
										</span>
									</li>
								)
							})}
						</ul>
					</div>
				</>
			)}
		</div>
	)
}
