import React, { memo, useEffect, useRef, useCallback, useState } from "react"
import { useCopyToClipboard } from "@src/utils/clipboard"
import { getHighlighter, isLanguageLoaded, normalizeLanguage, ExtendedLanguage } from "@src/utils/highlighter"
import { bundledLanguages } from "shiki"
import type { ShikiTransformer } from "shiki"
import { ChevronDown, ChevronUp, WrapText, AlignJustify, Copy, Check } from "lucide-react"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import { cn } from "@/lib/utils"

export const WRAPPER_ALPHA = "cc" // 80% opacity
// Configuration constants
export const WINDOW_SHADE_SETTINGS = {
	transitionDelayS: 0.2,
	collapsedHeight: 500, // Default collapsed height in pixels
}

// Tolerance in pixels for determining when a container is considered "at the bottom"
export const SCROLL_SNAP_TOLERANCE = 20

/*
overflowX: auto + inner div with padding results in an issue where the top/left/bottom padding renders but the right padding inside does not count as overflow as the width of the element is not exceeded. Once the inner div is outside the boundaries of the parent it counts as overflow.
https://stackoverflow.com/questions/60778406/why-is-padding-right-clipped-with-overflowscroll/77292459#77292459
this fixes the issue of right padding clipped off 
“ideal” size in a given axis when given infinite available space--allows the syntax highlighter to grow to largest possible width including its padding
minWidth: "max-content",
*/

interface CodeBlockProps {
	source?: string
	rawSource?: string // Add rawSource prop for copying raw text
	language?: string
	preStyle?: React.CSSProperties
	initialWordWrap?: boolean
	collapsedHeight?: number
	initialWindowShade?: boolean
	onLanguageChange?: (language: string) => void
}

interface CodeBlockButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	children: React.ReactNode
}

const CodeBlockButton = ({ children, ...props }: CodeBlockButtonProps) => {
	return (
		<button
			className="bg-transparent border-none text-vscode-foreground p-1 mx-0 flex items-center justify-center opacity-40 rounded-[3px] ml-1 h-6 w-6 hover:bg-vscode-toolbar-hoverBackground hover:opacity-100"
			style={{
				cursor: "var(--copy-button-cursor, default)",
				pointerEvents: "var(--copy-button-events, none)" as any,
			}}
			{...props}>
			{children}
		</button>
	)
}

interface CodeBlockButtonWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
	children: React.ReactNode
}

const CodeBlockButtonWrapper = React.forwardRef<HTMLDivElement, CodeBlockButtonWrapperProps>(
	({ children, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className="fixed h-auto z-[100] overflow-visible pointer-events-none p-[4px_6px] rounded-[3px] inline-flex items-center justify-center hover:bg-vscode-editor-background hover:!opacity-100 bg-vscode-editor-background/[.80]"
				style={{
					top: "var(--copy-button-top)",
					right: "var(--copy-button-right, 8px)",
					opacity: "var(--copy-button-opacity, 0)",
				}}
				{...props}>
				{children}
			</div>
		)
	},
)
CodeBlockButtonWrapper.displayName = "CodeBlockButtonWrapper"

interface CodeBlockContainerProps extends React.HTMLAttributes<HTMLDivElement> {
	children: React.ReactNode
	"data-partially-visible"?: boolean
}

const CodeBlockContainer = React.forwardRef<HTMLDivElement, CodeBlockContainerProps>(
	({ children, "data-partially-visible": partiallyVisible, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className="relative overflow-hidden border-b-4 border-vscode-sideBar-background bg-background"
				data-partially-visible={partiallyVisible}
				{...props}>
				{children}
			</div>
		)
	},
)
CodeBlockContainer.displayName = "CodeBlockContainer"

interface StyledPreProps extends React.HTMLAttributes<HTMLDivElement> {
	preStyle?: React.CSSProperties
	wordwrap?: "true" | "false" | undefined
	windowshade?: "true" | "false"
	collapsedHeight?: number
	children: React.ReactNode
}

