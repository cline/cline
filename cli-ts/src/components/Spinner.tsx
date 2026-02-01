/**
 * Loading spinner component using ink-spinner
 */

import { Box, Text } from "ink"
import Spinner from "ink-spinner"
import React from "react"

interface LoadingSpinnerProps {
	message?: string
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ message = "Thinking..." }) => {
	return (
		<Box>
			<Text color="cyan">
				<Spinner type="dots" />
			</Text>
			<Text color="cyan"> {message}</Text>
		</Box>
	)
}
