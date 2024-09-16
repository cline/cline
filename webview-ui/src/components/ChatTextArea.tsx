import React, { forwardRef, useState, useCallback, useEffect } from "react"
import DynamicTextArea from "react-textarea-autosize"
import Thumbnails from "./Thumbnails"
import { MAX_IMAGES_PER_MESSAGE } from "./ChatView"

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
		ref
	) => {
		const [isTextAreaFocused, setIsTextAreaFocused] = useState(false)
		const [thumbnailsHeight, setThumbnailsHeight] = useState(0)
		const [textAreaBaseHeight, setTextAreaBaseHeight] = useState<number | undefined>(undefined)

		const handleKeyDown = useCallback(
			(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
				const isComposing = event.nativeEvent?.isComposing ?? false
				if (event.key === "Enter" && !event.shiftKey && !isComposing) {
					event.preventDefault()
					onSend()
				}
			},
			[onSend]
		)

		const handlePaste = useCallback(
			async (e: React.ClipboardEvent) => {
				const items = e.clipboardData.items
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
			[shouldDisableImages, setSelectedImages]
		)

		const handleThumbnailsHeightChange = useCallback((height: number) => {
			setThumbnailsHeight(height)
		}, [])

		useEffect(() => {
			if (selectedImages.length === 0) {
				setThumbnailsHeight(0)
			}
		}, [selectedImages])

		return (
			<div
				style={{
					padding: "10px 15px",
					opacity: textAreaDisabled ? 0.5 : 1,
					position: "relative",
					display: "flex",
				}}>
				{!isTextAreaFocused && (
					<div
						style={{
							position: "absolute",
							inset: "10px 15px",
							border: "1px solid var(--vscode-input-border)",
							borderRadius: 2,
							pointerEvents: "none",
						}}
					/>
				)}
				<DynamicTextArea
					ref={ref}
					value={inputValue}
					disabled={textAreaDisabled}
					onChange={(e) => setInputValue(e.target.value)}
					onKeyDown={handleKeyDown}
					onFocus={() => setIsTextAreaFocused(true)}
					onBlur={() => setIsTextAreaFocused(false)}
					onPaste={handlePaste}
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
						backgroundColor: "var(--vscode-input-background)",
						color: "var(--vscode-input-foreground)",
						//border: "1px solid var(--vscode-input-border)",
						borderRadius: 2,
						fontFamily: "var(--vscode-font-family)",
						fontSize: "var(--vscode-editor-font-size)",
						lineHeight: "var(--vscode-editor-line-height)",
						resize: "none",
						overflow: "hidden",
						// Since we have maxRows, when text is long enough it starts to overflow the bottom padding, appearing behind the thumbnails. To fix this, we use a transparent border to push the text up instead. (https://stackoverflow.com/questions/42631947/maintaining-a-padding-inside-of-text-area/52538410#52538410)
						borderTop: "9px solid transparent",
						borderBottom: `${thumbnailsHeight + 9}px solid transparent`,
						borderColor: "transparent",
						// borderRight: "54px solid transparent",
						// borderLeft: "9px solid transparent", // NOTE: react-textarea-autosize doesn't calculate correct height when using borderLeft/borderRight so we need to use horizontal padding instead
						// Instead of using boxShadow, we use a div with a border to better replicate the behavior when the textarea is focused
						// boxShadow: "0px 0px 0px 1px var(--vscode-input-border)",
						padding: "0 49px 0 9px",
						cursor: textAreaDisabled ? "not-allowed" : undefined,
						flex: 1,
					}}
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
							right: 67, // (54 + 9) + 4 extra padding
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
						bottom: 9, // should be 10 but doesnt look good on mac
					}}>
					<div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
						<div
							className={`input-icon-button ${
								shouldDisableImages ? "disabled" : ""
							} codicon codicon-device-camera`}
							onClick={() => {
								if (!shouldDisableImages) {
									onSelectImages()
								}
							}}
							style={{
								marginRight: 5.5,
								fontSize: 16.5,
							}}
						/>
						<div
							className={`input-icon-button ${textAreaDisabled ? "disabled" : ""} codicon codicon-send`}
							onClick={() => {
								if (!textAreaDisabled) {
									onSend()
								}
							}}
							style={{ fontSize: 15 }}></div>
					</div>
				</div>
			</div>
		)
	}
)

export default ChatTextArea
