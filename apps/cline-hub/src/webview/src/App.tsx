import {
	ActivityIcon,
	ArrowUpDownIcon,
	BotIcon,
	ClockIcon,
	CodeIcon,
	FileTextIcon,
	Folder,
	FunnelIcon,
	HomeIcon,
	LinkIcon,
	MessageSquareIcon,
	MoreHorizontal,
	PencilIcon,
	PlugIcon,
	RotateCcwIcon,
	RssIcon,
	ServerIcon,
	SettingsIcon,
	Trash2Icon,
	UserCircleIcon,
	WrenchIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type {
	WebviewActiveConnector,
	WebviewConnectedClient,
	WebviewHubEvent,
	WebviewHubState,
	WebviewOutboundMessage,
	WebviewSessionSummary,
} from "../../webview-protocol";
import Chat from "./Chat";
import { PageFrame, PageHeader } from "./components/views/page-layout";
import {
	type CustomizationSection,
	CustomizationSectionView,
} from "./components/views/settings/extensions-view";
import {
	type SettingsSection,
	SettingsView,
} from "./components/views/settings/settings-view";
import { syncHubTheme } from "./lib/theme";
import {
	postToHost,
	readBrowserConnectionTarget,
	writeBrowserConnectionTarget,
} from "./vscode";

type View =
	| "home"
	| "sessions"
	| "chat"
	| "models"
	| "rules"
	| "hooks"
	| "mcp"
	| "plugins"
	| "skills"
	| "agents"
	| "tools"
	| "channels"
	| "schedules"
	| "settings"
	| "account";
const VIEW_PATHS: Record<View, string> = {
	home: "/",
	sessions: "/sessions",
	chat: "/chat",
	models: "/models",
	rules: "/rules",
	hooks: "/hooks",
	mcp: "/mcp",
	plugins: "/plugins",
	skills: "/skills",
	agents: "/agents",
	tools: "/tools",
	channels: "/channels",
	schedules: "/schedules",
	settings: "/settings",
	account: "/settings/account",
};

const CHAT_SESSION_QUERY_PARAM = "id";

const SETTINGS_SECTION_PATHS: Record<SettingsSection, string> = {
	General: "/settings",
	Providers: "/settings/providers",
	MCP: "/settings/mcp",
	Channels: "/settings/channels",
	Schedules: "/settings/schedules",
	Account: "/settings/account",
};

const CUSTOMIZATION_VIEW_SECTIONS = {
	rules: "Rules",
	hooks: "Hooks",
	mcp: "MCP",
	skills: "Skills",
	agents: "Agents",
	plugins: "Plugins",
	tools: "Tools",
} satisfies Partial<Record<View, CustomizationSection>>;

const EMPTY_HUB_STATE: WebviewHubState = {
	type: "hub_state",
	connected: false,
	clients: [],
	connectors: [],
	sessions: [],
	clientSummaries: [],
	sessionSummaries: [],
	events: [],
};

function viewFromPath(pathname: string): View {
	if (pathname === VIEW_PATHS.sessions) return "sessions";
	if (pathname === VIEW_PATHS.chat) return "chat";
	if (pathname === VIEW_PATHS.models) return "models";
	if (
		pathname === VIEW_PATHS.rules ||
		pathname === "/customizations" ||
		pathname === "/settings/customizations"
	)
		return "rules";
	if (pathname === VIEW_PATHS.hooks) return "hooks";
	if (
		pathname === "/marketplace" ||
		pathname === VIEW_PATHS.mcp ||
		pathname === "/marketplace/mcp"
	)
		return "mcp";
	if (pathname === VIEW_PATHS.plugins || pathname === "/marketplace/plugins")
		return "plugins";
	if (pathname === VIEW_PATHS.skills || pathname === "/marketplace/skills")
		return "skills";
	if (pathname === VIEW_PATHS.agents) return "agents";
	if (pathname === VIEW_PATHS.tools) return "tools";
	if (pathname === VIEW_PATHS.channels) return "channels";
	if (pathname === VIEW_PATHS.schedules) return "schedules";
	if (pathname === VIEW_PATHS.account) return "account";
	if (
		pathname === VIEW_PATHS.settings ||
		pathname.startsWith(`${VIEW_PATHS.settings}/`)
	) {
		return "settings";
	}
	return "home";
}

function settingsSectionFromPath(pathname: string): SettingsSection {
	for (const [section, path] of Object.entries(SETTINGS_SECTION_PATHS)) {
		if (pathname === path) {
			return section as SettingsSection;
		}
	}
	return "General";
}

function readCurrentView(): View {
	if (typeof window === "undefined") return "home";
	return viewFromPath(window.location.pathname);
}

function readCurrentChatSessionId(): string | undefined {
	if (typeof window === "undefined") return undefined;
	if (window.location.pathname !== VIEW_PATHS.chat) return undefined;
	const sessionId = new URLSearchParams(window.location.search)
		.get(CHAT_SESSION_QUERY_PARAM)
		?.trim();
	return sessionId || undefined;
}

function chatPath(sessionId?: string): string {
	const params = persistentRouteSearchParams();
	if (sessionId) {
		params.set(CHAT_SESSION_QUERY_PARAM, sessionId);
	} else {
		params.delete(CHAT_SESSION_QUERY_PARAM);
	}
	const query = params.toString();
	return query ? `${VIEW_PATHS.chat}?${query}` : VIEW_PATHS.chat;
}

function readCurrentSettingsSection(): SettingsSection {
	if (typeof window === "undefined") return "General";
	return settingsSectionFromPath(window.location.pathname);
}

function persistentRouteSearchParams(): URLSearchParams {
	if (typeof window === "undefined") return new URLSearchParams();
	const params = new URLSearchParams(window.location.search);
	params.delete(CHAT_SESSION_QUERY_PARAM);
	return params;
}

function routePath(pathname: string): string {
	const params = persistentRouteSearchParams();
	const query = params.toString();
	return query ? `${pathname}?${query}` : pathname;
}

function replaceLegacyCustomizationRoute(): void {
	if (
		typeof window === "undefined" ||
		(window.location.pathname !== "/customizations" &&
			window.location.pathname !== "/settings/customizations")
	) {
		return;
	}
	const nextPath = routePath(VIEW_PATHS.rules);
	if (currentPathWithSearch() !== nextPath) {
		window.history.replaceState(null, "", nextPath);
	}
}

function currentPathWithSearch(): string {
	if (typeof window === "undefined") return "/";
	return `${window.location.pathname}${window.location.search}`;
}

function formatRelativeTime(timestamp?: number): string {
	if (!timestamp) return "unknown";
	const elapsed = Math.max(0, Date.now() - timestamp);
	const minutes = Math.floor(elapsed / 60_000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
}

function shortId(id: string): string {
	return id.length > 12 ? id.slice(0, 12) : id;
}

function workspaceName(path?: string): string | undefined {
	const trimmed = path?.trim();
	if (!trimmed) return undefined;
	const parts = trimmed.split(/[\\/]+/).filter(Boolean);
	return parts.at(-1) ?? trimmed;
}

function formatCompactNumber(value?: number): string | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return new Intl.NumberFormat(undefined, {
		notation: "compact",
		maximumFractionDigits: 1,
	}).format(value);
}

function formatCost(value?: number): string | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return new Intl.NumberFormat(undefined, {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
		maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
	}).format(value);
}

