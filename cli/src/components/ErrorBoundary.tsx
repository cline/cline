import { Box, Text } from "ink"
import React from "react"
import { ErrorService } from "@/services/error"
import { StaticRobotFrame } from "./AsciiMotionCli"

type Props = React.PropsWithChildren<{ exit: (error?: Error) => void }>

async function onReactError(props: Props, error: Error, errorInfo: React.ErrorInfo) {
	try {
		await ErrorService.get().captureException(error, { context: "ErrorBoundary", errorInfo })
		await ErrorService.get().dispose()
	} catch {
		// Ignore errors
	} finally {
		props.exit(error)
	}
}

export class ErrorBoundary extends React.Component<Props, { hasError: boolean }> {
	override state = { hasError: false }

	constructor(props: Props) {
		super(props)
	}

	override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
		onReactError(this.props, error, errorInfo)
	}

	static getDerivedStateFromError() {
		return { hasError: true }
	}

	override render() {
		if (this.state.hasError) {
			return (
				<Box flexDirection="column" height="100%" key="header" width="100%">
					<StaticRobotFrame />
					<Text> </Text>
					<Text bold color="white">
						Something went wrong. We're sorry.
					</Text>
					<Text color="white">Please check the logs for more details.</Text>
					<Text> </Text>
				</Box>
			)
		}

		return this.props.children
	}
}
