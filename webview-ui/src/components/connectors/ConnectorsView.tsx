import { BUILTIN_CONNECTORS, type ConnectorDefinition, type ConnectorStatus } from "@shared/connectors"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { getEnvironmentColor } from "@/utils/environmentColors"

type ConnectorsTab = "catalog" | "custom" | "configure"

type ConnectorsViewProps = {
	onDone: () => void
}

const ConnectorsView = ({ onDone }: ConnectorsViewProps) => {
	const { environment } = useExtensionState()
	const [activeTab, setActiveTab] = useState<ConnectorsTab>("catalog")

	return (
		<div
			style={{
				position: "fixed",
				top: 0,
				left: 0,
				right: 0,
				bottom: 0,
				display: "flex",
				flexDirection: "column",
			}}>
			<div
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "10px 17px 5px 20px",
				}}>
				<h3 style={{ color: getEnvironmentColor(environment), margin: 0 }}>External Connectors</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			<div style={{ flex: 1, overflow: "auto" }}>
				<div
					style={{
						display: "flex",
						gap: "1px",
						padding: "0 20px",
						borderBottom: "1px solid var(--vscode-panel-border)",
					}}>
					<TabButton isActive={activeTab === "catalog"} onClick={() => setActiveTab("catalog")}>
						Catalog
					</TabButton>
					<TabButton isActive={activeTab === "custom"} onClick={() => setActiveTab("custom")}>
						Custom
					</TabButton>
					<TabButton isActive={activeTab === "configure"} onClick={() => setActiveTab("configure")}>
						Configure
					</TabButton>
				</div>

				<div style={{ width: "100%" }}>
					{activeTab === "catalog" && <CatalogTab />}
					{activeTab === "custom" && <CustomTab />}
					{activeTab === "configure" && <ConfigureTab />}
				</div>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Catalog tab — shows all built-in connectors
// ---------------------------------------------------------------------------

const CatalogTab = () => {
	return (
		<div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
			<p style={{ margin: 0, fontSize: "13px", color: "var(--vscode-descriptionForeground)" }}>
				Connect AI-Hydro to external data sources and compute services. Credentials are stored securely in VS Code's
				secret storage — never visible in the webview.
			</p>
			{BUILTIN_CONNECTORS.map((connector) => (
				<ConnectorCard connector={connector} key={connector.id} status="unknown" />
			))}
			<SubmitCard />
		</div>
	)
}

// ---------------------------------------------------------------------------
// Coming-soon / custom tabs (stubs)
// ---------------------------------------------------------------------------

const CustomTab = () => (
	<div style={{ padding: "20px", color: "var(--vscode-descriptionForeground)", fontSize: "13px" }}>
		<p>Custom connectors allow you to wire any external API into AI-Hydro's agent loop.</p>
		<p style={{ marginTop: "8px" }}>
			This tab will let you add connectors by supplying an OpenAPI spec, a base URL, and auth credentials.
		</p>
		<p style={{ marginTop: "8px", fontStyle: "italic" }}>Coming in a future release.</p>
	</div>
)

