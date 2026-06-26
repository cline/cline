import { EmptyRequest } from "@shared/proto/cline/common"
import {
	MarketplaceEntriesRequest,
	type MarketplaceEntry,
	MarketplaceEntryRequest,
	type MarketplaceLocalInstalledEntry,
	ToggleMarketplaceLocalInstalledEntryRequest,
} from "@shared/proto/cline/marketplace"
import { VSCodeButton, VSCodeLink, VSCodeProgressRing, VSCodeTextField } from "@vscode/webview-ui-toolkit/react"
import {
	BlocksIcon,
	CheckIcon,
	DownloadIcon,
	LoaderCircleIcon,
	type LucideIcon,
	PlugIcon,
	PuzzleIcon,
	SparklesIcon,
} from "lucide-react"
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react"
import { Switch } from "@/components/ui/switch"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { MarketplaceServiceClient, McpServiceClient } from "@/services/grpc-client"
import { Tab, TabContent, TabList, TabTrigger } from "../common/Tab"
import ViewHeader from "../common/ViewHeader"
import AddRemoteServerForm from "../mcp/configuration/tabs/add-server/AddRemoteServerForm"
import ServersToggleList from "../mcp/configuration/tabs/installed/ServersToggleList"

type PrimitiveType = "mcp" | "skill" | "plugin"

type MarketplaceViewProps = {
	initialType?: PrimitiveType
	onDone: () => void
}

type PrimitiveConfig = {
	type: PrimitiveType
	label: string
	singular: string
	plural: string
	title: string
	description: ReactNode
	icon: LucideIcon
}

const PRIMITIVES: PrimitiveConfig[] = [
	{
		type: "skill",
		label: "Skills",
		singular: "skill",
		plural: "skills",
		title: "Skills",
		description: (
			<>
				Reusable instruction sets that Cline loads on demand for specific tasks, without staying in context for unrelated
				work. Browse more at <VSCodeLink href="https://agentskills.io/">Agent Skills</VSCodeLink>.
			</>
		),
		icon: SparklesIcon,
	},
	{
		type: "mcp",
		label: "MCP",
		singular: "MCP server",
		plural: "MCP servers",
		title: "MCP Servers",
		description: (
			<>
				Connect Cline to external APIs, local tools, and hosted services through{" "}
				<VSCodeLink href="https://modelcontextprotocol.io/">MCP</VSCodeLink> servers.
			</>
		),
		icon: PlugIcon,
	},
	{
		type: "plugin",
		label: "Plugins",
		singular: "plugin",
		plural: "plugins",
		title: "Plugins",
		description: (
			<>
				<VSCodeLink href="https://docs.cline.bot/sdk/plugins">Plugins</VSCodeLink> are extensions for capabilities more
				complex than a single MCP server or skill, including custom tools, hooks, rules, slash commands, or bundled
				skills.
			</>
		),
		icon: PuzzleIcon,
	},
]

function isPrimitiveType(value: string): value is PrimitiveType {
	return value === "mcp" || value === "skill" || value === "plugin"
}

function entryKey(entry: MarketplaceEntry): string {
	return `${entry.type}:${entry.id}`
}

function installArgs(entry: MarketplaceEntry): string[] {
	return entry.install?.args ?? []
}

function getPrimitive(type: PrimitiveType): PrimitiveConfig {
	return PRIMITIVES.find((primitive) => primitive.type === type) ?? PRIMITIVES[0]
}

function sourceLabel(entry: MarketplaceLocalInstalledEntry): string | undefined {
	if (entry.source === "global") return "Global"
	if (entry.source === "workspace") return "Workspace"
	if (entry.source === "remote") return "Remote"
	return undefined
}

function setupSummary(entry: MarketplaceEntry): string | undefined {
	const env = entry.install?.env ?? []
	if (env.length === 0 && !entry.install?.notes) return undefined
	const required = env.filter((item) => item.required).map((item) => item.name)
	if (required.length > 0) return `Requires ${required.join(", ")}`
	if (env.length > 0) return `Uses ${env.map((item) => item.name).join(", ")}`
	return entry.install?.notes
}

function tagId(label: string): string {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
}

