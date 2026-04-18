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
	background: var(--popup-bg, #1c1c1c);
	border: var(--popup-border, 0.5px solid #333);
	border-radius: var(--popup-radius, 10px);
	overflow: hidden;
	z-index: 200;
	animation: ${popupAppear} var(--popup-appear-duration, 0.18s) ease forwards;
	box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
`

const PopupItem = styled.div<{ $active?: boolean }>`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: var(--popup-item-padding, 7px 11px);
	cursor: pointer;
	border-bottom: var(--popup-item-separator, 0.5px solid #222);
	transition: background 0.12s;
	background: ${(p) => (p.$active ? "var(--popup-item-hover-bg, #242424)" : "transparent")};

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background: var(--popup-item-hover-bg, #242424);
	}
`

const ItemIcon = styled.div`
	width: 14px;
	height: 14px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	opacity: var(--popup-icon-opacity, 0.55);
	color: var(--popup-icon-stroke, #aaa);
`

const ItemLabel = styled.span`
	color: var(--popup-text-primary, #ccc);
	font-size: var(--popup-font-size, 10.5px);
	flex: 1;
`

const ItemShortcut = styled.span`
	color: var(--popup-text-meta, #444);
	font-size: 9px;
	background: #252525;
	border-radius: 3px;
	padding: 1px 5px;
`

const ChevronIcon = styled.svg<{ $open: boolean }>`
	width: 12px;
	height: 12px;
	flex-shrink: 0;
	transition: transform 0.2s;
	transform: rotate(${(p) => (p.$open ? "180deg" : "0deg")});
`

// Auto-approve accordion
const AccordionContent = styled.div<{ $open: boolean }>`
	overflow: hidden;
	max-height: ${(p) => (p.$open ? "600px" : "0")};
	transition: max-height 0.28s cubic-bezier(0.4, 0, 0.2, 1);
	background: #161616;
`

const AaParentRow = styled.div`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 7px 11px;
	border-bottom: 0.5px solid #1e1e1e;
	cursor: pointer;
	transition: background 0.12s;

	&:hover {
		background: #1e1e1e;
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
	color: var(--popup-icon-stroke, #aaa);
	font-size: 12px;
`

const AaLabel = styled.span`
	color: var(--popup-text-primary, #ccc);
	font-size: var(--popup-font-size, 10.5px);
	flex: 1;
`

const AaChildRow = styled.div`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 6px 11px 6px 30px;
	border-bottom: 0.5px solid #1a1a1a;
	cursor: pointer;
	transition: background 0.12s;

	&:hover {
		background: #1a1a1a;
	}
`

const AaChildLabel = styled.span`
	color: var(--popup-text-child, #888);
	font-size: var(--popup-font-size, 10.5px);
	flex: 1;
`

const NotifRow = styled.div`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: 7px 11px;
	border-top: 0.5px solid #222;
`

const NotifLabel = styled.span`
	color: var(--popup-text-primary, #ccc);
	font-size: var(--popup-font-size, 10.5px);
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
	background: ${(p) => (p.$on ? "var(--toggle-on-bg, #2563eb)" : "var(--toggle-off-bg, #2e2e2e)")};
	border-radius: 8px;
	transition: background 0.2s;
`

const ToggleThumb = styled.div<{ $on: boolean }>`
	position: absolute;
	top: 2.5px;
	left: ${(p) => (p.$on ? "14.5px" : "2.5px")};
	width: var(--toggle-thumb-size, 11px);
	height: var(--toggle-thumb-size, 11px);
	background: ${(p) => (p.$on ? "var(--toggle-thumb-on-color, #fff)" : "var(--toggle-thumb-off-color, #555)")};
	border-radius: 50%;
	transition: left 0.2s, background 0.2s;
	pointer-events: none;
`

// ─── SVG Icons ───────────────────────────────────────────────────────────────
const ContextIcon = () => (
	<svg fill="none" height="13" viewBox="0 0 14 14" width="13">
		<path d="M2 4h10M2 7h7M2 10h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.3" />
	</svg>
)

const FilesIcon = () => (
	<svg fill="none" height="13" viewBox="0 0 14 14" width="13">
		<rect height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" width="10" x="2" y="1.5" />
		<path d="M4.5 5h5M4.5 7.5h3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1" />
	</svg>
)

const AutoApproveIcon = () => (
	<svg fill="none" height="13" viewBox="0 0 14 14" width="13">
		<circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" />
		<path d="M4.5 7l2 2 3-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.2" />
	</svg>
)

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
					<ContextIcon />
				</ItemIcon>
				<ItemLabel>Add context</ItemLabel>
				<ItemShortcut>@</ItemShortcut>
			</PopupItem>

			{/* Add files & images */}
			<PopupItem onClick={handleAddFiles}>
				<ItemIcon>
					<FilesIcon />
				</ItemIcon>
				<ItemLabel>Add files &amp; images</ItemLabel>
			</PopupItem>

			{/* Auto-approve header */}
			<PopupItem $active={aaOpen} onClick={() => setAaOpen((v) => !v)}>
				<ItemIcon>
					<AutoApproveIcon />
				</ItemIcon>
				<ItemLabel>Auto-approve</ItemLabel>
				<ChevronIcon $open={aaOpen} fill="none" viewBox="0 0 12 12">
					<path d="M2 4.5l4 4 4-4" stroke="#555" strokeLinecap="round" strokeWidth="1.3" />
				</ChevronIcon>
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
									<i className={`codicon ${action.icon}`} />
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