function statusTone(status?: string): string {
	const normalized = status?.toLowerCase();
	if (
		normalized === "running" ||
		normalized === "completed" ||
		normalized === "idle"
	)
		return "bg-emerald-300";
	if (normalized === "failed") return "bg-destructive";
	return "bg-muted-foreground";
}

function clientLabel(client: WebviewConnectedClient): string {
	return (
		client.displayName?.trim() || client.clientType || shortId(client.clientId)
	);
}

function connectorLabel(connector: WebviewActiveConnector): string {
	if (connector.botUsername) {
		return `@${connector.botUsername}`;
	}
	if (connector.userName) {
		return connector.userName;
	}
	if (connector.applicationId) {
		return connector.applicationId;
	}
	return shortId(connector.id);
}

function formatSessionModel(session: WebviewSessionSummary): string {
	if (session.providerId && session.model) {
		return `${session.providerId}:${session.model}`;
	}
	return session.model ?? session.providerId ?? "No model";
}

function sessionFilterDetails(session: WebviewSessionSummary): string[] {
	const name = workspaceName(session.workspaceRoot);
	return [
		name ? `workspace:${name}` : undefined,
		session.status ? `status:${session.status}` : undefined,
		session.providerId ? `provider:${session.providerId}` : undefined,
		session.model ? `model:${session.model}` : undefined,
		session.source ? `source:${session.source}` : undefined,
	].filter((detail): detail is string => Boolean(detail));
}