function entryTagLabels(entry: MarketplaceEntry): string[] {
	const labels = new Map<string, string>()
	for (const label of entry.tags) {
		const id = tagId(label)
		if (id) labels.set(id, label)
	}
	for (const tag of entry.tagObjects ?? []) {
		const id = tagId(tag.label)
		if (id) labels.set(id, tag.label)
	}
	return [...labels.values()]
}

function searchTextForEntry(entry: MarketplaceEntry): string {
	return [
		entry.id,
		entry.name,
		entry.tagline,
		entry.description,
		entry.author,
		...entryTagLabels(entry),
		...installArgs(entry),
		...(entry.install?.env ?? []).map((item) => item.name),
	]
		.filter(Boolean)
		.join(" ")
		.toLowerCase()
}

const MarketplaceStyles = () => (
	<style>{`
		.marketplace-view {
			background: var(--vscode-sideBar-background);
			color: var(--vscode-foreground);
			min-width: 0;
		}

		.marketplace-view > div:first-of-type {
			margin-bottom: 4px;
		}

		.marketplace-shell {
			min-height: 0;
			display: flex;
			flex: 1;
		}

		.marketplace-nav {
			width: 148px;
			flex: 0 0 148px;
			overflow-y: auto;
			border-right: 1px solid var(--vscode-panel-border);
			background: var(--vscode-sideBar-background);
			padding: 4px 0;
		}

		.marketplace-tab {
			width: 100%;
			height: 34px;
			border: 0;
			border-left: 2px solid transparent;
			background: transparent;
			color: var(--vscode-descriptionForeground);
			font: inherit;
			font-size: var(--vscode-font-size);
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 0 10px;
			text-align: left;
			cursor: pointer;
			min-width: 0;
		}

		.marketplace-tab:hover {
			background: var(--vscode-list-hoverBackground);
			color: var(--vscode-foreground);
		}

		.marketplace-tab[aria-selected="true"] {
			background: var(--vscode-list-activeSelectionBackground);
			color: var(--vscode-list-activeSelectionForeground);
			border-left-color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
		}

		.marketplace-tab-label {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.marketplace-content {
			min-width: 0;
			background: var(--vscode-editor-background);
		}

		.marketplace-inner {
			box-sizing: border-box;
			width: 100%;
			max-width: 760px;
			margin: 0 auto;
			padding: 14px 18px 20px;
		}

		.marketplace-primitive-description {
			margin-bottom: 12px;
			color: var(--vscode-descriptionForeground);
			font-size: calc(var(--vscode-font-size) * 0.9);
			line-height: 1.4;
		}

		.marketplace-primitive-description vscode-link {
			font-size: inherit;
		}

		.marketplace-error {
			border: 1px solid var(--vscode-inputValidation-errorBorder);
			background: var(--vscode-inputValidation-errorBackground);
			color: var(--vscode-inputValidation-errorForeground, var(--vscode-foreground));
			padding: 8px 10px;
			margin-bottom: 12px;
			font-size: calc(var(--vscode-font-size) * 0.92);
			line-height: 1.4;
			white-space: pre-wrap;
			word-break: break-word;
		}

		.marketplace-section {
			margin-bottom: 20px;
		}

		.marketplace-section-header {
			display: flex;
			align-items: center;
			gap: 12px;
			margin-bottom: 6px;
			padding-bottom: 5px;
			border-bottom: 1px solid var(--vscode-panel-border);
		}

		.marketplace-section-title {
			font-size: calc(var(--vscode-font-size) * 0.92);
			font-weight: 600;
			color: var(--vscode-foreground);
			margin: 0;
		}

		.marketplace-section-count {
			color: var(--vscode-descriptionForeground);
			font-size: calc(var(--vscode-font-size) * 0.85);
		}

		.marketplace-list {
			display: grid;
			gap: 7px;
			background: transparent;
		}

		.marketplace-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 26px;
			gap: 10px;
			align-items: start;
			min-height: 42px;
			padding: 9px 10px;
			border: 1px solid var(--vscode-panel-border);
			background: var(--vscode-sideBar-background);
		}

		.marketplace-row:hover {
			background: var(--vscode-list-hoverBackground);
		}

		.marketplace-row-main {
			min-width: 0;
		}

		.marketplace-row-title {
			display: flex;
			align-items: center;
			gap: 7px;
			min-width: 0;
			color: var(--vscode-foreground);
			font-size: var(--vscode-font-size);
			font-weight: 500;
			line-height: 1.35;
		}

		.marketplace-row-name {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.marketplace-row-description {
			margin-top: 2px;
			color: var(--vscode-descriptionForeground);
			font-size: calc(var(--vscode-font-size) * 0.9);
			line-height: 1.35;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
			overflow-wrap: anywhere;
			word-break: break-word;
		}

		.marketplace-row-description code {
			overflow-wrap: anywhere;
			word-break: break-word;
			white-space: normal;
		}

		.marketplace-row-meta {
			margin-top: 4px;
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			align-items: center;
			color: var(--vscode-descriptionForeground);
			font-size: calc(var(--vscode-font-size) * 0.82);
			line-height: 1.3;
		}

		.marketplace-pill {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			max-width: 100%;
			min-width: 0;
			padding: 1px 5px;
			border-radius: 2px;
			border: 1px solid var(--vscode-badge-background);
			background: color-mix(in srgb, var(--vscode-badge-background) 20%, transparent);
			color: var(--vscode-descriptionForeground);
			white-space: normal;
			overflow-wrap: anywhere;
			word-break: break-word;
		}

		.marketplace-path {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: normal;
			overflow-wrap: anywhere;
			word-break: break-word;
			font-family: var(--vscode-editor-font-family);
		}

		.marketplace-action {
			display: flex;
			justify-content: flex-end;
		}

		.marketplace-local-toggle {
			display: flex;
			align-items: center;
			justify-content: flex-end;
			min-height: 24px;
		}

		.marketplace-icon-button {
			width: 24px;
			height: 24px;
			border: 1px solid transparent;
			border-radius: 3px;
			background: transparent;
			color: var(--vscode-icon-foreground);
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: 0;
			cursor: pointer;
		}

		.marketplace-icon-button:hover:not(:disabled) {
			background: var(--vscode-toolbar-hoverBackground);
			color: var(--vscode-foreground);
		}

		.marketplace-icon-button:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 1px;
		}

		.marketplace-icon-button:disabled {
			cursor: default;
			opacity: 0.65;
		}

		.marketplace-icon-button svg {
			width: 14px;
			height: 14px;
		}

		.marketplace-icon-spin {
			animation: marketplace-spin 0.9s linear infinite;
		}

		@keyframes marketplace-spin {
			from {
				transform: rotate(0deg);
			}
			to {
				transform: rotate(360deg);
			}
		}

		.marketplace-search {
			margin: 0 0 10px;
		}

		.marketplace-search vscode-text-field {
			width: 100%;
		}

		.marketplace-clear-search {
			all: unset;
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			color: var(--vscode-descriptionForeground);
		}

		.marketplace-clear-search:hover {
			color: var(--vscode-foreground);
		}

		.marketplace-clear-search:focus-visible {
			outline: 1px solid var(--vscode-focusBorder);
			outline-offset: 2px;
		}

		.marketplace-filters {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 10px;
			margin: 0 0 10px;
			min-width: 0;
		}

		.marketplace-filter-scroll {
			display: flex;
			flex-wrap: wrap;
			gap: 6px;
			min-width: 0;
		}

		.marketplace-tag-button {
			display: inline-flex;
			align-items: center;
			gap: 5px;
			height: 24px;
			border: 1px solid var(--vscode-button-border, var(--vscode-panel-border));
			border-radius: 3px;
			background: var(--vscode-button-secondaryBackground);
			color: var(--vscode-button-secondaryForeground);
			font: inherit;
			font-size: calc(var(--vscode-font-size) * 0.86);
			padding: 0 7px;
			white-space: nowrap;
			cursor: pointer;
		}

		.marketplace-tag-button:hover {
			background: var(--vscode-button-secondaryHoverBackground);
		}

		.marketplace-tag-button[data-active="true"] {
			background: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border-color: var(--vscode-button-background);
		}

		.marketplace-tag-count {
			color: inherit;
			opacity: 0.75;
		}

		.marketplace-mcp-panel {
			border: 1px solid var(--vscode-panel-border);
			background: var(--vscode-sideBar-background);
			padding: 10px;
		}

		.marketplace-mcp-managed {
			display: flex;
			align-items: center;
			gap: 8px;
			margin-bottom: 10px;
			padding: 8px 10px;
			border-left: 3px solid var(--vscode-textLink-foreground);
			background: var(--vscode-textBlockQuote-background);
			color: var(--vscode-foreground);
			font-size: calc(var(--vscode-font-size) * 0.92);
			line-height: 1.35;
		}

		.marketplace-mcp-settings {
			display: grid;
			gap: 8px;
			margin-top: 10px;
		}

		.marketplace-mcp-settings vscode-button {
			width: 100%;
		}

		.marketplace-mcp-advanced {
			margin-top: -3px;
			text-align: center;
			font-size: calc(var(--vscode-font-size) * 0.88);
		}

		.marketplace-mcp-form {
			border: 1px solid var(--vscode-panel-border);
			background: var(--vscode-sideBar-background);
		}

		.marketplace-mcp-form > div {
			padding: 12px;
		}

		.marketplace-empty,
		.marketplace-loading {
			min-height: 72px;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8px;
			border: 1px dashed var(--vscode-panel-border);
			color: var(--vscode-descriptionForeground);
			background: var(--vscode-sideBar-background);
			font-size: calc(var(--vscode-font-size) * 0.92);
			text-align: center;
			padding: 12px;
		}

		.marketplace-loading vscode-progress-ring {
			width: 18px;
			height: 18px;
		}

		@media (max-width: 520px) {
			.marketplace-shell {
				flex-direction: column;
			}

			.marketplace-nav {
				width: auto;
				flex: 0 0 auto;
				display: flex;
				flex-wrap: wrap;
				overflow: visible;
				border-right: 0;
				border-bottom: 1px solid var(--vscode-panel-border);
				padding: 0 4px;
			}

			.marketplace-tab {
				width: auto;
				flex: 1 1 96px;
				min-width: 96px;
				border-left: 0;
				border-bottom: 2px solid transparent;
				padding: 0 10px;
			}

			.marketplace-tab[aria-selected="true"] {
				border-bottom-color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
				border-left-color: transparent;
			}

			.marketplace-inner {
				padding: 12px 10px 16px;
			}

			.marketplace-filters {
				align-items: flex-start;
				flex-direction: column;
				gap: 6px;
			}

			.marketplace-filter-scroll {
				width: 100%;
			}
		}
	`}</style>
)

