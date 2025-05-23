import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useEffect, useRef, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { vscode } from "@/utils/vscode"
import { CODE_BLOCK_BG_COLOR } from "../common/CodeBlock"
import { BrowserServiceClient, UiServiceClient } from "../../services/grpc-client"

interface ConnectionInfo {
	isConnected: boolean
	isRemote: boolean
	host?: string
}

export const BrowserSettingsMenu = () => {
	const { browserSettings, navigateToSettings } = useExtensionState()
	const containerRef = useRef<HTMLDivElement>(null)
	const [showInfoPopover, setShowInfoPopover] = useState(false)
	const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo>({
		isConnected: false,
		isRemote: !!browserSettings.remoteBrowserEnabled,
		host: browserSettings.remoteBrowserHost,
	})
	const popoverRef = useRef<HTMLDivElement>(null)

	// Get actual connection info from the browser session using gRPC
	useEffect(() => {
		// Function to fetch connection info
		;(async () => {
			try {
				console.log("[DEBUG] SENDING BROWSER CONNECTION INFO REQUEST")
				const info = await BrowserServiceClient.getBrowserConnectionInfo({})
				console.log("[DEBUG] GOT BROWSER REPLY:", info, typeof info)
				setConnectionInfo({
					isConnected: info.isConnected,
					isRemote: info.isRemote,
					host: info.host,
				})
			} catch (error) {
				console.error("Error fetching browser connection info:", error)
			}
		})()

		// No need for message event listeners anymore!
	}, [browserSettings.remoteBrowserHost, browserSettings.remoteBrowserEnabled])

	// Close popover when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				popoverRef.current &&
				!popoverRef.current.contains(event.target as Node) &&
				!event.composedPath().some((el) => (el as HTMLElement).classList?.contains("browser-info-icon"))
			) {
				setShowInfoPopover(false)
			}
		}

		if (showInfoPopover) {
			document.addEventListener("mousedown", handleClickOutside)
		}
		return () => {
			document.removeEventListener("mousedown", handleClickOutside)
		}
	}, [showInfoPopover])

	const openBrowserSettings = () => {
		// First open the settings panel using direct navigation
		navigateToSettings()

		// After a short delay, send a message to scroll to browser settings
		setTimeout(async () => {
			try {
				await UiServiceClient.scrollToSettings({ value: "browser" })
			} catch (error) {
				console.error("Error scrolling to browser settings:", error)
			}
		}, 300) // Give the settings panel time to open
	}

	const toggleInfoPopover = () => {
		setShowInfoPopover(!showInfoPopover)

		// Request updated connection info when opening the popover using gRPC
		if (!showInfoPopover) {
			const fetchConnectionInfo = async () => {
				try {
					const info = await BrowserServiceClient.getBrowserConnectionInfo({})
					setConnectionInfo({
						isConnected: info.isConnected,
						isRemote: info.isRemote,
						host: info.host,
					})
				} catch (error) {
					console.error("Error fetching browser connection info:", error)
				}
			}

			fetchConnectionInfo()
		}
	}

	// Determine icon based on connection state
	const getIconClass = () => {
		if (connectionInfo.isRemote) {
			return "codicon-remote"
		} else {
			return connectionInfo.isConnected ? "codicon-vm-running" : "codicon-info"
		}
	}

	// Determine icon color based on connection state
	const getIconColor = () => {
		if (connectionInfo.isRemote) {
			return connectionInfo.isConnected ? "var(--vscode-charts-blue)" : "var(--vscode-foreground)"
		} else if (connectionInfo.isConnected) {
			return "var(--vscode-charts-green)"
		} else {
			return "var(--vscode-foreground)"
		}
	}

	// Check connection status every second to keep icon in sync using gRPC
	useEffect(() => {
		// Function to fetch connection info
		const fetchConnectionInfo = async () => {
			try {
				const info = await BrowserServiceClient.getBrowserConnectionInfo({})
				setConnectionInfo({
					isConnected: info.isConnected,
					isRemote: info.isRemote,
					host: info.host,
				})
			} catch (error) {
				console.error("Error fetching browser connection info:", error)
			}
		}

		// Request connection info immediately
		fetchConnectionInfo()

		// Set up interval to refresh every second
		const intervalId = setInterval(fetchConnectionInfo, 1000)

		return () => clearInterval(intervalId)
	}, [])

	return (
		<div ref={containerRef} style={{ position: "relative", marginTop: "-1px", display: "flex" }}>
			<VSCodeButton
				appearance="icon"
				className="browser-info-icon"
				onClick={toggleInfoPopover}
				title="Browser connection info"
				style={{ marginRight: "4px" }}>
				<i
					className={`codicon ${getIconClass()}`}
					style={{
						fontSize: "14.5px",
						color: getIconColor(),
					}}
				/>
			</VSCodeButton>

			{showInfoPopover && (
				<InfoPopover ref={popoverRef}>
					<h4 style={{ margin: "0 0 8px 0" }}>Browser Connection</h4>
					<InfoRow>
						<InfoLabel>Status:</InfoLabel>
						<InfoValue
							style={{
								color: connectionInfo.isConnected
									? "var(--vscode-charts-green)"
									: "var(--vscode-errorForeground)",
							}}>
							{connectionInfo.isConnected ? "Connected" : "Disconnected"}
						</InfoValue>
					</InfoRow>
					{connectionInfo.isConnected && (
						<InfoRow>
							<InfoLabel>Type:</InfoLabel>
							<InfoValue>{connectionInfo.isRemote ? "Remote" : "Local"}</InfoValue>
						</InfoRow>
					)}
					{connectionInfo.isConnected && connectionInfo.isRemote && connectionInfo.host && (
						<InfoRow>
							<InfoLabel>Remote Host:</InfoLabel>
							<InfoValue>{connectionInfo.host}</InfoValue>
						</InfoRow>
					)}
				</InfoPopover>
			)}

			<VSCodeButton appearance="icon" onClick={openBrowserSettings}>
				<i className="codicon codicon-settings-gear" style={{ fontSize: "14.5px" }} />
			</VSCodeButton>
		</div>
	)
}

const InfoPopover = styled.div`
	position: absolute;
	top: 30px;
	right: 0;
	background-color: var(--vscode-editorWidget-background);
	border: 1px solid var(--vscode-widget-border);
	border-radius: 4px;
	padding: 10px;
	z-index: 100;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	width: 60dvw;
	max-width: 250px;
`

const InfoRow = styled.div`
	display: flex;
	margin-bottom: 4px;
	flex-wrap: wrap;
	white-space: nowrap;
`

const InfoLabel = styled.div`
	flex: 0 0 90px;
	font-weight: 500;
`

const InfoValue = styled.div`
	flex: 1;
	word-break: break-word;
`

export default BrowserSettingsMenu
