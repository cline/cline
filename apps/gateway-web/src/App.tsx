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

const connectionStages: Array<{
	id: Exclude<ConnectionStage, "idle">;
	label: string;
}> = [
	{ id: "opening", label: "Opening channel" },
	{ id: "authenticated", label: "Identity verified" },
	{ id: "syncing", label: "Loading bots" },
];

const savedUrl =
	localStorage.getItem("cline.gateway.url") ?? "ws://127.0.0.1:8080";
export function App() {
	const clientRef = useRef<BrowserGatewayClient | undefined>(undefined);
	const [url, setUrl] = useState(savedUrl);
	const [token, setToken] = useState("");
	const [allowInsecure, setAllowInsecure] = useState(false);
	const [status, setStatus] = useState<
		"disconnected" | "connecting" | "connected"
	>("disconnected");
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
	const [prompt, setPrompt] = useState("");
	const [sending, setSending] = useState(false);
	const [steerMode, setSteerMode] = useState(false);

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

	async function connect(event: FormEvent) {
		event.preventDefault();
		setStatus("connecting");
		setConnectionStage("opening");
		setError("");
		clientRef.current?.close();
		try {
			const client = await BrowserGatewayClient.connect({
				url,
				auth: token,
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
			client.onClose((reason) => {
				if (clientRef.current === client) {
					setStatus("disconnected");
					setError(reason);
				}
			});
			await client.request("run.subscribe", { cursor: initialEventCursor() });
			setConnectionStage("syncing");
			await refresh(client);
			setStatus("connected");
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

	async function submit(event: FormEvent) {
		event.preventDefault();
		const client = clientRef.current;
		const text = prompt.trim();
		if (!client || !text || !selectedBotId) return;
		setSending(true);
		setError("");
		try {
			if (steerMode && activeRun) {
				await client.mutate("run.steer", { runId: activeRun.runId, text });
			} else {
				const accepted = (await client.mutate("run.start", {
					botId: selectedBotId,
					prompt: text,
				})) as { runId: string };
				await client.request("run.subscribe", { runId: accepted.runId });
			}
			setPrompt("");
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

	if (status !== "connected") {
		return (
			<main className="connect-shell">
				<div className="connect-aurora" aria-hidden="true" />
				<div className="connect-grain" aria-hidden="true" />
				<section className="connect-card" aria-busy={status === "connecting"}>
					<header className="connect-brand">
						<span className="brand-signal" aria-hidden="true">
							<i />
						</span>
						CLINE GATEWAY
					</header>
					<div className="connect-copy">
						<h1>
							Talk to your bots
							<br />
							from anywhere.
						</h1>
						<p className="lede">
							Connect directly. Your access token is never stored.
						</p>
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
							Remote access token
							<input
								value={token}
								onChange={(e) => setToken(e.target.value)}
								type="password"
								autoComplete="off"
								placeholder="Paste token"
								required
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
		<div className="app-shell">
			<aside className="sidebar">
				<header>
					<div className="brand-mark small">C</div>
					<div>
						<strong>Cline</strong>
						<span>Remote Gateway</span>
					</div>
				</header>
				<div className="gateway-pill">
					<i /> Connected <span>{shortId(gatewayName)}</span>
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
							<span className={`avatar ${bot.identity.role}`}>
								{bot.identity.name.slice(0, 1).toUpperCase()}
							</span>
							<span>
								<strong>{bot.identity.name}</strong>
								<small>
									{bot.identity.role} · {bot.config.modelId ?? "default model"}
								</small>
							</span>
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
							<strong>{shortId(session.sessionId)}</strong>
							<small>{new Date(session.createdAt).toLocaleString()}</small>
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
					<div>
						<h2>{selectedBot?.identity.name ?? "Select a bot"}</h2>
						<p>
							{selectedBot?.config.providerId ?? "default provider"} /{" "}
							{selectedBot?.config.modelId ?? "default model"}
						</p>
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
							<div className="orb">C</div>
							<h3>Start a conversation</h3>
							<p>This bot’s work will stream here as durable Gateway events.</p>
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
						onChange={(e) => setPrompt(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && !e.shiftKey) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
						placeholder={
							steerMode
								? "Add direction to the current run…"
								: "Ask Cline to do something…"
						}
						rows={3}
					/>
					<button
						type="submit"
						className="send"
						disabled={sending || !prompt.trim()}
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
	return (
		<>
			{events.map((event) => {
				const message = event.payload?.message as
					| { role?: string; content?: unknown }
					| undefined;
				if (event.event === "run.messageAppended" && message)
					return (
						<article
							className={`message ${message.role ?? "assistant"}`}
							key={event.sequence}
						>
							<div className="message-role">{message.role ?? "assistant"}</div>
							<div>{messageText(message.content)}</div>
						</article>
					);
				if (event.event === "engine.textDelta")
					return (
						<article className="message assistant delta" key={event.sequence}>
							<div className="message-role">assistant</div>
							<div>{String(event.payload?.text ?? "")}</div>
						</article>
					);
				if (
					event.event.startsWith("engine.tool") ||
					event.event.includes("Tool")
				)
					return (
						<details className="event-card" key={event.sequence}>
							<summary>{event.event}</summary>
							<pre>{JSON.stringify(event.payload, null, 2)}</pre>
						</details>
					);
				if (event.event.startsWith("run."))
					return (
						<div className={`run-event ${event.event}`} key={event.sequence}>
							<span>{event.event.replace("run.", "")}</span>
							<code>{shortId(event.scope.runId ?? "")}</code>
							{event.payload?.outputText ? (
								<p>{String(event.payload.outputText)}</p>
							) : null}
						</div>
					);
				return null;
			})}
		</>
	);
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content
			.map((part) =>
				typeof part === "string"
					? part
					: typeof part === "object" && part && "text" in part
						? String(part.text)
						: "",
			)
			.join("\n");
	return content ? JSON.stringify(content, null, 2) : "";
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
function messageOf(cause: unknown) {
	return cause instanceof Error ? cause.message : String(cause);
}