function Shell({
	children,
	onNavigate,
	version,
	view,
}: {
	children: ReactNode;
	onNavigate: (view: View) => void;
	version?: string;
	view: View;
}) {
	const navItems = [
		{ view: "home", label: "Home", icon: HomeIcon },
		{ view: "sessions", label: "Sessions", icon: MessageSquareIcon },
		{ view: "models", label: "Models", icon: BotIcon },
		{ view: "channels", label: "Channels", icon: LinkIcon },
		{ view: "schedules", label: "Schedules", icon: ClockIcon },
		{ view: "account", label: "Account", icon: UserCircleIcon },
		{ view: "settings", label: "Settings", icon: SettingsIcon },
	] satisfies Array<{
		view: Exclude<
			View,
			| "chat"
			| "rules"
			| "hooks"
			| "mcp"
			| "plugins"
			| "skills"
			| "agents"
			| "tools"
		>;
		label: string;
		icon: typeof HomeIcon;
	}>;
	const customizationNavItems = [
		{ view: "plugins", label: "Plugins", icon: PlugIcon },
		{ view: "skills", label: "Skills", icon: ActivityIcon },
		{ view: "mcp", label: "MCP", icon: ServerIcon },
		{ view: "hooks", label: "Hooks", icon: CodeIcon },
		{ view: "rules", label: "Rules", icon: FileTextIcon },
		{ view: "agents", label: "Agents", icon: BotIcon },
		{ view: "tools", label: "Tools", icon: WrenchIcon },
	] satisfies Array<{
		view: Extract<
			View,
			"rules" | "hooks" | "mcp" | "plugins" | "skills" | "agents" | "tools"
		>;
		label: string;
		icon: typeof HomeIcon;
	}>;

	const renderNavButton = (
		item: (typeof navItems | typeof customizationNavItems)[number],
	) => {
		const Icon = item.icon;
		const active =
			view === item.view || (item.view === "sessions" && view === "chat");
		return (
			<button
				className={`flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left text-[15px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar ${
					active
						? "bg-sidebar-accent text-sidebar-accent-foreground"
						: "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
				}`}
				key={item.view}
				onClick={() => onNavigate(item.view)}
				type="button"
			>
				<Icon className="size-4 shrink-0" />
				<span className="truncate">{item.label}</span>
			</button>
		);
	};

	return (
		<div className="grid h-screen min-h-screen grid-cols-[14.5rem_minmax(0,1fr)] bg-background text-foreground max-[720px]:grid-cols-1 max-[720px]:grid-rows-[auto_minmax(0,1fr)]">
			<aside className="flex min-h-0 flex-col border-r bg-sidebar p-4 text-sidebar-foreground max-[720px]:border-b max-[720px]:border-r-0 max-[720px]:p-3">
				<button
					className="mb-5 flex min-w-0 items-center gap-2 rounded-md px-0 py-1 text-left text-lg font-semibold outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar max-[720px]:mb-2"
					onClick={() => onNavigate("home")}
					type="button"
				>
					<img
						alt=""
						className="size-6 shrink-0 dark:invert"
						src="/cline-logo-filled.svg"
					/>
					<span className="truncate">Cline Hub</span>
				</button>
				<nav
					className="grid gap-1 overflow-y-auto max-[720px]:grid-flow-col max-[720px]:auto-cols-max max-[720px]:overflow-x-auto max-[720px]:[scrollbar-width:none] max-[720px]:[&::-webkit-scrollbar]:hidden"
					aria-label="Hub views"
				>
					{navItems.map(renderNavButton)}
					<div className="mt-4 px-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground max-[720px]:mt-0 max-[720px]:self-center">
						Customizations
					</div>
					{customizationNavItems.map(renderNavButton)}
				</nav>
				<div className="mt-auto pt-6 max-[720px]:mt-2 max-[720px]:pt-0">
					<div className="flex min-w-0 items-center gap-2 px-2 text-xs text-muted-foreground">
						<span className="shrink-0">{version ? `v${version}` : "v-"}</span>
						<span className="shrink-0 text-border">|</span>
						<a
							className="truncate underline-offset-2 transition-colors hover:text-foreground hover:underline"
							href="https://github.com/cline/cline/issues/new"
							rel="noopener noreferrer"
							target="_blank"
						>
							Report issue
						</a>
					</div>
				</div>
			</aside>
			<main className="min-h-0 overflow-hidden bg-background [&>.h-screen]:h-full">
				{children}
			</main>
		</div>
	);
}