const Section = ({
	children,
	count,
	empty,
	title,
}: {
	children: React.ReactNode
	count: number
	empty: string
	title: string
}) => (
	<section className="marketplace-section">
		<div className="marketplace-section-header">
			<h3 className="marketplace-section-title">{title}</h3>
		</div>
		{count > 0 ? <div className="marketplace-list">{children}</div> : <div className="marketplace-empty">{empty}</div>}
	</section>
)

const MarketplaceCatalogSection = ({
	children,
	count,
	empty,
	filters,
	search,
}: {
	children: React.ReactNode
	count: number
	empty: string
	filters: React.ReactNode
	search: React.ReactNode
}) => (
	<section className="marketplace-section">
		<div className="marketplace-section-header">
			<h3 className="marketplace-section-title">Marketplace</h3>
		</div>
		{search}
		{filters}
		{count > 0 ? <div className="marketplace-list">{children}</div> : <div className="marketplace-empty">{empty}</div>}
	</section>
)

const TagFilters = ({
	counts,
	onSelect,
	selectedTag,
	tags,
}: {
	counts: Map<string, number>
	onSelect: (tag: string | null) => void
	selectedTag: string | null
	tags: Array<{ id: string; label: string }>
}) => {
	if (tags.length === 0) {
		return null
	}
	return (
		<div className="marketplace-filters">
			<div className="marketplace-filter-scroll">
				{tags.map((tag) => (
					<button
						className="marketplace-tag-button"
						data-active={selectedTag === tag.id}
						key={tag.id}
						onClick={() => onSelect(selectedTag === tag.id ? null : tag.id)}
						type="button">
						<span>{tag.label}</span>
						<span className="marketplace-tag-count">{counts.get(tag.id) ?? 0}</span>
					</button>
				))}
			</div>
		</div>
	)
}

