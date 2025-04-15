import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import DynamicTextArea from "react-textarea-autosize"
import { useClickAway, useEvent, useWindowSize } from "react-use"
import styled from "styled-components"
import { mentionRegex, mentionRegexGlobal } from "@shared/context-mentions"
import { ExtensionMessage } from "@shared/ExtensionMessage"
import { useExtensionState } from "@/context/ExtensionStateContext"
import {
	ContextMenuOptionType,
	getContextMenuOptions,
	insertMention,
	insertMentionDirectly,
	removeMention,
	shouldShowContextMenu,
	SearchResult,
} from "@/utils/context-mentions"
import { useMetaKeyDetection, useShortcut } from "@/utils/hooks"
import { validateApiConfiguration, validateModelId } from "@/utils/validate"
import { vscode } from "@/utils/vscode"
import { CODE_BLOCK_BG_COLOR } from "@/components/common/CodeBlock"
import Thumbnails from "@/components/common/Thumbnails"
import Tooltip from "@/components/common/Tooltip"
import ApiOptions, { normalizeApiConfiguration } from "@/components/settings/ApiOptions"
import { MAX_IMAGES_PER_MESSAGE } from "@/components/chat/ChatView"
import ContextMenu from "@/components/chat/ContextMenu"
import { ChatSettings } from "@shared/ChatSettings"
import ServersToggleModal from "./ServersToggleModal"

interface ChatTextAreaProps {
	inputValue: string
	setInputValue: (value: string) => void
	textAreaDisabled: boolean
	placeholderText: string
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	onSend: () => void
	onSelectImages: () => void
	shouldDisableImages: boolean
	onHeightChange?: (height: number) => void
}

interface GitCommit {
	type: ContextMenuOptionType.Git
	value: string
	label: string
	description: string
}

const PLAN_MODE_COLOR = "var(--vscode-inputValidation-warningBorder)"

const SwitchOption = styled.div<{ isActive: boolean }>`
	padding: 2px 8px;
	color: ${(props) => (props.isActive ? "white" : "var(--vscode-input-foreground)")};
	z-index: 1;
	transition: color 0.2s ease;
	font-size: 12px;
	width: 50%;
	text-align: center;

	&:hover {
		background-color: ${(props) => (!props.isActive ? "var(--vscode-toolbar-hoverBackground)" : "transparent")};
	}
`

const SwitchContainer = styled.div<{ disabled: boolean }>`
	display: flex;
	align-items: center;
	background-color: var(--vscode-editor-background);
	border: 1px solid var(--vscode-input-border);
	border-radius: 12px;
	overflow: hidden;
	cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
	opacity: ${(props) => (props.disabled ? 0.5 : 1)};
	transform: scale(0.85);
	transform-origin: right center;
	margin-left: -10px; // compensate for the transform so flex spacing works
	user-select: none; // Prevent text selection
`

const Slider = styled.div<{ isAct: boolean; isPlan?: boolean }>`
	position: absolute;
	height: 100%;
	width: 50%;
	background-color: ${(props) => (props.isPlan ? PLAN_MODE_COLOR : "var(--vscode-focusBorder)")};
	transition: transform 0.2s ease;
	transform: translateX(${(props) => (props.isAct ? "100%" : "0%")});
`

const ButtonGroup = styled.div`
	display: flex;
	align-items: center;
	gap: 4px;
	flex: 1;
	min-width: 0;
`

const ButtonContainer = styled.div`
	display: flex;
	align-items: center;
	gap: 3px;
	font-size: 10px;
	white-space: nowrap;
	min-width: 0;
	width: 100%;
`

const OptimizeButtonContainer = styled.div`
	position: absolute;
	z-index: 100;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	color: var(--vscode-button-secondaryForeground);
	padding: 2px 8px;
	border-radius: 2px;
	font-size: 11px;
	height: 20px;
	transition: opacity 0.2s;

	&:hover {
		opacity: 0.8;
	}
`

const ControlsContainer = styled.div`
	display: flex;
	align-items: center;
	justify-content: space-between;
	margin-top: -5px;
	padding: 0px 15px 5px 15px;
`

const ModelSelectorTooltip = styled.div<ModelSelectorTooltipProps>`
	position: fixed;
	bottom: calc(100% + 9px);
	left: 15px;
	right: 15px;
	background: ${CODE_BLOCK_BG_COLOR};
	border: 1px solid var(--vscode-editorGroup-border);
	padding: 12px;
	border-radius: 3px;
	z-index: 1000;
	max-height: calc(100vh - 100px);
	overflow-y: auto;
	overscroll-behavior: contain;

	// Add invisible padding for hover zone
	&::before {
		content: "";
		position: fixed;
		bottom: ${(props) => `calc(100vh - ${props.menuPosition}px - 2px)`};
		left: 0;
		right: 0;
		height: 8px;
	}

	// Arrow pointing down
	&::after {
		content: "";
		position: fixed;
		bottom: ${(props) => `calc(100vh - ${props.menuPosition}px)`};
		right: ${(props) => props.arrowPosition}px;
		width: 10px;
		height: 10px;
		background: ${CODE_BLOCK_BG_COLOR};
		border-right: 1px solid var(--vscode-editorGroup-border);
		border-bottom: 1px solid var(--vscode-editorGroup-border);
		transform: rotate(45deg);
		z-index: -1;
	}
`

const ModelContainer = styled.div`
	position: relative;
	display: flex;
	flex: 1;
	min-width: 0;
`

const ModelButtonWrapper = styled.div`
	display: inline-flex; // Make it shrink to content
	min-width: 0; // Allow shrinking
	max-width: 100%; // Don't overflow parent
`