function HomeView({
	hubState,
	onConnectHub,
	onOpenSession,
	onRestartHub,
	onViewSessions,
	restartPending,
	recentSessions,
}: {
	hubState: WebviewHubState;
	onConnectHub: (hubUrl: string) => void;
	onOpenSession: (sessionId: string) => void;
	onRestartHub: () => void;
	onViewSessions: () => void;
	restartPending: boolean;
	recentSessions: WebviewSessionSummary[];
}) {
	const activeSessions = hubState.sessionSummaries ?? [];
	const connectedClients = hubState.clients ?? [];
	const connectedConnectors = hubState.connectors ?? [];
	const latestEvents = hubState.events.slice(0, 3);
	const sessionPreview = (
		recentSessions.length > 0 ? recentSessions : activeSessions
	).slice(0, 2);
	const [restartDialogOpen, setRestartDialogOpen] = useState(false);
	const [hubUrlInput, setHubUrlInput] = useState(
		() => readBrowserConnectionTarget().hubUrl ?? hubState.hubUrl ?? "",
	);

	const copyText = useCallback((value?: string) => {
		if (!value || typeof navigator === "undefined") return;
		void navigator.clipboard?.writeText(value);
	}, []);

	const confirmRestartHub = () => {
		setRestartDialogOpen(false);
		onRestartHub();
	};

	const submitHubUrl = () => {
		const nextHubUrl = hubUrlInput.trim();
		if (!nextHubUrl) return;
		writeBrowserConnectionTarget({ hubUrl: nextHubUrl });
		onConnectHub(nextHubUrl);
	};

	return (
		<PageFrame>
			<PageHeader
				title="Cline Hub"
				description="Monitor connected clients, sessions, and hub activity."
				className="mb-10"
				actions={
					<>
						<div
							className="inline-flex h-7 items-center gap-1.5 rounded border bg-background px-2 text-xs text-muted-foreground"
							title="Hub uptime"
						>
							<ClockIcon className="size-3.5" />
							Uptime {hubState.hubUptime ?? "0m"}
						</div>
						<button
							aria-label="Copy hub URL"
							className="inline-flex h-7 min-w-0 max-w-64 items-center gap-1.5 rounded border bg-background px-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
							disabled={!hubState.hubUrl}
							onClick={() => copyText(hubState.hubUrl)}
							title="Copy hub URL"
							type="button"
						>
							<LinkIcon className="size-3.5 shrink-0" />
							<span
								className="min-w-0 truncate"
								title={hubState.hubUrl ?? "No hub URL"}
							>
								{hubState.hubUrl ?? "no hub url"}
							</span>
						</button>
						<Button
							disabled={!hubState.connected || restartPending}
							onClick={() => setRestartDialogOpen(true)}
							size="sm"
							title="Restart Cline Hub"
							type="button"
							variant="outline"
							className="h-7 rounded px-2 text-xs"
						>
							<RotateCcwIcon
								className={`size-3.5 ${restartPending ? "animate-spin" : ""}`}
							/>
							<span>{restartPending ? "Restarting" : "Restart"}</span>
						</Button>
					</>
				}
			/>
			<form
				className="mb-5 flex max-w-[52rem] items-center gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					submitHubUrl();
				}}
			>
				<Input
					aria-label="Hub URL"
					className="h-8"
					onChange={(event) => setHubUrlInput(event.target.value)}
					placeholder="ws://127.0.0.1:25463/hub"
					value={hubUrlInput}
				/>
				<Button className="h-8 rounded px-2" size="sm" type="submit">
					<LinkIcon className="size-3.5" />
					<span>Connect</span>
				</Button>
			</form>
			<AlertDialog
				open={restartDialogOpen}
				onOpenChange={(open) => {
					if (!restartPending) {
						setRestartDialogOpen(open);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Restart Cline Hub</AlertDialogTitle>
						<AlertDialogDescription>
							This will shut down the current hub process and start it again.
							Connected clients and active sessions may disconnect while the hub
							restarts.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={restartPending}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={!hubState.connected || restartPending}
							onClick={confirmRestartHub}
							variant="destructive"
						>
							<RotateCcwIcon
								className={`size-4 ${restartPending ? "animate-spin" : ""}`}
							/>
							<span>{restartPending ? "Restarting" : "Restart Hub"}</span>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<div className="grid max-w-[86rem] grid-cols-2 gap-6 max-[1100px]:grid-cols-1">
				<section
					id="connected-clients-section"
					className="overflow-hidden rounded-lg border bg-card"
				>
					<div className="flex h-11 items-center justify-between gap-3 border-b bg-muted/40 px-4">
						<h2 className="text-[17px] font-medium text-muted-foreground">
							Connected clients
						</h2>
						<span className="text-sm text-muted-foreground">
							{connectedClients.length + connectedConnectors.length}
						</span>
					</div>
					<div className="min-h-46">
						{connectedClients.length === 0 &&
						connectedConnectors.length === 0 ? (
							<p className="px-4 py-5 text-[15px] text-muted-foreground">
								No connected clients.
							</p>
						) : null}
						{connectedClients.map((client) => (
							<div
								className="flex min-h-18 items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
								key={client.clientId}
							>
								<div className="flex min-w-0 items-start gap-3">
									<MessageSquareIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0">
										<p className="truncate text-[15px] font-semibold">
											{clientLabel(client)}
										</p>
										<p className="mt-1 truncate text-[13px] text-muted-foreground">
											{client.clientType}
										</p>
									</div>
								</div>
								<time className="shrink-0 text-sm text-muted-foreground">
									{formatRelativeTime(client.connectedAt)}
								</time>
							</div>
						))}
						{connectedConnectors.map((connector) => (
							<div
								className="flex min-h-18 items-center justify-between gap-4 border-b px-4 py-3 last:border-b-0"
								key={connector.id}
							>
								<div className="flex min-w-0 items-start gap-3">
									<ServerIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
									<div className="min-w-0">
										<p className="truncate text-[15px] font-semibold">
											{connector.type.toUpperCase()}
										</p>
										<p className="mt-1 truncate text-[13px] text-muted-foreground">
											{connectorLabel(connector)}
										</p>
									</div>
								</div>
								<span className="shrink-0 text-sm text-muted-foreground">
									Channel
								</span>
							</div>
						))}
					</div>
				</section>

				<section className="overflow-hidden rounded-lg border bg-card">
					<div className="flex h-11 items-center justify-between gap-3 border-b bg-muted/40 px-4">
						<h2 className="text-[17px] font-medium text-muted-foreground">
							Sessions
						</h2>
						<span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
							<span className="size-1.5 rounded-full bg-emerald-500" />
							{activeSessions.length} active
						</span>
					</div>
					<div className="min-h-46">
						{sessionPreview.length === 0 ? (
							<p className="px-4 py-5 text-[15px] text-muted-foreground">
								No sessions yet.
							</p>
						) : null}
						{sessionPreview.map((session) => (
							<button
								className="flex min-h-19 w-full items-center justify-between gap-4 border-b px-4 py-3 text-left transition-colors hover:bg-accent/40"
								key={session.sessionId}
								onClick={() => onOpenSession(session.sessionId)}
								type="button"
							>
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span
											className={`size-1.5 shrink-0 rounded-full ${statusTone(session.status)}`}
										/>
										<p className="truncate text-[15px] font-semibold">
											{session.title || shortId(session.sessionId)}
										</p>
									</div>
									<div className="mt-2 flex min-w-0 items-center gap-2 pl-3.5 text-[13px] text-muted-foreground">
										<Folder className="size-3.5 shrink-0" />
										<span className="truncate">
											{session.workspaceRoot ?? "No workspace"}
										</span>
										<span className="shrink-0 rounded-full border bg-background px-2 py-0.5 text-xs">
											{formatSessionModel(session)}
										</span>
									</div>
								</div>
								<time className="shrink-0 text-sm text-muted-foreground">
									{formatRelativeTime(session.updatedAt)}
								</time>
							</button>
						))}
						<button
							className="flex h-9 w-full items-center justify-center border-t text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
							onClick={onViewSessions}
							type="button"
						>
							View all
						</button>
					</div>
				</section>

				<section className="overflow-hidden rounded-lg border bg-card">
					<div className="flex h-11 items-center justify-between gap-3 border-b bg-muted/40 px-4">
						<h2 className="text-[17px] font-medium text-muted-foreground">
							Recent events
						</h2>
					</div>
					<div className="min-h-46">
						{latestEvents.length === 0 ? (
							<p className="px-4 py-5 text-[15px] text-muted-foreground">
								No hub events yet.
							</p>
						) : null}
						{latestEvents.map((event) => (
							<EventRow event={event} key={event.id} />
						))}
					</div>
				</section>
			</div>
		</PageFrame>
	);
}

function SessionsView({
	onDeleteSession,
	onOpenSession,
	onRenameSession,
	sessions,
}: {
	onDeleteSession: (sessionId: string) => Promise<void> | void;
	onOpenSession: (sessionId: string) => void;
	onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
	sessions: WebviewSessionSummary[];
}) {
	const [sessionFilters, setSessionFilters] = useState<string[]>([]);
	const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
	const [editingTitle, setEditingTitle] = useState("");
	const [deleteSessionCandidate, setDeleteSessionCandidate] =
		useState<WebviewSessionSummary | null>(null);
	const [sortDirection, setSortDirection] = useState<"newest" | "oldest">(
		"newest",
	);
	const runDetailFilterOptions = useMemo(
		() =>
			Array.from(
				new Set(sessions.flatMap((session) => sessionFilterDetails(session))),
			).sort((a, b) => a.localeCompare(b)),
		[sessions],
	);
	const filteredSessions = useMemo(() => {
		const selected = new Set(sessionFilters);
		const filtered =
			sessionFilters.length === 0
				? sessions
				: sessions.filter((session) =>
						sessionFilterDetails(session).some((detail) =>
							selected.has(detail),
						),
					);
		return [...filtered].sort((a, b) => {
			const aTime = a.createdAt ?? a.updatedAt ?? 0;
			const bTime = b.createdAt ?? b.updatedAt ?? 0;
			return sortDirection === "newest" ? bTime - aTime : aTime - bTime;
		});
	}, [sessions, sessionFilters, sortDirection]);

	const startRenameSession = (session: WebviewSessionSummary) => {
		setEditingSessionId(session.sessionId);
		setEditingTitle(session.title || shortId(session.sessionId));
	};

	const cancelRenameSession = () => {
		setEditingSessionId(null);
		setEditingTitle("");
	};

	const submitRenameSession = (session: WebviewSessionSummary) => {
		const currentTitle = session.title || shortId(session.sessionId);
		const nextTitle = editingTitle.trim();
		if (!nextTitle || nextTitle === currentTitle) {
			cancelRenameSession();
			return;
		}
		void onRenameSession(session.sessionId, nextTitle);
		cancelRenameSession();
	};

	const confirmDeleteSession = () => {
		if (!deleteSessionCandidate) return;
		void onDeleteSession(deleteSessionCandidate.sessionId);
		setDeleteSessionCandidate(null);
	};

	const toggleSessionFilter = (detail: string, checked: boolean) => {
		setSessionFilters((prev) => {
			if (checked) {
				return prev.includes(detail) ? prev : [...prev, detail];
			}
			return prev.filter((item) => item !== detail);
		});
	};

	return (
		<PageFrame>
			<PageHeader
				title="Sessions"
				description="Review, reopen, rename, and delete recent sessions."
				actions={
					<>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										title="Sort sessions"
										aria-label="Sort sessions"
										size="icon-sm"
										type="button"
										variant="secondary"
										className="size-8 rounded-md"
									/>
								}
							>
								<ArrowUpDownIcon className="size-4" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" sideOffset={6}>
								<DropdownMenuItem onClick={() => setSortDirection("newest")}>
									{sortDirection === "newest"
										? "Newest first ✓"
										: "Newest first"}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => setSortDirection("oldest")}>
									{sortDirection === "oldest"
										? "Oldest first ✓"
										: "Oldest first"}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										title="Filter sessions"
										aria-label="Filter sessions"
										size="icon-sm"
										type="button"
										variant={
											sessionFilters.length > 0 ? "default" : "secondary"
										}
										className="size-8 rounded-md"
									/>
								}
							>
								<FunnelIcon className="size-4" />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="max-h-72 w-72">
								<DropdownMenuGroup>
									<DropdownMenuLabel>Filter sessions</DropdownMenuLabel>
									{sessionFilters.length > 0 ? (
										<>
											<DropdownMenuItem onClick={() => setSessionFilters([])}>
												Clear filters
											</DropdownMenuItem>
											<DropdownMenuSeparator />
										</>
									) : null}
									{runDetailFilterOptions.length === 0 ? (
										<DropdownMenuItem disabled>No run details</DropdownMenuItem>
									) : (
										runDetailFilterOptions.map((detail) => (
											<DropdownMenuCheckboxItem
												checked={sessionFilters.includes(detail)}
												key={detail}
												onCheckedChange={(checked: boolean) =>
													toggleSessionFilter(detail, checked)
												}
											>
												<span className="truncate" title={detail}>
													{detail}
												</span>
											</DropdownMenuCheckboxItem>
										))
									)}
								</DropdownMenuGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</>
				}
			/>

			<section className="w-full min-w-0 overflow-x-auto">
				<div className="grid w-full min-w-[56rem] grid-cols-[minmax(12rem,1.35fr)_minmax(7rem,0.85fr)_minmax(10rem,1.1fr)_5rem_5rem_4.5rem_5.5rem_2rem] gap-x-4 bg-muted/40 px-4 py-3 text-[15px] font-medium text-muted-foreground">
					<span>Session title</span>
					<span>Directory</span>
					<span>Model</span>
					<span>Tokens in</span>
					<span>Tokens out</span>
					<span>Cost</span>
					<span>Created</span>
					<span />
				</div>
				<div className="w-full min-w-[56rem]">
					{filteredSessions.length === 0 ? (
						<div className="border-b px-4 py-8 text-[15px] text-muted-foreground">
							{sessions.length === 0
								? "No sessions yet."
								: "No sessions match the selected filters."}
						</div>
					) : null}
					{filteredSessions.map((session) => {
						const isEditing = editingSessionId === session.sessionId;
						const title = session.title || shortId(session.sessionId);
						return (
							<div
								className="grid min-h-14 w-full grid-cols-[minmax(12rem,1.35fr)_minmax(7rem,0.85fr)_minmax(10rem,1.1fr)_5rem_5rem_4.5rem_5.5rem_2rem] items-center gap-x-4 border-b px-4 py-3 text-left text-[15px] transition-colors hover:bg-accent/40"
								key={session.sessionId}
							>
								{isEditing ? (
									<form
										className="col-span-7 grid grid-cols-[minmax(12rem,1.35fr)_minmax(7rem,0.85fr)_minmax(10rem,1.1fr)_5rem_5rem_4.5rem_5.5rem] items-center gap-x-4"
										onSubmit={(event) => {
											event.preventDefault();
											submitRenameSession(session);
										}}
									>
										<div className="col-span-2 flex min-w-0 items-center gap-2">
											<Input
												aria-label={`Rename ${title}`}
												autoFocus
												className="h-8"
												onChange={(event) =>
													setEditingTitle(event.target.value)
												}
												onKeyDown={(event) => {
													if (event.key === "Escape") {
														event.preventDefault();
														cancelRenameSession();
													}
												}}
												value={editingTitle}
											/>
											<Button
												className="h-8 rounded-md px-2.5 text-xs"
												disabled={!editingTitle.trim()}
												type="submit"
												variant="default"
											>
												Save
											</Button>
											<Button
												className="h-8 rounded-md px-2.5 text-xs"
												onClick={cancelRenameSession}
												type="button"
												variant="outline"
											>
												Cancel
											</Button>
										</div>
										<span className="truncate text-muted-foreground">
											{formatSessionModel(session)}
										</span>
										<span className="text-muted-foreground">
											{formatCompactNumber(session.inputTokens) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatCompactNumber(session.outputTokens) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatCost(session.totalCost) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatRelativeTime(
												session.createdAt ?? session.updatedAt,
											)}
										</span>
									</form>
								) : (
									<button
										className="col-span-7 grid grid-cols-[minmax(12rem,1.35fr)_minmax(7rem,0.85fr)_minmax(10rem,1.1fr)_5rem_5rem_4.5rem_5.5rem] items-center gap-x-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
										onClick={() => onOpenSession(session.sessionId)}
										type="button"
									>
										<span className="flex min-w-0 items-center gap-3 font-semibold">
											<span
												className={`size-1.5 shrink-0 rounded-full ${statusTone(session.status)}`}
											/>
											<span className="truncate">{title}</span>
										</span>
										<span className="truncate text-muted-foreground">
											{workspaceName(session.workspaceRoot) ?? "No workspace"}
										</span>
										<span className="truncate text-muted-foreground">
											{formatSessionModel(session)}
										</span>
										<span className="text-muted-foreground">
											{formatCompactNumber(session.inputTokens) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatCompactNumber(session.outputTokens) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatCost(session.totalCost) ?? "-"}
										</span>
										<span className="text-muted-foreground">
											{formatRelativeTime(
												session.createdAt ?? session.updatedAt,
											)}
										</span>
									</button>
								)}
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<button
												aria-label={`Session actions for ${title}`}
												className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
												onClick={(event) => event.stopPropagation()}
												type="button"
											/>
										}
									>
										<MoreHorizontal className="size-4" />
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" sideOffset={6}>
										<DropdownMenuItem
											onClick={(event) => {
												event.stopPropagation();
												startRenameSession(session);
											}}
										>
											<PencilIcon className="size-4" />
											Rename
										</DropdownMenuItem>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											className="text-destructive"
											onClick={(event) => {
												event.stopPropagation();
												setDeleteSessionCandidate(session);
											}}
										>
											<Trash2Icon className="size-4" />
											Delete
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						);
					})}
				</div>
			</section>
			<AlertDialog
				open={deleteSessionCandidate !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteSessionCandidate(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete session</AlertDialogTitle>
						<AlertDialogDescription>
							Delete{" "}
							<span className="font-medium text-foreground">
								{deleteSessionCandidate?.title ||
									(deleteSessionCandidate
										? shortId(deleteSessionCandidate.sessionId)
										: "this session")}
							</span>
							? This removes it from recent sessions.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={confirmDeleteSession}
							variant="destructive"
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageFrame>
	);
}

