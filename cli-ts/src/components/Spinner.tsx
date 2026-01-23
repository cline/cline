/**
 * Loading spinner component using ink-spinner
 */

import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import React from "react"

interface LoadingSpinnerProps {
	message?: string
}

const LOADING_TEXT_IDEAS = ["Thinking", "Loading", "Processing", "Working", "Calculating", "Analyzing", "Exploring"]

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
	message = LOADING_TEXT_IDEAS[Math.floor(Math.random() * LOADING_TEXT_IDEAS.length)],
}) => {
	return (
		<Box>
			<Text color="cyan">
				<Spinner type="dots" />
			</Text>
			<Text color="cyan"> {message}...</Text>
		</Box>
	)
}
