import { BUILTIN_CONNECTORS, type ConnectorDefinition, type ConnectorStatus } from "@shared/connectors"
import { EmptyRequest } from "@shared/proto/cline/common"
import type { GeeStatusResponse } from "@shared/proto/cline/ui"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import type React from "react"
import { useCallback, useEffect, useRef, useState } from "react"
import styled from "styled-components"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"

type ConnectorsTab = "catalog" | "configure"

type StatusMap = Record<string, ConnectorStatus>
type DetailsMap = Record<string, Record<string, string>>
type ErrorMap = Record<string, string>

type ConnectorsViewProps = {
	onDone: () => void
}

const GEE_ID = "gee"

const ConnectorsView = ({ onDone }: ConnectorsViewProps) => {
	const { environment } = useExtensionState()
	const [activeTab, setActiveTab] = useState<ConnectorsTab>("catalog")
	// Default to "disconnected" — no auto-probe, status only updates on explicit user action
	const [statuses, setStatuses] = useState<StatusMap>({ [GEE_ID]: "disconnected" })
	const [details, setDetails] = useState<DetailsMap>({})
	const [errors, setErrors] = useState<ErrorMap>({})
	const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
	const [connectors, setConnectors] = useState<ConnectorDefinition[]>(BUILTIN_CONNECTORS)
	const mountedRef = useRef(true)

	const setStatus = useCallback((id: string, status: ConnectorStatus) => {
		if (mountedRef.current) setStatuses((prev) => ({ ...prev, [id]: status }))
	}, [])

	const setConnectorDetails = useCallback((id: string, d: Record<string, string>) => {
		if (mountedRef.current) setDetails((prev) => ({ ...prev, [id]: d }))
	}, [])

	const setConnectorError = useCallback((id: string, msg: string) => {
		if (mountedRef.current) setErrors((prev) => ({ ...prev, [id]: msg }))
	}, [])

	const clearConnectorError = useCallback((id: string) => {
		if (mountedRef.current)
			setErrors((prev) => {
				const n = { ...prev }
				delete n[id]
				return n
			})
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

	// Apply a GeeStatusResponse to UI state
	const applyGeeResponse = useCallback(
		(resp: GeeStatusResponse) => {
			setStatus(GEE_ID, resp.ok ? "connected" : "disconnected")
			if (resp.ok) {
				clearConnectorError(GEE_ID)
				setConnectorDetails(GEE_ID, {
					"Project ID": resp.projectId ?? "",
					"EE version": resp.eeVersion ?? "",
					Python: resp.pythonExecutable ?? "",
				})
			} else {
				setConnectorError(GEE_ID, resp.message ?? "Connection failed")
				setConnectorDetails(GEE_ID, {})
			}
		},
		[setStatus, clearConnectorError, setConnectorDetails, setConnectorError],
	)

	// Fetch remote catalog and merge with BUILTIN_CONNECTORS on mount
	useEffect(() => {
		mountedRef.current = true
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
		return () => {
			mountedRef.current = false
		}
	}, [])

	// Handle action button clicks — calls gRPC for GEE, generic commands for others
	const handleAction = useCallback(
		(connectorId: string, commandId: string) => {
			if (connectorId !== GEE_ID) return
			setBusy(GEE_ID, true)
			clearConnectorError(GEE_ID)

			let rpcCall: Promise<import("@shared/proto/cline/ui").GeeStatusResponse>
			if (commandId === "aihydro.gee.connect" || commandId === "aihydro.gee.test") {
				rpcCall = UiServiceClient.geeConnect(EmptyRequest.create({}))
			} else if (commandId === "aihydro.gee.disconnect") {
				rpcCall = UiServiceClient.geeDisconnect(EmptyRequest.create({}))
			} else if (commandId === "aihydro.gee.chooseProject") {
				rpcCall = UiServiceClient.geeChooseProject(EmptyRequest.create({}))
			} else {
				setBusy(GEE_ID, false)
				return
			}
			rpcCall
				.then((resp) => {
					if (!mountedRef.current) {
						return
					}
					if (commandId === "aihydro.gee.disconnect") {
						setStatus(GEE_ID, "disconnected")
						setConnectorDetails(GEE_ID, {})
						clearConnectorError(GEE_ID)
					} else {
						applyGeeResponse(resp)
					}
				})
				.catch((err) => {
					if (!mountedRef.current) {
						return
					}
					setConnectorError(GEE_ID, String(err))
					setStatus(GEE_ID, "disconnected")
				})
				.finally(() => {
					if (mountedRef.current) {
						setBusy(GEE_ID, false)
					}
				})
		},
		[setBusy, clearConnectorError, applyGeeResponse, setStatus, setConnectorDetails, setConnectorError],
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
							errors={errors}
							onAction={handleAction}
							statuses={statuses}
						/>
					)}
					{activeTab === "configure" && (
						<ConfigureTab
							busyIds={busyIds}
							connectors={connectors}
							details={details}
							errors={errors}
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
// Tabs
// ---------------------------------------------------------------------------

type TabContentProps = {
	connectors: ConnectorDefinition[]
	statuses: StatusMap
	details: DetailsMap
	errors: ErrorMap
	busyIds: Set<string>
	onAction: (connectorId: string, commandId: string) => void
}

const CatalogTab = ({ connectors, statuses, details, errors, busyIds, onAction }: TabContentProps) => (
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
				error={errors[c.id]}
				key={c.id}
				onAction={onAction}
				status={statuses[c.id] ?? (c.comingSoon ? "coming-soon" : "disconnected")}
			/>
		))}
		<SubmitCard />
	</div>
)

const ConfigureTab = ({ connectors, statuses, details, errors, busyIds, onAction }: TabContentProps) => {
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
					error={errors[c.id]}
					key={c.id}
					onAction={onAction}
					status={statuses[c.id] ?? "disconnected"}
				/>
			))}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Status pill — no "Checking" state, only connected / disconnected / error
