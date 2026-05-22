import { NewTaskRequest } from "@shared/proto/cline/task"
import { VSCodeButton, VSCodeLink } from "@vscode/webview-ui-toolkit/react"
import { Check, ChevronRight, Copy, Droplets } from "lucide-react"
import { memo, useCallback, useEffect, useState } from "react"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { TaskServiceClient } from "@/services/grpc-client"

interface AnnouncementProps {
	version: string // kept for API compatibility, not shown in UI
	hideAnnouncement: () => void
}

// ── step-dot component ────────────────────────────────────────────────────────

const StepDot = ({ done, num }: { done: boolean; num: number }) =>
	done ? (
		<div className="announcement-step-dot announcement-step-dot--done">
			<Check size={11} strokeWidth={3} />
		</div>
	) : (
		<div className="announcement-step-dot announcement-step-dot--pending">{num}</div>
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
		<div className="announcement-card">
			{/* Close */}
			<VSCodeButton appearance="icon" className="announcement-close" onClick={hideAnnouncement} title="Skip for now">
				<span className="codicon codicon-close" />
			</VSCodeButton>

			{/* Title */}
			<h3 className="announcement-title">
				<Droplets color="#00a3ff" size={15} />
				<span>Get started with AI-Hydro</span>
			</h3>

			{/* ── Step 1: Language model ─────────────────────────────────────── */}
			<div className="announcement-step-row">
				<StepDot done={step1Done} num={1} />
				<div className="announcement-step-body">
					<p className="announcement-step-label">Language model connected</p>
					<p className="announcement-step-desc">
						OpenRouter gives access to 100+ models (Claude, GPT, Gemini) with a single key — no subscriptions needed.
					</p>
					<VSCodeButton appearance="secondary" className="text-[11px]" onClick={navigateToSettings}>
						<span className="flex items-center gap-1">
							Provider settings <ChevronRight size={11} />
						</span>
					</VSCodeButton>
				</div>
			</div>

			{/* ── Step 2: MCP tools ─────────────────────────────────────────── */}
			<div className="announcement-step-row">
				<StepDot done={isMcpReady} num={2} />
				<div className="announcement-step-body">
					<p className="announcement-step-label">
						{isMcpReady ? "Hydrological tools ready" : "Install hydrological tools"}
					</p>
					{isMcpReady ? (
						<p className="announcement-step-desc">
							AI-Hydro tools server is running — watershed delineation, streamflow, modelling, and more are
							available.
						</p>
					) : (
						<>
							<p className="announcement-step-desc">
								Run the command below in your terminal, then restart AI-Hydro.
							</p>
							<div className="announcement-code-row">
								<span className="flex-1">pip install aihydro-tools</span>
								<VSCodeButton appearance="icon" onClick={handleCopy} title={copied ? "Copied!" : "Copy"}>
									{copied ? <Check size={13} /> : <Copy size={13} />}
								</VSCodeButton>
							</div>
						</>
					)}
				</div>
			</div>

			{/* ── Step 3: Researcher profile ────────────────────────────────── */}
			<div className="announcement-step-row">
				<StepDot done={profileDone} num={3} />
				<div className="announcement-step-body">
					<p className="announcement-step-label">{profileDone ? "Profile saved" : "Introduce yourself"}</p>
					{profileDone ? (
						<p className="announcement-step-desc">
							AI-Hydro will tailor suggestions and remember your expertise across sessions.
						</p>
					) : (
						<>
							<p className="announcement-step-desc">
								Helps AI-Hydro tailor analyses and remember your expertise across sessions.
							</p>
							<div className="grid grid-cols-2 gap-[5px] mb-[5px]">
								<input
									className="announcement-input"
									onChange={(e) => setName(e.target.value)}
									placeholder="Name"
									type="text"
									value={name}
								/>
								<input
									className="announcement-input"
									onChange={(e) => setInstitution(e.target.value)}
									placeholder="Institution"
									type="text"
									value={institution}
								/>
							</div>
							<div className="grid grid-cols-2 gap-[5px] mb-[5px]">
								<select className="announcement-select" onChange={(e) => setRole(e.target.value)} value={role}>
									{ROLES.map((r) => (
										<option key={r} value={r}>
											{r}
										</option>
									))}
								</select>
								<select
									className="announcement-select"
									onChange={(e) => setDomain(e.target.value)}
									value={domain}>
									{DOMAINS.map((d) => (
										<option key={d} value={d}>
											{d}
										</option>
									))}
								</select>
							</div>
							<input
								className="announcement-input mb-[7px]"
								onChange={(e) => setInterests(e.target.value)}
								placeholder="Research interests  (e.g. flood frequency, LSTM, large-sample)"
								type="text"
								value={interests}
							/>
							<VSCodeButton
								appearance="primary"
								className="text-[11px]"
								disabled={!name.trim() || profileSaving}
								onClick={handleSaveProfile}>
								{profileSaving ? "Saving…" : "Save profile"}
							</VSCodeButton>
						</>
					)}
				</div>
			</div>

			{/* Footer */}
			<div className="announcement-footer">
				<VSCodeButton appearance="secondary" className="text-[11px]" onClick={hideAnnouncement}>
					Skip for now
				</VSCodeButton>
				<p className="announcement-link-row">
					<VSCodeLink className="inline text-[11px]" href="https://ai-hydro.github.io/AI-Hydro/">
						Docs
					</VSCodeLink>
					{" · "}
					<VSCodeLink className="inline text-[11px]" href="https://github.com/AI-Hydro/AI-Hydro/discussions">
						Community
					</VSCodeLink>
					{" · "}
					<VSCodeLink className="inline text-[11px]" href="https://github.com/AI-Hydro/AI-Hydro/issues">
						Issues
					</VSCodeLink>
				</p>
			</div>
		</div>
	)
}

export default memo(Announcement)
