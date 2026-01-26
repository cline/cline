/**
 * Component for displaying images in terminal
 * Handles both local file paths and data URLs
 */

import fs from "fs/promises"
import { Box, Text } from "ink"
import Image, { useTerminalCapabilities } from "ink-picture"
import os from "os"
import path from "path"
import React, { useEffect, useState } from "react"

interface MessageImageProps {
	/** Image source - can be a file path or data URL */
	src: string
	/** Optional width in terminal columns */
	width?: number
	/** Optional height in terminal rows */
	height?: number
	/** Show caption below image */
	caption?: string
}

const MessageImageComponent: React.FC<MessageImageProps> = ({ src, width = 80, caption }) => {
	const [imagePath, setImagePath] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)
	const terminalCapabilities = useTerminalCapabilities()
	const isDataUrl = src.startsWith("data:")
	const displayPath = isDataUrl ? "[data URL]" : src

	// Check if terminal can render images
	const canRenderImages = terminalCapabilities?.supportsColor && terminalCapabilities?.supportsUnicode

	// If terminal doesn't support rendering, show simple text instead
	if (terminalCapabilities && !canRenderImages) {
		return (
			<Box marginY={1}>
				<Text dimColor>📎 Image attached: {displayPath}</Text>
			</Box>
		)
	}

	useEffect(() => {
		let tempFilePath: string | null = null

		const setupImage = async () => {
			if (isDataUrl) {
				// Convert data URL to temporary file for ink-picture/sharp to read
				try {
					// Extract base64 data and mime type
					const matches = src.match(/^data:([^;]+);base64,(.+)$/)
					if (!matches) {
						setError("Invalid data URL format")
						return
					}

					const mimeType = matches[1]
					const base64Data = matches[2]
					const buffer = Buffer.from(base64Data, "base64")

					// Determine file extension from mime type
					const extension = mimeType.split("/")[1] || "png"

					// Create temporary file
					tempFilePath = path.join(os.tmpdir(), `cline-image-${Date.now()}.${extension}`)
					await fs.writeFile(tempFilePath, buffer)
					setImagePath(tempFilePath)
				} catch (err) {
					setError(err instanceof Error ? err.message : String(err))
				}
			} else {
				// Use file path directly
				setImagePath(src)
			}
		}

		setupImage()

		// Cleanup: remove temp file when component unmounts
		return () => {
			if (tempFilePath) {
				fs.unlink(tempFilePath).catch(() => {
					// Ignore cleanup errors
				})
			}
		}
	}, [src, isDataUrl])

	if (error) {
		return (
			<Box flexDirection="column" marginY={1}>
				{caption && (
					<Text dimColor italic>
						{caption}
					</Text>
				)}
				<Text color="red">Failed to load image: {displayPath}</Text>
				<Text dimColor>{error}</Text>
			</Box>
		)
	}

	if (!imagePath) {
		return (
			<Box flexDirection="column" marginY={1}>
				{caption && (
					<Text dimColor italic>
						{caption}
					</Text>
				)}
				<Text dimColor>Loading image...</Text>
			</Box>
		)
	}

	return (
		<Box flexDirection="column" marginY={1}>
			{caption && (
				<Text dimColor italic>
					{caption}
				</Text>
			)}
			<Image alt={displayPath} src={imagePath} width={width} />
			<Text dimColor italic>
				{displayPath}
			</Text>
		</Box>
	)
}

// Memoize to prevent unnecessary re-renders during streaming
export const MessageImage = React.memo(MessageImageComponent)