export const StyledPre = React.forwardRef<HTMLDivElement, StyledPreProps>(
	({ preStyle, wordwrap, windowshade, collapsedHeight, children, className, ...props }, ref) => {
		return (
			<div
				ref={ref}
				className={cn(
					"overflow-y-auto p-[10px] rounded-[5px]",
					"text-vscode-editor-font-size font-vscode-editor-font-family",
					"bg-background",
					windowshade === "true"
						? `[max-height:${collapsedHeight || WINDOW_SHADE_SETTINGS.collapsedHeight}px]`
						: "max-h-none",
					wordwrap === "false" ? "whitespace-pre" : "whitespace-pre-wrap",
					"break-normal",
					wordwrap === "false" ? "[overflow-wrap:normal]" : "break-words",
					className,
				)}
				style={preStyle}
				{...props}>
				{children}
			</div>
		)
	},
)
StyledPre.displayName = "StyledPre"

interface LanguageSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
	children: React.ReactNode
}
const LanguageSelect = ({ children, className, ...props }: LanguageSelectProps) => {
	return (
		<select
			className={cn(
				"text-xs text-vscode-foreground opacity-40 font-mono appearance-none bg-transparent border-none cursor-pointer p-1 m-0 align-middle h-6 hover:opacity-100 hover:bg-vscode-toolbar-hoverBackground hover:rounded-[3px] focus:opacity-100 focus:outline-none focus:rounded-[3px]",
				className,
			)}
			{...props}>
			{children}
		</select>
	)
}

