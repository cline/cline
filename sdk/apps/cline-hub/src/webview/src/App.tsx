import {
	ActivityIcon,
	BotIcon,
	ClockIcon,
	HomeIcon,
	LinkIcon,
	MessageSquareIcon,
	RotateCcwIcon,
	RssIcon,
	SettingsIcon,
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
import type {
	WebviewConnectedClient,
	WebviewHubEvent,
	WebviewHubState,
	WebviewOutboundMessage,
	WebviewSessionSummary,
} from "../../webview-protocol";
import Chat from "./Chat";
import { SettingsView } from "./components/views/settings/settings-view";
import { getVsCodeApi, postToHost } from "./vscode";

type View = "home" | "chat" | "settings";
type Theme = "dark" | "light";

const EMPTY_HUB_STATE: WebviewHubState = {
	type: "hub_state",
	connected: false,
	clients: [],
	sessions: [],
	clientSummaries: [],
	sessionSummaries: [],
	events: [],
};

function readTheme(): Theme {
	try {
		const state = getVsCodeApi()?.getState() as { theme?: Theme } | undefined;
		return state?.theme === "light" ? "light" : "dark";
	} catch {
		return "dark";
	}
}

function writeTheme(theme: Theme): void {
	try {
		const api = getVsCodeApi();
		const state = (api?.getState() as Record<string, unknown>) ?? {};
		api?.setState({ ...state, theme });
	} catch {
		// Theme persistence is best-effort.
	}
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

function Shell({
	children,
	onNavigate,
	view,
}: {
	children: ReactNode;
	onNavigate: (view: View) => void;
	theme: Theme;
	view: View;
}) {
	return (
		<div className="grid h-screen min-h-screen grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground">
			<header className="flex items-center justify-between gap-4 border-b bg-[color-mix(in_oklch,var(--background)_94%,var(--card))] px-4 py-2.5 max-[720px]:flex-col max-[720px]:items-stretch">
				<div className="min-w-0">
					<h1 className="truncate text-base font-semibold">Cline Hub</h1>
				</div>
				<nav
					className="flex items-center gap-1.5 max-[720px]:justify-start"
					aria-label="Hub views"
				>
					<Button
						onClick={() => onNavigate("home")}
						size="sm"
						type="button"
						variant={view === "home" ? "default" : "ghost"}
					>
						<HomeIcon className="size-4" />
					</Button>
					<Button
						onClick={() => onNavigate("chat")}
						size="sm"
						type="button"
						variant={view === "chat" ? "default" : "ghost"}
					>
						<MessageSquareIcon className="size-4" />
					</Button>
					<Button
						onClick={() => onNavigate("settings")}
						size="icon-sm"
						title="Settings"
						type="button"
						variant={view === "settings" ? "default" : "ghost"}
					>
						<SettingsIcon className="size-4" />
						<span className="sr-only">Settings</span>
					</Button>
				</nav>
			</header>
			<main className="min-h-0 overflow-hidden [&>.h-screen]:h-full">
				{children}
			</main>
		</div>
	);
}

function HomeView({
	hubState,
	onOpenSession,
	onRestartHub,
	restartPending,
	recentSessions,
}: {
	hubState: WebviewHubState;
	onOpenSession: (sessionId: string) => void;
	onRestartHub: () => void;
	restartPending: boolean;
	recentSessions: WebviewSessionSummary[];
}) {
	const activeSessions = hubState.sessionSummaries ?? [];
	const connectedClients = hubState.clients ?? [];
	const latestEvents = hubState.events.slice(0, 6);
	const [restartDialogOpen, setRestartDialogOpen] = useState(false);

	const confirmRestartHub = () => {
		setRestartDialogOpen(false);
		onRestartHub();
	};

	return (
		<div className="h-full overflow-auto p-[18px] max-[720px]:p-3">
			<section className="flex items-center justify-between gap-4 border-b pb-[18px] max-[720px]:flex-col max-[720px]:items-stretch">
				<div>
					<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
						Dashboard
					</p>
					{/* <p className="overview-subtitle">
						{hubState.lastWorkspaceRoot || "No workspace context yet"}
					</p> */}
				</div>
				<div className="flex flex-wrap items-center justify-end gap-2.5 max-[720px]:justify-start">
					<div className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-muted-foreground">
						<LinkIcon className="size-4 shrink-0" />
						<span
							className="min-w-0 truncate"
							title={hubState.hubUrl ?? "No hub URL"}
						>
							{hubState.hubUrl ?? "no hub url"}
						</span>
					</div>
					<div
						className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-muted-foreground"
						title="ClineCore package version"
					>
						<span className="font-medium text-foreground">ClineCore</span>
						{hubState.coreVersion ?? "unknown"}
					</div>
					<div
						className="inline-flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs text-muted-foreground"
						title="Hub uptime"
					>
						<ClockIcon className="size-4" />
						{hubState.hubUptime ?? "no uptime"}
					</div>
					<Button
						disabled={!hubState.connected || restartPending}
						onClick={() => setRestartDialogOpen(true)}
						size="sm"
						title="Restart hub"
						type="button"
						variant="outline"
					>
						<RotateCcwIcon
							className={`size-4 ${restartPending ? "animate-spin" : ""}`}
						/>
						<span>{restartPending ? "Restarting" : "Restart"}</span>
					</Button>
				</div>
			</section>
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

			<section className="my-4 grid grid-cols-2 gap-2.5 max-[720px]:grid-cols-1">
				<div className="grid grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg border bg-[color-mix(in_oklch,var(--card)_88%,transparent)] p-3.5">
					<BotIcon className="size-4 text-muted-foreground" />
					<span className="text-[26px] font-bold leading-none">
						{hubState.clientSummaries.length}
					</span>
					<span className="col-start-2 text-xs text-muted-foreground">
						Connected Clients
					</span>
				</div>
				<div className="grid grid-cols-[auto_1fr] grid-rows-[auto_auto] items-center gap-x-2.5 gap-y-0.5 rounded-lg border bg-[color-mix(in_oklch,var(--card)_88%,transparent)] p-3.5">
					<ActivityIcon className="size-4 text-muted-foreground" />
					<span className="text-[26px] font-bold leading-none">
						{activeSessions.length}
					</span>
					<span className="col-start-2 text-xs text-muted-foreground">
						Active Sessions
					</span>
				</div>
			</section>

			<section className="min-h-60 overflow-hidden rounded-lg border bg-card">
				<div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
					<h3 className="text-[13px] font-[650]">Connected Clients</h3>
				</div>
				<div className="grid gap-2 p-2.5">
					{hubState.clientSummaries.length === 0 ? (
						<p className="px-1 py-4 text-[13px] text-muted-foreground">
							No connected clients found.
						</p>
					) : (
						hubState.clientSummaries.map((client) => (
							<div
								className="flex items-center justify-between gap-3 border bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-2.5"
								key={`${client.label}-${client.name}`}
							>
								<div>
									<p className="text-[13px] font-semibold leading-tight">
										{client.name}
									</p>
								</div>
								<strong className="text-xl leading-none">
									{client.sessionCount ? client.sessionCount : null}
								</strong>
							</div>
						))
					)}
				</div>
			</section>

			<div className="mt-4 grid grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)] gap-3.5 max-[980px]:grid-cols-1">
				<section className="min-h-60 overflow-hidden rounded-lg border bg-card">
					<div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
						<h3 className="text-[13px] font-[650]">Recent Sessions</h3>
						<span className="text-xs text-muted-foreground">
							{recentSessions.length}
						</span>
					</div>
					<div className="grid gap-2 p-2.5">
						{recentSessions.length === 0 ? (
							<p className="px-1 py-4 text-[13px] text-muted-foreground">
								No recent sessions.
							</p>
						) : (
							recentSessions.map((session) => (
								<RecentSessionRow
									key={session.sessionId}
									onOpen={() => onOpenSession(session.sessionId)}
									session={session}
								/>
							))
						)}
					</div>
				</section>

				<section className="min-h-60 overflow-hidden rounded-lg border bg-card hidden">
					<div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
						<h3 className="text-[13px] font-[650]">
							Connected Client{connectedClients.length === 1 ? "" : "s"}
						</h3>
						<span className="text-xs text-muted-foreground">
							{connectedClients.length}
						</span>
					</div>
					<div className="grid gap-2 p-2.5">
						{connectedClients.length === 0 ? (
							<p className="px-1 py-4 text-[13px] text-muted-foreground">
								No clients connected.
							</p>
						) : (
							connectedClients.map((client) => (
								<div
									className="flex items-center justify-between gap-3 border bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-2.5"
									key={client.clientId}
								>
									<div>
										<p className="text-[13px] font-semibold leading-tight">
											{clientLabel(client)}
										</p>
										<span className="text-[11px] text-muted-foreground">
											{client.clientType}
										</span>
									</div>
									<span className="text-[11px] text-muted-foreground">
										{formatRelativeTime(client.connectedAt)}
									</span>
								</div>
							))
						)}
					</div>
				</section>

				<section className="min-h-60 overflow-hidden rounded-lg border bg-card">
					<div className="flex items-center justify-between gap-3 border-b px-3.5 py-3">
						<h3 className="text-[13px] font-[650]">Recent Events</h3>
						<span className="text-xs text-muted-foreground">
							<RssIcon className="size-4" />
						</span>
					</div>
					<div className="w-full p-2.5">
						{latestEvents.length === 0 ? (
							<p className="px-1 py-4 text-[13px] text-muted-foreground">
								No hub events yet.
							</p>
						) : (
							latestEvents.map((event) => (
								<EventRow event={event} key={event.id} />
							))
						)}
					</div>
				</section>
			</div>
		</div>
	);
}

function RecentSessionRow({
	onOpen,
	session,
}: {
	onOpen: () => void;
	session: WebviewSessionSummary;
}) {
	const inputTokens = formatCompactNumber(session.inputTokens);
	const outputTokens = formatCompactNumber(session.outputTokens);
	const cost = formatCost(session.totalCost);
	const runDetails = [
		workspaceName(session.workspaceRoot),
		`${session.providerId}:${session.model}`,
		inputTokens ? `${inputTokens}/${outputTokens}` : undefined,
		cost,
		session.source,
	].filter((detail): detail is string => Boolean(detail));

	return (
		<button
			className="grid w-full gap-2 border bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={onOpen}
			type="button"
		>
			<div className="flex items-center justify-start gap-3">
				<span
					className={`size-2 shrink-0 rounded-full ${statusTone(session.status)}`}
				/>
				<div className="min-w-0">
					<p className="text-[13px] font-semibold leading-tight">
						{session.title || shortId(session.sessionId)}
					</p>
				</div>
			</div>
			{runDetails.length > 0 ? (
				<div className="flex flex-wrap items-center gap-1.5 pl-[18px] text-[11px] text-muted-foreground">
					<span>{formatRelativeTime(session.updatedAt)}</span>
					<span
						className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
						key={session.workspaceRoot}
						title={session.workspaceRoot}
					>
						{session.workspaceRoot}
					</span>
					{runDetails.map((detail, index) => (
						<span
							className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
							key={`${detail}-${index}`}
							title={detail}
						>
							{detail}
						</span>
					))}
				</div>
			) : null}
		</button>
	);
}

function EventRow({ event }: { event: WebviewHubEvent }) {
	const severityBorder = {
		error: "border-l-destructive",
		info: "border-l-blue-300",
		success: "border-l-muted-foreground",
		warn: "border-l-amber-300",
	}[event.severity];

	return (
		<div
			className={`flex items-start justify-between gap-3 border border-l-[3px] bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-2.5 ${severityBorder}`}
		>
			<div>
				<p className="text-[13px] font-semibold leading-tight">{event.title}</p>
				<span className="text-[11px] text-muted-foreground">{event.body}</span>
			</div>
			<time className="whitespace-nowrap text-[11px] text-muted-foreground">
				{formatRelativeTime(event.timestamp)}
			</time>
		</div>
	);
}

function App() {
	const [view, setView] = useState<View>("home");
	const [theme, setTheme] = useState<Theme>(() => readTheme());
	const [hubState, setHubState] = useState<WebviewHubState>(EMPTY_HUB_STATE);
	const [restartPending, setRestartPending] = useState(false);
	const [selectedSessionId, setSelectedSessionId] = useState<string>();
	const [recentSessions, setRecentSessions] = useState<WebviewSessionSummary[]>(
		[],
	);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		writeTheme(theme);
	}, [theme]);

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
				setRecentSessions(message.sessions.slice(0, 10));
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

	const navigate = useCallback((nextView: View) => {
		if (nextView === "chat") {
			setSelectedSessionId(undefined);
		}
		setView(nextView);
	}, []);

	const openSession = useCallback((sessionId: string) => {
		setSelectedSessionId(sessionId);
		setView("chat");
	}, []);

	const content = useMemo(() => {
		if (view === "chat") return <Chat initialSessionId={selectedSessionId} />;
		if (view === "settings") {
			return (
				<SettingsView
					onClose={() => setView("home")}
					onThemeChange={setTheme}
					theme={theme}
				/>
			);
		}
		return (
			<HomeView
				hubState={hubState}
				onOpenSession={openSession}
				onRestartHub={restartHub}
				recentSessions={recentSessions}
				restartPending={restartPending}
			/>
		);
	}, [
		hubState,
		openSession,
		recentSessions,
		restartHub,
		restartPending,
		selectedSessionId,
		theme,
		view,
	]);

	return (
		<Shell onNavigate={navigate} theme={theme} view={view}>
			{content}
		</Shell>
	);
}

export default App;
