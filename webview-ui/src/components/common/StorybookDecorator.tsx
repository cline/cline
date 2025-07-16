import React from "react"
import { ClineAuthProvider } from "@/context/ClineAuthContext"
import { ExtensionStateContextProvider, useExtensionState } from "@/context/ExtensionStateContext"
import { ExtensionState } from "@shared/ExtensionMessage"
import { Decorator } from "@storybook/react-vite"
import { CustomPostHogProvider } from "@/CustomPostHogProvider"

// Inner component that uses the context
const StorybookStateUpdater: React.FC<{
	children: React.ReactNode
	mockState?: Partial<ExtensionState>
}> = ({ mockState, children }) => {
	const { updateExtensionState } = useExtensionState()

	React.useEffect(() => {
		if (mockState) {
			updateExtensionState(mockState)
		}
	}, [mockState, updateExtensionState])

	return <div style={{ maxWidth: "800px", margin: "0 auto" }}>{children}</div>
}

export const StorybookProvider: React.FC<{
	children: React.ReactNode
	mockState?: Partial<ExtensionState>
}> = ({ mockState, children }) => {
	return (
		<ExtensionStateContextProvider>
			<CustomPostHogProvider>
				<ClineAuthProvider>
					<div style={{ maxWidth: "600px", margin: "0 auto", padding: "16px" }}>
						<StorybookStateUpdater mockState={mockState}>{children}</StorybookStateUpdater>
					</div>
				</ClineAuthProvider>
			</CustomPostHogProvider>
		</ExtensionStateContextProvider>
	)
}

export function VSCodeDecorator(className: string | undefined): Decorator {
	return (story, parameters) => {
		return (
			<ExtensionStateContextProvider>
				<CustomPostHogProvider>
					<ClineAuthProvider>
						<div className={className} style={{ maxWidth: "600px", margin: "0 auto", padding: "16px" }}>
							{React.createElement(story)}
						</div>
					</ClineAuthProvider>
				</CustomPostHogProvider>
			</ExtensionStateContextProvider>
		)
	}
}

export const VSCodeWebview = VSCodeDecorator("w-1/2")
