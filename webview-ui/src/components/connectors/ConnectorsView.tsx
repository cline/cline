import { BUILTIN_CONNECTORS, type ConnectorDefinition, type ConnectorStatus } from "@shared/connectors"
import { EmptyRequest, StringRequest } from "@shared/proto/cline/common"
import type { GeeStatusResponse } from "@shared/proto/cline/ui"
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react"
import { useCallback, useEffect, useRef, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"
import { getEnvironmentColor } from "@/utils/environmentColors"

type StatusMap = Record<string, ConnectorStatus>
type DetailsMap = Record<string, Record<string, string>>

type ConnectorsViewProps = {
	onDone: () => void
}

const GEE_ID = "google_earth_engine"

const ConnectorsView = ({ onDone }: ConnectorsViewProps) => {
	const { environment } = useExtensionState()
	const [statuses, setStatuses] = useState<StatusMap>({ [GEE_ID]: "disconnected" })
	const [details, setDetails] = useState<DetailsMap>({})
	const [connectors, setConnectors] = useState<ConnectorDefinition[]>(BUILTIN_CONNECTORS)
	const mountedRef = useRef(true)

	const applyGeeResponse = useCallback((resp: GeeStatusResponse) => {
		if (!mountedRef.current) {
			return
		}
		setStatuses((prev) => ({ ...prev, [GEE_ID]: resp.ok ? "connected" : "disconnected" }))
		if (resp.ok) {
			setDetails((prev) => ({
				...prev,
				[GEE_ID]: {
					"Project ID": resp.projectId ?? "",
					"EE version": resp.eeVersion ?? "",
					Python: resp.pythonExecutable ?? "",
				},
			}))
		} else {
			setDetails((prev) => ({ ...prev, [GEE_ID]: {} }))
		}
	}, [])

	// Fetch remote catalog on mount
	useEffect(() => {
		mountedRef.current = true
		UiServiceClient.refreshConnectorsCatalog(EmptyRequest.create({}))
			.then((resp) => {
				if (!mountedRef.current) {
					return
				}
				try {
					const remote: ConnectorDefinition[] = JSON.parse(resp.catalogJson ?? "[]")
					if (!Array.isArray(remote) || remote.length === 0) {
						return
					}
					const remoteIds = new Set(remote.map((c) => c.id))
					setConnectors([...remote, ...BUILTIN_CONNECTORS.filter((c) => !remoteIds.has(c.id))])
				} catch {
					// keep BUILTIN_CONNECTORS
				}
			})
			.catch(() => {})

		// Probe GEE status once on mount (read-only, no auth side-effects)
		UiServiceClient.getGeeStatus(EmptyRequest.create({}))
			.then((resp) => applyGeeResponse(resp))
			.catch(() => {})

		return () => {
			mountedRef.current = false
		}
	}, [applyGeeResponse])

	const handleSetupWithAI = useCallback((connector: ConnectorDefinition) => {
		if (!connector.setupPrompt) {
			return
		}
		UiServiceClient.sendToChat(StringRequest.create({ value: connector.setupPrompt })).catch(() => {})
	}, [])

	return (
		<div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column" }}>
			<div
				style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 17px 5px 20px" }}>
				<h3 style={{ color: getEnvironmentColor(environment), margin: 0 }}>External Connectors</h3>
				<VSCodeButton onClick={onDone}>Done</VSCodeButton>
			</div>

			<div
				style={{
					flex: 1,
					overflow: "auto",
					padding: "16px 20px",
					display: "flex",
					flexDirection: "column",
					gap: "12px",
				}}>
				<p style={{ margin: 0, fontSize: "13px", color: "var(--vscode-descriptionForeground)" }}>
					Connect AI-Hydro to external data sources and compute services. Click <strong>Set up with AI</strong> and the
					agent will guide you through authentication and configuration.
				</p>

				{connectors.map((c) => (
					<ConnectorCard
						connector={c}
						details={details[c.id] ?? {}}
						key={c.id}
						onSetupWithAI={handleSetupWithAI}
						status={statuses[c.id] ?? (c.comingSoon ? "coming-soon" : "disconnected")}
					/>
				))}

				<SubmitCard />
			</div>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Status pill
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

const StatusPill = ({ status }: { status: ConnectorStatus }) => {
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
			{s.dot && <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot, flexShrink: 0 }} />}
			{STATUS_LABEL[status]}
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
	onSetupWithAI: (connector: ConnectorDefinition) => void
}

const ConnectorCard = ({ connector, status, details, onSetupWithAI }: ConnectorCardProps) => {
	const effectiveStatus: ConnectorStatus = connector.comingSoon ? "coming-soon" : status
	const isConnected = effectiveStatus === "connected"

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
						<StatusPill status={effectiveStatus} />
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
			<div style={{ display: "flex", gap: "8px", marginTop: "12px", alignItems: "center" }}>
				{!connector.comingSoon && connector.setupPrompt && (
					<VSCodeButton appearance="primary" onClick={() => onSetupWithAI(connector)} style={{ fontSize: "12px" }}>
						<span className="codicon codicon-sparkle" style={{ marginRight: "5px" }} />
						Set up with AI
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
						}}
						target="_blank">
						Docs ↗
					</a>
				)}
			</div>
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

export default ConnectorsView