const McpManagementPanel = () => {
	const { mcpServers, navigateToSettings, remoteConfigSettings } = useExtensionState()
	const [showAddRemote, setShowAddRemote] = useState(false)
	const showRemoteServers = remoteConfigSettings?.blockPersonalRemoteMCPServers !== true
	const hasRemoteMCPServers = remoteConfigSettings?.remoteMCPServers && remoteConfigSettings.remoteMCPServers.length > 0

	return (
		<section className="marketplace-section">
			<div className="marketplace-section-header">
				<h3 className="marketplace-section-title">Installed MCP Servers</h3>
			</div>
			<div className="marketplace-mcp-panel">
				{hasRemoteMCPServers && (
					<div className="marketplace-mcp-managed">
						<span className="codicon codicon-lock" />
						<span>Your organization manages some MCP servers</span>
					</div>
				)}
				<ServersToggleList hasTrashIcon={false} isExpandable={true} listGap="small" servers={mcpServers} />
			</div>
			<div className="marketplace-mcp-settings">
				{showRemoteServers && !showAddRemote && (
					<VSCodeButton appearance="primary" onClick={() => setShowAddRemote(true)}>
						<span className="codicon codicon-add" style={{ marginRight: "6px" }} />
						Add Remote Server
					</VSCodeButton>
				)}
				{showRemoteServers && showAddRemote && (
					<div className="marketplace-mcp-form">
						<AddRemoteServerForm
							onCancel={() => setShowAddRemote(false)}
							onServerAdded={() => setShowAddRemote(false)}
							showEditConfiguration={false}
						/>
					</div>
				)}
				<VSCodeButton
					appearance="secondary"
					onClick={() => {
						McpServiceClient.openMcpSettings(EmptyRequest.create({})).catch((error) => {
							console.error("Error opening MCP settings:", error)
						})
					}}>
					<span className="codicon codicon-server" style={{ marginRight: "6px" }} />
					Edit Configuration
				</VSCodeButton>
				<div className="marketplace-mcp-advanced">
					<VSCodeLink onClick={() => navigateToSettings("features")}>Advanced MCP Settings</VSCodeLink>
				</div>
			</div>
		</section>
	)
}