const CodeBlock = memo(
	({
		source,
		rawSource,
		language,
		preStyle,
		initialWordWrap = true,
		initialWindowShade = true,
		collapsedHeight,
		onLanguageChange,
	}: CodeBlockProps) => {
		const [wordWrap, setWordWrap] = useState(initialWordWrap)
		const [windowShade, setWindowShade] = useState(initialWindowShade)
		const [currentLanguage, setCurrentLanguage] = useState<ExtendedLanguage>(() => normalizeLanguage(language))
		const userChangedLanguageRef = useRef(false)
		const [highlightedCode, setHighlightedCode] = useState<string>("")
		const [showCollapseButton, setShowCollapseButton] = useState(true)
		const codeBlockRef = useRef<HTMLDivElement>(null)
		const preRef = useRef<HTMLDivElement>(null)
		const copyButtonWrapperRef = useRef<HTMLDivElement>(null)
		const { showCopyFeedback, copyWithFeedback } = useCopyToClipboard()
		const { t } = useAppTranslation()

		// Update current language when prop changes, but only if user hasn't made a selection
		useEffect(() => {
			const normalizedLang = normalizeLanguage(language)
			if (normalizedLang !== currentLanguage && !userChangedLanguageRef.current) {
				setCurrentLanguage(normalizedLang)
			}
		}, [language, currentLanguage])

		// Syntax highlighting with cached Shiki instance
		useEffect(() => {
			const fallback = `<pre class="p-0 m-0"><code class="hljs language-${currentLanguage || "txt"}">${source || ""}</code></pre>`
			const highlight = async () => {
				// Show plain text if language needs to be loaded
				if (currentLanguage && !isLanguageLoaded(currentLanguage)) {
					setHighlightedCode(fallback)
				}

				const highlighter = await getHighlighter(currentLanguage)
				const html = await highlighter.codeToHtml(source || "", {
					lang: currentLanguage || "txt",
					theme: document.body.className.toLowerCase().includes("light") ? "github-light" : "github-dark",
					transformers: [
						{
							pre(node) {
								node.properties.class = "p-0 m-0"
								return node
							},
							code(node) {
								// Add hljs classes for consistent styling
								node.properties.class = `hljs language-${currentLanguage}`
								return node
							},
							line(node) {
								// Preserve existing line handling
								node.properties.class = node.properties.class || ""
								return node
							},
						},
					] as ShikiTransformer[],
				})
				setHighlightedCode(html)
			}

			highlight().catch((e) => {
				console.error("[CodeBlock] Syntax highlighting error:", e, "\nStack trace:", e.stack)
				setHighlightedCode(fallback)
			})
		}, [source, currentLanguage, collapsedHeight])

		// Check if content height exceeds collapsed height whenever content changes
		useEffect(() => {
			const codeBlock = codeBlockRef.current
			if (codeBlock) {
				const actualHeight = codeBlock.scrollHeight
				setShowCollapseButton(actualHeight >= WINDOW_SHADE_SETTINGS.collapsedHeight)
			}
		}, [highlightedCode])

		// Ref to track if user was scrolled up *before* the source update potentially changes scrollHeight
		const wasScrolledUpRef = useRef(false)

		// Ref to track if outer container was near bottom
		const outerContainerNearBottomRef = useRef(false)

		// Effect to listen to scroll events and update the ref
		useEffect(() => {
			const preElement = preRef.current
			if (!preElement) return

			const handleScroll = () => {
				const isAtBottom =
					Math.abs(preElement.scrollHeight - preElement.scrollTop - preElement.clientHeight) <
					SCROLL_SNAP_TOLERANCE
				wasScrolledUpRef.current = !isAtBottom
			}

			preElement.addEventListener("scroll", handleScroll, { passive: true })
			// Initial check in case it starts scrolled up
			handleScroll()

			return () => {
				preElement.removeEventListener("scroll", handleScroll)
			}
		}, []) // Empty dependency array: runs once on mount

		// Effect to track outer container scroll position
		useEffect(() => {
			const scrollContainer = document.querySelector('[data-virtuoso-scroller="true"]')
			if (!scrollContainer) return

			const handleOuterScroll = () => {
				const isAtBottom =
					Math.abs(scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight) <
					SCROLL_SNAP_TOLERANCE
				outerContainerNearBottomRef.current = isAtBottom
			}

			scrollContainer.addEventListener("scroll", handleOuterScroll, { passive: true })
			// Initial check
			handleOuterScroll()

			return () => {
				scrollContainer.removeEventListener("scroll", handleOuterScroll)
			}
		}, []) // Empty dependency array: runs once on mount

		// Store whether we should scroll after highlighting completes
		const shouldScrollAfterHighlightRef = useRef(false)

		// Check if we should scroll when source changes
		useEffect(() => {
			// Only set the flag if we're at the bottom when source changes
			if (preRef.current && source && !wasScrolledUpRef.current) {
				shouldScrollAfterHighlightRef.current = true
			} else {
				shouldScrollAfterHighlightRef.current = false
			}
		}, [source])

		const updateCodeBlockButtonPosition = useCallback((forceHide = false) => {
			const codeBlock = codeBlockRef.current
			const copyWrapper = copyButtonWrapperRef.current
			if (!codeBlock) return

			const rectCodeBlock = codeBlock.getBoundingClientRect()
			const scrollContainer = document.querySelector('[data-virtuoso-scroller="true"]')
			if (!scrollContainer) return

			// Get wrapper height dynamically
			let wrapperHeight
			if (copyWrapper) {
				const copyRect = copyWrapper.getBoundingClientRect()
				// If height is 0 due to styling, estimate from children
				if (copyRect.height > 0) {
					wrapperHeight = copyRect.height
				} else if (copyWrapper.children.length > 0) {
					// Try to get height from the button inside
					const buttonRect = copyWrapper.children[0].getBoundingClientRect()
					const buttonStyle = window.getComputedStyle(copyWrapper.children[0] as Element)
					const buttonPadding =
						parseInt(buttonStyle.getPropertyValue("padding-top") || "0", 10) +
						parseInt(buttonStyle.getPropertyValue("padding-bottom") || "0", 10)
					wrapperHeight = buttonRect.height + buttonPadding
				}
			}

			// If we still don't have a height, calculate from font size
			if (!wrapperHeight) {
				const fontSize = parseInt(window.getComputedStyle(document.body).getPropertyValue("font-size"), 10)
				wrapperHeight = fontSize * 2.5 // Approximate button height based on font size
			}

			const scrollRect = scrollContainer.getBoundingClientRect()
			const copyButtonEdge = 48
			const isPartiallyVisible =
				rectCodeBlock.top < scrollRect.bottom - copyButtonEdge &&
				rectCodeBlock.bottom >= scrollRect.top + copyButtonEdge

			// Calculate margin from existing padding in the component
			const computedStyle = window.getComputedStyle(codeBlock)
			const paddingValue = parseInt(computedStyle.getPropertyValue("padding") || "0", 10)
			const margin =
				paddingValue > 0 ? paddingValue : parseInt(computedStyle.getPropertyValue("padding-top") || "0", 10)

			// Update visibility state and button interactivity
			const isVisible = !forceHide && isPartiallyVisible
			codeBlock.setAttribute("data-partially-visible", isPartiallyVisible ? "true" : "false")
			codeBlock.style.setProperty("--copy-button-cursor", isVisible ? "pointer" : "default")
			codeBlock.style.setProperty("--copy-button-events", isVisible ? "all" : "none")
			codeBlock.style.setProperty("--copy-button-opacity", isVisible ? "1" : "0")

			if (isPartiallyVisible) {
				// Keep button within code block bounds using dynamic measurements
				const topPosition = Math.max(
					scrollRect.top + margin,
					Math.min(rectCodeBlock.bottom - wrapperHeight - margin, rectCodeBlock.top + margin),
				)
				const rightPosition = Math.max(margin, scrollRect.right - rectCodeBlock.right + margin)

				codeBlock.style.setProperty("--copy-button-top", `${topPosition}px`)
				codeBlock.style.setProperty("--copy-button-right", `${rightPosition}px`)
			}
		}, [])

		useEffect(() => {
			const handleScroll = () => updateCodeBlockButtonPosition()
			const handleResize = () => updateCodeBlockButtonPosition()

			const scrollContainer = document.querySelector('[data-virtuoso-scroller="true"]')
			if (scrollContainer) {
				scrollContainer.addEventListener("scroll", handleScroll)
				window.addEventListener("resize", handleResize)
				updateCodeBlockButtonPosition()
			}

			return () => {
				if (scrollContainer) {
					scrollContainer.removeEventListener("scroll", handleScroll)
					window.removeEventListener("resize", handleResize)
				}
			}
		}, [updateCodeBlockButtonPosition])

		// Update button position and scroll when highlightedCode changes
		useEffect(() => {
			if (highlightedCode) {
				// Update button position
				setTimeout(updateCodeBlockButtonPosition, 0)

				// Scroll to bottom if needed (immediately after Shiki updates)
				if (shouldScrollAfterHighlightRef.current) {
					// Scroll inner container
					if (preRef.current) {
						preRef.current.scrollTop = preRef.current.scrollHeight
						wasScrolledUpRef.current = false
					}

					// Also scroll outer container if it was near bottom
					if (outerContainerNearBottomRef.current) {
						const scrollContainer = document.querySelector('[data-virtuoso-scroller="true"]')
						if (scrollContainer) {
							scrollContainer.scrollTop = scrollContainer.scrollHeight
							outerContainerNearBottomRef.current = true
						}
					}

					// Reset the flag
					shouldScrollAfterHighlightRef.current = false
				}
			}
		}, [highlightedCode, updateCodeBlockButtonPosition])

		// Advanced inertial scroll chaining
		// This effect handles the transition between scrolling the code block and the outer container.
		// When a user scrolls to the boundary of a code block (top or bottom), this implementation:
		// 1. Detects the boundary condition
		// 2. Applies inertial scrolling to the outer container for a smooth transition
		// 3. Adds physics-based momentum for natural deceleration
		// This creates a seamless experience where scrolling flows naturally between nested scrollable areas
		useEffect(() => {
			if (!preRef.current) return

			// Find the outer scrollable container
			const getScrollContainer = () => {
				return document.querySelector('[data-virtuoso-scroller="true"]') as HTMLElement
			}

			// Inertial scrolling implementation
			let velocity = 0
			let animationFrameId: number | null = null
			const FRICTION = 0.85 // Friction coefficient (lower = more friction)
			const MIN_VELOCITY = 0.5 // Minimum velocity before stopping

			// Animation function for inertial scrolling
			const animate = () => {
				const scrollContainer = getScrollContainer()
				if (!scrollContainer) return

				// Apply current velocity
				if (Math.abs(velocity) > MIN_VELOCITY) {
					scrollContainer.scrollBy(0, velocity)
					velocity *= FRICTION // Apply friction
					animationFrameId = requestAnimationFrame(animate)
				} else {
					velocity = 0
					animationFrameId = null
				}
			}

			// Wheel event handler with inertial scrolling
			const handleWheel = (e: WheelEvent) => {
				// If shift is pressed, let the browser handle default horizontal scrolling
				if (e.shiftKey) {
					return
				}
				if (!preRef.current) return

				// Only handle wheel events if the inner container has a scrollbar,
				// otherwise let the browser handle the default scrolling
				const hasScrollbar = preRef.current.scrollHeight > preRef.current.clientHeight

				// Pass through events if we don't need special handling
				if (!hasScrollbar) {
					return
				}

				const scrollContainer = getScrollContainer()
				if (!scrollContainer) return

				// Check if we're at the top or bottom of the inner container
				const isAtVeryTop = preRef.current.scrollTop === 0
				const isAtVeryBottom =
					Math.abs(preRef.current.scrollHeight - preRef.current.scrollTop - preRef.current.clientHeight) < 1

				// Handle scrolling at container boundaries
				if ((e.deltaY < 0 && isAtVeryTop) || (e.deltaY > 0 && isAtVeryBottom)) {
					// Prevent default to stop inner container from handling
					e.preventDefault()

					const boost = 0.15
					velocity += e.deltaY * boost

					// Start animation if not already running
					if (!animationFrameId) {
						animationFrameId = requestAnimationFrame(animate)
					}
				}
			}

			// Add wheel event listener to inner container
			const preElement = preRef.current
			preElement.addEventListener("wheel", handleWheel, { passive: false })

			// Clean up
			return () => {
				preElement.removeEventListener("wheel", handleWheel)

				// Cancel any ongoing animation
				if (animationFrameId) {
					cancelAnimationFrame(animationFrameId)
				}
			}
		}, [])

		// Track text selection state
		const [isSelecting, setIsSelecting] = useState(false)

		useEffect(() => {
			if (!preRef.current) return

			const handleMouseDown = (e: MouseEvent) => {
				// Only trigger if clicking the pre element directly
				if (e.currentTarget === preRef.current) {
					setIsSelecting(true)
				}
			}

			const handleMouseUp = () => {
				setIsSelecting(false)
			}

			const preElement = preRef.current
			preElement.addEventListener("mousedown", handleMouseDown)
			document.addEventListener("mouseup", handleMouseUp)

			return () => {
				preElement.removeEventListener("mousedown", handleMouseDown)
				document.removeEventListener("mouseup", handleMouseUp)
			}
		}, [])

		const handleCopy = useCallback(
			(e: React.MouseEvent) => {
				e.stopPropagation()

				// Check if code block is partially visible before allowing copy
				const codeBlock = codeBlockRef.current
				if (!codeBlock || codeBlock.getAttribute("data-partially-visible") !== "true") {
					return
				}
				const textToCopy = rawSource !== undefined ? rawSource : source || ""
				if (textToCopy) {
					copyWithFeedback(textToCopy, e)
				}
			},
			[source, rawSource, copyWithFeedback],
		)

		if (source?.length === 0) {
			return null
		}

		return (
			<CodeBlockContainer ref={codeBlockRef}>
				<MemoizedStyledPre
					preRef={preRef}
					preStyle={preStyle}
					wordWrap={wordWrap}
					windowShade={windowShade}
					collapsedHeight={collapsedHeight}
					highlightedCode={highlightedCode}
					updateCodeBlockButtonPosition={updateCodeBlockButtonPosition}
				/>
				{!isSelecting && (
					<CodeBlockButtonWrapper
						ref={copyButtonWrapperRef}
						onMouseOver={() => updateCodeBlockButtonPosition()}
						className="gap-0">
						{language && (
							<LanguageSelect
								value={currentLanguage}
								style={{
									width: `calc(${currentLanguage?.length || 0}ch + 9px)`,
								}}
								onClick={(e) => {
									e.currentTarget.focus()
								}}
								onChange={(e) => {
									const newLang = normalizeLanguage(e.target.value)
									userChangedLanguageRef.current = true
									setCurrentLanguage(newLang)
									if (onLanguageChange) {
										onLanguageChange(newLang)
									}
								}}>
								{
									// Display original language at top of list for quick selection
									language && (
										<option
											value={normalizeLanguage(language)}
											className="font-bold text-left text-[1.2em]">
											{normalizeLanguage(language)}
										</option>
									)
								}
								{
									// Display all available languages in alphabetical order
									Object.keys(bundledLanguages)
										.sort()
										.map((lang) => {
											const normalizedLang = normalizeLanguage(lang)
											return (
												<option
													key={normalizedLang}
													value={normalizedLang}
													className={cn(
														"text-left",
														normalizedLang === currentLanguage
															? "font-bold text-[1.2em]"
															: "font-normal",
													)}>
													{normalizedLang}
												</option>
											)
										})
								}
							</LanguageSelect>
						)}
						{showCollapseButton && (
							<CodeBlockButton
								onClick={() => {
									// Get the current code block element and scrollable container
									const codeBlock = codeBlockRef.current
									const scrollContainer = document.querySelector('[data-virtuoso-scroller="true"]')
									if (!codeBlock || !scrollContainer) return

									// Toggle window shade state
									setWindowShade(!windowShade)

									// After UI updates, ensure code block is visible and update button position
									setTimeout(
										() => {
											codeBlock.scrollIntoView({ behavior: "smooth", block: "nearest" })

											// Wait for scroll to complete before updating button position
											setTimeout(() => {
												updateCodeBlockButtonPosition()
											}, 50)
										},
										WINDOW_SHADE_SETTINGS.transitionDelayS * 1000 + 50,
									)
								}}
								title={t(`chat:codeblock.tooltips.${windowShade ? "expand" : "collapse"}`)}>
								{windowShade ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
							</CodeBlockButton>
						)}
						<CodeBlockButton
							onClick={() => setWordWrap(!wordWrap)}
							title={t(`chat:codeblock.tooltips.${wordWrap ? "disable_wrap" : "enable_wrap"}`)}>
							{wordWrap ? <AlignJustify size={16} /> : <WrapText size={16} />}
						</CodeBlockButton>
						<CodeBlockButton onClick={handleCopy} title={t("chat:codeblock.tooltips.copy_code")}>
							{showCopyFeedback ? <Check size={16} /> : <Copy size={16} />}
						</CodeBlockButton>
					</CodeBlockButtonWrapper>
				)}
			</CodeBlockContainer>
		)
	},
)

// Memoized content component to prevent unnecessary re-renders of highlighted code
const MemoizedCodeContent = memo(({ html }: { html: string }) => <div dangerouslySetInnerHTML={{ __html: html }} />)

// Memoized StyledPre component
const MemoizedStyledPre = memo(
	({
		preRef,
		preStyle,
		wordWrap,
		windowShade,
		collapsedHeight,
		highlightedCode,
		updateCodeBlockButtonPosition,
	}: {
		preRef: React.RefObject<HTMLDivElement>
		preStyle?: React.CSSProperties
		wordWrap: boolean
		windowShade: boolean
		collapsedHeight?: number
		highlightedCode: string
		updateCodeBlockButtonPosition: (forceHide?: boolean) => void
	}) => (
		<StyledPre
			ref={preRef}
			preStyle={preStyle}
			wordwrap={wordWrap ? "true" : "false"}
			windowshade={windowShade ? "true" : "false"}
			collapsedHeight={collapsedHeight}
			onMouseDown={() => updateCodeBlockButtonPosition(true)}
			onMouseUp={() => updateCodeBlockButtonPosition(false)}>
			<MemoizedCodeContent html={highlightedCode} />
		</StyledPre>
	),
)

export default CodeBlock