const ConfigureTab = () => {
	const connected = BUILTIN_CONNECTORS.filter((c) => !c.comingSoon)
	return (
		<div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
			{connected.length === 0 ? (
				<p style={{ color: "var(--vscode-descriptionForeground)", fontSize: "13px", margin: 0 }}>
					No connectors are configured yet. Install a connector from the Catalog tab.
				</p>
			) : (
				connected.map((connector) => <ConnectorCard connector={connector} key={connector.id} status="unknown" />)
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Connector card
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<ConnectorStatus, string> = {
	connected: "var(--vscode-testing-iconPassed)",
	disconnected: "var(--vscode-descriptionForeground)",
	error: "var(--vscode-testing-iconFailed)",
	unknown: "var(--vscode-descriptionForeground)",
	"coming-soon": "var(--vscode-badge-foreground)",
}

const STATUS_LABELS: Record<ConnectorStatus, string> = {
	connected: "Connected",
	disconnected: "Disconnected",
	error: "Error",
	unknown: "Not configured",
	"coming-soon": "Coming soon",
}

const ConnectorCard = ({ connector, status }: { connector: ConnectorDefinition; status: ConnectorStatus }) => {
	const effectiveStatus: ConnectorStatus = connector.comingSoon ? "coming-soon" : status

	return (
		<div
			style={{
				border: "1px solid var(--vscode-panel-border)",
				borderRadius: "6px",
				padding: "14px 16px",
				backgroundColor: "var(--vscode-editor-background)",
				opacity: connector.comingSoon ? 0.65 : 1,
			}}>
			{/* Header row */}
			<div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
				<span
					className={`codicon codicon-${connector.icon}`}
					style={{ fontSize: "20px", marginTop: "2px", color: "var(--vscode-foreground)", flexShrink: 0 }}
				/>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
						<span style={{ fontWeight: 600, fontSize: "13px" }}>{connector.displayName}</span>
						<StatusBadge status={effectiveStatus} />
					</div>
					<p
						style={{
							margin: "4px 0 0",
							fontSize: "12px",
							color: "var(--vscode-descriptionForeground)",
							lineHeight: 1.4,
						}}>
						{connector.description}
					</p>

					{/* Tags */}
					<div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "8px" }}>
						{connector.tags.slice(0, 4).map((tag) => (
							<span
								key={tag}
								style={{
									fontSize: "10px",
									padding: "1px 6px",
									borderRadius: "10px",
									background: "var(--vscode-badge-background)",
									color: "var(--vscode-badge-foreground)",
								}}>
								{tag}
							</span>
						))}
					</div>
				</div>
			</div>

			{/* Action buttons — only shown for non-coming-soon connectors */}
			{!connector.comingSoon && connector.actions.length > 0 && (
				<div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap" }}>
					{connector.actions.map((action) => {
						if (action.id === "docs" && connector.docsUrl) {
							return (
								<a
									href={connector.docsUrl}
									key={action.id}
									rel="noopener noreferrer"
									style={{
										fontSize: "12px",
										color: "var(--vscode-textLink-foreground)",
										textDecoration: "none",
										padding: "4px 8px",
										border: "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
										borderRadius: "4px",
										display: "inline-flex",
										alignItems: "center",
									}}
									target="_blank">
									{action.label}
								</a>
							)
						}
						return (
							<VSCodeButton
								appearance={action.primary ? "primary" : "secondary"}
								key={action.id}
								onClick={() => {
									if (action.commandId) {
										// Post to VS Code to invoke the command
										;(window as any).vscodeApi?.postMessage({
											type: "invokeCommand",
											command: action.commandId,
										})
									}
								}}
								style={{ fontSize: "12px" }}>
								{action.label}
							</VSCodeButton>
						)
					})}
				</div>
			)}

			{/* Coming-soon footer */}
			{connector.comingSoon && connector.docsUrl && (
				<div style={{ marginTop: "10px" }}>
					<a
						href={connector.docsUrl}
						rel="noopener noreferrer"
						style={{ fontSize: "12px", color: "var(--vscode-textLink-foreground)" }}
						target="_blank">
						Learn more ↗
					</a>
				</div>
			)}
		</div>
	)
}

const StatusBadge = ({ status }: { status: ConnectorStatus }) => (
	<span
		style={{
			fontSize: "10px",
			padding: "1px 7px",
			borderRadius: "10px",
			border: `1px solid ${STATUS_COLORS[status]}`,
			color: STATUS_COLORS[status],
			flexShrink: 0,
		}}>
		{STATUS_LABELS[status]}
	</span>
)

// ---------------------------------------------------------------------------
// Submit card (link to GitHub repo for community connectors)
// ---------------------------------------------------------------------------

const SubmitCard = () => (
	<div
		style={{
			border: "1px dashed var(--vscode-panel-border)",
			borderRadius: "6px",
			padding: "14px 16px",
			textAlign: "center",
		}}>
		<p style={{ margin: 0, fontSize: "13px", color: "var(--vscode-descriptionForeground)" }}>Want to add a connector?</p>
		<a
			href="https://github.com/AI-Hydro/Connectors"
			rel="noopener noreferrer"
			style={{ fontSize: "12px", color: "var(--vscode-textLink-foreground)", marginTop: "4px", display: "inline-block" }}
			target="_blank">
			Open AI-Hydro/Connectors on GitHub ↗
		</a>
	</div>
)

// ---------------------------------------------------------------------------
// Styled tab button (mirrors McpConfigurationView)
// ---------------------------------------------------------------------------

const StyledTabButton = styled.button.withConfig({
	shouldForwardProp: (prop) => !["isActive"].includes(prop),
})<{ isActive: boolean }>`
	background: none;
	border: none;
	border-bottom: 2px solid ${(props) => (props.isActive ? "var(--vscode-foreground)" : "transparent")};
	color: ${(props) => (props.isActive ? "var(--vscode-foreground)" : "var(--vscode-descriptionForeground)")};
	padding: 8px 16px;
	cursor: pointer;
	font-size: 13px;
	transition: color 0.2s;
	&:hover {
		color: var(--vscode-foreground);
	}
`

const TabButton = ({ isActive, onClick, children }: { isActive: boolean; onClick: () => void; children: React.ReactNode }) => (
	<StyledTabButton isActive={isActive} onClick={onClick}>
		{children}
	</StyledTabButton>
)

export default ConnectorsView
