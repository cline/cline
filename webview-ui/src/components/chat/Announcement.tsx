import { NewTaskRequest } from "@shared/proto/cline/task"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Check, ChevronRight, Copy, Droplets } from "lucide-react"
import { type CSSProperties, memo, useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

interface AnnouncementProps {
	version: string // kept for API compatibility, not shown in UI
	hideAnnouncement: () => void
}

// ── styles ────────────────────────────────────────────────────────────────────

const cardStyle: CSSProperties = {
	backgroundColor: "rgba(0, 163, 255, 0.05)",
	border: "1px solid rgba(0, 163, 255, 0.18)",
	borderRadius: "10px",
	padding: "16px 18px",
	margin: "8px 15px",
	position: "relative",
	flexShrink: 0,
}

const titleStyle: CSSProperties = {
	margin: "0 0 14px",
	fontWeight: 700,
	fontSize: "13px",
	display: "flex",
	alignItems: "center",
	gap: "7px",
	paddingRight: "28px",
}

const stepRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "flex-start",
	gap: "10px",
	padding: "8px 0",
	borderBottom: "1px solid rgba(255,255,255,0.06)",
}

const stepRowLastStyle: CSSProperties = { ...stepRowStyle, borderBottom: "none" }

const stepDotBase: CSSProperties = {
	width: "20px",
	height: "20px",
	borderRadius: "50%",
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	flexShrink: 0,
	marginTop: "1px",
	fontSize: "11px",
	fontWeight: 700,
}

const stepDotDone: CSSProperties = {
	...stepDotBase,
	backgroundColor: "rgba(0, 200, 120, 0.2)",
	border: "1px solid rgba(0, 200, 120, 0.5)",
	color: "#00c878",
}

const stepDotPending: CSSProperties = {
	...stepDotBase,
	backgroundColor: "rgba(0, 163, 255, 0.1)",
	border: "1px solid rgba(0, 163, 255, 0.3)",
	color: "rgba(0, 163, 255, 0.7)",
}

const stepBodyStyle: CSSProperties = { flex: 1, minWidth: 0 }

const stepLabelStyle: CSSProperties = {
	fontSize: "12px",
	fontWeight: 600,
	color: "var(--vscode-foreground)",
	margin: "0 0 3px",
	lineHeight: "1.4",
}

const stepDescStyle: CSSProperties = {
	fontSize: "11.5px",
	color: "rgba(255,255,255,0.5)",
	margin: "0 0 6px",
	lineHeight: "1.5",
}

const codeRowStyle: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "6px",
	backgroundColor: "var(--vscode-editor-background)",
	borderRadius: "4px",
	padding: "5px 8px",
	fontFamily: "var(--vscode-editor-font-family)",
	fontSize: "11.5px",
	color: "var(--vscode-editor-foreground)",
	marginBottom: "6px",
}

const inputStyle: CSSProperties = {
	width: "100%",
	background: "var(--vscode-input-background)",
	color: "var(--vscode-input-foreground)",
	border: "1px solid var(--vscode-input-border, rgba(255,255,255,0.15))",
	borderRadius: "3px",
	padding: "4px 7px",
	fontSize: "11.5px",
	outline: "none",
	boxSizing: "border-box",
}

const selectStyle: CSSProperties = {
	...inputStyle,
	cursor: "pointer",
	appearance: "none",
	WebkitAppearance: "none",
	backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='rgba(255,255,255,0.4)'/%3E%3C/svg%3E")`,
	backgroundRepeat: "no-repeat",
	backgroundPosition: "right 8px center",
	paddingRight: "22px",
}

const footerStyle: CSSProperties = {
	display: "flex",
	justifyContent: "space-between",
	alignItems: "center",
	marginTop: "12px",
	flexWrap: "wrap",
	gap: "8px",
}

const linkRowStyle: CSSProperties = {
	fontSize: "11px",
	color: "rgba(255,255,255,0.35)",
}

const closeStyle: CSSProperties = { position: "absolute", top: "10px", right: "10px" }

// ── step-dot component ────────────────────────────────────────────────────────

