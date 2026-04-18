import type React from "react"
import { useCallback, useEffect, useRef } from "react"
import styled, { keyframes } from "styled-components"
import { normalizeApiConfiguration } from "@/components/settings/utils/providerUtils"
import { useExtensionState } from "@/context/ExtensionStateContext"

// ─── Animation ────────────────────────────────────────────────────────────────
const popupAppear = keyframes`
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
`

// ─── Styled Components ────────────────────────────────────────────────────────
const PopupWrapper = styled.div`
	position: absolute;
	bottom: calc(100% + 8px);
	right: 0;
	width: 215px;
	background: var(--popup-bg);
	border: var(--popup-border);
	border-radius: var(--popup-radius, 10px);
	overflow: hidden;
	z-index: 200;
	animation: ${popupAppear} var(--popup-appear-duration, 0.18s) ease forwards;
	box-shadow: 0 8px 24px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.4));
`

const Header = styled.div`
	padding: 6px 11px;
	border-bottom: var(--popup-header-separator);
`

const HeaderTitle = styled.div`
	color: var(--popup-text-muted);
	font-size: 8.5px;
	text-transform: uppercase;
	letter-spacing: 0.06em;
	font-weight: 600;
`

const ModelRow = styled.div<{ $isSelected?: boolean }>`
	display: flex;
	align-items: center;
	gap: 9px;
	padding: var(--popup-item-padding, 7px 11px);
	cursor: pointer;
	border-bottom: var(--popup-item-separator);
	transition: background 0.12s;

	&:last-child {
		border-bottom: none;
	}

	&:hover {
		background: var(--model-selector-hover-bg);
	}
`

const ModelInfo = styled.div`
	flex: 1;
	min-width: 0;
`

const ModelName = styled.div`
	color: var(--popup-text-primary);
	font-size: var(--popup-font-size, var(--vscode-font-size, 11px));
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const ModelSub = styled.div`
	color: var(--popup-text-muted);
	font-size: 8.5px;
	margin-top: 1px;
`

const CheckMark = styled.i<{ $visible: boolean }>`
	color: var(--popup-checkmark-color);
	font-size: 11px;
	visibility: ${(p) => (p.$visible ? "visible" : "hidden")};
	flex-shrink: 0;
`

const SettingsLink = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 6px 11px;
	border-top: var(--popup-header-separator);
	cursor: pointer;
	transition: background 0.12s;

	&:hover {
		background: var(--model-selector-hover-bg);
	}
`

const SettingsLinkText = styled.span`
	color: var(--popup-text-muted);
	font-size: 9px;

	${SettingsLink}:hover & {
		color: var(--popup-text-child);
	}
`

// ─── Types ────────────────────────────────────────────────────────────────────
interface ModelEntry {
	id: string
	label: string
	subtitle?: string
}

interface ModelSelectorDropdownProps {
	isOpen: boolean
	onClose: () => void
	anchorRef: React.RefObject<HTMLElement | null>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Build a curated short list for the current provider */
function getProviderModels(provider: string, selectedModelId: string): ModelEntry[] {
	if (provider === "anthropic" || provider === "cline") {
		return [
			{ id: "claude-opus-4-5", label: "claude-opus-4-5", subtitle: "Most intelligent" },
			{ id: "claude-sonnet-4-5", label: "claude-sonnet-4-5", subtitle: "Balanced" },
			{ id: "claude-haiku-4-5", label: "claude-haiku-4-5", subtitle: "Fastest" },
		]
	}
	if (provider === "openai") {
		return [
			{ id: "gpt-4o", label: "gpt-4o", subtitle: "Most intelligent" },
			{ id: "gpt-4o-mini", label: "gpt-4o-mini", subtitle: "Faster & cheaper" },
		]
	}
	if (provider === "gemini") {
		return [
			{ id: "gemini-2.5-pro-exp-03-25", label: "gemini-2.5-pro", subtitle: "Most intelligent" },
			{ id: "gemini-2.0-flash", label: "gemini-2.0-flash", subtitle: "Faster" },
		]
	}
	// Fallback: show currently selected
	return [{ id: selectedModelId, label: selectedModelId, subtitle: "Current model" }]
}

// ─── Main Component ────────────────────────────────────────────────────────────
const ModelSelectorDropdown: React.FC<ModelSelectorDropdownProps> = ({ isOpen, onClose }) => {
	const popupRef = useRef<HTMLDivElement>(null)
	const { apiConfiguration, mode, navigateToSettingsModelPicker } = useExtensionState()

	const { selectedProvider, selectedModelId } = normalizeApiConfiguration(apiConfiguration, mode)
	const models = getProviderModels(selectedProvider, selectedModelId)

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

	const handleSelectModel = useCallback(
		(_modelId: string) => {
			navigateToSettingsModelPicker({ targetSection: "api-config" })
			onClose()
		},
		[navigateToSettingsModelPicker, onClose],
	)

	const handleOpenSettings = useCallback(() => {
		navigateToSettingsModelPicker({ targetSection: "api-config" })
		onClose()
	}, [navigateToSettingsModelPicker, onClose])

	if (!isOpen) return null

	return (
		<PopupWrapper ref={popupRef}>
			<Header>
				<HeaderTitle>Model</HeaderTitle>
			</Header>
			{models.map((m) => (
				<ModelRow $isSelected={m.id === selectedModelId} key={m.id} onClick={() => handleSelectModel(m.id)}>
					<ModelInfo>
						<ModelName>{m.label}</ModelName>
						{m.subtitle && <ModelSub>{m.subtitle}</ModelSub>}
					</ModelInfo>
					<CheckMark $visible={m.id === selectedModelId} aria-hidden="true" className="codicon codicon-check" />
				</ModelRow>
			))}
			<SettingsLink onClick={handleOpenSettings}>
				<SettingsLinkText>All models &amp; providers →</SettingsLinkText>
			</SettingsLink>
		</PopupWrapper>
	)
}

export default ModelSelectorDropdown