function EventRow({ event }: { event: WebviewHubEvent }) {
	return (
		<div className="flex min-h-18 items-start justify-between gap-4 border-b px-4 py-3 last:border-b-0">
			<div className="flex min-w-0 items-start gap-3">
				<RssIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				<div className="min-w-0">
					<p className="truncate text-[15px] font-semibold">{event.title}</p>
					<p className="mt-1 truncate text-[13px] text-muted-foreground">
						{event.body}
					</p>
				</div>
			</div>
			<time className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
				{formatRelativeTime(event.timestamp)}
			</time>
		</div>
	);
}

function App() {
	const [view, setView] = useState<View>(() => readCurrentView());
	const [settingsSection, setSettingsSection] = useState<SettingsSection>(() =>
		readCurrentSettingsSection(),
	);
	const [hubState, setHubState] = useState<WebviewHubState>(EMPTY_HUB_STATE);
	const [restartPending, setRestartPending] = useState(false);
	const [selectedSessionId, setSelectedSessionId] = useState<
		string | undefined
	>(() => readCurrentChatSessionId());
	const [recentSessions, setRecentSessions] = useState<WebviewSessionSummary[]>(
		[],
	);

	useEffect(() => {
		syncHubTheme();
		replaceLegacyCustomizationRoute();
	}, []);

	useEffect(() => {
		const handlePopState = () => {
			replaceLegacyCustomizationRoute();
			const nextView = readCurrentView();
			setView(nextView);
			setSelectedSessionId(
				nextView === "chat" ? readCurrentChatSessionId() : undefined,
			);
			setSettingsSection(readCurrentSettingsSection());
		};
		window.addEventListener("popstate", handlePopState);
		return () => window.removeEventListener("popstate", handlePopState);
	}, []);

	useEffect(() => {
		const handleMessage = (event: MessageEvent<WebviewOutboundMessage>) => {
			const message = event.data;
			if (!message || typeof message !== "object") {
				return;
			}
			if (message.type === "hub_state") {
				setHubState(message);
				if (message.connected) {
					setRestartPending(false);
				}
				return;
			}
			if (message.type === "sessions") {
				setRecentSessions(message.sessions);
			}
		};
		window.addEventListener("message", handleMessage);
		postToHost({ type: "ready" });
		return () => window.removeEventListener("message", handleMessage);
	}, []);

	const restartHub = useCallback(() => {
		setRestartPending(true);
		postToHost({ type: "restart_hub" });
	}, []);

	const connectHub = useCallback((hubUrl: string) => {
		postToHost({ type: "connect_hub", hubUrl });
	}, []);

	const navigate = useCallback((nextView: View) => {
		if (nextView === "chat") {
			setSelectedSessionId(undefined);
		}
		if (nextView === "settings") {
			setSettingsSection("General");
		}
		if (nextView !== "chat") {
			setSelectedSessionId(undefined);
		}
		const nextPath = routePath(VIEW_PATHS[nextView]);
		if (currentPathWithSearch() !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView(nextView);
	}, []);

	const openSession = useCallback((sessionId: string) => {
		setSelectedSessionId(sessionId);
		const nextPath = chatPath(sessionId);
		if (currentPathWithSearch() !== nextPath) {
			window.history.pushState(null, "", nextPath);
		}
		setView("chat");
	}, []);

	const updateChatSessionRoute = useCallback((sessionId?: string) => {
		setSelectedSessionId(sessionId);
		const nextPath = chatPath(sessionId);
		if (currentPathWithSearch() !== nextPath) {
			window.history.replaceState(null, "", nextPath);
		}
	}, []);

	const deleteSession = useCallback((sessionId: string) => {
		setRecentSessions((current) =>
			current.filter((session) => session.sessionId !== sessionId),
		);
		postToHost({ type: "deleteSession", sessionId });
	}, []);

	const renameSession = useCallback((sessionId: string, title: string) => {
		setRecentSessions((current) =>
			current.map((session) =>
				session.sessionId === sessionId ? { ...session, title } : session,
			),
		);
		postToHost({
			type: "updateSessionMetadata",
			sessionId,
			metadata: { title },
		});
	}, []);

	const content = useMemo(() => {
		if (view === "chat") {
			return (
				<Chat
					initialSessionId={selectedSessionId}
					onSessionSelected={updateChatSessionRoute}
				/>
			);
		}
		if (view === "sessions") {
			return (
				<SessionsView
					onDeleteSession={deleteSession}
					onOpenSession={openSession}
					onRenameSession={renameSession}
					sessions={recentSessions}
				/>
			);
		}
		if (view === "settings") {
			return (
				<SettingsView
					initialSection={settingsSection}
					key={settingsSection}
					chrome="content"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "account") {
			return (
				<SettingsView
					chrome="content"
					initialSection="Account"
					key="account"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "models") {
			return (
				<SettingsView
					chrome="content"
					initialSection="Providers"
					key="models"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "channels") {
			return (
				<SettingsView
					chrome="content"
					initialSection="Channels"
					key="channels"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "schedules") {
			return (
				<SettingsView
					chrome="content"
					initialSection="Schedules"
					key="schedules"
					onClose={() => navigate("home")}
				/>
			);
		}
		if (view === "mcp") {
			return (
				<CustomizationSectionView
					catalogPrimitive="mcp"
					key={view}
					section={CUSTOMIZATION_VIEW_SECTIONS[view]}
				/>
			);
		}
		if (view === "skills" || view === "plugins") {
			return (
				<CustomizationSectionView
					catalogPrimitive={view === "skills" ? "skill" : "plugin"}
					key={view}
					section={CUSTOMIZATION_VIEW_SECTIONS[view]}
				/>
			);
		}
		if (
			view === "rules" ||
			view === "hooks" ||
			view === "agents" ||
			view === "tools"
		) {
			return (
				<CustomizationSectionView
					key={view}
					section={CUSTOMIZATION_VIEW_SECTIONS[view]}
				/>
			);
		}
		return (
			<HomeView
				hubState={hubState}
				onConnectHub={connectHub}
				onOpenSession={openSession}
				onRestartHub={restartHub}
				onViewSessions={() => navigate("sessions")}
				recentSessions={recentSessions}
				restartPending={restartPending}
			/>
		);
	}, [
		hubState,
		connectHub,
		deleteSession,
		navigate,
		openSession,
		recentSessions,
		renameSession,
		restartHub,
		restartPending,
		selectedSessionId,
		settingsSection,
		updateChatSessionRoute,
		view,
	]);

	return (
		<Shell onNavigate={navigate} version={hubState.coreVersion} view={view}>
			{content}
		</Shell>
	);
}

export default App;
