"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	BrowserGatewayClient,
	type GatewayEvent,
	type GatewayServerRequest,
	initialEventCursor,
} from "./gateway-client";

interface BotRecord {
	identity: {
		botId: string;
		name: string;
		role: "lead" | "worker" | "contractor";
		parentBotId: string | null;
	};
	config: { providerId?: string; modelId?: string };
	status: string;
}

interface SessionRecord {
	sessionId: string;
	botId: string;
	workspace: { rootPath: string };
	state: string;
	createdAt: number;
}

interface Approval extends GatewayServerRequest {
	answered?: "approved" | "denied";
}

type ConnectionStage = "idle" | "opening" | "authenticated" | "syncing";
const RUN_PROVIDER_ID = "cline";
const DEFAULT_MODEL_ID = "grok-5.4";
const PROMPT_DRAFT_KEY = "cline.gateway.promptDraft";

const connectionStages: Array<{
	id: Exclude<ConnectionStage, "idle">;
	label: string;
}> = [
	{ id: "opening", label: "Opening channel" },
	{ id: "authenticated", label: "Identity verified" },
	{ id: "syncing", label: "Loading bots" },
];

const environmentToken = "";
export function App({
	defaultUrl,
	defaultToken,
	userDisplayName,
}: {
	defaultUrl?: string;
	defaultToken?: string;
	userDisplayName?: string;
} = {}) {
	const clientRef = useRef<BrowserGatewayClient | undefined>(undefined);
	const configuredToken = defaultToken?.trim() || environmentToken;
	const [url, setUrl] = useState(() =>
		defaultUrl?.trim() ||
		(typeof window === "undefined"
			? "ws://127.0.0.1:8080"
			: (localStorage.getItem("cline.gateway.url") ??
				"ws://127.0.0.1:8080")),
	);
	const [token, setToken] = useState("");
	const [allowInsecure, setAllowInsecure] = useState(false);
	const [status, setStatus] = useState<
		"disconnected" | "connecting" | "connected"
	>("disconnected");
	const [hasConnected, setHasConnected] = useState(false);
	const [connectionStage, setConnectionStage] =
		useState<ConnectionStage>("idle");
	const [error, setError] = useState("");
	const [gatewayName, setGatewayName] = useState("");
	const [bots, setBots] = useState<BotRecord[]>([]);
	const [sessions, setSessions] = useState<SessionRecord[]>([]);
	const [selectedBotId, setSelectedBotId] = useState("");
	const [selectedSessionId, setSelectedSessionId] = useState("");
	const [events, setEvents] = useState<GatewayEvent[]>([]);
	const [approvals, setApprovals] = useState<Approval[]>([]);
	const [prompt, setPrompt] = useState(
		() =>
			(typeof window === "undefined"
				? ""
				: (localStorage.getItem(PROMPT_DRAFT_KEY) ?? "")),
	);
	const [modelId, setModelId] = useState("");
	const [sending, setSending] = useState(false);
	const [steerMode, setSteerMode] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(true);

	const selectedBot = bots.find((bot) => bot.identity.botId === selectedBotId);
	const visibleSessions = sessions.filter(
		(session) => session.botId === selectedBotId,
	);
	const visibleEvents = useMemo(
		() =>
			events.filter((event) =>
				selectedSessionId
					? event.scope.sessionId === selectedSessionId
					: event.scope.botId === selectedBotId,
			),
		[events, selectedBotId, selectedSessionId],
	);
	const runStates = useMemo(
		() => projectRunStates(visibleEvents),
		[visibleEvents],
	);
	const activeRun = [...runStates.values()]
		.reverse()
		.find((run) => run.state === "running");

	useEffect(() => () => clientRef.current?.close(), []);

	async function connect(event?: FormEvent) {
		event?.preventDefault();
		setStatus("connecting");
		setConnectionStage("opening");
		setError("");
		clientRef.current?.close();
		try {
			const client = await BrowserGatewayClient.connect({
				url,
				auth: token.trim() || configuredToken,
				clientId: localStorage.getItem("cline.gateway.clientId") ?? undefined,
				allowInsecure,
			});
			clientRef.current = client;
			setConnectionStage("authenticated");
			localStorage.setItem("cline.gateway.url", url);
			localStorage.setItem("cline.gateway.clientId", client.hello.clientId);
			setGatewayName(client.hello.gatewayId);
			client.onEvent((incoming) => {
				setEvents((current) => mergeEvent(current, incoming));
				if (incoming.event === "session.created") void refresh(client);
			});
			client.onServerRequest((request) =>
				setApprovals((current) =>
					current.some((item) => item.id === request.id)
						? current
						: [...current, request],
				),
			);
			client.onClose(() => {
				if (clientRef.current === client) {
					clientRef.current = undefined;
					setStatus("disconnected");
					setError("");
				}
			});
			await client.request("run.subscribe", { cursor: initialEventCursor() });
			setConnectionStage("syncing");
			await refresh(client);
			setStatus("connected");
			setHasConnected(true);
			setConnectionStage("idle");
		} catch (cause) {
			setStatus("disconnected");
			setConnectionStage("idle");
			setError(messageOf(cause));
		}
	}

	async function refresh(client = clientRef.current) {
		if (!client) return;
		const [botResult, sessionResult] = await Promise.all([
			client.request("bot.list") as Promise<{ bots: BotRecord[] }>,
			client.request("session.list") as Promise<{ sessions: SessionRecord[] }>,
		]);
		setBots(botResult.bots);
		setSessions(sessionResult.sessions);
		setSelectedBotId(
			(current) => current || botResult.bots[0]?.identity.botId || "",
		);
	}

	useEffect(() => {
		if (!selectedBotId) return;
		const choices = sessions.filter(
			(session) => session.botId === selectedBotId,
		);
		setSelectedSessionId((current) =>
			choices.some((session) => session.sessionId === current)
				? current
				: (choices.at(-1)?.sessionId ?? ""),
		);
	}, [selectedBotId, sessions]);

	useEffect(() => {
		if (!selectedBotId) {
			setModelId("");
			return;
		}
		const savedModel = localStorage.getItem(modelStorageKey(selectedBotId));
		setModelId(savedModel?.trim() || DEFAULT_MODEL_ID);
	}, [selectedBotId, selectedBot?.config.modelId]);

	async function submit(event: FormEvent) {
		event.preventDefault();
		const client = clientRef.current;
		const text = prompt.trim();
		const attributedText = withGatewayUserContext(text, userDisplayName);
		const selectedModelId = modelId.trim();
		if (!client || !text || !selectedBotId) return;
		if (!steerMode && !selectedModelId) {
			setError("Enter a model ID before starting a run");
			return;
		}
		setSending(true);
		setError("");
		try {
			if (steerMode && activeRun) {
				await client.mutate("run.steer", {
					runId: activeRun.runId,
					text: attributedText,
				});
				if (userDisplayName) {
					console.info("[Cline Gateway] run steered", {
						runId: activeRun.runId,
						submittedBy: userDisplayName,
					});
				}
			} else {
				const accepted = (await client.mutate("run.start", {
					botId: selectedBotId,
					prompt: attributedText,
					overrides: {
						providerId: RUN_PROVIDER_ID,
						modelId: selectedModelId,
					},
				})) as { runId: string };
				if (userDisplayName) {
					console.info("[Cline Gateway] run submitted", {
						runId: accepted.runId,
						submittedBy: userDisplayName,
					});
				}
				await client.request("run.subscribe", { runId: accepted.runId });
			}
			setPrompt("");
			localStorage.removeItem(PROMPT_DRAFT_KEY);
			setSteerMode(false);
			window.setTimeout(() => void refresh(client), 150);
		} catch (cause) {
			setError(messageOf(cause));
		} finally {
			setSending(false);
		}
	}

	async function control(method: "run.interrupt" | "run.abort") {
		if (!clientRef.current || !activeRun) return;
		try {
			await clientRef.current.mutate(method, {
				runId: activeRun.runId,
				reason: `Requested from gateway web`,
			});
		} catch (cause) {
			setError(messageOf(cause));
		}
	}

	function answer(request: Approval, approved: boolean) {
		clientRef.current?.respond(request.id, {
			approved,
			reason: approved
				? "Approved from Gateway web"
				: "Denied from Gateway web",
		});
		setApprovals((current) =>
			current.map((item) =>
				item.id === request.id
					? { ...item, answered: approved ? "approved" : "denied" }
					: item,
			),
		);
	}

	if (!hasConnected) {
		return (
			<main className="connect-shell">
				<div className="connect-aurora" aria-hidden="true" />
				<div className="connect-grain" aria-hidden="true" />
				<section className="connect-card" aria-busy={status === "connecting"}>
					<div className="connect-copy">
						<h1>Cline Gateway</h1>
						<p className="lede">Connect you to your Cline Bots anywhere</p>
					</div>
					<form onSubmit={connect} className="connect-form">
						<label>
							Gateway address
							<input
								value={url}
								onChange={(e) => setUrl(e.target.value)}
								placeholder="wss://gateway.example.com"
								required
							/>
						</label>
						<label>
							<span className="field-title">
								Remote access token <span className="optional">Optional</span>
							</span>
							<input
								value={token}
								onChange={(e) => setToken(e.target.value)}
								type="password"
								autoComplete="off"
								placeholder={
									configuredToken
										? "Using VITE_CLINE_GATEWAY_TOKEN"
										: "Paste token or configure environment"
								}
							/>
						</label>
						<label className="check">
							<input
								type="checkbox"
								checked={allowInsecure}
								onChange={(e) => setAllowInsecure(e.target.checked)}
							/>{" "}
							Allow insecure ws:// outside loopback (development only)
						</label>
						{error && <div className="error">{error}</div>}
						{status === "connecting" && (
							<div className="connection-progress" aria-live="polite">
								<div className="connection-route" aria-hidden="true">
									<span className="route-line" />
									{connectionStages.map((stage, index) => {
										const activeIndex = connectionStages.findIndex(
											(item) => item.id === connectionStage,
										);
										return (
											<i
												key={stage.id}
												className={index <= activeIndex ? "active" : ""}
											/>
										);
									})}
									<span className="route-packet" />
								</div>
								<div>
									<strong>
										{connectionStages.find(
											(stage) => stage.id === connectionStage,
										)?.label ?? "Preparing connection"}
									</strong>
									<span>Establishing an encrypted path to your Gateway</span>
								</div>
							</div>
						)}
						<button
							type="submit"
							className="primary"
							disabled={status === "connecting"}
						>
							<span className="button-glyph" aria-hidden="true">
								<i />
							</span>
							{status === "connecting"
								? "Connecting to Gateway"
								: "Connect to Gateway"}
							<span className="button-arrow" aria-hidden="true">
								→
							</span>
						</button>
					</form>
					<footer className="connect-footer">
						<span>REMOTE PROTOCOL / 01</span>
						<span>DIRECT · PRIVATE · DURABLE</span>
					</footer>
				</section>
			</main>
		);
	}

	return (
		<div
			className={`app-shell ${status}${sidebarCollapsed ? " sidebar-collapsed" : ""}`}
		>
			<aside className="sidebar">
				<header>
					<img src="/favicon.png" alt="" />
					<strong>Gateway</strong>
					<button
						type="button"
						className="sidebar-toggle"
						onClick={() => setSidebarCollapsed((current) => !current)}
						aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
						title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
					>
						{sidebarCollapsed ? "›" : "‹"}
					</button>
				</header>
				<div className={`gateway-pill ${status}`}>
					<i />
					<span className="status-label">
						{status === "connected"
							? "Connected"
							: status === "connecting"
								? "Connecting"
								: "Disconnected"}
					</span>
					{status === "connected" ? (
						<span className="gateway-id">{shortId(gatewayName)}</span>
					) : (
						<button
							type="button"
							onClick={() => void connect()}
							disabled={status === "connecting"}
						>
							{status === "connecting" ? "Connecting…" : "Reconnect"}
						</button>
					)}
				</div>
				<div className="section-label">
					Bots{" "}
					<button type="button" onClick={() => void refresh()}>
						↻
					</button>
				</div>
				<nav className="bot-list">
					{bots.map((bot) => (
						<button
							type="button"
							key={bot.identity.botId}
							className={selectedBotId === bot.identity.botId ? "selected" : ""}
							onClick={() => setSelectedBotId(bot.identity.botId)}
						>
							<strong>{bot.identity.name}</strong>
							<i />
						</button>
					))}
				</nav>
				<div className="section-label">Sessions</div>
				<nav className="session-list">
					{visibleSessions.length === 0 && (
						<p>No session yet. Send a message to create one.</p>
					)}
					{visibleSessions.map((session) => (
						<button
							type="button"
							key={session.sessionId}
							className={
								selectedSessionId === session.sessionId ? "selected" : ""
							}
							onClick={() => setSelectedSessionId(session.sessionId)}
						>
							<time dateTime={new Date(session.createdAt).toISOString()}>
								{new Date(session.createdAt).toLocaleString([], {
									dateStyle: "medium",
									timeStyle: "short",
								})}
							</time>
						</button>
					))}
				</nav>
				<button
					type="button"
					className="disconnect"
					onClick={() => {
						clientRef.current?.close();
						clientRef.current = undefined;
						setStatus("disconnected");
						setError("");
					}}
				>
					Disconnect
				</button>
			</aside>

			<main className="conversation">
				<header className="conversation-header">
					<div className="conversation-identity">
						<label className="model-selector">
							<span>{RUN_PROVIDER_ID} /</span>
							<input
								aria-label="Model ID"
								value={modelId}
								onChange={(event) => {
									const value = event.target.value;
									setModelId(value);
									if (selectedBotId)
										localStorage.setItem(modelStorageKey(selectedBotId), value);
								}}
								placeholder="Enter model ID"
								autoComplete="off"
							/>
						</label>
					</div>
					<div className="run-actions">
						{activeRun && (
							<>
								<span className="running-dot">Running</span>
								<button type="button" onClick={() => setSteerMode(true)}>
									Steer
								</button>
								<button
									type="button"
									onClick={() => void control("run.interrupt")}
								>
									Interrupt
								</button>
								<button
									type="button"
									className="danger"
									onClick={() => void control("run.abort")}
								>
									Abort
								</button>
							</>
						)}
					</div>
				</header>
				<div className="timeline">
					{visibleEvents.length === 0 ? (
						<div className="empty">
							<h3>Start a conversation</h3>
							<p>Send a message to begin.</p>
						</div>
					) : (
						<EventTimeline events={visibleEvents} />
					)}
				</div>
				{approvals
					.filter((item) => !item.answered)
					.map((request) => (
						<div className="approval" key={request.id}>
							<div>
								<strong>Approval requested</strong>
								<span>
									{String(request.params?.toolName ?? request.method)}
								</span>
								<code>{JSON.stringify(request.params, null, 2)}</code>
							</div>
							<button type="button" onClick={() => answer(request, false)}>
								Deny
							</button>
							<button
								type="button"
								className="primary"
								onClick={() => answer(request, true)}
							>
								Approve
							</button>
						</div>
					))}
				<form
					className={`composer ${steerMode ? "steering" : ""}`}
					onSubmit={submit}
				>
					<div className="composer-label">
						{steerMode ? (
							<>
								Steering active run{" "}
								<button type="button" onClick={() => setSteerMode(false)}>
									Cancel
								</button>
							</>
						) : activeRun ? (
							"Message will queue after the active run"
						) : (
							"New turn"
						)}
					</div>
					<textarea
						value={prompt}
						onChange={(e) => {
							const value = e.target.value;
							setPrompt(value);
							localStorage.setItem(PROMPT_DRAFT_KEY, value);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
						placeholder={
							status !== "connected"
								? "Reconnect to continue…"
								: steerMode
									? "Add direction to the current run…"
									: "Ask Cline to do something…"
						}
						rows={3}
					/>
					<button
						type="submit"
						className="send"
						disabled={
							status !== "connected" ||
							sending ||
							!prompt.trim() ||
							(!steerMode && !modelId.trim())
						}
					>
						{sending ? "…" : "↑"}
					</button>
				</form>
				{error && (
					<div className="toast error">
						{error}
						<button type="button" onClick={() => setError("")}>
							×
						</button>
					</div>
				)}
			</main>
		</div>
	);
}

function EventTimeline({ events }: { events: GatewayEvent[] }) {
	const items = projectTimeline(events);
	return (
		<>
			{items.map((item) => {
				if (item.kind === "message")
					return (
						<article className={`message ${item.role}`} key={item.key}>
							<div className="message-role">{item.role}</div>
							<div>{item.text}</div>
						</article>
					);
				if (item.kind === "stream")
					return (
						<article className="message assistant delta" key={item.key}>
							<div className="message-role">assistant</div>
							<div>{item.text}</div>
						</article>
					);
				if (item.kind === "tool")
					return (
						<details className="event-card" key={item.key}>
							<summary>{item.label}</summary>
							<pre>{JSON.stringify(item.payload, null, 2)}</pre>
						</details>
					);
				if (item.kind === "failure")
					return (
						<details className="failure-card" key={item.key}>
							<summary>Run failed</summary>
							<p>{item.message}</p>
						</details>
					);
			})}
		</>
	);
}

type TimelineItem =
	| { kind: "message"; key: string; role: string; text: string }
	| { kind: "stream"; key: string; runId: string; text: string }
	| { kind: "tool"; key: string; label: string; payload: unknown }
	| { kind: "failure"; key: string; message: string };

function projectTimeline(events: GatewayEvent[]): TimelineItem[] {
	const items: TimelineItem[] = [];
	for (const event of events) {
		const key = String(event.sequence);
		const runId = event.scope.runId ?? "";
		const message = event.payload?.message as
			| { role?: string; content?: unknown }
			| undefined;
		if (event.event === "run.messageAppended" && message) {
			const role = message.role ?? "assistant";
			if (role === "assistant") {
				const trailing = items.at(-1);
				if (trailing?.kind === "stream" && trailing.runId === runId)
					items.pop();
			}
			items.push({
				kind: "message",
				key,
				role,
				text: messageText(message.content),
			});
			continue;
		}
		if (event.event === "engine.textDelta") {
			const text = String(event.payload?.text ?? "");
			const trailing = items.at(-1);
			if (trailing?.kind === "stream" && trailing.runId === runId)
				trailing.text += text;
			else items.push({ kind: "stream", key, runId, text });
			continue;
		}
		if (event.event.startsWith("engine.tool") || event.event.includes("Tool")) {
			items.push({
				kind: "tool",
				key,
				label: event.event.replace(/^engine\./, ""),
				payload: event.payload,
			});
			continue;
		}
		if (event.event === "run.failed") {
			const error = event.payload?.error as { message?: string } | undefined;
			items.push({
				kind: "failure",
				key,
				message: error?.message ?? "The run did not complete.",
			});
		}
	}
	return items;
}

function messageText(content: unknown): string {
	if (typeof content === "string") return withoutGatewayUserContext(content);
	if (Array.isArray(content))
		return withoutGatewayUserContext(
			content
			.map((part) =>
				typeof part === "string"
					? part
					: typeof part === "object" && part && "text" in part
						? String(part.text)
						: "",
			)
			.join("\n"),
		);
	return content ? JSON.stringify(content, null, 2) : "";
}

function withGatewayUserContext(text: string, userDisplayName?: string): string {
	const submittedBy = userDisplayName?.trim();
	if (!submittedBy) return text;
	return `<gateway_context>${JSON.stringify({ submittedBy })}</gateway_context>\n\n${text}`;
}

function withoutGatewayUserContext(text: string): string {
	return text.replace(/^<gateway_context>[^\n]*<\/gateway_context>\s*/u, "");
}

function projectRunStates(events: GatewayEvent[]) {
	const runs = new Map<string, { runId: string; state: string }>();
	const lifecycleStates: Record<string, string> = {
		"run.queued": "queued",
		"run.started": "running",
		"run.completed": "completed",
		"run.failed": "failed",
		"run.aborted": "aborted",
		"run.interrupted": "interrupted",
	};
	for (const event of events) {
		const state = lifecycleStates[event.event];
		if (event.scope.runId && state) {
			runs.set(event.scope.runId, {
				runId: event.scope.runId,
				state,
			});
		}
	}
	return runs;
}

function mergeEvent(current: GatewayEvent[], incoming: GatewayEvent) {
	if (current.some((event) => event.sequence === incoming.sequence))
		return current;
	return [...current, incoming].sort((a, b) => a.sequence - b.sequence);
}

function shortId(value: string) {
	return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}
function modelStorageKey(botId: string) {
	return `cline.gateway.bot.${botId}.modelId`;
}
function messageOf(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause);
}