const StepDot = ({ done, num }: { done: boolean; num: number }) =>
	done ? (
		<div style={stepDotDone}>
			<Check size={11} strokeWidth={3} />
		</div>
	) : (
		<div style={stepDotPending}>{num}</div>
	)

// ── profile roles / domains ───────────────────────────────────────────────────

const ROLES = [
	"PhD Student",
	"Postdoctoral Researcher",
	"Research Scientist",
	"Faculty",
	"Water Resources Engineer",
	"Hydrologist (Government/Agency)",
	"Other",
]

const DOMAINS = [
	"Computational Hydrology",
	"Water Resources Engineering",
	"Hydroclimatology",
	"Geomorphology",
	"Remote Sensing & Hydrology",
	"Groundwater",
	"Eco-hydrology",
	"Urban Hydrology",
	"Other",
]

// ── main component ────────────────────────────────────────────────────────────

const Announcement = ({ hideAnnouncement }: AnnouncementProps) => {
	const { navigateToSettings, mcpServers } = useExtensionState()

	// ── Step 1: model — always done (user is past WelcomeView if they see this) ──
	const step1Done = true

	// ── Step 2: MCP tools ────────────────────────────────────────────────────────
	const isMcpReady = mcpServers.some((s) => s.name === "ai-hydro")
	const [copied, setCopied] = useState(false)

	const handleCopy = useCallback(async () => {
		await navigator.clipboard.writeText("pip install aihydro-tools")
		setCopied(true)
		setTimeout(() => setCopied(false), 1500)
	}, [])

	// ── Step 3: profile ──────────────────────────────────────────────────────────
	const [profileDone, setProfileDone] = useState(false)
	const [name, setName] = useState("")
	const [institution, setInstitution] = useState("")
	const [role, setRole] = useState(ROLES[0])
	const [domain, setDomain] = useState(DOMAINS[0])
	const [interests, setInterests] = useState("")
	const [profileSaving, setProfileSaving] = useState(false)

	const handleSaveProfile = useCallback(async () => {
		if (!name.trim()) {
			return
		}
		setProfileSaving(true)
		try {
			const parts: string[] = [`My name is ${name.trim()}`]
			if (institution.trim()) {
				parts.push(`I work at ${institution.trim()}`)
			}
			parts.push(`My role is ${role}`)
			parts.push(`My domain is ${domain}`)
			if (interests.trim()) {
				parts.push(`My research interests include: ${interests.trim()}`)
			}
			parts.push("Please save this to my researcher profile using update_researcher_profile.")

			await TaskServiceClient.newTask(NewTaskRequest.create({ text: parts.join(". "), images: [] }))
			setProfileDone(true)
		} catch (err) {
			console.error("Profile save failed:", err)
		} finally {
			setProfileSaving(false)
		}
	}, [name, institution, role, domain, interests])

	// Auto-dismiss when all done
	const allDone = step1Done && isMcpReady && profileDone
	useEffect(() => {
		if (allDone) {
			const t = setTimeout(hideAnnouncement, 1200)
			return () => clearTimeout(t)
		}
	}, [allDone, hideAnnouncement])

	return (
		<div style={cardStyle}>
			{/* Close */}
			<VSCodeButton appearance="icon" onClick={hideAnnouncement} style={closeStyle} title="Skip for now">
				<span className="codicon codicon-close" />
			</VSCodeButton>

			{/* Title */}
			<h3 style={titleStyle}>
				<Droplets color="#00a3ff" size={15} />
				<span>Get started with AI-Hydro</span>
			</h3>

			{/* ── Step 1: Language model ─────────────────────────────────────── */}
			<div style={stepRowStyle}>
				<StepDot done={step1Done} num={1} />
				<div style={stepBodyStyle}>
					<p style={stepLabelStyle}>Language model connected</p>
					<p style={stepDescStyle}>
						OpenRouter gives access to 100+ models (Claude, GPT, Gemini) with a single key — no subscriptions needed.
					</p>
					<VSCodeButton appearance="secondary" onClick={navigateToSettings} style={{ fontSize: "11px" }}>
						<span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
							Provider settings <ChevronRight size={11} />
						</span>
					</VSCodeButton>
				</div>
			</div>

			{/* ── Step 2: MCP tools ─────────────────────────────────────────── */}
			<div style={stepRowStyle}>
				<StepDot done={isMcpReady} num={2} />
				<div style={stepBodyStyle}>
					<p style={stepLabelStyle}>{isMcpReady ? "Hydrological tools ready" : "Install hydrological tools"}</p>
					{isMcpReady ? (
						<p style={stepDescStyle}>
							AI-Hydro tools server is running — watershed delineation, streamflow, modelling, and more are
							available.
						</p>
					) : (
						<>
							<p style={stepDescStyle}>Run the command below in your terminal, then restart AI-Hydro.</p>
							<div style={codeRowStyle}>
								<span style={{ flex: 1 }}>pip install aihydro-tools</span>
								<VSCodeButton appearance="icon" onClick={handleCopy} title={copied ? "Copied!" : "Copy"}>
									{copied ? <Check size={13} /> : <Copy size={13} />}
								</VSCodeButton>
							</div>
						</>
					)}
				</div>
			</div>

			{/* ── Step 3: Researcher profile ────────────────────────────────── */}
			<div style={stepRowLastStyle}>
				<StepDot done={profileDone} num={3} />
				<div style={stepBodyStyle}>
					<p style={stepLabelStyle}>{profileDone ? "Profile saved" : "Introduce yourself"}</p>
					{profileDone ? (
						<p style={stepDescStyle}>AI-Hydro will tailor suggestions and remember your expertise across sessions.</p>
					) : (
						<>
							<p style={stepDescStyle}>
								Helps AI-Hydro tailor analyses and remember your expertise across sessions.
							</p>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px", marginBottom: "5px" }}>
								<input
									onChange={(e) => setName(e.target.value)}
									placeholder="Name"
									style={inputStyle}
									type="text"
									value={name}
								/>
								<input
									onChange={(e) => setInstitution(e.target.value)}
									placeholder="Institution"
									style={inputStyle}
									type="text"
									value={institution}
								/>
							</div>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px", marginBottom: "5px" }}>
								<select onChange={(e) => setRole(e.target.value)} style={selectStyle} value={role}>
									{ROLES.map((r) => (
										<option key={r} value={r}>
											{r}
										</option>
									))}
								</select>
								<select onChange={(e) => setDomain(e.target.value)} style={selectStyle} value={domain}>
									{DOMAINS.map((d) => (
										<option key={d} value={d}>
											{d}
										</option>
									))}
								</select>
							</div>
							<input
								onChange={(e) => setInterests(e.target.value)}
								placeholder="Research interests  (e.g. flood frequency, LSTM, large-sample)"
								style={{ ...inputStyle, marginBottom: "7px" }}
								type="text"
								value={interests}
							/>
							<VSCodeButton
								appearance="primary"
								disabled={!name.trim() || profileSaving}
								onClick={handleSaveProfile}
								style={{ fontSize: "11px" }}>
								{profileSaving ? "Saving…" : "Save profile"}
							</VSCodeButton>
						</>
					)}
				</div>
			</div>

			{/* Footer */}
			<div style={footerStyle}>
				<VSCodeButton appearance="secondary" onClick={hideAnnouncement} style={{ fontSize: "11px" }}>
					Skip for now
				</VSCodeButton>
				<p style={linkRowStyle}>
					<VSCodeLink href="https://ai-hydro.github.io/AI-Hydro/" style={{ display: "inline", fontSize: "11px" }}>
						Docs
					</VSCodeLink>
					{" · "}
					<VSCodeLink
						href="https://github.com/AI-Hydro/AI-Hydro/discussions"
						style={{ display: "inline", fontSize: "11px" }}>
						Community
					</VSCodeLink>
					{" · "}
					<VSCodeLink
						href="https://github.com/AI-Hydro/AI-Hydro/issues"
						style={{ display: "inline", fontSize: "11px" }}>
						Issues
					</VSCodeLink>
				</p>
			</div>
		</div>
	)
}

export default memo(Announcement)
