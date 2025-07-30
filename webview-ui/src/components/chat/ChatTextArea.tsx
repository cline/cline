import React, { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useEvent } from "react-use"
import DynamicTextArea from "react-textarea-autosize"

import { mentionRegex, mentionRegexGlobal, commandRegexGlobal, unescapeSpaces } from "@roo/context-mentions"
import { WebviewMessage } from "@roo/WebviewMessage"
import { Mode, getAllModes } from "@roo/modes"
import { ExtensionMessage } from "@roo/ExtensionMessage"

import { vscode } from "@/utils/vscode"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useAppTranslation } from "@/i18n/TranslationContext"
import {
	ContextMenuOptionType,
	getContextMenuOptions,
	insertMention,
	removeMention,
	shouldShowContextMenu,
	SearchResult,
} from "@src/utils/context-mentions"
import { convertToMentionPath } from "@/utils/path-mentions"
import { StandardTooltip } from "@/components/ui"

import Thumbnails from "../common/Thumbnails"
import ModeSelector from "./ModeSelector"
import { ApiConfigSelector } from "./ApiConfigSelector"
import { MAX_IMAGES_PER_MESSAGE } from "./ChatView"
import ContextMenu from "./ContextMenu"
import { VolumeX, Image, WandSparkles, SendHorizontal } from "lucide-react"
import { IndexingStatusBadge } from "./IndexingStatusBadge"
import { SlashCommandsPopover } from "./SlashCommandsPopover"
import { cn } from "@/lib/utils"
import { usePromptHistory } from "./hooks/usePromptHistory"
import { EditModeControls } from "./EditModeControls"

interface ChatTextAreaProps {
	inputValue: string
	setInputValue: (value: string) => void
	sendingDisabled: boolean
	selectApiConfigDisabled: boolean
	placeholderText: string
	selectedImages: string[]
	setSelectedImages: React.Dispatch<React.SetStateAction<string[]>>
	onSend: () => void
	onSelectImages: () => void
	shouldDisableImages: boolean
	onHeightChange?: (height: number) => void
	mode: Mode
	setMode: (value: Mode) => void
	modeShortcutText: string
	// Edit mode props
	isEditMode?: boolean
	onCancel?: () => void
}

