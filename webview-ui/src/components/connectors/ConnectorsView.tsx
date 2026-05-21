import { BUILTIN_CONNECTORS, type ConnectorDefinition, type ConnectorStatus } from "@shared/connectors"
import { EmptyRequest } from "@shared/proto/cline/common"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import styled from "styled-components"
import { PLATFORM_CONFIG } from "@/config/platform.config"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"

type ConnectorsTab = "catalog" | "configure"

type StatusMap = Record<string, ConnectorStatus>
type DetailsMap = Record<string, Record<string, string>>

type ConnectorsViewProps = {
	onDone: () => void
}

const GEE_ID = "gee"
const GEE_STATUS_CMD = "aihydro.gee.status"

function postInvokeCommand(command: string) {
	PLATFORM_CONFIG.postMessage({ type: "invokeCommand", command })
}

const ConnectorsView = ({ onDone }: ConnectorsViewProps) => {
	const { environment } = useExtensionState()
	const [activeTab, setActiveTab] = useState<ConnectorsTab>("catalog")
	const [statuses, setStatuses] = useState<StatusMap>({})
	const [details, setDetails] = useState<DetailsMap>({})
	const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
	const [connectors, setConnectors] = useState<ConnectorDefinition[]>(BUILTIN_CONNECTORS)
	const mountedRef = useRef(true)

	const setStatus = useCallback((id: string, status: ConnectorStatus) => {
		if (mountedRef.current) setStatuses((prev) => ({ ...prev, [id]: status }))
	}, [])

	const setConnectorDetails = useCallback((id: string, d: Record<string, string>) => {
		if (mountedRef.current) setDetails((prev) => ({ ...prev, [id]: d }))
	}, [])

	const setBusy = useCallback((id: string, busy: boolean) => {
		if (mountedRef.current) {
			setBusyIds((prev) => {
				const next = new Set(prev)
				busy ? next.add(id) : next.delete(id)
				return next
			})
		}
	}, [])

	// Fetch remote catalog and merge with BUILTIN_CONNECTORS (remote wins on overlap by id)
	useEffect(() => {
		UiServiceClient.refreshConnectorsCatalog(EmptyRequest.create({}))
			.then((resp) => {
				if (!mountedRef.current) return
				try {
					const remote: ConnectorDefinition[] = JSON.parse(resp.catalogJson ?? "[]")
					if (!Array.isArray(remote) || remote.length === 0) return
					const remoteIds = new Set(remote.map((c) => c.id))
					setConnectors([...remote, ...BUILTIN_CONNECTORS.filter((c) => !remoteIds.has(c.id))])
				} catch {
					// keep BUILTIN_CONNECTORS
				}
			})
			.catch(() => {})
	}, [])

	// commandResult listener — handles responses from invokeCommand
	useEffect(() => {
		const handler = (event: MessageEvent) => {
			const msg = event.data
			if (msg?.type !== "commandResult" || !msg.commandResult) return
			const { command, ok } = msg.commandResult as {
				command: string
				ok: boolean
				project_id?: string
				message?: string
				runtime?: { ee_version?: string; python_executable?: string; credentials_path?: string }
			}

			if ([GEE_STATUS_CMD, "aihydro.gee.connect", "aihydro.gee.test"].includes(command)) {
				setStatus(GEE_ID, ok ? "connected" : "disconnected")
				setBusy(GEE_ID, false)
				if (ok && msg.commandResult.project_id) {
					setConnectorDetails(GEE_ID, {
						"Project ID": msg.commandResult.project_id,
						"EE Version": msg.commandResult.runtime?.ee_version ?? "",
						Python: msg.commandResult.runtime?.python_executable ?? "",
					})
				}
			} else if (command === "aihydro.gee.disconnect") {
				setStatus(GEE_ID, "disconnected")
				setConnectorDetails(GEE_ID, {})
				setBusy(GEE_ID, false)
			} else if (command === "aihydro.gee.chooseProject") {
				// Re-check status after project is picked
				setBusy(GEE_ID, true)
				postInvokeCommand(GEE_STATUS_CMD)
			}
		}
		window.addEventListener("message", handler)
		return () => window.removeEventListener("message", handler)
	}, [setStatus, setBusy, setConnectorDetails])

	// GEE status probe on mount via gRPC (reliable path, no invokeCommand)
	useEffect(() => {
		mountedRef.current = true
		setBusy(GEE_ID, true)

		// Race gRPC call against a 20s client-side timeout so the spinner never hangs forever
		const timeoutPromise = new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error("GEE status timeout")), 20_000),
		)
		Promise.race([UiServiceClient.getGeeStatus(EmptyRequest.create({})), timeoutPromise])
			.then((resp) => {
				if (!mountedRef.current) return
				setStatus(GEE_ID, resp.ok ? "connected" : "disconnected")
				setBusy(GEE_ID, false)
				if (resp.ok && resp.projectId) {
					setConnectorDetails(GEE_ID, {
						"Project ID": resp.projectId,
						"EE Version": resp.eeVersion,
						Python: resp.pythonExecutable,
					})
				}
			})
			.catch(() => {
				if (!mountedRef.current) return
				setStatus(GEE_ID, "disconnected")
				setBusy(GEE_ID, false)
			})
		return () => {
			mountedRef.current = false
		}
	}, [setBusy, setStatus, setConnectorDetails])

	const handleAction = useCallback(
		(connectorId: string, commandId: string) => {
			setBusy(connectorId, true)
			postInvokeCommand(commandId)
		},
		[setBusy],
	)

	return (
		<div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column" }}>
			<div
				style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 17px 5px 20px" }}>
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
					<TabButton isActive={activeTab === "configure"} onClick={() => setActiveTab("configure")}>
						Configure
					</TabButton>
				</div>

				<div style={{ width: "100%" }}>
					{activeTab === "catalog" && (
						<CatalogTab
							busyIds={busyIds}
							connectors={connectors}
							details={details}
							onAction={handleAction}
							statuses={statuses}
						/>
					)}
					{activeTab === "configure" && (
						<ConfigureTab
							busyIds={busyIds}
							connectors={connectors}
							details={details}
							onAction={handleAction}
							statuses={statuses}
						/>
					)}
				</div>
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Catalog tab
// ---------------------------------------------------------------------------

type TabContentProps = {
	connectors: ConnectorDefinition[]
	statuses: StatusMap
	details: DetailsMap
	busyIds: Set<string>
	onAction: (connectorId: string, commandId: string) => void
}

const CatalogTab = ({ connectors, statuses, details, busyIds, onAction }: TabContentProps) => (
	<div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
		<p style={{ margin: 0, fontSize: "13px", color: "var(--vscode-descriptionForeground)" }}>
			Connect AI-Hydro to external data sources and compute services. Credentials are stored securely in VS Code&apos;s
			secret storage — never visible in the webview.
		</p>
		{connectors.map((c) => (
			<ConnectorCard
				busy={busyIds.has(c.id)}
				connector={c}
				details={details[c.id] ?? {}}
				key={c.id}
				onAction={onAction}
				status={statuses[c.id] ?? (c.comingSoon ? "coming-soon" : "unknown")}
			/>
		))}
		<SubmitCard />
	</div>
)

// ---------------------------------------------------------------------------
// Configure tab — live connectors only
// ---------------------------------------------------------------------------

const ConfigureTab = ({ connectors, statuses, details, busyIds, onAction }: TabContentProps) => {
	const live = connectors.filter((c) => !c.comingSoon)
	const connected = live.filter((c) => statuses[c.id] === "connected")

	return (
		<div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "12px" }}>
			<p style={{ margin: 0, fontSize: "13px", color: "var(--vscode-descriptionForeground)" }}>
				{connected.length > 0
					? `${connected.length} connector${connected.length > 1 ? "s" : ""} active`
					: "No connectors connected yet — use the Catalog tab to connect."}
			</p>
			{live.map((c) => (
				<ConnectorCard
					busy={busyIds.has(c.id)}
					connector={c}
					details={details[c.id] ?? {}}
					key={c.id}
					onAction={onAction}
					status={statuses[c.id] ?? "unknown"}
				/>
			))}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Connector card — smart contextual action
// ---------------------------------------------------------------------------

type ConnectorCardProps = {
	connector: ConnectorDefinition
	status: ConnectorStatus
	details: Record<string, string>
	busy: boolean
	onAction: (connectorId: string, commandId: string) => void
}

// ---------------------------------------------------------------------------
// Status pill — visible, solid color, never blends into the card background
// ---------------------------------------------------------------------------

const PILL_STYLES: Record<ConnectorStatus, { bg: string; color: string; border: string }> = {
	connected: { bg: "#166534", color: "#4ade80", border: "#166534" },
	disconnected: { bg: "transparent", color: "var(--vscode-descriptionForeground)", border: "var(--vscode-panel-border)" },
	error: { bg: "#450a0a", color: "#f87171", border: "#450a0a" },
	unknown: { bg: "transparent", color: "var(--vscode-descriptionForeground)", border: "var(--vscode-panel-border)" },
	"coming-soon": { bg: "transparent", color: "var(--vscode-badge-foreground)", border: "var(--vscode-panel-border)" },
}

const StatusPill = ({ status, checking }: { status: ConnectorStatus; checking: boolean }) => {
	const s = PILL_STYLES[status]
	return (
		<span
			style={{
				display: "inline-flex",
				alignItems: "center",
				gap: "5px",
				fontSize: "11px",
				fontWeight: 500,
				padding: "3px 9px",
				borderRadius: "12px",
				background: s.bg,
				color: s.color,
				border: `1px solid ${s.border}`,
				flexShrink: 0,
			}}>
			{checking ? (
				<span className="codicon codicon-loading codicon-modifier-spin" style={{ fontSize: "10px" }} />
			) : status === "connected" ? (
				<span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
			) : null}
			{checking ? "Checking…" : STATUS_LABEL[status]}
		</span>
	)
}

const STATUS_DOT: Record<ConnectorStatus, string> = {
	connected: "#22c55e",
	disconnected: "var(--vscode-descriptionForeground)",
	error: "var(--vscode-testing-iconFailed)",
	unknown: "var(--vscode-descriptionForeground)",
	"coming-soon": "var(--vscode-badge-foreground)",
}

const STATUS_LABEL: Record<ConnectorStatus, string> = {
	connected: "Connected",
	disconnected: "Disconnected",
	error: "Error",
	unknown: "Checking…",
	"coming-soon": "Coming soon",
}

const ConnectorCard = ({ connector, status, details, busy, onAction }: ConnectorCardProps) => {
	const effectiveStatus: ConnectorStatus = connector.comingSoon ? "coming-soon" : status
	const isConnected = effectiveStatus === "connected"
	const isChecking = effectiveStatus === "unknown" || (effectiveStatus !== "coming-soon" && busy)

	// Find primary connect/disconnect actions from connector definition
	const connectAction = connector.actions.find((a) => a.id === "connect")
	const disconnectAction = connector.actions.find((a) => a.id === "disconnect")
	const configureAction = connector.actions.find((a) => a.id === "configure")
	const testAction = connector.actions.find((a) => a.id === "test")
	const docsAction = connector.actions.find((a) => a.id === "docs")

	return (
		<div
			style={{
				border: `1px solid ${isConnected ? "rgba(34,197,94,0.3)" : "var(--vscode-panel-border)"}`,
				borderRadius: "8px",
				padding: "14px 16px",
				backgroundColor: "var(--vscode-editor-background)",
				opacity: connector.comingSoon ? 0.6 : 1,
				transition: "border-color 0.2s",
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
						{/* Status pill */}
						<StatusPill checking={isChecking} status={effectiveStatus} />
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

			{/* Connected details panel */}
			{isConnected && Object.keys(details).length > 0 && (
				<div
					style={{
						marginTop: "12px",
						padding: "10px 12px",
						borderRadius: "6px",
						background: "rgba(34,197,94,0.06)",
						border: "1px solid rgba(34,197,94,0.15)",
						display: "flex",
						flexDirection: "column",
						gap: "4px",
					}}>
					{Object.entries(details)
						.filter(([, v]) => v)
						.map(([k, v]) => (
							<div key={k} style={{ display: "flex", gap: "8px", fontSize: "11px" }}>
								<span style={{ color: "var(--vscode-descriptionForeground)", minWidth: 80 }}>{k}</span>
								<span
									style={{
										fontFamily: "var(--vscode-editor-font-family, monospace)",
										color: "#22c55e",
										wordBreak: "break-all",
									}}>
									{v}
								</span>
							</div>
						))}
				</div>
			)}

			{/* Action row — smart contextual */}
			{!connector.comingSoon && (
				<div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap", alignItems: "center" }}>
					{isConnected ? (
						<>
							{/* Test / verify link */}
							{testAction?.commandId && (
								<button
									disabled={busy}
									onClick={() => onAction(connector.id, testAction.commandId!)}
									style={{
										background: "none",
										border: "none",
										color: "var(--vscode-textLink-foreground)",
										cursor: busy ? "default" : "pointer",
										fontSize: "12px",
										padding: "4px 2px",
										opacity: busy ? 0.5 : 1,
									}}>
									{busy ? "Testing…" : "Verify connection"}
								</button>
							)}
							{/* Configure project */}
							{configureAction?.commandId && (
								<VSCodeButton
									appearance="secondary"
									disabled={busy}
									onClick={() => onAction(connector.id, configureAction.commandId!)}
									style={{ fontSize: "12px" }}>
									Change project
								</VSCodeButton>
							)}
							{/* Docs */}
							{docsAction && connector.docsUrl && (
								<a
									href={connector.docsUrl}
									rel="noopener noreferrer"
									style={{
										fontSize: "12px",
										color: "var(--vscode-textLink-foreground)",
										textDecoration: "none",
										padding: "4px 2px",
										marginLeft: "auto",
									}}
									target="_blank">
									Docs ↗
								</a>
							)}
							{/* Disconnect — pushed right */}
							{disconnectAction?.commandId && (
								<button
									disabled={busy}
									onClick={() => onAction(connector.id, disconnectAction.commandId!)}
									style={{
										background: "none",
										border: "1px solid var(--vscode-panel-border)",
										borderRadius: "4px",
										color: "var(--vscode-descriptionForeground)",
										cursor: busy ? "default" : "pointer",
										fontSize: "12px",
										padding: "4px 10px",
										opacity: busy ? 0.5 : 1,
										marginLeft: docsAction ? "0" : "auto",
									}}>
									Disconnect
								</button>
							)}
						</>
					) : (
						<>
							{/* Primary connect button */}
							{connectAction?.commandId && (
								<VSCodeButton
									appearance="primary"
									disabled={busy || isChecking}
									onClick={() => onAction(connector.id, connectAction.commandId!)}
									style={{ fontSize: "12px" }}>
									{busy ? "Connecting…" : "Connect"}
								</VSCodeButton>
							)}
							{/* Configure project while disconnected */}
							{configureAction?.commandId && (
								<VSCodeButton
									appearance="secondary"
									disabled={busy || isChecking}
									onClick={() => onAction(connector.id, configureAction.commandId!)}
									style={{ fontSize: "12px" }}>
									Configure project
								</VSCodeButton>
							)}
							{/* Docs */}
							{connector.docsUrl && (
								<a
									href={connector.docsUrl}
									rel="noopener noreferrer"
									style={{
										fontSize: "12px",
										color: "var(--vscode-textLink-foreground)",
										textDecoration: "none",
										padding: "4px 8px",
										border: "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
										borderRadius: "4px",
									}}
									target="_blank">
									Docs ↗
								</a>
							)}
						</>
					)}
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

// ---------------------------------------------------------------------------
// Submit card
// ---------------------------------------------------------------------------

const SubmitCard = () => (
	<div
		style={{
			border: "1px dashed var(--vscode-panel-border)",
			borderRadius: "8px",
			padding: "14px 16px",
			textAlign: "center",
		}}>
		<p style={{ margin: 0, fontSize: "13px", color: "var(--vscode-descriptionForeground)" }}>Want to add a connector?</p>
		<a
			href="https://github.com/AI-Hydro/Connectors/issues/new?template=new_connector.md"
			rel="noopener noreferrer"
			style={{
				fontSize: "12px",
				color: "var(--vscode-textLink-foreground)",
				marginTop: "4px",
				display: "inline-block",
			}}
			target="_blank">
			Submit on GitHub ↗
		</a>
	</div>
)

// ---------------------------------------------------------------------------
// Tab button
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
