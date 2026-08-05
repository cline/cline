import React, { useCallback, useEffect, useRef } from "react"
import ScreenReaderAnnounce from "@/components/common/ScreenReaderAnnounce"
import { useMenuAnnouncement } from "@/hooks/useMenuAnnouncement"
import { backendColor } from "@/utils/multichatColors"

export interface BackendMenuItem {
	name: string
	isCurrent: boolean
	summary?: string
}

interface BackendPickerMenuProps {
	items: BackendMenuItem[]
	onSelect: (name: string) => void
	selectedIndex: number
	setSelectedIndex: (index: number) => void
	onMouseDown: () => void
}

/**
 * Multichat: Tab-triggered picker (see ChatTextArea's showBackendMenu) listing
 * every configured backend, color-swatched to match the colors ChatRow uses to
 * badge each backend's responses. Selecting one inserts its addressing prefix
 * ("<name>, ") so SdkMultichatCoordinator's trigger detection picks it up.
 */
const BackendPickerMenu: React.FC<BackendPickerMenuProps> = ({
	items,
	onSelect,
	selectedIndex,
	setSelectedIndex,
	onMouseDown,
}) => {
	const menuRef = useRef<HTMLDivElement>(null)

	const getItemLabel = useCallback((item: BackendMenuItem) => `${item.name}${item.isCurrent ? " (current)" : ""}`, [])
	const { announcement } = useMenuAnnouncement({ items, selectedIndex, getItemLabel })

	useEffect(() => {
		if (!menuRef.current) {
			return
		}
		const selectedElement = menuRef.current.querySelector(`#backend-menu-item-${selectedIndex}`) as HTMLElement | null
		if (!selectedElement) {
			return
		}
		const menuRect = menuRef.current.getBoundingClientRect()
		const selectedRect = selectedElement.getBoundingClientRect()
		if (selectedRect.bottom > menuRect.bottom) {
			menuRef.current.scrollTop += selectedRect.bottom - menuRect.bottom
		} else if (selectedRect.top < menuRect.top) {
			menuRef.current.scrollTop -= menuRect.top - selectedRect.top
		}
	}, [selectedIndex])

	return (
		<div
			className="absolute bottom-[calc(100%-10px)] left-[15px] right-[15px] overflow-x-hidden z-1000"
			data-testid="backend-picker-menu"
			onMouseDown={onMouseDown}>
			<ScreenReaderAnnounce message={announcement} />
			<div
				aria-activedescendant={items.length > 0 ? `backend-menu-item-${selectedIndex}` : undefined}
				aria-label="Multichat backends"
				className="bg-(--vscode-dropdown-background) border border-(--vscode-editorGroup-border) rounded-[3px] shadow-[0_4px_10px_rgba(0,0,0,0.25)] flex flex-col overflow-y-auto"
				ref={menuRef}
				role="listbox"
				style={{ maxHeight: "min(200px, calc(50vh))", overscrollBehavior: "contain" }}>
				<div
					className="text-xs text-(--vscode-descriptionForeground) px-3 py-1 font-bold border-b border-(--vscode-editorGroup-border)"
					role="presentation">
					Switch backend
				</div>
				{items.length > 0 ? (
					items.map((item, index) => {
						const color = backendColor(item.name)
						return (
							<div
								aria-selected={index === selectedIndex}
								className={`py-2 px-3 cursor-pointer flex items-center gap-2 border-b border-(--vscode-editorGroup-border) ${
									index === selectedIndex
										? "bg-(--vscode-quickInputList-focusBackground) text-(--vscode-quickInputList-focusForeground)"
										: ""
								} hover:bg-(--vscode-list-hoverBackground)`}
								id={`backend-menu-item-${index}`}
								key={item.name}
								onClick={() => onSelect(item.name)}
								onMouseEnter={() => setSelectedIndex(index)}
								role="option">
								<span
									className="inline-block size-2.5 rounded-full shrink-0"
									style={{ backgroundColor: color }}
								/>
								<div className="min-w-0">
									<div className="font-bold whitespace-nowrap overflow-hidden text-ellipsis">
										<span className="ph-no-capture">{item.name}</span>
										{item.isCurrent && (
											<span className="ml-1 font-normal text-(--vscode-descriptionForeground)">
												(current)
											</span>
										)}
									</div>
									{item.summary && (
										<div className="text-[0.85em] text-(--vscode-descriptionForeground) whitespace-nowrap overflow-hidden text-ellipsis">
											<span className="ph-no-capture">{item.summary}</span>
										</div>
									)}
								</div>
							</div>
						)
					})
				) : (
					<div aria-selected="false" className="py-2 px-3 cursor-default flex flex-col" role="option">
						<div className="text-[0.85em] text-(--vscode-descriptionForeground)">
							No named backends configured yet — add one in Settings.
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

export default BackendPickerMenu