const ChatTextArea = forwardRef<HTMLTextAreaElement, ChatTextAreaProps>(
	(
		{
			inputValue,
			setInputValue,
			sendingDisabled,
			selectApiConfigDisabled,
			placeholderText,
			selectedImages,
			setSelectedImages,
			onSend,
			onSelectImages,
			shouldDisableImages,
			onHeightChange,
			mode,
			setMode,
			modeShortcutText,
			isEditMode = false,
			onCancel,
		},
		ref,
	) => {
		const { t } = useAppTranslation()
		const {
			filePaths,
			openedTabs,
			currentApiConfigName,
			listApiConfigMeta,
			customModes,
			customModePrompts,
			cwd,
			pinnedApiConfigs,
			togglePinnedApiConfig,
			taskHistory,
			clineMessages,
			commands,
		} = useExtensionState()

		// Find the ID and display text for the currently selected API configuration
		const { currentConfigId, displayName } = useMemo(() => {
			const currentConfig = listApiConfigMeta?.find((config) => config.name === currentApiConfigName)
			return {
				currentConfigId: currentConfig?.id || "",
				displayName: currentApiConfigName || "", // Use the name directly for display
			}
		}, [listApiConfigMeta, currentApiConfigName])

		const [gitCommits, setGitCommits] = useState<any[]>([])
		const [showDropdown, setShowDropdown] = useState(false)
		const [fileSearchResults, setFileSearchResults] = useState<SearchResult[]>([])
		const [searchLoading, setSearchLoading] = useState(false)
		const [searchRequestId, setSearchRequestId] = useState<string>("")

		// Close dropdown when clicking outside.
		useEffect(() => {
			const handleClickOutside = () => {
				if (showDropdown) {
					setShowDropdown(false)
				}
			}

			document.addEventListener("mousedown", handleClickOutside)
			return () => document.removeEventListener("mousedown", handleClickOutside)
		}, [showDropdown])

		// Handle enhanced prompt response and search results.
		useEffect(() => {
			const messageHandler = (event: MessageEvent) => {
				const message = event.data

				if (message.type === "enhancedPrompt") {
					if (message.text && textAreaRef.current) {
						try {
							// Use execCommand to replace text while preserving undo history
							if (document.execCommand) {
								// Use native browser methods to preserve undo stack
								const textarea = textAreaRef.current

								// Focus the textarea to ensure it's the active element
								textarea.focus()

								// Select all text first
								textarea.select()
								document.execCommand("insertText", false, message.text)
							} else {
								setInputValue(message.text)
							}
						} catch {
							setInputValue(message.text)
						}
					}

					setIsEnhancingPrompt(false)
				} else if (message.type === "insertTextIntoTextarea") {
					if (message.text && textAreaRef.current) {
						// Insert the command text at the current cursor position
						const textarea = textAreaRef.current
						const currentValue = inputValue
						const cursorPos = textarea.selectionStart || 0

						// Check if we need to add a space before the command
						const textBefore = currentValue.slice(0, cursorPos)
						const needsSpaceBefore = textBefore.length > 0 && !textBefore.endsWith(" ")
						const prefix = needsSpaceBefore ? " " : ""

						// Insert the text at cursor position
						const newValue =
							currentValue.slice(0, cursorPos) +
							prefix +
							message.text +
							" " +
							currentValue.slice(cursorPos)
						setInputValue(newValue)

						// Set cursor position after the inserted text
						const newCursorPos = cursorPos + prefix.length + message.text.length + 1
						setTimeout(() => {
							if (textAreaRef.current) {
								textAreaRef.current.focus()
								textAreaRef.current.setSelectionRange(newCursorPos, newCursorPos)
							}
						}, 0)
					}
				} else if (message.type === "commitSearchResults") {
					const commits = message.commits.map((commit: any) => ({
						type: ContextMenuOptionType.Git,
						value: commit.hash,
						label: commit.subject,
						description: `${commit.shortHash} by ${commit.author} on ${commit.date}`,
						icon: "$(git-commit)",
					}))

					setGitCommits(commits)
				} else if (message.type === "fileSearchResults") {
					setSearchLoading(false)
					if (message.requestId === searchRequestId) {
						setFileSearchResults(message.results || [])
					}
				}
			}

			window.addEventListener("message", messageHandler)
			return () => window.removeEventListener("message", messageHandler)
		}, [setInputValue, searchRequestId, inputValue])

		const [isDraggingOver, setIsDraggingOver] = useState(false)
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
		const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false)
		const [isFocused, setIsFocused] = useState(false)

		// Use custom hook for prompt history navigation
		const { handleHistoryNavigation, resetHistoryNavigation, resetOnInputChange } = usePromptHistory({
			clineMessages,
			taskHistory,
			cwd,
			inputValue,
			setInputValue,
		})

		// Fetch git commits when Git is selected or when typing a hash.
		useEffect(() => {
			if (selectedType === ContextMenuOptionType.Git || /^[a-f0-9]+$/i.test(searchQuery)) {
				const message: WebviewMessage = {
					type: "searchCommits",
					query: searchQuery || "",
				} as const
				vscode.postMessage(message)
			}
		}, [selectedType, searchQuery])

		const handleEnhancePrompt = useCallback(() => {
			const trimmedInput = inputValue.trim()

			if (trimmedInput) {
				setIsEnhancingPrompt(true)
				vscode.postMessage({ type: "enhancePrompt" as const, text: trimmedInput })
			} else {
				setInputValue(t("chat:enhancePromptDescription"))
			}
		}, [inputValue, setInputValue, t])

		const allModes = useMemo(() => getAllModes(customModes), [customModes])

		const queryItems = useMemo(() => {
			return [
				{ type: ContextMenuOptionType.Problems, value: "problems" },
				{ type: ContextMenuOptionType.Terminal, value: "terminal" },
				...gitCommits,
				...openedTabs
					.filter((tab) => tab.path)
					.map((tab) => ({
						type: ContextMenuOptionType.OpenedFile,
						value: "/" + tab.path,
					})),
				...filePaths
					.map((file) => "/" + file)
					.filter((path) => !openedTabs.some((tab) => tab.path && "/" + tab.path === path)) // Filter out paths that are already in openedTabs
					.map((path) => ({
						type: path.endsWith("/") ? ContextMenuOptionType.Folder : ContextMenuOptionType.File,
						value: path,
					})),
			]
		}, [filePaths, gitCommits, openedTabs])

		useEffect(() => {
			const handleClickOutside = (event: MouseEvent) => {
				if (
					contextMenuContainerRef.current &&
					!contextMenuContainerRef.current.contains(event.target as Node)
				) {
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

				if (type === ContextMenuOptionType.Mode && value) {
					// Handle mode selection.
					setMode(value)
					setInputValue("")
					setShowContextMenu(false)
					vscode.postMessage({ type: "mode", text: value })
					return
				}

				if (type === ContextMenuOptionType.Command && value) {
					// Handle command selection.
					setSelectedMenuIndex(-1)
					setInputValue("")
					setShowContextMenu(false)

					// Insert the command mention into the textarea
					const commandMention = `/${value}`
					setInputValue(commandMention + " ")
					setCursorPosition(commandMention.length + 1)
					setIntendedCursorPosition(commandMention.length + 1)

					// Focus the textarea
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.focus()
						}
					}, 0)
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
					} else if (type === ContextMenuOptionType.Command) {
						insertValue = value ? `/${value}` : ""
					}

					// Determine if this is a slash command selection
					const isSlashCommand = type === ContextMenuOptionType.Mode || type === ContextMenuOptionType.Command

					const { newValue, mentionIndex } = insertMention(
						textAreaRef.current.value,
						cursorPosition,
						insertValue,
						isSlashCommand,
					)

					setInputValue(newValue)
					const newCursorPosition = newValue.indexOf(" ", mentionIndex + insertValue.length) + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)

					// Scroll to cursor.
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)
				}
			},
			// eslint-disable-next-line react-hooks/exhaustive-deps
			[setInputValue, cursorPosition],
		)

		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				if (showContextMenu) {
					if (event.key === "Escape") {
						setSelectedType(null)
						setSelectedMenuIndex(3) // File by default
						return
					}

					if (event.key === "ArrowUp" || event.key === "ArrowDown") {
						event.preventDefault()
						setSelectedMenuIndex((prevIndex) => {
							const direction = event.key === "ArrowUp" ? -1 : 1
							const options = getContextMenuOptions(
								searchQuery,
								selectedType,
								queryItems,
								fileSearchResults,
								allModes,
								commands,
							)
							const optionsLength = options.length

							if (optionsLength === 0) return prevIndex

							// Find selectable options (non-URL types)
							const selectableOptions = options.filter(
								(option) =>
									option.type !== ContextMenuOptionType.URL &&
									option.type !== ContextMenuOptionType.NoResults &&
									option.type !== ContextMenuOptionType.SectionHeader,
							)

							if (selectableOptions.length === 0) return -1 // No selectable options

							// Find the index of the next selectable option
							const currentSelectableIndex = selectableOptions.findIndex(
								(option) => option === options[prevIndex],
							)

							const newSelectableIndex =
								(currentSelectableIndex + direction + selectableOptions.length) %
								selectableOptions.length

							// Find the index of the selected option in the original options array
							return options.findIndex((option) => option === selectableOptions[newSelectableIndex])
						})
						return
					}
					if ((event.key === "Enter" || event.key === "Tab") && selectedMenuIndex !== -1) {
						event.preventDefault()
						const selectedOption = getContextMenuOptions(
							searchQuery,
							selectedType,
							queryItems,
							fileSearchResults,
							allModes,
							commands,
						)[selectedMenuIndex]
						if (
							selectedOption &&
							selectedOption.type !== ContextMenuOptionType.URL &&
							selectedOption.type !== ContextMenuOptionType.NoResults &&
							selectedOption.type !== ContextMenuOptionType.SectionHeader
						) {
							handleMentionSelect(selectedOption.type, selectedOption.value)
						}
						return
					}
				}

				const isComposing = event.nativeEvent?.isComposing ?? false

				// Handle prompt history navigation using custom hook
				if (handleHistoryNavigation(event, showContextMenu, isComposing)) {
					return
				}

				if (event.key === "Enter" && !event.shiftKey && !isComposing) {
					event.preventDefault()

					// Always call onSend - let ChatView handle queueing when disabled
					resetHistoryNavigation()
					onSend()
				}

				if (event.key === "Backspace" && !isComposing) {
					const charBeforeCursor = inputValue[cursorPosition - 1]
					const charAfterCursor = inputValue[cursorPosition + 1]

					const charBeforeIsWhitespace =
						charBeforeCursor === " " || charBeforeCursor === "\n" || charBeforeCursor === "\r\n"

					const charAfterIsWhitespace =
						charAfterCursor === " " || charAfterCursor === "\n" || charAfterCursor === "\r\n"

					// Checks if char before cusor is whitespace after a mention.
					if (
						charBeforeIsWhitespace &&
						// "$" is added to ensure the match occurs at the end of the string.
						inputValue.slice(0, cursorPosition - 1).match(new RegExp(mentionRegex.source + "$"))
					) {
						const newCursorPosition = cursorPosition - 1
						// If mention is followed by another word, then instead
						// of deleting the space separating them we just move
						// the cursor to the end of the mention.
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
				allModes,
				fileSearchResults,
				handleHistoryNavigation,
				resetHistoryNavigation,
				commands,
			],
		)

		useLayoutEffect(() => {
			if (intendedCursorPosition !== null && textAreaRef.current) {
				textAreaRef.current.setSelectionRange(intendedCursorPosition, intendedCursorPosition)
				setIntendedCursorPosition(null) // Reset the state.
			}
		}, [inputValue, intendedCursorPosition])

		// Ref to store the search timeout.
		const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

		const handleInputChange = useCallback(
			(e: React.ChangeEvent<HTMLTextAreaElement>) => {
				const newValue = e.target.value
				setInputValue(newValue)

				// Reset history navigation when user types
				resetOnInputChange()

				const newCursorPosition = e.target.selectionStart
				setCursorPosition(newCursorPosition)

				const showMenu = shouldShowContextMenu(newValue, newCursorPosition)
				setShowContextMenu(showMenu)

				if (showMenu) {
					if (newValue.startsWith("/") && !newValue.includes(" ")) {
						// Handle slash command - request fresh commands
						const query = newValue
						setSearchQuery(query)
						// Set to first selectable item (skip section headers)
						setSelectedMenuIndex(1) // Section header is at 0, first command is at 1
						// Request commands fresh each time slash menu is shown
						vscode.postMessage({ type: "requestCommands" })
					} else {
						// Existing @ mention handling.
						const lastAtIndex = newValue.lastIndexOf("@", newCursorPosition - 1)
						const query = newValue.slice(lastAtIndex + 1, newCursorPosition)
						setSearchQuery(query)

						// Send file search request if query is not empty.
						if (query.length > 0) {
							setSelectedMenuIndex(0)

							// Don't clear results until we have new ones. This
							// prevents flickering.

							// Clear any existing timeout.
							if (searchTimeoutRef.current) {
								clearTimeout(searchTimeoutRef.current)
							}

							// Set a timeout to debounce the search requests.
							searchTimeoutRef.current = setTimeout(() => {
								// Generate a request ID for this search.
								const reqId = Math.random().toString(36).substring(2, 9)
								setSearchRequestId(reqId)
								setSearchLoading(true)

								// Send message to extension to search files.
								vscode.postMessage({
									type: "searchFiles",
									query: unescapeSpaces(query),
									requestId: reqId,
								})
							}, 200) // 200ms debounce.
						} else {
							setSelectedMenuIndex(3) // Set to "File" option by default.
						}
					}
				} else {
					setSearchQuery("")
					setSelectedMenuIndex(-1)
					setFileSearchResults([]) // Clear file search results.
				}
			},
			[setInputValue, setSearchRequestId, setFileSearchResults, setSearchLoading, resetOnInputChange],
		)

		useEffect(() => {
			if (!showContextMenu) {
				setSelectedType(null)
			}
		}, [showContextMenu])

		const handleBlur = useCallback(() => {
			// Only hide the context menu if the user didn't click on it.
			if (!isMouseDownOnMenu) {
				setShowContextMenu(false)
			}

			setIsFocused(false)
		}, [isMouseDownOnMenu])

		const handlePaste = useCallback(
			async (e: React.ClipboardEvent) => {
				const items = e.clipboardData.items

				const pastedText = e.clipboardData.getData("text")
				// Check if the pasted content is a URL, add space after so user
				// can easily delete if they don't want it.
				const urlRegex = /^\S+:\/\/\S+$/
				if (urlRegex.test(pastedText.trim())) {
					e.preventDefault()
					const trimmedUrl = pastedText.trim()
					const newValue =
						inputValue.slice(0, cursorPosition) + trimmedUrl + " " + inputValue.slice(cursorPosition)
					setInputValue(newValue)
					const newCursorPosition = cursorPosition + trimmedUrl.length + 1
					setCursorPosition(newCursorPosition)
					setIntendedCursorPosition(newCursorPosition)
					setShowContextMenu(false)

					// Scroll to new cursor position.
					setTimeout(() => {
						if (textAreaRef.current) {
							textAreaRef.current.blur()
							textAreaRef.current.focus()
						}
					}, 0)

					return
				}

				const acceptedTypes = ["png", "jpeg", "webp"]

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
									console.error(t("chat:errorReadingFile"), reader.error)
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

					if (dataUrls.length > 0) {
						setSelectedImages((prevImages) => [...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE))
					} else {
						console.warn(t("chat:noValidImages"))
					}
				}
			},
			[shouldDisableImages, setSelectedImages, cursorPosition, setInputValue, inputValue, t],
		)

		const handleMenuMouseDown = useCallback(() => {
			setIsMouseDownOnMenu(true)
		}, [])

		const updateHighlights = useCallback(() => {
			if (!textAreaRef.current || !highlightLayerRef.current) return

			const text = textAreaRef.current.value

			// Helper function to check if a command is valid
			const isValidCommand = (commandName: string): boolean => {
				return commands?.some((cmd) => cmd.name === commandName) || false
			}

			// Process the text to highlight mentions and valid commands
			let processedText = text
				.replace(/\n$/, "\n\n")
				.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c)
				.replace(mentionRegexGlobal, '<mark class="mention-context-textarea-highlight">$&</mark>')

			// Custom replacement for commands - only highlight valid ones
			processedText = processedText.replace(commandRegexGlobal, (match, commandName) => {
				// Only highlight if the command exists in the valid commands list
				if (isValidCommand(commandName)) {
					// Check if the match starts with a space
					const startsWithSpace = match.startsWith(" ")
					const commandPart = `/${commandName}`

					if (startsWithSpace) {
						// Keep the space but only highlight the command part
						return ` <mark class="mention-context-textarea-highlight">${commandPart}</mark>`
					} else {
						// Highlight the entire command (starts at beginning of line)
						return `<mark class="mention-context-textarea-highlight">${commandPart}</mark>`
					}
				}
				return match // Return unhighlighted if command is not valid
			})

			highlightLayerRef.current.innerHTML = processedText

			highlightLayerRef.current.scrollTop = textAreaRef.current.scrollTop
			highlightLayerRef.current.scrollLeft = textAreaRef.current.scrollLeft
		}, [commands])

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

		const handleDrop = useCallback(
			async (e: React.DragEvent<HTMLDivElement>) => {
				e.preventDefault()
				setIsDraggingOver(false)

				const textFieldList = e.dataTransfer.getData("text")
				const textUriList = e.dataTransfer.getData("application/vnd.code.uri-list")
				// When textFieldList is empty, it may attempt to use textUriList obtained from drag-and-drop tabs; if not empty, it will use textFieldList.
				const text = textFieldList || textUriList
				if (text) {
					// Split text on newlines to handle multiple files
					const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "")

					if (lines.length > 0) {
						// Process each line as a separate file path
						let newValue = inputValue.slice(0, cursorPosition)
						let totalLength = 0

						// Using a standard for loop instead of forEach for potential performance gains.
						for (let i = 0; i < lines.length; i++) {
							const line = lines[i]
							// Convert each path to a mention-friendly format
							const mentionText = convertToMentionPath(line, cwd)
							newValue += mentionText
							totalLength += mentionText.length

							// Add space after each mention except the last one
							if (i < lines.length - 1) {
								newValue += " "
								totalLength += 1
							}
						}

						// Add space after the last mention and append the rest of the input
						newValue += " " + inputValue.slice(cursorPosition)
						totalLength += 1

						setInputValue(newValue)
						const newCursorPosition = cursorPosition + totalLength
						setCursorPosition(newCursorPosition)
						setIntendedCursorPosition(newCursorPosition)
					}

					return
				}

				const files = Array.from(e.dataTransfer.files)

				if (files.length > 0) {
					const acceptedTypes = ["png", "jpeg", "webp"]

					const imageFiles = files.filter((file) => {
						const [type, subtype] = file.type.split("/")
						return type === "image" && acceptedTypes.includes(subtype)
					})

					if (!shouldDisableImages && imageFiles.length > 0) {
						const imagePromises = imageFiles.map((file) => {
							return new Promise<string | null>((resolve) => {
								const reader = new FileReader()

								reader.onloadend = () => {
									if (reader.error) {
										console.error(t("chat:errorReadingFile"), reader.error)
										resolve(null)
									} else {
										const result = reader.result
										resolve(typeof result === "string" ? result : null)
									}
								}

								reader.readAsDataURL(file)
							})
						})

						const imageDataArray = await Promise.all(imagePromises)
						const dataUrls = imageDataArray.filter((dataUrl): dataUrl is string => dataUrl !== null)

						if (dataUrls.length > 0) {
							setSelectedImages((prevImages) =>
								[...prevImages, ...dataUrls].slice(0, MAX_IMAGES_PER_MESSAGE),
							)

							if (typeof vscode !== "undefined") {
								vscode.postMessage({ type: "draggedImages", dataUrls: dataUrls })
							}
						} else {
							console.warn(t("chat:noValidImages"))
						}
					}
				}
			},
			[
				cursorPosition,
				cwd,
				inputValue,
				setInputValue,
				setCursorPosition,
				setIntendedCursorPosition,
				shouldDisableImages,
				setSelectedImages,
				t,
			],
		)

		const [isTtsPlaying, setIsTtsPlaying] = useState(false)

		useEvent("message", (event: MessageEvent) => {
			const message: ExtensionMessage = event.data

			if (message.type === "ttsStart") {
				setIsTtsPlaying(true)
			} else if (message.type === "ttsStop") {
				setIsTtsPlaying(false)
			}
		})

		const placeholderBottomText = `\n(${t("chat:addContext")}${shouldDisableImages ? `, ${t("chat:dragFiles")}` : `, ${t("chat:dragFilesImages")}`})`

		// Common mode selector handler
		const handleModeChange = useCallback(
			(value: Mode) => {
				setMode(value)
				vscode.postMessage({ type: "mode", text: value })
			},
			[setMode],
		)

		// Helper function to render mode selector
		const renderModeSelector = () => (
			<ModeSelector
				value={mode}
				title={t("chat:selectMode")}
				onChange={handleModeChange}
				triggerClassName="w-full"
				modeShortcutText={modeShortcutText}
				customModes={customModes}
				customModePrompts={customModePrompts}
			/>
		)

		// Helper function to handle API config change
		const handleApiConfigChange = useCallback((value: string) => {
			vscode.postMessage({ type: "loadApiConfigurationById", text: value })
		}, [])

		// Helper function to render non-edit mode controls
		const renderNonEditModeControls = () => (
			<div className={cn("flex", "justify-between", "items-center", "mt-auto")}>
				<div className={cn("flex", "items-center", "gap-1", "min-w-0")}>
					<div className="shrink-0">{renderModeSelector()}</div>

					<div className={cn("flex-1", "min-w-0", "overflow-hidden")}>
						<ApiConfigSelector
							value={currentConfigId}
							displayName={displayName}
							disabled={selectApiConfigDisabled}
							title={t("chat:selectApiConfig")}
							onChange={handleApiConfigChange}
							triggerClassName="w-full text-ellipsis overflow-hidden"
							listApiConfigMeta={listApiConfigMeta || []}
							pinnedApiConfigs={pinnedApiConfigs}
							togglePinnedApiConfig={togglePinnedApiConfig}
						/>
					</div>
				</div>

				<div className={cn("flex", "items-center", "gap-0.5", "shrink-0")}>
					{isTtsPlaying && (
						<StandardTooltip content={t("chat:stopTts")}>
							<button
								aria-label={t("chat:stopTts")}
								onClick={() => vscode.postMessage({ type: "stopTts" })}
								className={cn(
									"relative inline-flex items-center justify-center",
									"bg-transparent border-none p-1.5",
									"rounded-md min-w-[28px] min-h-[28px]",
									"text-vscode-foreground opacity-85",
									"transition-all duration-150",
									"hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
									"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
									"active:bg-[rgba(255,255,255,0.1)]",
									"cursor-pointer",
								)}>
								<VolumeX className="w-4 h-4" />
							</button>
						</StandardTooltip>
					)}
					<SlashCommandsPopover />
					<IndexingStatusBadge />
					<StandardTooltip content={t("chat:addImages")}>
						<button
							aria-label={t("chat:addImages")}
							disabled={shouldDisableImages}
							onClick={!shouldDisableImages ? onSelectImages : undefined}
							className={cn(
								"relative inline-flex items-center justify-center",
								"bg-transparent border-none p-1.5",
								"rounded-md min-w-[28px] min-h-[28px]",
								"text-vscode-foreground opacity-85",
								"transition-all duration-150",
								"hover:opacity-100 hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
								"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
								"active:bg-[rgba(255,255,255,0.1)]",
								!shouldDisableImages && "cursor-pointer",
								shouldDisableImages &&
									"opacity-40 cursor-not-allowed grayscale-[30%] hover:bg-transparent hover:border-[rgba(255,255,255,0.08)] active:bg-transparent",
								"mr-1",
							)}>
							<Image className="w-4 h-4" />
						</button>
					</StandardTooltip>
				</div>
			</div>
		)

		// Helper function to render the text area section
		const renderTextAreaSection = () => (
			<div
				className={cn(
					"relative",
					"flex-1",
					"flex",
					"flex-col-reverse",
					"min-h-0",
					"overflow-hidden",
					"rounded",
				)}>
				<div
					ref={highlightLayerRef}
					data-testid="highlight-layer"
					className={cn(
						"absolute",
						"inset-0",
						"pointer-events-none",
						"whitespace-pre-wrap",
						"break-words",
						"text-transparent",
						"overflow-hidden",
						"font-vscode-font-family",
						"text-vscode-editor-font-size",
						"leading-vscode-editor-line-height",
						"py-2",
						"px-[9px]",
						"z-10",
						"forced-color-adjust-none",
					)}
					style={{
						color: "transparent",
					}}
				/>
				<DynamicTextArea
					ref={(el) => {
						if (typeof ref === "function") {
							ref(el)
						} else if (ref) {
							ref.current = el
						}
						textAreaRef.current = el
					}}
					value={inputValue}
					onChange={(e) => {
						handleInputChange(e)
						updateHighlights()
					}}
					onFocus={() => setIsFocused(true)}
					onKeyDown={handleKeyDown}
					onKeyUp={handleKeyUp}
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
					minRows={3}
					maxRows={15}
					autoFocus={true}
					className={cn(
						"w-full",
						"text-vscode-input-foreground",
						"font-vscode-font-family",
						"text-vscode-editor-font-size",
						"leading-vscode-editor-line-height",
						"cursor-text",
						isEditMode ? "pt-1.5 pb-10 px-2" : "py-1.5 px-2",
						isFocused
							? "border border-vscode-focusBorder outline outline-vscode-focusBorder"
							: isDraggingOver
								? "border-2 border-dashed border-vscode-focusBorder"
								: "border border-transparent",
						isDraggingOver
							? "bg-[color-mix(in_srgb,var(--vscode-input-background)_95%,var(--vscode-focusBorder))]"
							: "bg-vscode-input-background",
						"transition-background-color duration-150 ease-in-out",
						"will-change-background-color",
						"min-h-[90px]",
						"box-border",
						"rounded",
						"resize-none",
						"overflow-x-hidden",
						"overflow-y-auto",
						"pr-9",
						"flex-none flex-grow",
						"z-[2]",
						"scrollbar-none",
						"scrollbar-hide",
					)}
					onScroll={() => updateHighlights()}
				/>

				<div className="absolute top-1 right-1 z-30">
					<StandardTooltip content={t("chat:enhancePrompt")}>
						<button
							aria-label={t("chat:enhancePrompt")}
							disabled={false}
							onClick={handleEnhancePrompt}
							className={cn(
								"relative inline-flex items-center justify-center",
								"bg-transparent border-none p-1.5",
								"rounded-md min-w-[28px] min-h-[28px]",
								"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
								"transition-all duration-150",
								"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
								"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
								"active:bg-[rgba(255,255,255,0.1)]",
								"cursor-pointer",
							)}>
							<WandSparkles className={cn("w-4 h-4", isEnhancingPrompt && "animate-spin")} />
						</button>
					</StandardTooltip>
				</div>

				{!isEditMode && (
					<div className="absolute bottom-1 right-1 z-30">
						<StandardTooltip content={t("chat:sendMessage")}>
							<button
								aria-label={t("chat:sendMessage")}
								disabled={false}
								onClick={onSend}
								className={cn(
									"relative inline-flex items-center justify-center",
									"bg-transparent border-none p-1.5",
									"rounded-md min-w-[28px] min-h-[28px]",
									"opacity-60 hover:opacity-100 text-vscode-descriptionForeground hover:text-vscode-foreground",
									"transition-all duration-150",
									"hover:bg-[rgba(255,255,255,0.03)] hover:border-[rgba(255,255,255,0.15)]",
									"focus:outline-none focus-visible:ring-1 focus-visible:ring-vscode-focusBorder",
									"active:bg-[rgba(255,255,255,0.1)]",
									"cursor-pointer",
								)}>
								<SendHorizontal className="w-4 h-4" />
							</button>
						</StandardTooltip>
					</div>
				)}

				{!inputValue && !isEditMode && (
					<div
						className="absolute left-2 z-30 pr-9 flex items-center h-8 font-vscode-font-family text-vscode-editor-font-size leading-vscode-editor-line-height"
						style={{
							bottom: "0.25rem",
							color: "color-mix(in oklab, var(--vscode-input-foreground) 50%, transparent)",
							userSelect: "none",
							pointerEvents: "none",
						}}>
						{placeholderBottomText}
					</div>
				)}
			</div>
		)

		return (
			<div
				className={cn(
					"relative",
					"flex",
					"flex-col",
					"gap-1",
					"bg-editor-background",
					isEditMode ? "px-0" : "px-1.5",
					"pb-1",
					"outline-none",
					"border",
					"border-none",
					isEditMode ? "w-full" : "w-[calc(100%-16px)]",
					"ml-auto",
					"mr-auto",
					"box-border",
				)}>
				<div className="relative">
					<div
						className={cn("chat-text-area", "relative", "flex", "flex-col", "outline-none")}
						onDrop={handleDrop}
						onDragOver={(e) => {
							// Only allowed to drop images/files on shift key pressed.
							if (!e.shiftKey) {
								setIsDraggingOver(false)
								return
							}

							e.preventDefault()
							setIsDraggingOver(true)
							e.dataTransfer.dropEffect = "copy"
						}}
						onDragLeave={(e) => {
							e.preventDefault()
							const rect = e.currentTarget.getBoundingClientRect()

							if (
								e.clientX <= rect.left ||
								e.clientX >= rect.right ||
								e.clientY <= rect.top ||
								e.clientY >= rect.bottom
							) {
								setIsDraggingOver(false)
							}
						}}>
						{showContextMenu && (
							<div
								ref={contextMenuContainerRef}
								className={cn(
									"absolute",
									"bottom-full",
									"left-0",
									"right-0",
									"z-[1000]",
									"mb-2",
									"filter",
									"drop-shadow-md",
								)}>
								<ContextMenu
									onSelect={handleMentionSelect}
									searchQuery={searchQuery}
									inputValue={inputValue}
									onMouseDown={handleMenuMouseDown}
									selectedIndex={selectedMenuIndex}
									setSelectedIndex={setSelectedMenuIndex}
									selectedType={selectedType}
									queryItems={queryItems}
									modes={allModes}
									loading={searchLoading}
									dynamicSearchResults={fileSearchResults}
									commands={commands}
								/>
							</div>
						)}

						{renderTextAreaSection()}
					</div>

					{isEditMode && (
						<EditModeControls
							mode={mode}
							onModeChange={handleModeChange}
							modeShortcutText={modeShortcutText}
							customModes={customModes}
							customModePrompts={customModePrompts}
							onCancel={onCancel}
							onSend={onSend}
							onSelectImages={onSelectImages}
							sendingDisabled={sendingDisabled}
							shouldDisableImages={shouldDisableImages}
						/>
					)}
				</div>

				{selectedImages.length > 0 && (
					<Thumbnails
						images={selectedImages}
						setImages={setSelectedImages}
						style={{
							left: "16px",
							zIndex: 2,
							marginBottom: 0,
						}}
					/>
				)}

				{!isEditMode && renderNonEditModeControls()}
			</div>
		)
	},
)

export default ChatTextArea