const ModelDisplayButton = styled.a<{ isActive?: boolean; disabled?: boolean }>`
	padding: 0px 0px;
	height: 20px;
	width: 100%;
	min-width: 0;
	cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
	text-decoration: ${(props) => (props.isActive ? "underline" : "none")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	display: flex;
	align-items: center;
	font-size: 10px;
	outline: none;
	user-select: none;
	opacity: ${(props) => (props.disabled ? 0.5 : 1)};
	pointer-events: ${(props) => (props.disabled ? "none" : "auto")};

	&:hover,
	&:focus {
		color: ${(props) => (props.disabled ? "var(--vscode-descriptionForeground)" : "var(--vscode-foreground)")};
		text-decoration: ${(props) => (props.disabled ? "none" : "underline")};
		outline: none;
	}

	&:active {
		color: ${(props) => (props.disabled ? "var(--vscode-descriptionForeground)" : "var(--vscode-foreground)")};
		text-decoration: ${(props) => (props.disabled ? "none" : "underline")};
		outline: none;
	}

	&:focus-visible {
		outline: none;
	}
`

const ModelButtonContent = styled.div`
	width: 100%;
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
`

const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
	(
		{
			inputValue,
			setInputValue,
			textAreaDisabled,
			placeholderText,
			selectedImages,
			setSelectedImages,
			onSend,
			onSelectImages,
			shouldDisableImages,
			onHeightChange,
		},
		ref,
	) => {
		const { filePaths, chatSettings, apiConfiguration, openRouterModels, platform } = useExtensionState()
		const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
		const [gitCommits, setGitCommits] = useState<GitCommit[]>([])
		const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false)

		const [thumbnailsHeight, setThumbnailsHeight] = useState(0)
		const [textAreaBaseHeight, setTextAreaBaseHeight] = useState<number | undefined>(undefined)
		const [showContextMenu, setShowContextMenu] = useState(false)
		const [cursorPosition, setCursorPosition] = useState(0)
		const [searchQuery, setSearchQuery] = useState("")
		const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
		const [isMouseDownOnMenu, setIsMouseDownOnMenu] = useState(false)
		const highlightLayerRef = useRef<HTMLDivElement>(null)
		const [selectedMenuIndex, setSelectedMenuIndex] = useState(-1)
		const [selectedType, setSelectedType] = useState<ContextMenuOptionType | null>(null)
		const [justDeletedSpaceAfterMention, setJustDeletedSpaceAfterMention] = useState(false)
		const [intendedCursorPosition, setIntendedCursorPosition] = useState<number | null>(null)
		const contextMenuContainerRef = useRef<HTMLDivElement>(null)
		const [showModelSelector, setShowModelSelector] = useState(false)
		const modelSelectorRef = useRef<HTMLDivElement>(null)
		const { width: viewportWidth, height: viewportHeight } = useWindowSize()
		const buttonRef = useRef<HTMLDivElement>(null)
		const [arrowPosition, setArrowPosition] = useState(0)
		const [menuPosition, setMenuPosition] = useState(0)
		const [shownTooltipMode, setShownTooltipMode] = useState<ChatSettings["mode"] | null>(null)
		const [pendingInsertions, setPendingInsertions] = useState<string[]>([])

		const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])
		const [searchLoading, setSearchLoading] = useState(false)
		const [, metaKeyChar] = useMetaKeyDetection(platform)

		// Add a ref to track previous menu state
		const prevShowModelSelector = useRef(showModelSelector)

		// Fetch git commits when Git is selected or when typing a hash
		useEffect(() => {
			if (selectedType === ContextMenuOptionType.Git || /^[a-f0-9]+$/i.test(searchQuery)) {
				vscode.postMessage({
					type: "searchCommits",
					text: searchQuery || "",
				})
			}
		}, [selectedType, searchQuery])

		const handleMessage = useCallback((event: MessageEvent) => {
			const message: ExtensionMessage = event.data
			switch (message.type) {
				case "commitSearchResults": {
					const commits: GitCommit[] =
						message.commits?.map((commit) => ({
							type: ContextMenuOptionType.Git,
							value: commit.hash,
							label: commit.subject,
							description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
						})) || []
					setGitCommits(commits)
					break
				}
				case "relativePathsResponse": {
					// New case for batch response
					const validPaths = message.paths?.filter((path): path is string => !!path) || []
					if (validPaths.length > 0) {
						setPendingInsertions((prev) => [...prev, ...validPaths])
					}
					break
				}

				case "fileSearchResults": {
					// Only update results if they match the current query or if there's no mentionsRequestId - better UX
					if (!message.mentionsRequestId || message.mentionsRequestId === currentSearchQueryRef.current) {
						setFileSearchResults(message.results || [])
						setSearchLoading(false)
					}
					break
				}
			}
		}, [])

		useEvent("message", handleMessage)

		const queryItems = useMemo(() => {
			return [
				{ type: ContextMenuOptionType.Problems, value: "problems" },
				{ type: ContextMenuOptionType.Terminal, value: "terminal" },
				...gitCommits,
				...filePaths
					.map((file) => "/" + file)
					.map((path) => ({
						type: path.endsWith("/") ? ContextMenuOptionType.Folder : ContextMenuOptionType.File,
						value: path,
					})),
			]
		}, [filePaths, gitCommits])

		useEffect(() => {
			const handleClickOutside = (event: MouseEvent) => {
				if (contextMenuContainerRef.current && !contextMenuContainerRef.current.contains(event.target as Node)) {
					setShowContextMenu(false)
				}
			}

			if (showContextMenu) {
				document.addEventListener("mousedown", handleClickOutside)
			}

			return () => {
				document.removeEventListener("mousedown", handleClickOutside)
			}
		}, [showContextMenu, setShowContextMenu])

		const handleMentionSelect = useCallback(
			(type: ContextMenuOptionType, value?: string) => {
				if (type === ContextMenuOptionType.NoResults) {
					return
				}

				if (
					type === ContextMenuOptionType.File ||
					type === ContextMenuOptionType.Folder ||
					type === ContextMenuOptionType.Git
				) {
					if (!value) {
						setSelectedType(type)
						setSearchQuery("")
						setSelectedMenuIndex(0)
						return
					}
				}

				setShowContextMenu(false)
				setSelectedType(null)
				if (textAreaRef.current) {
					let insertValue = value || ""
					if (type === ContextMenuOptionType.URL) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.File || type === ContextMenuOptionType.Folder) {
						insertValue = value || ""
					} else if (type === ContextMenuOptionType.Problems) {
						insertValue = "problems"
					} else if (type === ContextMenuOptionType.Terminal) {
						insertValue = "terminal"
					} else if (type === ContextMenuOptionType.Git) {
						insertValue = value || ""
					}

					const { newValue, mentionIndex } = insertMention(textAreaRef.current.value, cursorPosition, insertValue)

					setInputValue(newValue)
					const newCursorPosition = newValue.indexOf(" ", mentionIndex + insertValue.length) + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					// textAreaRef.current.focus()

					// scroll to cursor
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			[setInputValue, cursorPosition],
		)

		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (showContextMenu) {
					if (event.key === "Escape") {
						// event.preventDefault()
						setSelectedType(null)
						setSelectedMenuIndex(3) // File by default
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedMenuIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							const options = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)
							const optionsLength = options.length

							if (optionsLength === 0) return prevIndex

							// Find selectable options (non-URL types)
							const selectableOptions = options.filter(
								(option) =>
									option.type !== ContextMenuOptionType.URL && option.type !== ContextMenuOptionType.NoResults,
							)

							if (selectableOptions.length === 0) return -1 // No selectable options

							// Find the index of the next selectable option
							const currentSelectableIndex = selectableOptions.findIndex((option) => option === options[prevIndex])

							const newSelectableIndex =
								(currentSelectableIndex + direction + selectableOptions.length) % selectableOptions.length

							// Find the index of the selected option in the original options array
							return options.findIndex((option) => option === selectableOptions[newSelectableIndex])
						})
						return
					}
					if ((event.key === "Enter" || event.key === "Tab") && selectedMenuIndex !== -1) {
						event.preventDefault()
						const selectedOption = getContextMenuOptions(searchQuery, selectedType, queryItems, fileSearchResults)[
							selectedMenuIndex
						]
						if (
							selectedOption &&
							selectedOption.type !== ContextMenuOptionType.URL &&
							selectedOption.type !== ContextMenuOptionType.NoResults
						) {
							handleMentionSelect(selectedOption.type, selectedOption.value)
						}
						return
					}
				}

				const isComposing = event.nativeEvent?.isComposing ?? false
				if (event.key === "Enter" && !event.shiftKey && !isComposing) {
					event.preventDefault()
					setIsTextAreaFocused(false)
					onSend()
				}

				if (event.key === "Backspace" && !isComposing) {
					const charBeforeCursor = inputValue[cursorPosition - 1]
					const charAfterCursor = inputValue[cursorPosition + 1]

					const charBeforeIsWhitespace =
						charBeforeCursor === " " || charBeforeCursor === "\n" || charBeforeCursor === "\r\n"
					const charAfterIsWhitespace =
						charAfterCursor === " " || charAfterCursor === "\n" || charAfterCursor === "\r\n"
					// checks if char before cursor is whitespace after a mention
					if (
						charBeforeIsWhitespace &&
						inputValue.slice(0, cursorPosition - 1).match(new RegExp(mentionRegex.source + "$")) // "$" is added to ensure the match occurs at the end of the string
					) {
						const newCursorPosition = cursorPosition - 1
						// if mention is followed by another word, then instead of deleting the space separating them we just move the cursor to the end of the mention
						if (!charAfterIsWhitespace) {
							event.preventDefault()
							textAreaRef.current?.setSelectionRange(newCursorPosition, newCursorPosition)
							setCursorPosition(newCursorPosition)
						}
						setCursorPosition(newCursorPosition)
						setJustDeletedSpaceAfterMention(true)
					} else if (justDeletedSpaceAfterMention) {
						const { newText, newPosition } = removeMention(inputValue, cursorPosition)
						if (newText !== inputValue) {
							event.preventDefault()
							setInputValue(newText)
							setIntendedCursorPosition(newPosition) // Store the new cursor position in state
						}
						setJustDeletedSpaceAfterMention(false)
						setShowContextMenu(false)
					} else {
						setJustDeletedSpaceAfterMention(false)
					}
				}
			},
			[
				onSend,
				showContextMenu,
				searchQuery,
				selectedMenuIndex,
				handleMentionSelect,
				selectedType,
				inputValue,
				cursorPosition,
				setInputValue,
				justDeletedSpaceAfterMention,
				queryItems,
				fileSearchResults,
			],
		)

		// Effect to set cursor position after state updates
		useLayoutEffect(() => {
			if (intendedCursorPosition !== null && textAreaRef.current) {
				textAreaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
				setIntendedCursorPosition(null) // Reset the state after applying
			}
		}, [inputValue, intendedCursorPosition])

		useEffect(() => {
			if (pendingInsertions.length === 0 || !textAreaRef.current) {
				return
			}

			const path = pendingInsertions[0]
			const currentTextArea = textAreaRef.current
			const currentValue = currentTextArea.value
			const currentCursorPos =
				intendedCursorPosition ??
				(currentTextArea.selectionStart >= 0 ? currentTextArea.selectionStart : currentValue.length)

			const { newValue, mentionIndex } = insertMentionDirectly(currentValue, currentCursorPos, path)

			setInputValue(newValue)

			const newCursorPosition = mentionIndex + path.length + 2
			setIntendedCursorPosition(newCursorPosition)

			setPendingInsertions((prev) => prev.slice(1))
		}, [pendingInsertions, setInputValue])

		const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

		const currentSearchQueryRef = useRef<string>("")

		const handleInputChange = useCallback(
			(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				const newValue = e.target.value
				const newCursorPosition = e.target.selectionStart
				setInputValue(newValue)
				setCursorPosition(newCursorPosition)
				const showMenu = shouldShowContextMenu(newValue, newCursorPosition)

				setShowContextMenu(showMenu)
				if (showMenu) {
					const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)
					const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
					setSearchQuery(query)
					currentSearchQueryRef.current = query

					if (query.length > 0 && !selectedType) {
						setSelectedMenuIndex(0)

						// Clear any existing timeout
						if (searchTimeoutRef.current) {
							clearTimeout(searchTimeoutRef.current)
						}

						setSearchLoading(true)

						// Set a timeout to debounce the search requests
						searchTimeoutRef.current = setTimeout(() => {
							vscode.postMessage({
								type: "searchFiles",
								query: query,
								mentionsRequestId: query,
							})
						}, 200) // 200ms debounce
					} else {
						setSelectedMenuIndex(3) // Set to "File" option by default
					}
				} else {
					setSearchQuery("")
					setSelectedMenuIndex(-1)
					setFileSearchResults([])
				}
			},
			[setInputValue, setFileSearchResults, selectedType],
		)

		useEffect(() => {
			if (!showContextMenu) {
				setSelectedType(null)
			}
		}, [showContextMenu])

		const handleBlur = useCallback(() => {
			// Only hide the context menu if the user didn't click on it
			if (!isMouseDownOnMenu) {
				setShowContextMenu(false)
			}
			setIsTextAreaFocused(false)
		}, [isMouseDownOnMenu])

		const handlePaste = useCallback(
			async (e: React.ClipboardEvent) => {
				const items = e.clipboardData.items

				const pastedText = e.clipboardData.getData("text")
				// Check if the pasted content is a URL, add space after so user can easily delete if they don't want it
				const urlRegex = /^\S+:\/\/\S+$/
				if (urlRegex.test(pastedText.trim())) {
					e.preventDefault()
					const trimmedUrl = pastedText.trim()
					const newValue = inputValue.slice(0, cursorPosition) + trimmedUrl + " " + inputValue.slice(cursorPosition)
					setInputValue(newValue)
					const newCursorPosition = cursorPosition + trimmedUrl.length + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					setShowContextMenu(false)

					// Scroll to new cursor position
					// https://stackoverflow.com/questions/29899364/how-do-you-scroll-to-the-position-of-the-cursor-in-a-textarea/40951875#40951875
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
					// NOTE: callbacks dont utilize return function to cleanup, but it's fine since this timeout immediately executes and will be cleaned up by the browser (no chance component unmounts before it executes)

					return
				}

				const acceptedTypes = ["png", "jpeg", "webp"] // supported by anthropic and openrouter (jpg is just a file extension but the image will be recognized as jpeg)
				const imageItems = Array.from(items).filter((item) => {
					const [type, subtype] = item.type.split("/")
					return type === "image" && acceptedTypes.includes(subtype)
				})
				if (!shouldDisableImages && imageItems.length > 0) {
					e.preventDefault()
					const imagePromises = imageItems.map((item) => {
						return new Promise<string | null>((resolve) => {
							const blob = item.getAsFile()
							if (!blob) {
								resolve(null)
								return
							}
							const reader = new FileReader()
							reader.onloadend = () => {
								if (reader.error) {
									console.error("Error reading file:", reader.error)
									resolve(null)
								} else {
									const result = reader.result
									resolve(typeof result === "string" ? result : null)
								}
							}
							reader.readAsDataURL(blob)
						})
					})
					const imageDataArray = await Promise.all(imagePromises)
					const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)
					//.map((dataUrl) => dataUrl.split(",")[1]) // strip the mime type prefix, sharp doesn't need it
					if (dataUrls.length > 0) {
						setSelectedImages((prevImages) => [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE))
					} else {
						console.warn("No valid images were processed")
					}
				}
			},
			[shouldDisableImages, setSelectedImages, cursorPosition, setInputValue, inputValue],
		)

		const handleThumbnailsHeightChange = useCallback((height: number) => {
			setThumbnailsHeight(height)
		}, [])

		useEffect(() => {
			if (selectedImages.length === 0) {
				setThumbnailsHeight(0)
			}
		}, [selectedImages])

		const handleMenuMouseDown = useCallback(() => {
			setIsMouseDownOnMenu(true)
		}, [])

		const updateHighlights = useCallback(() => {
			if (!textAreaRef.current || !highlightLayerRef.current) return

			const text = textAreaRef.current.value

			highlightLayerRef.current.innerHTML = text
				.replace(/\n$/, "\n\n")
				.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c)
				.replace(mentionRegexGlobal, '<mark class="mention-context-textarea-highlight">$&</mark>')

			highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop
			highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft
		}, [])

		useLayoutEffect(() => {
			updateHighlights()
		}, [inputValue, updateHighlights])

		const updateCursorPosition = useCallback(() => {
			if (textAreaRef.current) {
				setCursorPosition(textAreaRef.current.selectionStart)
			}
		}, [])

		const handleKeyUp = useCallback(
			(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) {
					updateCursorPosition()
				}
			},
			[updateCursorPosition],
		)

		// Separate the API config submission logic
		const submitApiConfig = useCallback(() => {
			const apiValidationResult = validateApiConfiguration(apiConfiguration)
			const modelIdValidationResult = validateModelId(apiConfiguration, openRouterModels)

			if (!apiValidationResult && !modelIdValidationResult) {
				vscode.postMessage({ type: "apiConfiguration", apiConfiguration })
			} else {
				vscode.postMessage({ type: "getLatestState" })
			}
		}, [apiConfiguration, openRouterModels])

		const onModeToggle = useCallback(() => {
			// if (textAreaDisabled) return
			let changeModeDelay = 0
			if (showModelSelector) {
				// user has model selector open, so we should save it before switching modes
				submitApiConfig()
				changeModeDelay = 250 // necessary to let the api config update (we send message and wait for it to be saved) FIXME: this is a hack and we ideally should check for api config changes, then wait for it to be saved, before switching modes
			}
			setTimeout(() => {
				const newMode = chatSettings.mode === "plan" ? "act" : "plan"
				vscode.postMessage({
					type: "togglePlanActMode",
					chatSettings: {
						mode: newMode,
					},
					chatContent: {
						message: inputValue.trim() ? inputValue : undefined,
						images: selectedImages.length > 0 ? selectedImages : undefined,
					},
				})
				// Focus the textarea after mode toggle with slight delay
				setTimeout(() => {
					textAreaRef.current?.focus()
				}, 100)
			}, changeModeDelay)
		}, [chatSettings.mode, showModelSelector, submitApiConfig, inputValue, selectedImages])

		useShortcut("Meta+Shift+a", onModeToggle, { disableTextInputs: false }) // important that we don't disable the text input here

		const handleContextButtonClick = useCallback(() => {
			if (textAreaDisabled) return

			// Focus the textarea first
			textAreaRef.current?.focus()

			// If input is empty, just insert @
			if (!inputValue.trim()) {
				const event = {
					target: {
						value: "@",
						selectionStart: 1,
					},
				} as React.ChangeEvent<HTMLTextAreaElement>
				handleInputChange(event)
				updateHighlights()
				return
			}

			// If input ends with space or is empty, just append @
			if (inputValue.endsWith(" ")) {
				const event = {
					target: {
						value: inputValue + "@",
						selectionStart: inputValue.length + 1,
					},
				} as React.ChangeEvent<HTMLTextAreaElement>
				handleInputChange(event)
				updateHighlights()
				return
			}

			// Otherwise add space then @
			const event = {
				target: {
					value: inputValue + " @",
					selectionStart: inputValue.length + 2,
				},
			} as React.ChangeEvent<HTMLTextAreaElement>
			handleInputChange(event)
			updateHighlights()
		}, [inputValue, textAreaDisabled, handleInputChange, updateHighlights])

		// Use an effect to detect menu close
		useEffect(() => {
			if (prevShowModelSelector.current && !showModelSelector) {
				// Menu was just closed
				submitApiConfig()
			}
			prevShowModelSelector.current = showModelSelector
		}, [showModelSelector, submitApiConfig])

		// Remove the handleApiConfigSubmit callback
		// Update click handler to just toggle the menu
		const handleModelButtonClick = () => {
			setShowModelSelector(!showModelSelector)
		}

		// Update click away handler to just close menu
		useClickAway(modelSelectorRef, () => {
			setShowModelSelector(false)
		})

		// Get model display name
		const modelDisplayName = useMemo(() => {
			const { selectedProvider, selectedModelId } = normalizeApiConfiguration(apiConfiguration)
			const unknownModel = "unknown"
			if (!apiConfiguration) return unknownModel
			switch (selectedProvider) {
				case "cline":
					return `${selectedProvider}:${selectedModelId}`
				case "openai":
					return `openai-compat:${selectedModelId}`
				case "vscode-lm":
					return `vscode-lm:${apiConfiguration.vsCodeLmModelSelector ? `${apiConfiguration.vsCodeLmModelSelector.vendor ?? ""}/${apiConfiguration.vsCodeLmModelSelector.family ?? ""}` : unknownModel}`
				case "together":
					return `${selectedProvider}:${apiConfiguration.togetherModelId}`
				case "lmstudio":
					return `${selectedProvider}:${apiConfiguration.lmStudioModelId}`
				case "ollama":
					return `${selectedProvider}:${apiConfiguration.ollamaModelId}`
				case "litellm":
					return `${selectedProvider}:${apiConfiguration.liteLlmModelId}`
				case "requesty":
				case "anthropic":
				case "openrouter":
				default:
					return `${selectedProvider}:${selectedModelId}`
			}
		}, [apiConfiguration])

		// Calculate arrow position and menu position based on button location
		useEffect(() => {
			if (showModelSelector && buttonRef.current) {
				const buttonRect = buttonRef.current.getBoundingClientRect()
				const buttonCenter = buttonRect.left + buttonRect.width / 2

				// Calculate distance from right edge of viewport using viewport coordinates
				const rightPosition = document.documentElement.clientWidth - buttonCenter - 5

				setArrowPosition(rightPosition)
				setMenuPosition(buttonRect.top + 1) // Added +1 to move menu down by 1px
			}
		}, [showModelSelector, viewportWidth, viewportHeight])

		useEffect(() => {
			if (!showModelSelector) {
				// Attempt to save if possible
				// NOTE: we cannot call this here since it will create an infinite loop between this effect and the callback since getLatestState will update state. Instead we should submitapiconfig when the menu is explicitly closed, rather than as an effect of showModelSelector changing.
				// handleApiConfigSubmit()

				// Reset any active styling by blurring the button
				const button = buttonRef.current?.querySelector("a")
				if (button) {
					button.blur()
				}
			}
		}, [showModelSelector])

		/**
		 * Handles the drag over event to allow dropping.
		 * Prevents the default behavior to enable drop.
		 *
		 * @param {React.DragEvent} e - The drag event.
		 */
		const onDragOver = (e: React.DragEvent) => {
			e.preventDefault()
		}

		/**
		 * Handles the drop event for files and text.
		 * Processes dropped images and text, updating the state accordingly.
		 *
		 * @param {React.DragEvent} e - The drop event.
		 */
		const onDrop = async (e: React.DragEvent) => {
			e.preventDefault()

			// --- 1. VSCode Explorer Drop Handling ---
			let uris: string[] = []
			const resourceUrlsData = e.dataTransfer.getData("resourceurls")
			const vscodeUriListData = e.dataTransfer.getData("application/vnd.code.uri-list")

			// 1a. Try 'resourceurls' first (used for multi-select)
			if (resourceUrlsData) {
				try {
					uris = JSON.parse(resourceUrlsData)
					uris = uris.map((uri) => decodeURIComponent(uri))
				} catch (error) {
					console.error("Failed to parse resourceurls JSON:", error)
					uris = [] // Reset if parsing failed
				}
			}

			// 1b. Fallback to 'application/vnd.code.uri-list' (newline separated)
			if (uris.length === 0 && vscodeUriListData) {
				uris = vscodeUriListData.split("\n").map((uri) => uri.trim())
			}

			// 1c. Filter for valid schemes (file or vscode-file) and non-empty strings
			const validUris = uris.filter((uri) => uri && (uri.startsWith("vscode-file:") || uri.startsWith("file:")))

			if (validUris.length > 0) {
				setPendingInsertions([])
				let initialCursorPos = inputValue.length
				if (textAreaRef.current) {
					initialCursorPos = textAreaRef.current.selectionStart
				}
				setIntendedCursorPosition(initialCursorPos)

				vscode.postMessage({
					type: "getRelativePaths",
					uris: validUris,
				})
				return
			}

			const text = e.dataTransfer.getData("text")
			if (text) {
				handleTextDrop(text)
				return
			}

			// --- 3. Image Drop Handling ---
			// Only proceed if it wasn't a VSCode resource or plain text drop
			const files = Array.from(e.dataTransfer.files)
			const acceptedTypes = ["png", "jpeg", "webp"]
			const imageFiles = files.filter((file) => {
				const [type, subtype] = file.type.split("/")
				return type === "image" && acceptedTypes.includes(subtype)
			})

			if (shouldDisableImages || imageFiles.length === 0) {
				return
			}

			const imageDataArray = await readImageFiles(imageFiles)
			const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

			if (dataUrls.length > 0) {
				setSelectedImages((prevImages) => [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE))
			} else {
				console.warn("No valid images were processed")
			}
		}

		/**
		 * Handles the drop event for text.
		 * Inserts the dropped text at the current cursor position.
		 *
		 * @param {string} text - The dropped text.
		 */
		const handleTextDrop = (text: string) => {
			const newValue = inputValue.slice(0, cursorPosition) + text + inputValue.slice(cursorPosition)
			setInputValue(newValue)
			const newCursorPosition = cursorPosition + text.length
			setCursorPosition(newCursorPosition)
			setIntendedCursorPosition(newCursorPosition)
		}

		/**
		 * Reads image files and returns their data URLs.
		 * Uses FileReader to read the files as data URLs.
		 *
		 * @param {File[]} imageFiles - The image files to read.
		 * @returns {Promise<(string | null)[]>} - A promise that resolves to an array of data URLs or null values.
		 */
		const readImageFiles = (imageFiles: File[]): Promise<(string | null)[]> => {
			return Promise.all(
				imageFiles.map(
					(file) =>
						new Promise<string | null>((resolve) => {
							const reader = new FileReader()
							reader.onloadend = () => {
								if (reader.error) {
									console.error("Error reading file:", reader.error)
									resolve(null)
								} else {
									const result = reader.result
									resolve(typeof result === "string" ? result : null)
								}
							}
							reader.readAsDataURL(file)
						}),
				),
			)
		}

		// Add handler for optimized prompt result, without error display
		useEffect(() => {
			const handleOptimizedPromptResult = (event: MessageEvent) => {
				const message: ExtensionMessage = event.data
				if (message.type === "optimizedPromptResult") {
					setIsOptimizingPrompt(false)
					if (message.success && message.optimizedPrompt) {
						setInputValue(message.optimizedPrompt)
						if (textAreaRef.current) {
							// Focus the text area so the user can continue editing immediately
							setTimeout(() => {
								textAreaRef.current?.focus()
							}, 0)
						}
					}
					// No error handling, keep original content unchanged
				}
			}

			window.addEventListener("message", handleOptimizedPromptResult)
			return () => {
				window.removeEventListener("message", handleOptimizedPromptResult)
			}
		}, [setInputValue])

		// Handle prompt optimization
		const handleOptimizePrompt = useCallback(() => {
			if (!inputValue.trim() || textAreaDisabled) return

			setIsOptimizingPrompt(true) // Set loading state

			// Determine which model ID to use
			let modelId = "gpt-4"
			if (apiConfiguration) {
				if (apiConfiguration.apiModelId) {
					modelId = apiConfiguration.apiModelId
				} else if (apiConfiguration.openAiModelId) {
					modelId = apiConfiguration.openAiModelId
				}
			}

			// Tell VSCode to optimize the prompt
			vscode.postMessage({
				type: "optimizationPromptRequest",
				prompt: inputValue,
				model: modelId,
			})
		}, [inputValue, textAreaDisabled, apiConfiguration])

		return (
			<div>
				<div
					style={{
						padding: "10px 15px",
						opacity: textAreaDisabled ? 0.5 : 1,
						position: "relative",
						display: "flex",
					}}
					onDrop={onDrop}
					onDragOver={onDragOver}>
					{inputValue.trim() && (
						<OptimizeButtonContainer
							data-testid="optimize-prompt-button"
							title="Optimize Prompt"
							onClick={handleOptimizePrompt}
							style={{
								top: "-24px",
								right: "15px",
								background: "transparent",
							}}>
							{isOptimizingPrompt ? (
								<div
									className="codicon codicon-loading codicon-modifier-spin"
									style={{ fontSize: "12px", marginRight: "4px" }}></div>
							) : (
								<div className="codicon codicon-star" style={{ fontSize: "12px", marginRight: "4px" }}></div>
							)}
							Optimize
						</OptimizeButtonContainer>
					)}
					{showContextMenu && (
						<div ref={contextMenuContainerRef}>
							<ContextMenu
								onSelect={handleMentionSelect}
								searchQuery={searchQuery}
								onMouseDown={handleMenuMouseDown}
								selectedIndex={selectedMenuIndex}
								setSelectedIndex={setSelectedMenuIndex}
								selectedType={selectedType}
								queryItems={queryItems}
								dynamicSearchResults={fileSearchResults}
								isLoading={searchLoading}
							/>
						</div>
					)}
					{!isTextAreaFocused && (
						<div
							style={{
								position: "absolute",
								inset: "10px 15px",
								border: "1px solid var(--vscode-input-border)",
								borderRadius: 2,
								pointerEvents: "none",
								zIndex: 5,
							}}
						/>
					)}
					<div
						ref={highlightLayerRef}
						style={{
							position: "absolute",
							top: 10,
							left: 15,
							right: 15,
							bottom: 10,
							pointerEvents: "none",
							whiteSpace: "pre-wrap",
							wordWrap: "break-word",
							color: "transparent",
							overflow: "hidden",
							backgroundColor: "var(--vscode-input-background)",
							fontFamily: "var(--vscode-font-family)",
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
							borderRadius: 2,
							borderLeft: 0,
							borderRight: 0,
							borderTop: 0,
							borderColor: "transparent",
							borderBottom: `${thumbnailsHeight + 6}px solid transparent`,
							padding: "9px 28px 3px 9px",
						}}
					/>
					<DynamicTextArea
						data-testid="chat-input"
						ref={(el) => {
							if (typeof ref === "function") {
								ref(el)
							} else if (ref) {
								ref.current = el
							}
							textAreaRef.current = el
						}}
						value={inputValue}
						disabled={textAreaDisabled}
						onChange={(e) => {
							handleInputChange(e)
							updateHighlights()
						}}
						onKeyDown={handleKeyDown}
						onKeyUp={handleKeyUp}
						onFocus={() => setIsTextAreaFocused(true)}
						onBlur={handleBlur}
						onPaste={handlePaste}
						onSelect={updateCursorPosition}
						onMouseUp={updateCursorPosition}
						onHeightChange={(height) => {
							if (textAreaBaseHeight === undefined || height < textAreaBaseHeight) {
								setTextAreaBaseHeight(height)
							}
							onHeightChange?.(height)
						}}
						placeholder={placeholderText}
						maxRows={10}
						autoFocus={true}
						style={{
							width: "100%",
							boxSizing: "border-box",
							backgroundColor: "transparent",
							color: "var(--vscode-input-foreground)",
							//border: "1px solid var(--vscode-input-border)",
							borderRadius: 2,
							fontFamily: "var(--vscode-font-family)",
							fontSize: "var(--vscode-editor-font-size)",
							lineHeight: "var(--vscode-editor-line-height)",
							resize: "none",
							overflowX: "hidden",
							overflowY: "scroll",
							scrollbarWidth: "none",
							// Since we have maxRows, when text is long enough it starts to overflow the bottom padding, appearing behind the thumbnails. To fix this, we use a transparent border to push the text up instead. (https://stackoverflow.com/questions/42631947/maintaining-a-padding-inside-of-text-area/52538410#52538410)
							// borderTop: "9px solid transparent",
							borderLeft: 0,
							borderRight: 0,
							borderTop: 0,
							borderBottom: `${thumbnailsHeight + 6}px solid transparent`,
							borderColor: "transparent",
							// borderRight: "54px solid transparent",
							// borderLeft: "9px solid transparent", // NOTE: react-textarea-autosize doesn't calculate correct height when using borderLeft/borderRight so we need to use horizontal padding instead
							// Instead of using boxShadow, we use a div with a border to better replicate the behavior when the textarea is focused
							// boxShadow: "0px 0px 0px 1px var(--vscode-input-border)",
							padding: "9px 28px 3px 9px",
							cursor: textAreaDisabled ? "not-allowed" : undefined,
							flex: 1,
							zIndex: 1,
							outline: isTextAreaFocused
								? `1px solid ${chatSettings.mode === "plan" ? PLAN_MODE_COLOR : "var(--vscode-focusBorder)"}`
								: "none",
						}}
						onScroll={() => updateHighlights()}
					/>
					{selectedImages.length > 0 && (
						<Thumbnails
							images={selectedImages}
							setImages={setSelectedImages}
							onHeightChange={handleThumbnailsHeightChange}
							style={{
								position: "absolute",
								paddingTop: 4,
								bottom: 14,
								left: 22,
								right: 47, // (54 + 9) + 4 extra padding
								zIndex: 2,
							}}
						/>
					)}

					<div
						style={{
							position: "absolute",
							right: 23,
							display: "flex",
							alignItems: "flex-center",
							height: textAreaBaseHeight || 31,
							bottom: 9.5, // should be 10 but doesnt look good on mac
							zIndex: 2,
						}}>
						<div
							style={{
								display: "flex",
								flexDirection: "row",
								alignItems: "center",
							}}>
							{/* <div
								className={`input-icon-button ${shouldDisableImages ? "disabled" : ""} codicon codicon-device-camera`}
								onClick={() => {
									if (!shouldDisableImages) {
										onSelectImages()
									}
								}}
								style={{
									marginRight: 5.5,
									fontSize: 16.5,
								}}
							/> */}
							<div
								data-testid="send-button"
								className={`input-icon-button ${textAreaDisabled ? "disabled" : ""} codicon codicon-send`}
								onClick={() => {
									if (!textAreaDisabled) {
										setIsTextAreaFocused(false)
										onSend()
									}
								}}
								style={{ fontSize: 15 }}></div>
						</div>
					</div>
				</div>

				<ControlsContainer>
					<ButtonGroup>
						<VSCodeButton
							data-testid="context-button"
							appearance="icon"
							aria-label="Add Context"
							disabled={textAreaDisabled}
							onClick={handleContextButtonClick}
							style={{ padding: "0px 0px", height: "20px" }}>
							<ButtonContainer>
								<span className="flex items-center" style={{ fontSize: "13px", marginBottom: 1 }}>
									@
								</span>
								{/* {showButtonText && <span style={{ fontSize: "10px" }}>Context</span>} */}
							</ButtonContainer>
						</VSCodeButton>

						<VSCodeButton
							data-testid="images-button"
							appearance="icon"
							aria-label="Add Images"
							disabled={shouldDisableImages}
							onClick={() => {
								if (!shouldDisableImages) {
									onSelectImages()
								}
							}}
							style={{ padding: "0px 0px", height: "20px" }}>
							<ButtonContainer>
								<span
									className="codicon codicon-device-camera flex items-center"
									style={{ fontSize: "14px", marginBottom: -3 }}
								/>
								{/* {showButtonText && <span style={{ fontSize: "10px" }}>Images</span>} */}
							</ButtonContainer>
						</VSCodeButton>
						<ServersToggleModal />

						<ModelContainer ref={modelSelectorRef}>
							<ModelButtonWrapper ref={buttonRef}>
								<ModelDisplayButton
									role="button"
									isActive={showModelSelector}
									disabled={false}
									onClick={handleModelButtonClick}
									// onKeyDown={(e) => {
									// 	if (e.key === "Enter" || e.key === " ") {
									// 		e.preventDefault()
									// 		handleModelButtonClick()
									// 	}
									// }}
									tabIndex={0}>
									<ModelButtonContent>{modelDisplayName}</ModelButtonContent>
								</ModelDisplayButton>
							</ModelButtonWrapper>
							{showModelSelector && (
								<ModelSelectorTooltip
									arrowPosition={arrowPosition}
									menuPosition={menuPosition}
									style={{
										bottom: `calc(100vh - ${menuPosition}px + 6px)`,
									}}>
									<ApiOptions
										showModelOptions={true}
										apiErrorMessage={undefined}
										modelIdErrorMessage={undefined}
										isPopup={true}
									/>
								</ModelSelectorTooltip>
							)}
						</ModelContainer>
					</ButtonGroup>
					<Tooltip
						style={{ zIndex: 1000 }}
						visible={shownTooltipMode !== null}
						tipText={`In ${shownTooltipMode === "act" ? "Act" : "Plan"}  mode, Cline will ${shownTooltipMode === "act" ? "complete the task immediately" : "gather information to architect a plan"}`}
						hintText={`Toggle w/ ${metaKeyChar}+Shift+A`}>
						<SwitchContainer data-testid="mode-switch" disabled={false} onClick={onModeToggle}>
							<Slider isAct={chatSettings.mode === "act"} isPlan={chatSettings.mode === "plan"} />
							<SwitchOption
								isActive={chatSettings.mode === "plan"}
								onMouseOver={() => setShownTooltipMode("plan")}
								onMouseLeave={() => setShownTooltipMode(null)}>
								Plan
							</SwitchOption>
							<SwitchOption
								isActive={chatSettings.mode === "act"}
								onMouseOver={() => setShownTooltipMode("act")}
								onMouseLeave={() => setShownTooltipMode(null)}>
								Act
							</SwitchOption>
						</SwitchContainer>
					</Tooltip>
				</ControlsContainer>
			</div>
		)
	},
)

// Update TypeScript interface for styled-component props
interface ModelSelectorTooltipProps {
	arrowPosition: number
	menuPosition: number
}

export default ChatTextArea
