import { useRef, useCallback, useEffect, useMemo } from "react"
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react"
import { useExtensionState } from "../../context/ExtensionStateContext"
import {
	MemoryBankContextMenuOptionType,
	MemoryBankContextMenuQueryItem,
	memoryBankContextMenuOptions,
} from "../../utils/context-MemoryBank"
import { vscode } from "../../utils/vscode"

interface ContextMenuProps {
	onSelect: (type: MemoryBankContextMenuOptionType, value?: string) => void
	onMouseDown: () => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	selectedType: MemoryBankContextMenuOptionType | null
}

const MemoryBankContextMenu: React.FC<ContextMenuProps> = ({
	onSelect,
	onMouseDown,
	selectedIndex,
	setSelectedIndex,
	selectedType,
}) => {
	const menuRef = useRef<HTMLDivElement>(null)

	const filteredOptions = useMemo(() => memoryBankContextMenuOptions, [])

	const { memoryBankSettings } = useExtensionState()

	const updateEnabled = useCallback(
		(enabled: boolean) => {
			vscode.postMessage({
				type: "memoryBankSettings",
				memoryBankSettings: {
					...memoryBankSettings,
					enabled,
				},
			})
		},
		[memoryBankSettings],
	)

	useEffect(() => {
		if (menuRef.current) {
			const selectedElement = menuRef.current.children[selectedIndex + 1] as HTMLElement
			if (selectedElement) {
				const menuRect = menuRef.current.getBoundingClientRect()
				const selectedRect = selectedElement.getBoundingClientRect()

				if (selectedRect.bottom > menuRect.bottom) {
					menuRef.current.scrollTop += selectedRect.bottom - menuRect.bottom
				} else if (selectedRect.top < menuRect.top) {
					menuRef.current.scrollTop -= menuRect.top - selectedRect.top
				}
			}
		}
	}, [selectedIndex])

	const renderOptionContent = (option: MemoryBankContextMenuQueryItem) => {
		switch (option.type) {
			case MemoryBankContextMenuOptionType.Initialize:
				return <span>Initialize Memory Bank</span>
			case MemoryBankContextMenuOptionType.Update:
				return <span>Update Memory Bank</span>
			case MemoryBankContextMenuOptionType.Follow:
				return <span>Follow your custom instructions</span>
		}
	}

	const getIconForOption = (option: MemoryBankContextMenuQueryItem): string => {
		switch (option.type) {
			case MemoryBankContextMenuOptionType.Initialize:
				return "files"
			case MemoryBankContextMenuOptionType.Update:
				return "sync"
			case MemoryBankContextMenuOptionType.Follow:
				return "go-to-file"
			default:
				return "blank"
		}
	}

	return (
		<div
			style={{
				position: "absolute",
				bottom: "calc(100% - 10px)",
				left: 15,
				right: 15,
				overflowX: "hidden",
			}}
			onMouseDown={onMouseDown}>
			<div
				ref={menuRef}
				style={{
					backgroundColor: "var(--vscode-dropdown-background)",
					border: "1px solid var(--vscode-editorGroup-border)",
					borderRadius: "3px",
					boxShadow: "0 4px 10px rgba(0, 0, 0, 0.25)",
					zIndex: 1000,
					display: "flex",
					flexDirection: "column",
					maxHeight: "200px",
					overflowY: "auto",
				}}>
				<div
					style={{
						padding: "8px 12px",
						borderBottom: "1px solid var(--vscode-editorGroup-border)",
						display: "flex",
						alignItems: "center",
						backgroundColor: "transparent",
					}}>
					<VSCodeCheckbox
						checked={memoryBankSettings.enabled}
						onChange={(e) => {
							const checked = (e.target as HTMLInputElement).checked
							updateEnabled(checked)
						}}
						title="Enable Memory Bank"
						aria-label="Enable Memory Bank"
						style={{ marginRight: "8px" }}
					/>
					<span>Enable Memory Bank</span>
				</div>
				{filteredOptions.map((option: MemoryBankContextMenuQueryItem, index: number) => (
					<div
						key={`${option.type}-${index}`}
						onClick={() => {
							if (!memoryBankSettings.enabled) return
							onSelect(option.type)
						}}
						style={{
							padding: "8px 12px",
							cursor: memoryBankSettings.enabled ? "default" : "not-allowed",
							color: !memoryBankSettings.enabled
								? "var(--vscode-disabledForeground)"
								: index === selectedIndex
									? "var(--vscode-quickInputList-focusForeground)"
									: "var(--vscode-foreground)",
							borderBottom: "1px solid var(--vscode-editorGroup-border)",
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							backgroundColor: index === selectedIndex ? "var(--vscode-quickInputList-focusBackground)" : "",
							pointerEvents: memoryBankSettings.enabled ? "auto" : "none",
						}}
						onMouseEnter={() => setSelectedIndex(index)}>
						<div
							style={{
								display: "flex",
								alignItems: "center",
								flex: 1,
								minWidth: 0,
								overflow: "hidden",
							}}>
							<i
								className={`codicon codicon-${getIconForOption(option)}`}
								style={{
									marginRight: "8px",
									flexShrink: 0,
									fontSize: "14px",
								}}
							/>
							{renderOptionContent(option)}
						</div>
						{(option.type === MemoryBankContextMenuOptionType.Initialize ||
							option.type === MemoryBankContextMenuOptionType.Update ||
							option.type === MemoryBankContextMenuOptionType.Follow) && (
							<i
								className="codicon codicon-comment"
								style={{
									fontSize: "14px",
									flexShrink: 0,
									marginLeft: 8,
								}}
							/>
						)}
					</div>
				))}
			</div>
		</div>
	)
}

export default MemoryBankContextMenu
