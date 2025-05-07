import React, { useState } from "react"
import { Trans } from "react-i18next"
import {
	VSCodeButton,
	VSCodeCheckbox,
	VSCodeLink,
	VSCodePanels,
	VSCodePanelTab,
	VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react"

import { McpServer } from "@roo/shared/mcp"

import { vscode } from "@src/utils/vscode"
import { useExtensionState } from "@src/context/ExtensionStateContext"
import { useAppTranslation } from "@src/i18n/TranslationContext"
import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from "@src/components/ui"
import { cn } from "@/lib/utils" // Import cn utility

import { Tab, TabContent, TabHeader } from "../common/Tab"

import McpToolRow from "./McpToolRow"
import McpResourceRow from "./McpResourceRow"
import McpEnabledToggle from "./McpEnabledToggle"
import { McpErrorRow } from "./McpErrorRow"

type McpViewProps = {
	onDone: () => void
}

const McpView = ({ onDone }: McpViewProps) => {
	const {
		mcpServers: servers,
		alwaysAllowMcp,
		mcpEnabled,
		enableMcpServerCreation,
		setEnableMcpServerCreation,
	} = useExtensionState()

	const { t } = useAppTranslation()

	return (
		<Tab>
			<TabHeader className="flex justify-between items-center">
				<h3 className="text-vscode-foreground m-0">{t("mcp:title")}</h3>
				<Button onClick={onDone}>{t("mcp:done")}</Button>
			</TabHeader>

			<TabContent>
				<div className="text-vscode-foreground text-[13px] mb-[10px] mt-[5px]">
					<Trans i18nKey="mcp:description">
						<VSCodeLink href="https://github.com/modelcontextprotocol" className="inline">
							Model Context Protocol
						</VSCodeLink>
						<VSCodeLink href="https://github.com/modelcontextprotocol/servers" className="inline">
							community-made servers
						</VSCodeLink>
					</Trans>
				</div>

				<McpEnabledToggle />

				{mcpEnabled && (
					<>
						<div className="mb-[15px]">
							<VSCodeCheckbox
								checked={enableMcpServerCreation}
								onChange={(e: any) => {
									setEnableMcpServerCreation(e.target.checked)
									vscode.postMessage({ type: "enableMcpServerCreation", bool: e.target.checked })
								}}>
								<span className="font-medium">{t("mcp:enableServerCreation.title")}</span>
							</VSCodeCheckbox>
							<p className="text-xs mt-[5px] text-vscode-descriptionForeground">
								{t("mcp:enableServerCreation.description")}
							</p>
						</div>

						{/* Server List */}
						{servers.length > 0 && (
							<div className="flex flex-col gap-[10px]">
								{servers.map((server) => (
									<ServerRow
										key={`${server.name}-${server.source || "global"}`}
										server={server}
										alwaysAllowMcp={alwaysAllowMcp}
									/>
								))}
							</div>
						)}

						{/* Edit Settings Buttons */}
						<div className="mt-[10px] w-full flex gap-[10px]">
							<Button
								variant="secondary"
								className="flex-1"
								onClick={() => {
									vscode.postMessage({ type: "openMcpSettings" })
								}}>
								<span className="codicon codicon-edit mr-[6px]"></span>
								{t("mcp:editGlobalMCP")}
							</Button>
							<Button
								variant="secondary"
								className="flex-1"
								onClick={() => {
									vscode.postMessage({ type: "openProjectMcpSettings" })
								}}>
								<span className="codicon codicon-edit mr-[6px]"></span>
								{t("mcp:editProjectMCP")}
							</Button>
						</div>
					</>
				)}
			</TabContent>
		</Tab>
	)
}

const ServerRow = ({ server, alwaysAllowMcp }: { server: McpServer; alwaysAllowMcp?: boolean }) => {
	const { t } = useAppTranslation()
	const [isExpanded, setIsExpanded] = useState(false)
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
	const [timeoutValue, setTimeoutValue] = useState(() => {
		const configTimeout = JSON.parse(server.config)?.timeout
		return configTimeout ?? 60 // Default 1 minute (60 seconds)
	})

	const timeoutOptions = [
		{ value: 15, label: t("mcp:networkTimeout.options.15seconds") },
		{ value: 30, label: t("mcp:networkTimeout.options.30seconds") },
		{ value: 60, label: t("mcp:networkTimeout.options.1minute") },
		{ value: 300, label: t("mcp:networkTimeout.options.5minutes") },
		{ value: 600, label: t("mcp:networkTimeout.options.10minutes") },
		{ value: 900, label: t("mcp:networkTimeout.options.15minutes") },
		{ value: 1800, label: t("mcp:networkTimeout.options.30minutes") },
		{ value: 3600, label: t("mcp:networkTimeout.options.60minutes") },
	]

	const handleRowClick = () => {
		if (server.status === "connected") {
			setIsExpanded(!isExpanded)
		}
	}

	const handleRestart = () => {
		vscode.postMessage({
			type: "restartMcpServer",
			text: server.name,
			source: server.source || "global",
		})
	}

	const handleTimeoutChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const seconds = parseInt(event.target.value)
		setTimeoutValue(seconds)
		vscode.postMessage({
			type: "updateMcpTimeout",
			serverName: server.name,
			source: server.source || "global",
			timeout: seconds,
		})
	}

	const handleDelete = () => {
		vscode.postMessage({
			type: "deleteMcpServer",
			serverName: server.name,
			source: server.source || "global",
		})
		setShowDeleteConfirm(false)
	}

	return (
		<div className="mb-[10px]">
			<div
				className={cn(
					"flex items-center p-[8px] bg-vscode-textCodeBlock-background",
					server.status === "connected" ? "cursor-pointer" : "cursor-default",
					isExpanded || server.status === "connected" ? "rounded-[4px]" : "rounded-t-[4px]",
					server.disabled ? "opacity-60" : "opacity-100",
				)}
				onClick={handleRowClick}>
				{server.status === "connected" && (
					<span className={`codicon codicon-chevron-${isExpanded ? "down" : "right"} mr-[8px]`} />
				)}
				<span className="flex-1">
					{server.name}
					{server.source && (
						<span className="ml-[8px] px-[6px] py-[1px] text-[11px] rounded-[4px] bg-vscode-badge-background text-vscode-badge-foreground">
							{server.source}
						</span>
					)}
				</span>
				<div className="flex items-center mr-[8px]" onClick={(e) => e.stopPropagation()}>
					<Button variant="ghost" size="icon" onClick={() => setShowDeleteConfirm(true)} className="mr-[8px]">
						<span className="codicon codicon-trash text-[14px]"></span>
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleRestart}
						disabled={server.status === "connecting"}
						className="mr-[8px]">
						<span className="codicon codicon-refresh text-[14px]"></span>
					</Button>
					<div
						role="switch"
						aria-checked={!server.disabled}
						tabIndex={0}
						className={cn(
							"w-[20px] h-[10px] rounded-[5px] relative cursor-pointer transition-colors duration-200",
							server.disabled
								? "bg-vscode-titleBar-inactiveForeground opacity-40"
								: "bg-vscode-button-background opacity-80",
						)}
						onClick={() => {
							vscode.postMessage({
								type: "toggleMcpServer",
								serverName: server.name,
								source: server.source || "global",
								disabled: !server.disabled,
							})
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault()
								vscode.postMessage({
									type: "toggleMcpServer",
									serverName: server.name,
									source: server.source || "global",
									disabled: !server.disabled,
								})
							}
						}}>
						<div
							className={cn(
								"w-[6px] h-[6px] bg-vscode-titleBar-activeForeground rounded-full absolute top-[2px] transition-all duration-200",
								server.disabled ? "left-[2px]" : "left-[12px]",
							)}
						/>
					</div>
				</div>
				<div
					className={cn("w-[8px] h-[8px] rounded-full ml-[8px]", {
						"bg-vscode-testing-iconPassed": server.status === "connected",
						"bg-vscode-charts-yellow": server.status === "connecting",
						"bg-vscode-testing-iconFailed": server.status === "disconnected",
					})}
				/>
			</div>

			{server.status === "connected" ? (
				isExpanded && (
					<div className="bg-vscode-textCodeBlock-background px-[10px] pb-[10px] text-[13px] rounded-b-[4px]">
						<VSCodePanels className="mb-[10px]">
							<VSCodePanelTab id="tools">
								{t("mcp:tabs.tools")} ({server.tools?.length || 0})
							</VSCodePanelTab>
							<VSCodePanelTab id="resources">
								{t("mcp:tabs.resources")} (
								{[...(server.resourceTemplates || []), ...(server.resources || [])].length || 0})
							</VSCodePanelTab>
							<VSCodePanelTab id="errors">
								{t("mcp:tabs.errors")} ({server.errorHistory?.length || 0})
							</VSCodePanelTab>

							<VSCodePanelView id="tools-view">
								{server.tools && server.tools.length > 0 ? (
									<div className="flex flex-col gap-[8px] w-full">
										{server.tools.map((tool) => (
											<McpToolRow
												key={`${tool.name}-${server.name}-${server.source || "global"}`}
												tool={tool}
												serverName={server.name}
												serverSource={server.source || "global"}
												alwaysAllowMcp={alwaysAllowMcp}
											/>
										))}
									</div>
								) : (
									<div className="py-[10px] text-vscode-descriptionForeground">
										{t("mcp:emptyState.noTools")}
									</div>
								)}
							</VSCodePanelView>

							<VSCodePanelView id="resources-view">
								{(server.resources && server.resources.length > 0) ||
								(server.resourceTemplates && server.resourceTemplates.length > 0) ? (
									<div className="flex flex-col gap-[8px] w-full">
										{[...(server.resourceTemplates || []), ...(server.resources || [])].map(
											(item) => (
												<McpResourceRow
													key={"uriTemplate" in item ? item.uriTemplate : item.uri}
													item={item}
												/>
											),
										)}
									</div>
								) : (
									<div className="py-[10px] text-vscode-descriptionForeground">
										{t("mcp:emptyState.noResources")}
									</div>
								)}
							</VSCodePanelView>

							<VSCodePanelView id="errors-view">
								{server.errorHistory && server.errorHistory.length > 0 ? (
									<div className="flex flex-col gap-[8px] w-full">
										{[...server.errorHistory]
											.sort((a, b) => b.timestamp - a.timestamp)
											.map((error, index) => (
												<McpErrorRow key={`${error.timestamp}-${index}`} error={error} />
											))}
									</div>
								) : (
									<div className="py-[10px] text-vscode-descriptionForeground">
										{t("mcp:emptyState.noErrors")}
									</div>
								)}
							</VSCodePanelView>
						</VSCodePanels>

						{/* Network Timeout */}
						<div className="px-[7px] py-[10px]">
							<div className="flex items-center gap-[10px] mb-[8px]">
								<span>{t("mcp:networkTimeout.label")}</span>
								<select
									value={timeoutValue}
									onChange={handleTimeoutChange}
									className="flex-1 p-[4px] bg-vscode-dropdown-background text-vscode-dropdown-foreground border border-vscode-dropdown-border rounded-[2px] outline-none cursor-pointer">
									{timeoutOptions.map((option) => (
										<option key={option.value} value={option.value}>
											{option.label}
										</option>
									))}
								</select>
							</div>
							<span className="text-xs text-vscode-descriptionForeground block">
								{t("mcp:networkTimeout.description")}
							</span>
						</div>
					</div>
				)
			) : (
				<div className="text-[13px] bg-vscode-textCodeBlock-background rounded-b-[4px] w-full">
					<div className="text-vscode-testing-iconFailed mb-[8px] px-[10px] overflow-wrap-break-word break-words">
						{server.error &&
							server.error.split("\n").map((item, index) => (
								<React.Fragment key={index}>
									{index > 0 && <br />}
									{item}
								</React.Fragment>
							))}
					</div>
					<VSCodeButton
						appearance="secondary"
						onClick={handleRestart}
						disabled={server.status === "connecting"}
						className="w-[calc(100%-20px)] mx-[10px] mb-[10px]">
						{server.status === "connecting" ? "Retrying..." : "Retry Connection"}
					</VSCodeButton>
				</div>
			)}

			{/* Delete Confirmation Dialog */}
			<Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("mcp:deleteDialog.title")}</DialogTitle>
						<DialogDescription>
							{t("mcp:deleteDialog.description", { serverName: server.name })}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="secondary" onClick={() => setShowDeleteConfirm(false)}>
							{t("mcp:deleteDialog.cancel")}
						</Button>
						<Button variant="default" onClick={handleDelete}>
							{t("mcp:deleteDialog.delete")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

export default McpView
