"use client";

import {
	ChevronRight,
	Github,
	Minus,
	Pencil,
	Plus,
	RefreshCw,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { desktopClient } from "@/lib/desktop-client";
import {
	GITHUB_MCP_MARKETPLACE_ENTRY_KEY,
	GITHUB_MCP_SERVER_NAME,
	GITHUB_MCP_SERVER_URL,
	isOfficialGitHubMcpUrl,
} from "@/lib/github-mcp";
import { cn } from "@/lib/utils";
import {
	MarketplaceEntrySetupDetails,
	type MarketplaceLocalInstalledItem,
	type MarketplaceLocalInstalledItemRenderContext,
	MarketplaceView,
} from "../marketplace-view";
import { PageFrame, PageHeader } from "../page-layout";

type McpTransportType = "stdio" | "sse" | "streamableHttp";

type McpServerType = "local" | "remote";

function serverTypeOf(transportType: McpTransportType): McpServerType {
	return transportType === "stdio" ? "local" : "remote";
}

const TRANSPORT_TYPE_LABELS: Record<McpTransportType, string> = {
	stdio: "Local · stdio",
	sse: "Remote · SSE (legacy)",
	streamableHttp: "Remote · Streamable HTTP",
};

const EXCLUDED_MARKETPLACE_ENTRY_KEYS = [
	GITHUB_MCP_MARKETPLACE_ENTRY_KEY,
] as const;

interface McpServer {
	name: string;
	transportType: McpTransportType;
	disabled: boolean;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	metadata?: unknown;
	configurationError?: string;
	oauthStatus?: {
		supported: boolean;
		configured: boolean;
		authorizationRequired: boolean;
		lastError?: string;
		lastAuthenticatedAt?: number;
	};
}

function isOfficialGitHubMcpServer(
	server: Pick<McpServer, "transportType" | "url">,
): boolean {
	return (
		server.transportType === "streamableHttp" &&
		isOfficialGitHubMcpUrl(server.url)
	);
}

interface McpServersResponse {
	settingsPath: string;
	hasSettingsFile: boolean;
	servers: McpServer[];
}

interface McpServerUpsertInput {
	name: string;
	previousName?: string;
	transportType: McpTransportType;
	command?: string;
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	url?: string;
	headers?: Record<string, string>;
	disabled?: boolean;
	metadata?: unknown;
}

type McpServerFormState = {
	name: string;
	previousName: string;
	transportType: McpTransportType;
	command: string;
	argsText: string;
	cwd: string;
	envEntries: Array<{ id: string; key: string; value: string }>;
	url: string;
	headersText: string;
	disabled: boolean;
	metadataText: string;
};

function splitCsv(text: string): string[] {
	return text
		.split(",")
		.map((value) => value.trim())
		.filter((value) => value.length > 0);
}

function parseKeyValuePairs(text: string): Record<string, string> | undefined {
	const pairs = splitCsv(text);
	if (pairs.length === 0) {
		return undefined;
	}
	const out: Record<string, string> = {};
	for (const pair of pairs) {
		const idx = pair.indexOf("=");
		if (idx <= 0) {
			continue;
		}
		const key = pair.slice(0, idx).trim();
		const value = pair.slice(idx + 1).trim();
		if (!key) {
			continue;
		}
		out[key] = value;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

function stringifyKeyValuePairs(input?: Record<string, string>): string {
	if (!input) {
		return "";
	}
	return Object.entries(input)
		.map(([key, value]) => `${key}=${value}`)
		.join(", ");
}

function stringifyRedactedKeyValuePairs(
	input?: Record<string, string>,
): string {
	if (!input) {
		return "";
	}
	return Object.keys(input)
		.map((key) => `${key}=[REDACTED]`)
		.join(", ");
}

function createEnvEntries(
	input?: Record<string, string>,
): Array<{ id: string; key: string; value: string }> {
	if (!input || Object.keys(input).length === 0) {
		return [{ id: crypto.randomUUID(), key: "", value: "" }];
	}
	return Object.entries(input).map(([key, value]) => ({
		id: crypto.randomUUID(),
		key,
		value,
	}));
}

function createServerFormState(existing?: McpServer): McpServerFormState {
	return {
		name: existing?.name ?? "",
		previousName: existing?.name ?? "",
		transportType: existing?.transportType ?? "stdio",
		command: existing?.command ?? "",
		argsText: existing?.args?.join(", ") ?? "",
		cwd: existing?.cwd ?? "",
		envEntries: createEnvEntries(existing?.env),
		url: existing?.url ?? "",
		headersText: stringifyKeyValuePairs(existing?.headers),
		disabled: existing?.disabled ?? false,
		metadataText:
			existing?.metadata === undefined
				? ""
				: JSON.stringify(existing.metadata, null, 2),
	};
}

export function McpServersContent() {
	const [servers, setServers] = useState<McpServer[]>([]);
	const [settingsPath, setSettingsPath] = useState("");
	const [hasSettingsFile, setHasSettingsFile] = useState(false);
	const [isLoading, setIsLoading] = useState(true);
	const [settingsPathCopied, setSettingsPathCopied] = useState(false);
	const settingsPathCopyTimeoutRef = useRef<number | undefined>(undefined);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [serverActionErrors, setServerActionErrors] = useState<
		Record<string, string>
	>({});
	const [busyServerName, setBusyServerName] = useState<string | null>(null);
	const [authorizingServerName, setAuthorizingServerName] = useState<
		string | null
	>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
	const [formState, setFormState] = useState<McpServerFormState>(() =>
		createServerFormState(),
	);
	const [advancedOpen, setAdvancedOpen] = useState(false);
	const [formErrorMessage, setFormErrorMessage] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null);

	const applyResponse = useCallback((response: McpServersResponse) => {
		setServers(response.servers);
		setSettingsPath(response.settingsPath);
		setHasSettingsFile(response.hasSettingsFile);
	}, []);

	const setServerActionError = useCallback(
		(serverName: string, message?: string) => {
			setServerActionErrors((current) => {
				if (message) {
					return { ...current, [serverName]: message };
				}
				if (!(serverName in current)) {
					return current;
				}
				const next = { ...current };
				delete next[serverName];
				return next;
			});
		},
		[],
	);

	const refreshServers = useCallback(async () => {
		setIsLoading(true);
		setErrorMessage(null);
		try {
			const response =
				await desktopClient.invoke<McpServersResponse>("list_mcp_servers");
			applyResponse(response);
			setServerActionErrors({});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	}, [applyResponse]);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void refreshServers();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [refreshServers]);

	useEffect(
		() => () => {
			if (settingsPathCopyTimeoutRef.current !== undefined) {
				window.clearTimeout(settingsPathCopyTimeoutRef.current);
			}
		},
		[],
	);

	const toggleServer = async (server: McpServer, disabled: boolean) => {
		setBusyServerName(server.name);
		setErrorMessage(null);
		setServerActionError(server.name);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"set_mcp_server_disabled",
				{
					name: server.name,
					disabled,
				},
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setServerActionError(server.name, message);
		} finally {
			setBusyServerName(null);
		}
	};

	const upsertServer = async (input: McpServerUpsertInput) => {
		setBusyServerName(input.previousName ?? input.name);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"upsert_mcp_server",
				{
					input,
				},
			);
			applyResponse(response);
		} finally {
			setBusyServerName(null);
		}
	};

	const deleteServer = async (serverName: string) => {
		setBusyServerName(serverName);
		setErrorMessage(null);
		setServerActionError(serverName);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"delete_mcp_server",
				{
					name: serverName,
				},
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setServerActionError(serverName, message);
		} finally {
			setBusyServerName(null);
		}
	};

	const authorizeOAuth = async (serverName: string) => {
		setAuthorizingServerName(serverName);
		setErrorMessage(null);
		setServerActionError(serverName);
		setServers((current) =>
			current.map((server) =>
				server.name === serverName
					? {
							...server,
							disabled: true,
							oauthStatus: {
								supported: server.oauthStatus?.supported ?? true,
								configured: server.oauthStatus?.configured ?? false,
								authorizationRequired: true,
								lastError: server.oauthStatus?.lastError,
								lastAuthenticatedAt: server.oauthStatus?.lastAuthenticatedAt,
							},
						}
					: server,
			),
		);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"authorize_mcp_server_oauth",
				{ name: serverName },
				{ timeoutMs: null },
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			await refreshServers();
			setServerActionError(serverName, message);
		} finally {
			setAuthorizingServerName(null);
		}
	};

	const installGitHubMcp = async () => {
		setServerActionError(GITHUB_MCP_SERVER_NAME);
		try {
			await upsertServer({
				name: GITHUB_MCP_SERVER_NAME,
				transportType: "streamableHttp",
				url: GITHUB_MCP_SERVER_URL,
				disabled: true,
			});
			await authorizeOAuth(GITHUB_MCP_SERVER_NAME);
		} catch (error) {
			setServerActionError(
				GITHUB_MCP_SERVER_NAME,
				error instanceof Error ? error.message : String(error),
			);
		}
	};

	const cancelOAuth = async (serverName: string) => {
		setErrorMessage(null);
		setServerActionError(serverName);
		try {
			const response = await desktopClient.invoke<McpServersResponse>(
				"cancel_mcp_server_oauth",
				{ name: serverName },
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setServerActionError(serverName, message);
		} finally {
			setAuthorizingServerName(null);
		}
	};

	const buildServerInput = useCallback((form: McpServerFormState) => {
		const name = form.name.trim();
		if (!name) {
			throw new Error("Server name is required.");
		}
		const env = form.envEntries.reduce<Record<string, string>>((acc, entry) => {
			const key = entry.key.trim();
			if (!key) {
				return acc;
			}
			acc[key] = entry.value;
			return acc;
		}, {});
		const metadataText = form.metadataText.trim();
		const metadata =
			metadataText.length > 0 ? JSON.parse(metadataText) : undefined;
		if (form.transportType === "stdio") {
			const command = form.command.trim();
			if (!command) {
				throw new Error("Command is required for local servers.");
			}
			const args = splitCsv(form.argsText);
			return {
				name,
				previousName: form.previousName.trim() || undefined,
				transportType: form.transportType,
				command,
				args: args.length > 0 ? args : undefined,
				cwd: form.cwd.trim() || undefined,
				env: Object.keys(env).length > 0 ? env : undefined,
				disabled: form.disabled,
				metadata,
			} satisfies McpServerUpsertInput;
		}
		const url = form.url.trim();
		if (!url) {
			throw new Error("Server URL is required for remote servers.");
		}
		return {
			name,
			previousName: form.previousName.trim() || undefined,
			transportType: form.transportType,
			url,
			headers: parseKeyValuePairs(form.headersText),
			disabled: form.disabled,
			metadata,
		} satisfies McpServerUpsertInput;
	}, []);

	const openCreateDialog = () => {
		setEditorMode("create");
		setFormState(createServerFormState());
		setAdvancedOpen(false);
		setFormErrorMessage(null);
		setEditorOpen(true);
	};

	const openEditDialog = (server: McpServer) => {
		setEditorMode("edit");
		setFormState(createServerFormState(server));
		setAdvancedOpen(
			Boolean(server.cwd?.trim()) || server.metadata !== undefined,
		);
		setFormErrorMessage(null);
		setEditorOpen(true);
	};

	const handleSaveServer = async () => {
		setFormErrorMessage(null);
		try {
			const input = buildServerInput(formState);
			await upsertServer(input);
			setEditorOpen(false);
		} catch (error) {
			setFormErrorMessage(
				error instanceof Error ? error.message : String(error),
			);
		}
	};

	const copySettingsPath = async () => {
		const path = settingsPath.trim();
		if (!path) {
			return;
		}
		setErrorMessage(null);
		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error("Clipboard access is unavailable.");
			}
			await navigator.clipboard.writeText(path);
			setSettingsPathCopied(true);
			if (settingsPathCopyTimeoutRef.current !== undefined) {
				window.clearTimeout(settingsPathCopyTimeoutRef.current);
			}
			settingsPathCopyTimeoutRef.current = window.setTimeout(() => {
				setSettingsPathCopied(false);
				settingsPathCopyTimeoutRef.current = undefined;
			}, 1600);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		}
	};

	const sortedServers = useMemo(
		() =>
			[...servers].sort((a, b) =>
				a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
			),
		[servers],
	);
	const officialGitHubServer = useMemo(
		() =>
			sortedServers.find(
				(server) =>
					server.name === GITHUB_MCP_SERVER_NAME &&
					isOfficialGitHubMcpServer(server),
			) ?? sortedServers.find(isOfficialGitHubMcpServer),
		[sortedServers],
	);
	const githubNameCollision = useMemo(
		() =>
			sortedServers.find(
				(server) =>
					server.name.toLowerCase() === GITHUB_MCP_SERVER_NAME &&
					!isOfficialGitHubMcpServer(server),
			),
		[sortedServers],
	);

	const updateEnvEntry = (
		id: string,
		field: "key" | "value",
		value: string,
	) => {
		setFormState((current) => ({
			...current,
			envEntries: current.envEntries.map((entry) =>
				entry.id === id ? { ...entry, [field]: value } : entry,
			),
		}));
	};

	const addEnvEntry = () => {
		setFormState((current) => ({
			...current,
			envEntries: [
				...current.envEntries,
				{ id: crypto.randomUUID(), key: "", value: "" },
			],
		}));
	};

	const removeEnvEntry = (id: string) => {
		setFormState((current) => ({
			...current,
			envEntries:
				current.envEntries.length === 1
					? [{ id: crypto.randomUUID(), key: "", value: "" }]
					: current.envEntries.filter((entry) => entry.id !== id),
		}));
	};

	const renderServerToggle = (
		server: McpServer,
		options?: { disabled?: boolean },
	) => {
		const isBusy = busyServerName === server.name;
		return (
			<Switch
				checked={!server.disabled}
				onCheckedChange={(enabled) => toggleServer(server, !enabled)}
				disabled={isBusy || options?.disabled}
				aria-label={`Enable ${server.name}`}
			/>
		);
	};

	const renderServerManagementActions = (server: McpServer) => {
		const isBusy = busyServerName === server.name;
		const isAuthorizing = authorizingServerName === server.name;
		return (
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Edit ${server.name}`}
					onClick={() => openEditDialog(server)}
					disabled={isBusy || isAuthorizing}
				>
					<Pencil className="h-3.5 w-3.5" />
				</Button>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Delete ${server.name}`}
					onClick={() => setDeleteTarget(server)}
					disabled={isBusy || isAuthorizing}
				>
					<Trash2 className="h-3.5 w-3.5" />
				</Button>
			</div>
		);
	};

	const renderServerDetails = (server: McpServer) => (
		<div className="flex flex-col gap-1 text-xs text-muted-foreground">
			{server.command && (
				<p>
					<span className="text-muted-foreground/70">Command:</span>{" "}
					{server.command}
				</p>
			)}
			{server.args && server.args.length > 0 && (
				<p>
					<span className="text-muted-foreground/70">Args:</span>{" "}
					{server.args.join(", ")}
				</p>
			)}
			{server.cwd && (
				<p>
					<span className="text-muted-foreground/70">CWD:</span> {server.cwd}
				</p>
			)}
			{server.url && (
				<p>
					<span className="text-muted-foreground/70">URL:</span> {server.url}
				</p>
			)}
			{server.env && Object.keys(server.env).length > 0 && (
				<p>
					<span className="text-muted-foreground/70">Env:</span>{" "}
					{stringifyRedactedKeyValuePairs(server.env)}
				</p>
			)}
			{server.headers && Object.keys(server.headers).length > 0 && (
				<p>
					<span className="text-muted-foreground/70">Headers:</span>{" "}
					{stringifyKeyValuePairs(server.headers)}
				</p>
			)}
		</div>
	);

	const renderServerCard = (
		server: McpServer,
		context?: MarketplaceLocalInstalledItemRenderContext,
	) => {
		const isBusy = busyServerName === server.name;
		const isAuthorizing = authorizingServerName === server.name;
		const isOfficialGitHub = isOfficialGitHubMcpServer(server);
		const hasStaticAuthorizationHeader = Object.keys(server.headers ?? {}).some(
			(name) => name.toLowerCase() === "authorization",
		);
		const authorizationRequired =
			server.oauthStatus?.authorizationRequired === true ||
			(isOfficialGitHub &&
				!hasStaticAuthorizationHeader &&
				server.oauthStatus?.configured !== true);
		const serverError =
			serverActionErrors[server.name] ??
			(authorizationRequired || !server.disabled
				? server.oauthStatus?.lastError
				: undefined);
		const oauthStatusMessage = isAuthorizing
			? "Complete sign-in in your browser, or select Cancel to stop waiting."
			: (serverError ??
				"Sign in with OAuth to enable this MCP server. The server remains off until authorization succeeds.");

		return (
			<div
				key={server.name}
				className="group relative rounded-lg border border-border px-5 py-4 transition-colors hover:bg-accent/20"
			>
				<div
					className="flex items-center gap-3"
					data-mcp-server-header={server.name}
				>
					{renderServerToggle(server, {
						disabled: isAuthorizing || authorizationRequired,
					})}
					<h3 className="text-sm font-semibold text-foreground">
						{isOfficialGitHub ? "GitHub" : server.name}
					</h3>
					{isOfficialGitHub ? (
						<span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
							Recommended
						</span>
					) : null}
					<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
						{TRANSPORT_TYPE_LABELS[server.transportType] ??
							server.transportType}
					</span>
					{context?.matchedEntries?.length ? (
						<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
							Marketplace
						</span>
					) : null}
					{server.oauthStatus?.configured ? (
						<span
							className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"
							data-oauth-status="connected"
						>
							OAuth connected
						</span>
					) : null}
					{isAuthorizing || authorizationRequired ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									className={cn(
										"cursor-help rounded-md border px-2 py-0.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
										isAuthorizing
											? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
											: "border-destructive/40 bg-destructive/10 text-destructive",
									)}
									data-oauth-status={isAuthorizing ? "pending" : "required"}
									type="button"
								>
									{isAuthorizing ? "OAuth pending" : "OAuth required"}
								</button>
							</TooltipTrigger>
							<TooltipContent
								className="max-w-sm whitespace-normal"
								side="top"
								sideOffset={6}
							>
								{oauthStatusMessage}
							</TooltipContent>
						</Tooltip>
					) : null}
					<div className="flex-1" />
					{isAuthorizing || authorizationRequired ? (
						<Button
							aria-label={
								isAuthorizing
									? `Cancel OAuth for ${server.name}`
									: `Connect ${server.name} with OAuth`
							}
							className="shrink-0"
							disabled={isBusy}
							onClick={() =>
								void (isAuthorizing
									? cancelOAuth(server.name)
									: authorizeOAuth(server.name))
							}
							size="sm"
							variant="default"
						>
							{isAuthorizing ? "Cancel" : "Connect"}
						</Button>
					) : null}
				</div>
				<div className="mt-2.5 grid gap-2">
					{server.configurationError ? (
						<div
							className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
							role="alert"
						>
							<p className="text-xs font-medium text-destructive">
								Invalid configuration
							</p>
							<p className="mt-0.5 wrap-break-word text-xs text-muted-foreground">
								{server.configurationError}
							</p>
						</div>
					) : null}
					{serverError && !authorizationRequired && !isAuthorizing ? (
						<div
							className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2"
							role="alert"
						>
							<p className="text-xs font-medium text-destructive">
								Connection failed
							</p>
							<p className="mt-0.5 wrap-break-word text-xs text-muted-foreground">
								{serverError}
							</p>
						</div>
					) : null}
					{renderServerDetails(server)}
					{context?.matchedEntries?.length ? (
						<MarketplaceEntrySetupDetails entries={context.matchedEntries} />
					) : null}
					<div className="pointer-events-none absolute right-4 bottom-3 opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
						{renderServerManagementActions(server)}
					</div>
				</div>
			</div>
		);
	};

	const renderGitHubInstallCard = () => {
		const isInstalling = busyServerName === GITHUB_MCP_SERVER_NAME;
		const installError = serverActionErrors[GITHUB_MCP_SERVER_NAME];
		const actionLabel = isLoading
			? "Checking..."
			: isInstalling
				? "Installing..."
				: "Install with GitHub";

		return (
			<div className="relative grid min-w-0 gap-3 rounded-lg border border-primary/20 bg-card px-5 py-4 shadow-xs">
				<div className="flex min-w-0 items-start gap-3">
					<div className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
						<Github className="h-4 w-4" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="text-sm font-semibold text-foreground">GitHub</h3>
							<span className="rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
								Recommended
							</span>
							<span className="rounded-md border border-border px-2 py-0.5 text-xs text-muted-foreground">
								Remote · Streamable HTTP
							</span>
						</div>
						<p className="mt-1 text-xs leading-5 text-muted-foreground">
							Connect Cline to GitHub repositories, issues, and pull requests
							through the official GitHub MCP server.
						</p>
					</div>
					<Button
						className="shrink-0"
						disabled={isLoading || isInstalling || Boolean(githubNameCollision)}
						onClick={() => void installGitHubMcp()}
						size="sm"
						type="button"
					>
						{isLoading || isInstalling ? (
							<RefreshCw className="h-4 w-4 animate-spin" />
						) : (
							<Github className="h-4 w-4" />
						)}
						{actionLabel}
					</Button>
				</div>

				<p className="wrap-break-word font-mono text-xs text-muted-foreground/80">
					{GITHUB_MCP_SERVER_URL}
				</p>

				{githubNameCollision ? (
					<div
						className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground"
						role="alert"
					>
						A different server already uses the name{" "}
						<code className="font-mono">{GITHUB_MCP_SERVER_NAME}</code>. Rename
						or delete it before installing the official GitHub server.
					</div>
				) : null}

				{installError ? (
					<div
						className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
						role="alert"
					>
						{installError}
					</div>
				) : null}
			</div>
		);
	};

	const installedItems = sortedServers
		.filter((server) => server.name !== officialGitHubServer?.name)
		.map(
			(server): MarketplaceLocalInstalledItem => ({
				key: server.name,
				matchValues: [server.name],
				render: (context) => renderServerCard(server, context),
			}),
		);

	return (
		<PageFrame>
			<PageHeader
				description={
					hasSettingsFile
						? "Editing this list updates cline_mcp_settings.json."
						: "No MCP settings file found yet. Add a server to create it."
				}
				title="MCP Servers"
				meta={
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								aria-label={
									settingsPath
										? `Copy MCP settings path: ${settingsPath}`
										: "MCP settings path unavailable"
								}
								className="cursor-copy rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-60"
								disabled={!settingsPath}
								onClick={() => void copySettingsPath()}
								type="button"
							>
								{settingsPathCopied ? "Path copied" : "From settings file"}
							</button>
						</TooltipTrigger>
						<TooltipContent
							className="max-w-md whitespace-normal"
							side="bottom"
							sideOffset={6}
						>
							<p className="font-mono">{settingsPath || "Path unavailable"}</p>
							{settingsPath ? (
								<p className="mt-1 opacity-70">Click to copy</p>
							) : null}
						</TooltipContent>
					</Tooltip>
				}
				actions={
					<>
						<Button
							variant="outline"
							size="sm"
							onClick={() => void refreshServers()}
							disabled={isLoading}
						>
							<RefreshCw
								className={cn("h-4 w-4", isLoading && "animate-spin")}
							/>
						</Button>
						<Button size="sm" onClick={openCreateDialog}>
							<Plus className="h-4 w-4" />
							Add MCP Server
						</Button>
					</>
				}
			/>

			{errorMessage && (
				<div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{errorMessage}
				</div>
			)}

			<MarketplaceView
				chrome="embedded"
				excludedEntryKeys={EXCLUDED_MARKETPLACE_ENTRY_KEYS}
				featuredContent={
					<section
						aria-labelledby="github-mcp-heading"
						className="grid min-w-0 gap-3"
					>
						<div className="flex flex-wrap items-end justify-between gap-2">
							<div>
								<h2
									className="text-base font-semibold text-foreground"
									id="github-mcp-heading"
								>
									GitHub MCP
								</h2>
								<p className="mt-0.5 text-xs text-muted-foreground">
									Official GitHub integration with browser-based OAuth.
								</p>
							</div>
						</div>
						{officialGitHubServer
							? renderServerCard(officialGitHubServer)
							: renderGitHubInstallCard()}
					</section>
				}
				installedItems={installedItems}
				onInstalledItemsChanged={() => refreshServers()}
				primitive="mcp"
			/>
			<Dialog
				open={editorOpen}
				onOpenChange={(open) => {
					setEditorOpen(open);
					if (!open) {
						setFormErrorMessage(null);
					}
				}}
			>
				<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							{editorMode === "edit" ? "Edit MCP Server" : "Add MCP Server"}
						</DialogTitle>
						<DialogDescription>
							{editorMode === "edit"
								? "Update the MCP server stored in "
								: "The server is saved to "}
							<code className="font-mono">
								{settingsPath || "cline_mcp_settings.json"}
							</code>
							.
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4">
						<div className="grid gap-2">
							<Label htmlFor="mcp-name">Server name</Label>
							<Input
								id="mcp-name"
								value={formState.name}
								onChange={(event) =>
									setFormState((current) => ({
										...current,
										name: event.target.value,
									}))
								}
								placeholder="github"
							/>
						</div>

						<div className="grid gap-2">
							<Label>Server type</Label>
							<RadioGroup
								className="grid gap-2"
								value={serverTypeOf(formState.transportType)}
								onValueChange={(value) =>
									setFormState((current) => ({
										...current,
										transportType:
											value === "local"
												? "stdio"
												: serverTypeOf(current.transportType) === "remote"
													? current.transportType
													: "streamableHttp",
									}))
								}
							>
								<Label
									htmlFor="mcp-server-type-local"
									className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 font-normal has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-accent/30"
								>
									<RadioGroupItem
										className="mt-0.5"
										id="mcp-server-type-local"
										value="local"
									/>
									<span className="grid gap-0.5">
										<span className="text-sm font-medium text-foreground">
											Local
										</span>
										<span className="text-xs text-muted-foreground">
											Runs a command on this machine (stdio). Recommended when
											available.
										</span>
									</span>
								</Label>
								<Label
									htmlFor="mcp-server-type-remote"
									className="flex cursor-pointer items-start gap-3 rounded-md border border-border px-3 py-2.5 font-normal has-[[data-state=checked]]:border-primary/60 has-[[data-state=checked]]:bg-accent/30"
								>
									<RadioGroupItem
										className="mt-0.5"
										id="mcp-server-type-remote"
										value="remote"
									/>
									<span className="grid gap-0.5">
										<span className="text-sm font-medium text-foreground">
											Remote
										</span>
										<span className="text-xs text-muted-foreground">
											Connects to a hosted server over HTTP by URL.
										</span>
									</span>
								</Label>
							</RadioGroup>
						</div>

						{formState.transportType === "stdio" ? (
							<>
								<div className="grid gap-2">
									<Label htmlFor="mcp-command">Command</Label>
									<Input
										id="mcp-command"
										value={formState.command}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												command: event.target.value,
											}))
										}
										placeholder="npx"
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="mcp-args">Args</Label>
									<Textarea
										id="mcp-args"
										value={formState.argsText}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												argsText: event.target.value,
											}))
										}
										placeholder="-y, @modelcontextprotocol/server-github"
									/>
								</div>
								<div className="grid gap-2">
									<div className="flex items-center justify-between gap-3">
										<Label>Environment variables</Label>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={addEnvEntry}
										>
											<Plus className="h-3.5 w-3.5" />
										</Button>
									</div>
									<div className="flex flex-col gap-2">
										{formState.envEntries.map((entry) => (
											<div key={entry.id} className="flex items-center gap-2">
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													onClick={() => removeEnvEntry(entry.id)}
													aria-label={`Remove env var ${entry.key || "row"}`}
												>
													<Minus className="h-3.5 w-3.5" />
												</Button>
												<Input
													value={entry.key}
													onChange={(event) =>
														updateEnvEntry(entry.id, "key", event.target.value)
													}
													placeholder="KEY"
												/>
												<Input
													type="password"
													value={entry.value}
													onChange={(event) =>
														updateEnvEntry(
															entry.id,
															"value",
															event.target.value,
														)
													}
													placeholder="VALUE"
												/>
											</div>
										))}
									</div>
								</div>
							</>
						) : (
							<>
								<div className="grid gap-2">
									<Label htmlFor="mcp-url">Server URL</Label>
									<Input
										id="mcp-url"
										value={formState.url}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												url: event.target.value,
											}))
										}
										placeholder="https://example.com/mcp"
									/>
								</div>
								<div className="grid gap-2">
									<Label htmlFor="mcp-headers">Headers</Label>
									<Textarea
										id="mcp-headers"
										value={formState.headersText}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												headersText: event.target.value,
											}))
										}
										placeholder="Authorization=Bearer token"
									/>
								</div>
								<div className="grid gap-2">
									<Label>Transport</Label>
									<Select
										value={formState.transportType}
										onValueChange={(value) =>
											setFormState((current) => ({
												...current,
												transportType: value as McpTransportType,
											}))
										}
									>
										<SelectTrigger className="w-full">
											<SelectValue placeholder="Select transport" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="streamableHttp">
												Streamable HTTP (recommended)
											</SelectItem>
											<SelectItem value="sse">SSE (legacy)</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</>
						)}

						<Collapsible
							className="grid gap-3"
							onOpenChange={setAdvancedOpen}
							open={advancedOpen}
						>
							<CollapsibleTrigger asChild>
								<button
									type="button"
									className="flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
								>
									<ChevronRight
										className={cn(
											"h-3.5 w-3.5 transition-transform",
											advancedOpen && "rotate-90",
										)}
									/>
									Advanced
								</button>
							</CollapsibleTrigger>
							<CollapsibleContent className="grid gap-4">
								{formState.transportType === "stdio" && (
									<div className="grid gap-2">
										<Label htmlFor="mcp-cwd">Working directory</Label>
										<Input
											id="mcp-cwd"
											value={formState.cwd}
											onChange={(event) =>
												setFormState((current) => ({
													...current,
													cwd: event.target.value,
												}))
											}
											placeholder="/path/to/project"
										/>
									</div>
								)}
								<div className="grid gap-2">
									<Label htmlFor="mcp-metadata">Metadata JSON</Label>
									<Textarea
										id="mcp-metadata"
										value={formState.metadataText}
										onChange={(event) =>
											setFormState((current) => ({
												...current,
												metadataText: event.target.value,
											}))
										}
										placeholder='{"key":"value"}'
									/>
								</div>
							</CollapsibleContent>
						</Collapsible>

						<div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
							<div>
								<p className="text-sm font-medium text-foreground">Enabled</p>
								<p className="text-xs text-muted-foreground">
									Disable the server without removing it from settings.
								</p>
							</div>
							<Switch
								checked={!formState.disabled}
								onCheckedChange={(enabled) =>
									setFormState((current) => ({
										...current,
										disabled: !enabled,
									}))
								}
								aria-label="Enable MCP server"
							/>
						</div>

						{formErrorMessage ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{formErrorMessage}
							</div>
						) : null}
					</div>

					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => setEditorOpen(false)}
							disabled={busyServerName !== null}
						>
							Cancel
						</Button>
						<Button
							onClick={() => void handleSaveServer()}
							disabled={busyServerName !== null}
						>
							{busyServerName !== null
								? "Saving..."
								: editorMode === "edit"
									? "Save changes"
									: "Add server"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={deleteTarget !== null}
				onOpenChange={(open) => {
					if (!open) {
						setDeleteTarget(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete MCP Server</AlertDialogTitle>
						<AlertDialogDescription>
							{deleteTarget
								? `Delete MCP server "${deleteTarget.name}" from settings?`
								: "Delete this MCP server from settings?"}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busyServerName !== null}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={busyServerName !== null || !deleteTarget}
							onClick={() => {
								if (deleteTarget) {
									void deleteServer(deleteTarget.name);
									setDeleteTarget(null);
								}
							}}
						>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageFrame>
	);
}