const LocalInstalledRow = ({
	entry,
	onToggle,
	toggling,
}: {
	entry: MarketplaceLocalInstalledEntry
	onToggle: (entry: MarketplaceLocalInstalledEntry, enabled: boolean) => void
	toggling: boolean
}) => {
	const origin = sourceLabel(entry)
	return (
		<div className="marketplace-row">
			<div className="marketplace-row-main">
				<div className="marketplace-row-title">
					<span className="marketplace-row-name">{entry.name || entry.id}</span>
				</div>
				{entry.description && <div className="marketplace-row-description">{entry.description}</div>}
				<div className="marketplace-row-meta">
					{origin && <span className="marketplace-pill">{origin}</span>}
					{entry.path && <span className="marketplace-path">{entry.path}</span>}
				</div>
			</div>
			<div className="marketplace-local-toggle">
				<Switch
					aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.name || entry.id}`}
					checked={entry.enabled}
					disabled={toggling}
					onClick={() => onToggle(entry, !entry.enabled)}
					title={`${entry.enabled ? "Disable" : "Enable"} ${entry.name || entry.id}`}
				/>
			</div>
		</div>
	)
}

const CatalogEntryRow = ({
	entry,
	installed,
	installing,
	onInstall,
}: {
	entry: MarketplaceEntry
	installed: boolean
	installing: boolean
	onInstall: (entry: MarketplaceEntry) => void
}) => {
	const summary = setupSummary(entry)
	const canInstall = installArgs(entry).length > 0 && !installed && !installing
	const label = installed ? `${entry.name || entry.id} is installed` : `Install ${entry.name || entry.id}`
	return (
		<div className="marketplace-row">
			<div className="marketplace-row-main">
				<div className="marketplace-row-title">
					{installed && <CheckIcon aria-hidden className="h-3.5 w-3.5" />}
					<span className="marketplace-row-name">{entry.name || entry.id}</span>
				</div>
				{(entry.description || entry.tagline) && (
					<div className="marketplace-row-description">{entry.description || entry.tagline}</div>
				)}
				<div className="marketplace-row-meta">
					{summary && <span className="marketplace-pill">{summary}</span>}
					{entry.author && <span>{entry.author}</span>}
				</div>
			</div>
			<div className="marketplace-action">
				<button
					aria-label={label}
					className="marketplace-icon-button"
					disabled={!canInstall}
					onClick={() => onInstall(entry)}
					title={label}
					type="button">
					{installing ? (
						<LoaderCircleIcon aria-hidden className="marketplace-icon-spin" />
					) : installed ? (
						<CheckIcon aria-hidden />
					) : (
						<DownloadIcon aria-hidden />
					)}
				</button>
			</div>
		</div>
	)
}

const MarketplaceView = ({ initialType = "skill", onDone }: MarketplaceViewProps) => {
	const { environment } = useExtensionState()
	const [activeType, setActiveType] = useState<PrimitiveType>(initialType)
	const [catalogEntries, setCatalogEntries] = useState<MarketplaceEntry[]>([])
	const [localEntries, setLocalEntries] = useState<MarketplaceLocalInstalledEntry[]>([])
	const [installedKeys, setInstalledKeys] = useState<Set<string>>(new Set())
	const [installingId, setInstallingId] = useState<string | null>(null)
	const [togglingLocalId, setTogglingLocalId] = useState<string | null>(null)
	const [query, setQuery] = useState("")
	const [selectedTag, setSelectedTag] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const refresh = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const [catalog, local] = await Promise.all([
				MarketplaceServiceClient.getMarketplaceCatalog(EmptyRequest.create({})),
				MarketplaceServiceClient.listMarketplaceLocalInstalledEntries(EmptyRequest.create({})),
			])
			const entries = catalog.entries.filter((entry) => isPrimitiveType(entry.type))
			setCatalogEntries(entries)
			setLocalEntries(local.entries.filter((entry) => isPrimitiveType(entry.type)))
			const installed = await MarketplaceServiceClient.listMarketplaceInstalledEntries(
				MarketplaceEntriesRequest.create({ entries }),
			)
			setInstalledKeys(new Set(installed.installedKeys))
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		refresh()
	}, [refresh])

	useEffect(() => {
		setActiveType(initialType)
		setQuery("")
		setSelectedTag(null)
	}, [initialType])

	const primitive = getPrimitive(activeType)
	const searchedCatalogEntries = useMemo(() => {
		const normalizedQuery = query.trim().toLowerCase()
		return catalogEntries.filter(
			(entry) => entry.type === activeType && (!normalizedQuery || searchTextForEntry(entry).includes(normalizedQuery)),
		)
	}, [catalogEntries, activeType, query])
	const tagFilters = useMemo(() => {
		const labelsById = new Map<string, string>()
		const counts = new Map<string, number>()
		for (const entry of searchedCatalogEntries) {
			for (const label of entryTagLabels(entry)) {
				const id = tagId(label)
				if (!id) continue
				labelsById.set(id, label)
				counts.set(id, (counts.get(id) ?? 0) + 1)
			}
		}
		return {
			counts,
			tags: [...labelsById.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
		}
	}, [searchedCatalogEntries])
	useEffect(() => {
		if (selectedTag && !tagFilters.counts.has(selectedTag)) {
			setSelectedTag(null)
		}
	}, [selectedTag, tagFilters.counts])
	const visibleCatalogEntries = useMemo(
		() =>
			selectedTag
				? searchedCatalogEntries.filter((entry) => entryTagLabels(entry).some((label) => tagId(label) === selectedTag))
				: searchedCatalogEntries,
		[searchedCatalogEntries, selectedTag],
	)
	const visibleLocalEntries = useMemo(
		() => localEntries.filter((entry) => entry.type === activeType),
		[localEntries, activeType],
	)
	const hasAnyCurrentPrimitiveEntries = useMemo(
		() => catalogEntries.some((entry) => entry.type === activeType) || visibleLocalEntries.length > 0,
		[catalogEntries, activeType, visibleLocalEntries.length],
	)

	const handleInstall = useCallback(
		async (entry: MarketplaceEntry) => {
			setInstallingId(entryKey(entry))
			setError(null)
			try {
				await MarketplaceServiceClient.installMarketplaceEntry(MarketplaceEntryRequest.create({ entry }))
				await refresh()
			} catch (err) {
				setError(err instanceof Error ? err.message : String(err))
			} finally {
				setInstallingId(null)
			}
		},
		[refresh],
	)

	const handleToggleLocal = useCallback(async (entry: MarketplaceLocalInstalledEntry, enabled: boolean) => {
		const key = `${entry.type}:${entry.id}:${entry.path}`
		setTogglingLocalId(key)
		setError(null)
		try {
			const response = await MarketplaceServiceClient.toggleMarketplaceLocalInstalledEntry(
				ToggleMarketplaceLocalInstalledEntryRequest.create({ entry, enabled }),
			)
			setLocalEntries(response.entries.filter((item) => isPrimitiveType(item.type)))
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err))
		} finally {
			setTogglingLocalId(null)
		}
	}, [])

	const handleTabChange = useCallback((value: string) => {
		setActiveType(value as PrimitiveType)
		setQuery("")
		setSelectedTag(null)
	}, [])

	return (
		<Tab className="marketplace-view">
			<MarketplaceStyles />
			<ViewHeader environment={environment} onDone={onDone} title="Customize" />

			<div className="marketplace-shell">
				<TabList className="marketplace-nav" onValueChange={handleTabChange} value={activeType}>
					{PRIMITIVES.map((item) => (
						<TabTrigger className="marketplace-tab" key={item.type} value={item.type}>
							<item.icon aria-hidden className="h-4 w-4 shrink-0" />
							<span className="marketplace-tab-label">{item.label}</span>
						</TabTrigger>
					))}
				</TabList>

				<TabContent className="marketplace-content">
					<div className="marketplace-inner">
						<div className="marketplace-primitive-description">{primitive.description}</div>
						{error && <div className="marketplace-error">{error}</div>}

						{loading ? (
							<div className="marketplace-loading">
								<VSCodeProgressRing />
								<span>Loading {primitive.plural}</span>
							</div>
						) : (
							<>
								{activeType === "mcp" ? (
									<McpManagementPanel />
								) : (
									<Section
										count={visibleLocalEntries.length}
										empty={`No installed ${primitive.plural}.`}
										title={`Installed ${primitive.title}`}>
										{visibleLocalEntries.map((entry) => (
											<LocalInstalledRow
												entry={entry}
												key={`${entry.type}:${entry.id}:${entry.path}`}
												onToggle={handleToggleLocal}
												toggling={togglingLocalId === `${entry.type}:${entry.id}:${entry.path}`}
											/>
										))}
									</Section>
								)}

								<MarketplaceCatalogSection
									count={visibleCatalogEntries.length}
									empty={
										query || selectedTag
											? `No ${primitive.plural} match your search.`
											: `No marketplace ${primitive.plural}.`
									}
									filters={
										<TagFilters
											counts={tagFilters.counts}
											onSelect={setSelectedTag}
											selectedTag={selectedTag}
											tags={tagFilters.tags}
										/>
									}
									search={
										<div className="marketplace-search">
											<VSCodeTextField
												aria-label={`Search ${primitive.title}`}
												onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
												placeholder={`Search ${primitive.plural}`}
												value={query}>
												<span className="codicon codicon-search" slot="start" />
												{query && (
													<button
														aria-label="Clear search"
														className="codicon codicon-close marketplace-clear-search"
														onClick={() => setQuery("")}
														slot="end"
														type="button"
													/>
												)}
											</VSCodeTextField>
										</div>
									}>
									{visibleCatalogEntries.map((entry) => (
										<CatalogEntryRow
											entry={entry}
											installed={installedKeys.has(entryKey(entry))}
											installing={installingId === entryKey(entry)}
											key={entryKey(entry)}
											onInstall={handleInstall}
										/>
									))}
								</MarketplaceCatalogSection>

								{!hasAnyCurrentPrimitiveEntries && (
									<div className="marketplace-empty">
										<BlocksIcon aria-hidden className="h-4 w-4" />
										<span>No {primitive.plural} found.</span>
									</div>
								)}
							</>
						)}
					</div>
				</TabContent>
			</div>
		</Tab>
	)
}

export default MarketplaceView
