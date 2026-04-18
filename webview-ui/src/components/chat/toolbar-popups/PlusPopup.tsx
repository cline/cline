import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import styled, { keyframes } from "styled-components"
import { ACTION_METADATA, NOTIFICATIONS_SETTING } from "@/components/chat/auto-approve-menu/constants"
import { useAutoApproveActions } from "@/hooks/useAutoApproveActions"

// ─── Animation ────────────────────────────────────────────────────────────────
const popupAppear = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`

// ─── Styled Components ────────────────────────────────────────────────────────
const PopupWrapper = styled.div`
	position: absolute;
	bottom: calc(100% + 8px);
	left: 0;
	width: 230px;
	background: var(--popup-bg);
	border: var(--popup-border);
	border-radius: var(--popup-radius, 10px);
	overflow: hidden;
	z-index: 200;
	animation: ${popupAppear} var(--popup-appear-duration, 0.18s) ease forwards;
	box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.4));
`

const PopupItem = styled.div<{ $active?: boolean }>`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: var(--popup-item-padding, 7px 11px);
	cursor: pointer;
	border-bottom: var(--popup-item-separator);
	transition: background 0.12s;
	background: ${(p) => (p.$active ? "var(--popup-item-hover-bg)" : "transparent")};

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background: var(--popup-item-hover-bg);
	}
`

const ItemIcon = styled.div`
	width: 14px;
	height: 14px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	opacity: var(--popup-icon-opacity, 0.6);
	color: var(--popup-icon-stroke);
	font-size: 13px;
`

const ItemLabel = styled.span`
	color: var(--popup-text-primary);
	font-size: var(--popup-font-size, var(--vscode-font-size, 11px));
	flex: 1;
`

const ItemShortcut = styled.span`
	color: var(--popup-shortcut-color);
	font-size: 9px;
	background: var(--popup-shortcut-bg);
	border-radius: 3px;
	padding: 1px 5px;
`

const ChevronIcon = styled.i<{ $open: boolean }>`
	flex-shrink: 0;
	font-size: 12px;
	opacity: 0.5;
	color: var(--popup-text-muted);
	transition: transform 0.2s;
	transform: rotate(${(p) => (p.$open ? "180deg" : "0deg")});
`

// Auto-approve accordion
const AccordionContent = styled.div<{ $open: boolean }>`
	overflow: hidden;
	max-height: ${(p) => (p.$open ? "600px" : "0")};
	transition: max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1);
	background: var(--popup-sub-bg);
`

const AaParentRow = styled.div`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 7px 11px;
	border-bottom: var(--popup-sub-separator);
	cursor: pointer;
	transition: background 0.12s;

	&:hover {
		background: var(--popup-sub-hover);
	}
`

const AaParentIcon = styled.div`
	width: 14px;
	height: 14px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	opacity: 0.5;
	color: var(--popup-icon-stroke);
	font-size: 12px;
`

const AaLabel = styled.span`
	color: var(--popup-text-primary);
	font-size: var(--popup-font-size, var(--vscode-font-size, 11px));
	flex: 1;
`

const AaChildRow = styled.div`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 6px 11px 6px 30px;
	border-bottom: var(--popup-sub-separator);
	cursor: pointer;
	transition: background 0.12s;

	&:hover {
		background: var(--popup-sub-hover);
	}
`

const AaChildLabel = styled.span`
	color: var(--popup-text-child);
	font-size: var(--popup-font-size, var(--vscode-font-size, 11px));
	flex: 1;
`

const NotifRow = styled.div`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 7px 11px;
	border-top: var(--popup-sub-separator);
`

const NotifLabel = styled.span`
	color: var(--popup-text-primary);
	font-size: var(--popup-font-size, var(--vscode-font-size, 11px));
	flex: 1;
`

// Custom Toggle
const ToggleWrapper = styled.div<{ $on: boolean }>`
	position: relative;
	width: var(--toggle-width, 28px);
	height: var(--toggle-height, 16px);
	flex-shrink: 0;
	cursor: pointer;
`

const ToggleTrack = styled.div<{ $on: boolean }>`
	position: absolute;
	inset: 0;
	background: ${(p) => (p.$on ? "var(--toggle-on-bg)" : "var(--toggle-off-bg)")};
	border-radius: 8px;
	transition: background 0.2s;
`

const ToggleThumb = styled.div<{ $on: boolean }>`
	position: absolute;
	top: 2.5px;
	left: ${(p) => (p.$on ? "14.5px" : "2.5px")};
	width: var(--toggle-thumb-size, 11px);
	height: var(--toggle-thumb-size, 11px);
	background: ${(p) => (p.$on ? "var(--toggle-thumb-on-color)" : "var(--toggle-thumb-off-color)")};
	border-radius: 50%;
	transition:
		left 0.2s,
		background 0.2s;
	pointer-events: none;
