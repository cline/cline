// Shared types for the AutoQA tool. Kept dependency-free: bun + node builtins only.

export type Platform = "linux" | "windows" | "macos"
export type Host = "vscode" | "jetbrains" | "cli" | "desktop" | "kanban" | "acp" | "connectors" | "cloud"
export type Surface = "smoke" | "ide" | "cli" | "desktop" | "kanban" | "acp" | "connectors" | "cloud" | "regressions"
export type Priority = "P0" | "P1" | "P2" | "P3"
export type Maturity = "draft" | "reviewed" | "trusted"
export type Status = "pass" | "fail" | "flaky" | "blocked" | "skip"
export type Isolation = "none" | "fresh-task" | "fresh-window" | "fresh-profile"

export const PLATFORMS: Platform[] = ["linux", "windows", "macos"]
export const HOSTS: Host[] = ["vscode", "jetbrains", "cli", "desktop", "kanban", "acp", "connectors", "cloud"]
export const SURFACES: Surface[] = ["smoke", "ide", "cli", "desktop", "kanban", "acp", "connectors", "cloud", "regressions"]
export const PRIORITIES: Priority[] = ["P0", "P1", "P2", "P3"]
export const MATURITIES: Maturity[] = ["draft", "reviewed", "trusted"]
export const STATUSES: Status[] = ["pass", "fail", "flaky", "blocked", "skip"]
export const ISOLATIONS: Isolation[] = ["none", "fresh-task", "fresh-window", "fresh-profile"]

/** Which hosts a surface runs on. `ide` cases may further narrow via `hosts`. */
export const SURFACE_HOSTS: Record<Surface, Host[]> = {
	smoke: ["vscode", "jetbrains", "cli", "desktop"],
	ide: ["vscode", "jetbrains"],
	cli: ["cli"],
	desktop: ["desktop"],
	kanban: ["kanban"],
	acp: ["acp"],
	connectors: ["connectors"],
	cloud: ["cloud", "vscode", "jetbrains"],
	regressions: ["vscode", "jetbrains", "cli", "desktop"],
}

export type Step = { do: string } | { expect: string } | { capture: string }

export interface Case {
	id: string
	title: string
	surface: Surface
	hosts?: Host[]
	platforms?: Platform[]
	priority: Priority
	maturity: Maturity
	estimated_minutes?: number
	tags?: string[]
	touches?: string[]
	refs?: string[]
	requires: string[]
	provides?: string[]
	isolation?: Isolation
	steps: Step[]
	notes?: Record<string, string>
	known_issues?: string[]
	/** filled in by the loader */
	_file: string
	_feature: string
}

export interface CaseFile {
	feature: string
	title: string
	docs?: string[]
	cases: Case[]
}

export interface Prereq {
	id: string
	title: string
	requires?: string[]
	platforms?: Platform[]
	surfaces?: Surface[]
	volatile?: boolean
	check?: { agent?: string; command?: string }
	establish?: { agent?: string; command?: string }
}

export interface PrereqSet {
	id: string
	title: string
	includes: string[]
}

export interface Catalog {
	prereqs: Map<string, Prereq>
	sets: Map<string, PrereqSet>
}

export interface RunMeta {
	id: string
	created: string
	platform: Platform
	host: Host
	surfaces?: Surface[]
	commit?: string // autoqa repo commit the cases were read from
	cline_commit?: string // cline/cline checkout used for planning signals (CLINE_REPO), if present
	build?: Record<string, string>
	focus?: string[]
	notes?: string
}

export interface StateEntry {
	value: boolean
	at: string
	note?: string
}
export type RunState = Record<string, StateEntry>

export interface ResultRecord {
	case: string
	status: Status
	at: string
	duration_minutes?: number
	isolated?: boolean
	evidence?: string[]
	notes?: string
	suspected_interference?: string
	blocked_on?: string
}

export interface Run {
	dir: string
	meta: RunMeta
	state: RunState
	results: ResultRecord[]
}
