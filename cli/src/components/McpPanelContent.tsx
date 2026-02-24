/**
 * MCP panel content for inline display in ChatView
 * Shows installed MCP servers with enable/disable toggle
 */

import type { McpServer } from "@shared/mcp"
import { Box, Text, useInput } from "ink"
import React, { useCallback, useEffect, useRef, useState } from "react"
import type { Controller } from "@/core/controller"
import { useStdinContext } from "../context/StdinContext"
import { isMouseEscapeSequence } from "../utils/input"
import { Panel } from "./Panel"

interface McpPanelContentProps {
	controller: Controller
	onClose: () => void
}

const MAX_VISIBLE = 8

export const McpPanelContent: React.FC<McpPanelContentProps> = ({ controller, onClose }) => {
	const { isRawModeSupported } = useStdinContext()
	const [servers, setServers] = useState<McpServer[]>([])
	const [selectedIndex, setSelectedIndex] = useState(0)
	const [isLoading, setIsLoading] = useState(true)

	const pollRef = useRef<NodeJS.Timeout | null>(null)

	// Fetch latest server state from McpHub
	const refreshServers = useCallback(async () => {
		const hub = controller.mcpHub
		if (!hub) return
		try {
			const mcpServers = (await hub.getLatestMcpServersRPC()) || []
			setServers(mcpServers)
		} catch {
			// Ignore transient errors during polling
		}
	}, [controller])

	// Load MCP servers on mount, poll while any server is still connecting
	useEffect(() => {
		const hub = controller.mcpHub
		if (!hub) {
			setIsLoading(false)
			return
		}

		const load = async () => {
			// Wait for McpHub's initial connection sweep
			const maxWait = 5000
			const start = Date.now()
			while (hub.isConnecting && Date.now() - start < maxWait) {
				await new Promise((r) => setTimeout(r, 200))
			}
			await refreshServers()
			setIsLoading(false)
		}
		load()

		// Poll every second to pick up status changes (connecting → connected)
		pollRef.current = setInterval(refreshServers, 1000)
		return () => {
			if (pollRef.current) clearInterval(pollRef.current)
		}
	}, [controller, refreshServers])

	// Handle toggle
	const handleToggle = useCallback(async () => {
		const server = servers[selectedIndex]
		if (!server) return

		const newDisabled = !server.disabled

		// Optimistic update
		setServers((prev) => prev.map((s) => (s.name === server.name ? { ...s, disabled: newDisabled } : s)))

		try {
			const updated = await controller.mcpHub?.toggleServerDisabledRPC(server.name, newDisabled)
			if (updated) {
				setServers(updated)
			}
		} catch {
			// Revert on failure
			setServers((prev) => prev.map((s) => (s.name === server.name ? { ...s, disabled: !newDisabled } : s)))
		}
	}, [controller, servers, selectedIndex])

	useInput(
		(input, key) => {
			if (isMouseEscapeSequence(input)) {
				return
			}
			if (key.escape) {
				onClose()
				return
			}
			if (key.upArrow || input === "k") {
				setSelectedIndex((i) => (i > 0 ? i - 1 : servers.length - 1))
				return
			}
			if (key.downArrow || input === "j") {
				setSelectedIndex((i) => (i < servers.length - 1 ? i + 1 : 0))
				return
			}
			if ((key.return || input === " ") && servers.length > 0) {
				handleToggle()
				return
			}
		},
		{ isActive: isRawModeSupported },
	)

	// Scrolling window
	const halfVisible = Math.floor(MAX_VISIBLE / 2)
	const startIndex = Math.max(0, Math.min(selectedIndex - halfVisible, servers.length - MAX_VISIBLE))

	if (isLoading) {
		return (
			<Panel label="MCP Servers">
				<Text color="gray">Loading MCP servers...</Text>
			</Panel>
		)
	}

	return (
		<Panel label="MCP Servers">
			<Box flexDirection="column" gap={1}>
				{servers.length === 0 ? (
					<Text color="gray">No MCP servers installed.</Text>
				) : (
					<Box flexDirection="column">
						{servers.slice(startIndex, startIndex + MAX_VISIBLE).map((server, idx) => {
							const actualIndex = startIndex + idx
							const isSelected = actualIndex === selectedIndex
							const enabled = !server.disabled
							const statusColor = server.disabled
								? "gray"
								: server.status === "connected"
									? "green"
									: server.status === "connecting"
										? "yellow"
										: "red"
							const statusLabel = server.disabled ? "disabled" : server.status
							return (
								<Box flexDirection="column" key={server.name}>
									<Box>
										<Text color={isSelected ? "cyan" : undefined}>
											{isSelected ? "❯ " : "  "}
											<Text color={enabled ? "green" : "red"}>{enabled ? "[✓]" : "[ ]"}</Text>
											<Text> </Text>
											<Text bold color="white">
												{server.name}
											</Text>
											<Text color={statusColor}> ({statusLabel})</Text>
										</Text>
									</Box>
								</Box>
							)
						})}
					</Box>
				)}

				{/* Help text */}
				{servers.length > 0 && (
					<Box marginTop={1}>
						<Text color="gray">↑/↓ Navigate • Space/Enter Toggle</Text>
					</Box>
				)}
			</Box>
		</Panel>
	)
}