`

// ─── Toggle Component ─────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (e: React.MouseEvent) => void }) => (
	<ToggleWrapper $on={checked} onClick={onChange}>
		<ToggleTrack $on={checked} />
		<ToggleThumb $on={checked} />
	</ToggleWrapper>
)

// ─── Main Component ───────────────────────────────────────────────────────────
interface PlusPopupProps {
	isOpen: boolean
	onClose: () => void
	onAddContext: () => void
	onAddFilesAndImages: () => void
	anchorRef: React.RefObject<HTMLElement | null>
}

const PlusPopup: React.FC<PlusPopupProps> = ({ isOpen, onClose, onAddContext, onAddFilesAndImages }) => {
	const [aaOpen, setAaOpen] = useState(true) // expanded by default
	const popupRef = useRef<HTMLDivElement>(null)

	const { isChecked, updateAction, updateNotifications } = useAutoApproveActions()

	// Close on outside click
	useEffect(() => {
		if (!isOpen) return
		const handleClick = (e: MouseEvent) => {
			if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
				onClose()
			}
		}
		document.addEventListener("mousedown", handleClick)
		return () => document.removeEventListener("mousedown", handleClick)
	}, [isOpen, onClose])

	const handleAddContext = useCallback(() => {
		onClose()
		onAddContext()
	}, [onClose, onAddContext])

	const handleAddFiles = useCallback(() => {
		onClose()
		onAddFilesAndImages()
	}, [onClose, onAddFilesAndImages])

	if (!isOpen) return null

	return (
		<PopupWrapper ref={popupRef}>
			{/* Add context */}
			<PopupItem onClick={handleAddContext}>
				<ItemIcon>
					<i aria-hidden="true" className="codicon codicon-mention" />
				</ItemIcon>
				<ItemLabel>Add context</ItemLabel>
				<ItemShortcut>@</ItemShortcut>
			</PopupItem>

			{/* Add files & images */}
			<PopupItem onClick={handleAddFiles}>
				<ItemIcon>
					<i aria-hidden="true" className="codicon codicon-file-add" />
				</ItemIcon>
				<ItemLabel>Add files &amp; images</ItemLabel>
			</PopupItem>

			{/* Auto-approve header */}
			<PopupItem $active={aaOpen} onClick={() => setAaOpen((v) => !v)}>
				<ItemIcon>
					<i aria-hidden="true" className="codicon codicon-shield" />
				</ItemIcon>
				<ItemLabel>Auto-approve</ItemLabel>
				<ChevronIcon $open={aaOpen} aria-hidden="true" className="codicon codicon-chevron-down" />
			</PopupItem>

			{/* Auto-approve accordion */}
			<AccordionContent $open={aaOpen}>
				{ACTION_METADATA.map((action) => {
					const enabled = isChecked(action)
					return (
						<div key={action.id}>
							<AaParentRow
								onClick={() =>
									updateAction(action, !enabled).catch((e) => console.error("Auto-approve toggle error:", e))
								}>
								<AaParentIcon>
									<i aria-hidden="true" className={`codicon ${action.icon}`} />
								</AaParentIcon>
								<AaLabel>{action.label}</AaLabel>
								<Toggle
									checked={enabled}
									onChange={(e) => {
										e.stopPropagation()
										updateAction(action, !enabled).catch((err) =>
											console.error("Auto-approve toggle error:", err),
										)
									}}
								/>
							</AaParentRow>
							{action.subAction && (
								<AaChildRow
									key={action.subAction.id}
									onClick={() => {
										const subEnabled = isChecked(action.subAction!)
										updateAction(action.subAction!, !subEnabled).catch((e) =>
											console.error("Sub-action toggle error:", e),
										)
									}}>
									<AaChildLabel>{action.subAction.label}</AaChildLabel>
									<Toggle
										checked={isChecked(action.subAction)}
										onChange={(e) => {
											e.stopPropagation()
											const subEnabled = isChecked(action.subAction!)
											updateAction(action.subAction!, !subEnabled).catch((err) =>
												console.error("Sub-action toggle error:", err),
											)
										}}
									/>
								</AaChildRow>
							)}
						</div>
					)
				})}
				<NotifRow>
					<NotifLabel>{NOTIFICATIONS_SETTING.label}</NotifLabel>
					<Toggle
						checked={isChecked(NOTIFICATIONS_SETTING)}
						onChange={(e) => {
							e.stopPropagation()
							const current = isChecked(NOTIFICATIONS_SETTING)
							updateNotifications(NOTIFICATIONS_SETTING, !current).catch((err) =>
								console.error("Notifications toggle error:", err),
							)
						}}
					/>
				</NotifRow>
			</AccordionContent>
		</PopupWrapper>
	)
}

export default PlusPopup