// ---------------------------------------------------------------------------

const PILL: Record<ConnectorStatus, { bg: string; color: string; border: string; dot?: string }> = {
	connected: { bg: "rgba(34,197,94,0.12)", color: "#4ade80", border: "rgba(34,197,94,0.3)", dot: "#4ade80" },
	disconnected: { bg: "transparent", color: "var(--vscode-descriptionForeground)", border: "var(--vscode-panel-border)" },
	error: { bg: "rgba(239,68,68,0.12)", color: "#f87171", border: "rgba(239,68,68,0.3)" },
	unknown: { bg: "transparent", color: "var(--vscode-descriptionForeground)", border: "var(--vscode-panel-border)" },
	"coming-soon": { bg: "transparent", color: "var(--vscode-badge-foreground)", border: "var(--vscode-panel-border)" },
}

const STATUS_LABEL: Record<ConnectorStatus, string> = {
	connected: "Connected",
	disconnected: "Disconnected",
	error: "Error",
	unknown: "Unknown",
	"coming-soon": "Coming soon",
}

const StatusPill = ({ status, busy }: { status: ConnectorStatus; busy: boolean }) => {
	const s = PILL[status]
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
			{busy ? (
				<span className="codicon codicon-loading codicon-modifier-spin" style={{ fontSize: "10px" }} />
			) : s.dot ? (
				<span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />
			) : null}
			{busy ? "Working…" : STATUS_LABEL[status]}
		</span>
	)
}

// ---------------------------------------------------------------------------
// Connector card
// ---------------------------------------------------------------------------

type ConnectorCardProps = {
	connector: ConnectorDefinition
	status: ConnectorStatus
	details: Record<string, string>
	error?: string
	busy: boolean
	onAction: (connectorId: string, commandId: string) => void
}

const ConnectorCard = ({ connector, status, details, error, busy, onAction }: ConnectorCardProps) => {
	const effectiveStatus: ConnectorStatus = connector.comingSoon ? "coming-soon" : status
	const isConnected = effectiveStatus === "connected"

	const connectAction = connector.actions.find((a) => a.id === "connect")
	const disconnectAction = connector.actions.find((a) => a.id === "disconnect")
	const configureAction = connector.actions.find((a) => a.id === "configure")
	const testAction = connector.actions.find((a) => a.id === "test")

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
			{/* Header */}
			<div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
				<span
					className={`codicon codicon-${connector.icon}`}
					style={{ fontSize: "20px", marginTop: "2px", color: "var(--vscode-foreground)", flexShrink: 0 }}
				/>
				<div style={{ flex: 1, minWidth: 0 }}>
					<div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
						<span style={{ fontWeight: 600, fontSize: "13px" }}>{connector.displayName}</span>
						<StatusPill busy={busy} status={effectiveStatus} />
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

			{/* Error banner */}
			{error && (
				<div
					style={{
						marginTop: "10px",
						padding: "8px 10px",
						borderRadius: "5px",
						background: "rgba(239,68,68,0.08)",
						border: "1px solid rgba(239,68,68,0.25)",
						fontSize: "12px",
						color: "#f87171",
					}}>
					{error}
				</div>
			)}

			{/* Connected details */}
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
										color: "#4ade80",
										wordBreak: "break-all",
									}}>
									{v}
								</span>
							</div>
						))}
				</div>
			)}

			{/* Action row */}
			{!connector.comingSoon && (
				<div style={{ display: "flex", gap: "6px", marginTop: "12px", flexWrap: "wrap", alignItems: "center" }}>
					{isConnected ? (
						<>
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
									{busy ? "Verifying…" : "Verify connection"}
								</button>
							)}
							{configureAction?.commandId && (
								<VSCodeButton
									appearance="secondary"
									disabled={busy}
									onClick={() => onAction(connector.id, configureAction.commandId!)}
									style={{ fontSize: "12px" }}>
									Change project
								</VSCodeButton>
							)}
							{connector.docsUrl && (
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
									}}>
									Disconnect
								</button>
							)}
						</>
					) : (
						<>
							{connectAction?.commandId && (
								<VSCodeButton
									appearance="primary"
									disabled={busy}
									onClick={() => onAction(connector.id, connectAction.commandId!)}
									style={{ fontSize: "12px" }}>
									{busy ? "Connecting…" : "Connect"}
								</VSCodeButton>
							)}
							{configureAction?.commandId && (
								<VSCodeButton
									appearance="secondary"
									disabled={busy}
									onClick={() => onAction(connector.id, configureAction.commandId!)}
									style={{ fontSize: "12px" }}>
									Configure project
								</VSCodeButton>
							)}
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
			style={{ fontSize: "12px", color: "var(--vscode-textLink-foreground)", marginTop: "4px", display: "inline-block" }}
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
