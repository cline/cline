import { EmptyRequest } from "@shared/proto/cline/common"
import type { SkillItem } from "@shared/proto/cline/skills"
import { DeleteSkillRequest, SaveSkillRequest, SkillSource } from "@shared/proto/cline/skills"
import { useEffect, useState } from "react"
import { SkillsServiceClient } from "@/services/grpc-client"

const DOMAINS = ["frequency-analysis", "baseflow", "modelling", "interpretation", "general"] as const

const SOURCE_BADGE: Record<number, { label: string; bg: string; color: string }> = {
	[SkillSource.MARKETPLACE]: { label: "Marketplace", bg: "rgba(14,99,156,0.2)", color: "#4fc3f7" },
	[SkillSource.AGENT_CREATED]: { label: "AI", bg: "rgba(107,33,168,0.2)", color: "#c084fc" },
	[SkillSource.MANUAL]: { label: "Manual", bg: "rgba(21,128,61,0.2)", color: "#4ade80" },
}

interface SkillFormState {
	skillId: string
	name: string
	description: string
	domain: string
	whenToUse: string
	instructions: string
}

const emptyForm = (): SkillFormState => ({
	skillId: "",
	name: "",
	description: "",
	domain: "general",
	whenToUse: "",
	instructions: "",
})

const SkillsConfiguredTab = () => {
	const [skills, setSkills] = useState<SkillItem[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [showForm, setShowForm] = useState(false)
	const [form, setForm] = useState<SkillFormState>(emptyForm())
	const [isSaving, setIsSaving] = useState(false)
	const [enabledMap, setEnabledMap] = useState<Record<string, boolean>>({})
	const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

	useEffect(() => {
		loadSkills()
	}, [])

	const loadSkills = () => {
		setIsLoading(true)
		SkillsServiceClient.listInstalledSkills(EmptyRequest.create({}))
			.then((catalog) => {
				setSkills(catalog.items)
				const map: Record<string, boolean> = {}
				for (const s of catalog.items) {
					map[s.skillId] = true
				}
				setEnabledMap((prev) => ({ ...map, ...prev }))
				setIsLoading(false)
			})
			.catch((err) => {
				console.error("Failed to load installed skills:", err)
				setMessage({ type: "error", text: "Failed to load installed skills" })
				setIsLoading(false)
			})
	}

	const handleAddSkill = () => {
		setForm(emptyForm())
		setShowForm(true)
	}

	const handleEditSkill = (skill: SkillItem) => {
		setForm({
			skillId: skill.skillId,
			name: skill.name,
			description: skill.description,
			domain: skill.domain || "general",
			whenToUse: skill.whenToUse || "",
			instructions: skill.content || "",
		})
		setShowForm(true)
	}

	const handleCancelForm = () => {
		setShowForm(false)
		setForm(emptyForm())
	}

	const handleSaveSkill = async () => {
		if (!form.name.trim()) {
			setMessage({ type: "error", text: "Name is required" })
			return
		}
		setIsSaving(true)
		setMessage(null)
		try {
			const resp = await SkillsServiceClient.saveSkill(
				SaveSkillRequest.create({
					skillId: form.skillId,
					name: form.name.trim(),
					description: form.description.trim(),
					content: form.instructions,
					domain: form.domain,
					whenToUse: form.whenToUse.trim(),
					source: SkillSource.MANUAL,
					tags: [],
					toolsUsed: [],
				}),
			)
			if (resp.success) {
				setMessage({ type: "success", text: form.skillId ? "Skill updated." : "Skill saved." })
				setShowForm(false)
				setForm(emptyForm())
				loadSkills()
			} else {
				setMessage({ type: "error", text: resp.error ?? "Save failed" })
			}
		} catch (err) {
			setMessage({ type: "error", text: err instanceof Error ? err.message : "Save failed" })
		} finally {
			setIsSaving(false)
		}
	}

	const handleDeleteSkill = async (skill: SkillItem) => {
		setMessage(null)
		try {
			await SkillsServiceClient.deleteSkill(
				DeleteSkillRequest.create({
					skillId: skill.skillId,
					source: skill.source,
				}),
			)
			setMessage({ type: "success", text: `"${skill.name}" deleted.` })
			loadSkills()
		} catch (err) {
			setMessage({ type: "error", text: err instanceof Error ? err.message : "Delete failed" })
		}
	}

	const toggleEnabled = (skillId: string) => {
		setEnabledMap((prev) => ({ ...prev, [skillId]: !prev[skillId] }))
	}

	const inputStyle: React.CSSProperties = {
		width: "100%",
		padding: "5px 8px",
		fontSize: 12,
		background: "var(--vscode-input-background)",
		color: "var(--vscode-input-foreground)",
		border: "1px solid var(--vscode-input-border, rgba(255,255,255,0.1))",
		borderRadius: 3,
		outline: "none",
		boxSizing: "border-box",
	}

	const labelStyle: React.CSSProperties = {
		fontSize: 11,
		color: "var(--vscode-descriptionForeground)",
		textTransform: "uppercase",
		fontWeight: 500,
		marginBottom: 3,
		display: "block",
	}

	return (
		<div style={{ display: "flex", flexDirection: "column" }}>
			{/* Header area */}
			<div
				style={{
					padding: "14px 16px 10px",
					display: "flex",
					alignItems: "center",
					justifyContent: "space-between",
					borderBottom: "1px solid var(--vscode-panel-border)",
				}}>
				<span style={{ fontSize: 12, color: "var(--vscode-descriptionForeground)" }}>
					{isLoading ? "Loading…" : `${skills.length} skill${skills.length !== 1 ? "s" : ""} installed`}
				</span>
				<button
					onClick={handleAddSkill}
					style={{
						display: "flex",
						alignItems: "center",
						gap: 5,
						padding: "4px 10px",
						fontSize: 12,
						fontWeight: 600,
						background: "var(--vscode-button-background, #0e639c)",
						color: "var(--vscode-button-foreground, #fff)",
						border: "none",
						borderRadius: 3,
						cursor: "pointer",
					}}
					type="button">
					<span className="codicon codicon-add" style={{ fontSize: 13 }} />
					Add Skill
				</button>
			</div>

			{/* Message bar */}
			{message && (
				<div
					style={{
						padding: "8px 16px",
						fontSize: 12,
						background: message.type === "error" ? "rgba(220,53,69,0.12)" : "rgba(40,167,69,0.12)",
						color: message.type === "error" ? "var(--vscode-errorForeground, #f48771)" : "#4ade80",
						borderBottom: "1px solid var(--vscode-panel-border)",
						display: "flex",
						alignItems: "center",
						justifyContent: "space-between",
					}}>
					<span>{message.text}</span>
					<button
						onClick={() => setMessage(null)}
						style={{
							background: "none",
							border: "none",
							cursor: "pointer",
							color: "inherit",
							padding: 0,
							fontSize: 12,
						}}
						type="button">
						<span className="codicon codicon-close" />
					</button>
				</div>
			)}

			{/* Inline form */}
			{showForm && (
				<div
					style={{
						padding: "16px",
						borderBottom: "1px solid var(--vscode-panel-border)",
						background: "var(--vscode-sideBar-background, rgba(255,255,255,0.02))",
						display: "flex",
						flexDirection: "column",
						gap: 10,
					}}>
					<div style={{ fontSize: 13, fontWeight: 600, color: "var(--vscode-foreground)", marginBottom: 4 }}>
						{form.skillId ? "Edit Skill" : "New Skill"}
					</div>

					<div>
						<label style={labelStyle}>Name *</label>
						<input
							onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
							placeholder="e.g. Baseflow Separation"
							style={inputStyle}
							type="text"
							value={form.name}
						/>
					</div>

					<div>
						<label style={labelStyle}>Description</label>
						<input
							onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
							placeholder="Brief description of what this skill does"
							style={inputStyle}
							type="text"
							value={form.description}
						/>
					</div>

					<div>
						<label style={labelStyle}>Domain</label>
						<select
							onChange={(e) => setForm((f) => ({ ...f, domain: e.target.value }))}
							style={{ ...inputStyle, height: 28 }}
							value={form.domain}>
							{DOMAINS.map((d) => (
								<option key={d} value={d}>
									{d}
								</option>
							))}
						</select>
					</div>

					<div>
						<label style={labelStyle}>When to use</label>
						<input
							onChange={(e) => setForm((f) => ({ ...f, whenToUse: e.target.value }))}
							placeholder="Describe the scenarios where this skill should be applied"
							style={inputStyle}
							type="text"
							value={form.whenToUse}
						/>
					</div>

					<div>
						<label style={labelStyle}>Instructions</label>
						<textarea
							onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
							placeholder="Full skill instructions for the AI agent…"
							style={{
								...inputStyle,
								minHeight: 200,
								resize: "vertical",
								fontFamily: "var(--vscode-editor-font-family, monospace)",
								lineHeight: 1.5,
							}}
							value={form.instructions}
						/>
					</div>

					<div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
						<button
							onClick={handleCancelForm}
							style={{
								padding: "5px 12px",
								fontSize: 12,
								background: "transparent",
								color: "var(--vscode-foreground)",
								border: "1px solid var(--vscode-button-border, var(--vscode-panel-border))",
								borderRadius: 3,
								cursor: "pointer",
							}}
							type="button">
							Cancel
						</button>
						<button
							disabled={isSaving}
							onClick={handleSaveSkill}
							style={{
								padding: "5px 12px",
								fontSize: 12,
								fontWeight: 600,
								background: isSaving ? "rgba(0,0,0,0.12)" : "var(--vscode-button-background, #0e639c)",
								color: isSaving ? "var(--vscode-descriptionForeground)" : "var(--vscode-button-foreground, #fff)",
								border: "none",
								borderRadius: 3,
								cursor: isSaving ? "default" : "pointer",
							}}
							type="button">
							{isSaving ? "Saving…" : "Save Skill"}
						</button>
					</div>
				</div>
			)}

			{/* Skills list */}
			{!isLoading && skills.length === 0 ? (
				<div
					style={{
						padding: 24,
						textAlign: "center",
						color: "var(--vscode-descriptionForeground)",
						fontSize: 13,
						lineHeight: 1.6,
					}}>
					No skills installed yet. Browse the Marketplace tab or click + Add Skill.
				</div>
			) : (
				<div style={{ display: "flex", flexDirection: "column" }}>
					{skills.map((skill) => {
						const badge = SOURCE_BADGE[skill.source] ?? SOURCE_BADGE[SkillSource.MANUAL]
						const enabled = enabledMap[skill.skillId] ?? true
						return (
							<div
								key={skill.skillId}
								style={{
									padding: "10px 16px",
									display: "flex",
									alignItems: "center",
									gap: 10,
									borderBottom: "1px solid var(--vscode-panel-border, rgba(255,255,255,0.06))",
									background: "var(--vscode-editor-background)",
									opacity: enabled ? 1 : 0.55,
								}}>
								{/* Source badge */}
								<span
									style={{
										fontSize: 10,
										padding: "2px 6px",
										borderRadius: 10,
										background: badge.bg,
										color: badge.color,
										fontWeight: 600,
										flexShrink: 0,
									}}>
									{badge.label}
								</span>

								{/* Name */}
								<span
									style={{
										fontSize: 13,
										fontWeight: 600,
										color: "var(--vscode-foreground)",
										flex: 1,
										overflow: "hidden",
										textOverflow: "ellipsis",
										whiteSpace: "nowrap",
									}}>
									{skill.name}
								</span>

								{/* Domain badge */}
								{skill.domain && (
									<span
										style={{
											fontSize: 10,
											padding: "2px 6px",
											borderRadius: 10,
											background: "rgba(6,182,212,0.12)",
											color: "var(--vscode-textLink-foreground, #06b6d4)",
											flexShrink: 0,
										}}>
										{skill.domain}
									</span>
								)}

								{/* Enable toggle */}
								<label
									style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", flexShrink: 0 }}
									title={enabled ? "Disable skill" : "Enable skill"}>
									<input
										checked={enabled}
										onChange={() => toggleEnabled(skill.skillId)}
										style={{ cursor: "pointer", accentColor: "#00A3FF" }}
										type="checkbox"
									/>
								</label>

								{/* Edit button */}
								<button
									onClick={() => handleEditSkill(skill)}
									style={{
										background: "none",
										border: "none",
										cursor: "pointer",
										color: "var(--vscode-descriptionForeground)",
										padding: "2px 4px",
										borderRadius: 3,
										display: "flex",
										alignItems: "center",
										flexShrink: 0,
									}}
									title="Edit skill"
									type="button">
									<span className="codicon codicon-edit" style={{ fontSize: 14 }} />
								</button>

								{/* Delete button */}
								<button
									onClick={() => handleDeleteSkill(skill)}
									onMouseEnter={(e) => {
										;(e.currentTarget as HTMLButtonElement).style.color =
											"var(--vscode-errorForeground, #f48771)"
									}}
									onMouseLeave={(e) => {
										;(e.currentTarget as HTMLButtonElement).style.color =
											"var(--vscode-descriptionForeground)"
									}}
									style={{
										background: "none",
										border: "none",
										cursor: "pointer",
										color: "var(--vscode-descriptionForeground)",
										padding: "2px 4px",
										borderRadius: 3,
										display: "flex",
										alignItems: "center",
										flexShrink: 0,
									}}
									title="Delete skill"
									type="button">
									<span className="codicon codicon-trash" style={{ fontSize: 14 }} />
								</button>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

export default SkillsConfiguredTab
