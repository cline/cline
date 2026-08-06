"use client";

import {
	type ActiveConnectorRecord,
	type ConnectorChannel,
	type ConnectorChannelsResponse,
	shouldIncludeConnectorField,
} from "@cline/shared/browser";
import { Circle, Eye, EyeOff, RefreshCw, Search } from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { desktopClient } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";
import { PageFrame, PageHeader } from "../page-layout";

type ConnectorField = ConnectorChannel["fields"][number];
type ConnectorSecurityField = NonNullable<
	ConnectorChannel["security"]
>["fields"][number];
// Desktop start/stop is a separate lifecycle API and currently returns only
// the active/catalog subset of the shared Hub response.
type DesktopConnectorChannelsResponse = Pick<
	ConnectorChannelsResponse,
	"active" | "available"
>;

type ConnectorDraft = {
	values: Record<string, string>;
	securityEnabled: boolean;
	securityValues: Record<string, string>;
};

type PendingAction = {
	channelId: string;
	type: "connecting" | "disconnecting";
};

const CHANNEL_COLORS: Record<string, string> = {
	discord: "#5865F2",
	gchat: "#4285F4",
	linear: "#5E6AD2",
	slack: "#4A154B",
	telegram: "#229ED9",
	whatsapp: "#25D366",
};

function channelColor(channel: ConnectorChannel): string {
	return CHANNEL_COLORS[channel.id] ?? "#64748B";
}

function channelLetter(channel: ConnectorChannel): string {
	return channel.name.trim().charAt(0).toUpperCase() || "?";
}

function connectorIdentity(connector: ActiveConnectorRecord): string {
	if (connector.botUsername) {
		return connector.botUsername.startsWith("@")
			? connector.botUsername
			: `@${connector.botUsername}`;
	}
	if (connector.userName) {
		return connector.userName;
	}
	if (connector.applicationId) {
		return connector.applicationId;
	}
	if (connector.phoneNumberId) {
		return connector.phoneNumberId;
	}
	return `pid ${connector.pid}`;
}

function formatDateTime(value?: string): string | undefined {
	if (!value) {
		return undefined;
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function isSecretField(
	field: ConnectorField | ConnectorSecurityField,
): boolean {
	const key = "flag" in field ? field.flag : field.key;
	const normalized = `${key} ${field.label}`.toLowerCase();
	if (normalized.includes("public key")) {
		return false;
	}
	return (
		key === "-k" ||
		normalized.includes("token") ||
		normalized.includes("secret") ||
		normalized.includes("password") ||
		normalized.includes("api key") ||
		normalized.includes("api-key") ||
		normalized.includes("credentials")
	);
}

function isMultilineField(field: ConnectorField): boolean {
	const normalized = `${field.flag} ${field.label}`.toLowerCase();
	return normalized.includes("json") || normalized.includes("credentials");
}

function initialValuesForChannel(
	channel: ConnectorChannel,
): Record<string, string> {
	const values: Record<string, string> = {};
	for (const field of channel.fields) {
		if (field.initialValue !== undefined) {
			values[field.flag] = field.initialValue;
		}
	}
	return values;
}

function createDraft(channel: ConnectorChannel): ConnectorDraft {
	return {
		values: initialValuesForChannel(channel),
		securityEnabled: false,
		securityValues: {},
	};
}

function resolvedFieldValues(
	channel: ConnectorChannel,
	draft: ConnectorDraft,
): Record<string, string> {
	return {
		...initialValuesForChannel(channel),
		...draft.values,
	};
}

function visibleFieldsForChannel(
	channel: ConnectorChannel,
	draft: ConnectorDraft,
): ConnectorField[] {
	const values = resolvedFieldValues(channel, draft);
	return channel.fields.filter((field) =>
		shouldIncludeConnectorField(field, values),
	);
}

function validateDraft(
	channel: ConnectorChannel,
	draft: ConnectorDraft,
): string | undefined {
	const values = resolvedFieldValues(channel, draft);
	for (const field of visibleFieldsForChannel(channel, draft)) {
		if (field.required && !values[field.flag]?.trim()) {
			return `${field.label} is required`;
		}
	}
	if (draft.securityEnabled && channel.security) {
		for (const field of channel.security.fields) {
			if (!draft.securityValues[field.key]?.trim()) {
				return field.requiredMessage;
			}
		}
	}
	return undefined;
}

function fieldDescription(
	field: ConnectorField | ConnectorSecurityField,
): string {
	if (field.help?.length) {
		return field.help.join(" ");
	}
	if ("requiredMessage" in field) {
		return field.requiredMessage;
	}
	return field.required
		? "Required to connect this channel."
		: "Optional channel setting.";
}

function fieldDomId(
	channelId: string,
	fieldKey: string,
	kind: "credential" | "security" = "credential",
): string {
	const normalizedKey = fieldKey.replace(/[^a-zA-Z0-9_-]/g, "-");
	return `channel-${channelId}-${kind}-${normalizedKey}`;
}

function CredentialField({
	description,
	disabled,
	id,
	label,
	multiline = false,
	onChange,
	options,
	placeholder,
	required = false,
	secret = false,
	value,
}: {
	description: string;
	disabled: boolean;
	id: string;
	label: string;
	multiline?: boolean;
	onChange: (value: string) => void;
	options?: Array<{ value: string; label: string; hint?: string }>;
	placeholder?: string;
	required?: boolean;
	secret?: boolean;
	value: string;
}) {
	const [revealed, setRevealed] = useState(false);
	const descriptionId = `${id}-description`;

	useEffect(() => {
		if (disabled || value.length === 0) {
			setRevealed(false);
		}
	}, [disabled, value]);

	const revealButton = (className: string) =>
		secret ? (
			<button
				aria-label={`${revealed ? "Hide" : "Show"} ${label}`}
				className={cn(
					"absolute right-2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
					className,
				)}
				disabled={disabled}
				onClick={() => setRevealed((current) => !current)}
				type="button"
			>
				{revealed ? (
					<EyeOff className="size-3.5" />
				) : (
					<Eye className="size-3.5" />
				)}
			</button>
		) : null;

	return (
		<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
			<div className="min-w-0 sm:max-w-xs">
				<label className="text-sm font-medium text-foreground" htmlFor={id}>
					{label}
					{required ? (
						<span aria-hidden="true" className="text-destructive">
							{" "}
							*
						</span>
					) : null}
				</label>
				<p
					className="mt-0.5 text-xs leading-relaxed text-muted-foreground"
					id={descriptionId}
				>
					{description}
				</p>
			</div>
			<div className="sm:w-72 sm:shrink-0">
				{options ? (
					<Select
						disabled={disabled}
						onValueChange={(nextValue) => {
							if (nextValue !== null) {
								onChange(nextValue);
							}
						}}
						value={value}
					>
						<SelectTrigger
							aria-describedby={descriptionId}
							aria-required={required}
							className="w-full"
							id={id}
						>
							<SelectValue placeholder={placeholder} />
						</SelectTrigger>
						<SelectContent>
							{options.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : multiline ? (
					<div className="relative">
						<Textarea
							aria-describedby={descriptionId}
							className={cn(
								secret && "pr-9",
								secret && !revealed && "[-webkit-text-security:disc]",
							)}
							disabled={disabled}
							id={id}
							onChange={(event) => onChange(event.target.value)}
							placeholder={placeholder}
							required={required}
							rows={5}
							spellCheck={false}
							value={value}
						/>
						{revealButton("top-2")}
					</div>
				) : (
					<div className="relative">
						<Input
							aria-describedby={descriptionId}
							autoComplete="off"
							className={cn(secret && "pr-9")}
							disabled={disabled}
							id={id}
							onChange={(event) => onChange(event.target.value)}
							placeholder={placeholder}
							required={required}
							spellCheck={false}
							type={secret && !revealed ? "password" : "text"}
							value={value}
						/>
						{revealButton("top-1/2 -translate-y-1/2")}
					</div>
				)}
			</div>
		</div>
	);
}

export function ChannelsContent() {
	const [channels, setChannels] = useState<ConnectorChannel[]>([]);
	const [activeConnectors, setActiveConnectors] = useState<
		ActiveConnectorRecord[]
	>([]);
	const [drafts, setDrafts] = useState<Record<string, ConnectorDraft>>({});
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [pendingAction, setPendingAction] = useState<PendingAction | null>(
		null,
	);
	const [catalogError, setCatalogError] = useState<string | null>(null);
	const [channelErrors, setChannelErrors] = useState<
		Record<string, string | undefined>
	>({});
	const [disconnectTargetId, setDisconnectTargetId] = useState<string | null>(
		null,
	);

	const applyResponse = useCallback(
		(response: DesktopConnectorChannelsResponse) => {
			setChannels(Array.isArray(response.available) ? response.available : []);
			setActiveConnectors(
				Array.isArray(response.active) ? response.active : [],
			);
		},
		[],
	);

	const updateChannelError = useCallback(
		(channelId: string, message?: string) => {
			setChannelErrors((current) => {
				const next = { ...current };
				if (message) {
					next[channelId] = message;
				} else {
					delete next[channelId];
				}
				return next;
			});
		},
		[],
	);

	const refreshChannels = useCallback(async () => {
		setIsLoading(true);
		setCatalogError(null);
		try {
			const response =
				await desktopClient.invoke<DesktopConnectorChannelsResponse>(
					"list_connector_channels",
				);
			applyResponse(response);
			setChannelErrors({});
		} catch (error) {
			setCatalogError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsLoading(false);
		}
	}, [applyResponse]);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void refreshChannels();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [refreshChannels]);

	const draftForChannel = (channel: ConnectorChannel): ConnectorDraft =>
		drafts[channel.id] ?? createDraft(channel);

	const updateFieldValue = (
		channel: ConnectorChannel,
		fieldKey: string,
		value: string,
	) => {
		setDrafts((current) => {
			const draft = current[channel.id] ?? createDraft(channel);
			return {
				...current,
				[channel.id]: {
					...draft,
					values: { ...draft.values, [fieldKey]: value },
				},
			};
		});
		updateChannelError(channel.id);
	};

	const setSecurityEnabled = (channel: ConnectorChannel, enabled: boolean) => {
		setDrafts((current) => {
			const draft = current[channel.id] ?? createDraft(channel);
			return {
				...current,
				[channel.id]: { ...draft, securityEnabled: enabled },
			};
		});
		updateChannelError(channel.id);
	};

	const updateSecurityFieldValue = (
		channel: ConnectorChannel,
		fieldKey: string,
		value: string,
	) => {
		setDrafts((current) => {
			const draft = current[channel.id] ?? createDraft(channel);
			return {
				...current,
				[channel.id]: {
					...draft,
					securityValues: {
						...draft.securityValues,
						[fieldKey]: value,
					},
				},
			};
		});
		updateChannelError(channel.id);
	};

	const connectChannel = async (channel: ConnectorChannel) => {
		if (pendingAction || isLoading) {
			return;
		}
		const draft = draftForChannel(channel);
		const validationError = validateDraft(channel, draft);
		if (validationError) {
			setExpandedId(channel.id);
			updateChannelError(channel.id, validationError);
			return;
		}

		setPendingAction({ channelId: channel.id, type: "connecting" });
		setCatalogError(null);
		updateChannelError(channel.id);
		try {
			const response =
				await desktopClient.invoke<DesktopConnectorChannelsResponse>(
					"start_connector_channel",
					{
						channel: channel.id,
						values: resolvedFieldValues(channel, draft),
						security: {
							enabled: draft.securityEnabled,
							values: draft.securityValues,
						},
					},
				);
			applyResponse(response);
		} catch (error) {
			setExpandedId(channel.id);
			updateChannelError(
				channel.id,
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setPendingAction(null);
		}
	};

	const disconnectChannel = async (channel: ConnectorChannel) => {
		if (pendingAction || isLoading) {
			return;
		}
		setPendingAction({ channelId: channel.id, type: "disconnecting" });
		setDisconnectTargetId(null);
		setCatalogError(null);
		updateChannelError(channel.id);
		try {
			const response =
				await desktopClient.invoke<DesktopConnectorChannelsResponse>(
					"stop_connector_channel",
					{ channel: channel.id },
				);
			applyResponse(response);
		} catch (error) {
			updateChannelError(
				channel.id,
				error instanceof Error ? error.message : String(error),
			);
		} finally {
			setPendingAction(null);
		}
	};

	const normalizedQuery = query.trim().toLowerCase();
	const filteredChannels = useMemo(() => {
		const enabledChannelIds = new Set(
			activeConnectors.map((connector) => connector.type),
		);

		return channels
			.filter(
				(channel) =>
					!normalizedQuery ||
					channel.name.toLowerCase().includes(normalizedQuery) ||
					channel.hint.toLowerCase().includes(normalizedQuery) ||
					channel.type.toLowerCase().includes(normalizedQuery),
			)
			.sort((left, right) => {
				const leftIsEnabled = enabledChannelIds.has(left.id);
				const rightIsEnabled = enabledChannelIds.has(right.id);
				if (leftIsEnabled !== rightIsEnabled) {
					return leftIsEnabled ? -1 : 1;
				}
				return (
					left.name.localeCompare(right.name, undefined, {
						sensitivity: "base",
					}) || left.id.localeCompare(right.id)
				);
			});
	}, [activeConnectors, channels, normalizedQuery]);

	const disconnectTarget = disconnectTargetId
		? (channels.find((channel) => channel.id === disconnectTargetId) ?? null)
		: null;
	const disconnectTargetConnectors = disconnectTarget
		? activeConnectors.filter(
				(connector) => connector.type === disconnectTarget.id,
			)
		: [];
	const isBusy = isLoading || pendingAction !== null;

	return (
		<PageFrame>
			<PageHeader
				actions={
					<Button
						aria-label="Refresh channels"
						disabled={isBusy}
						onClick={() => void refreshChannels()}
						size="sm"
						title="Refresh channels"
						variant="outline"
					>
						<RefreshCw className={cn("size-4", isLoading && "animate-spin")} />
					</Button>
				}
				description="Connect messaging platforms so you can chat with Cline anywhere. Click on a channel name to view or edit its configuration."
				meta={
					<span className="rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">
						cline connect
					</span>
				}
				title="Channels"
			/>

			{catalogError ? (
				<div
					className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					role="alert"
				>
					Failed to load channels: {catalogError}
				</div>
			) : null}

			<div className="mb-5 flex items-center gap-2 rounded-lg border border-border bg-input px-3 py-2">
				<Search aria-hidden="true" className="size-4 text-muted-foreground" />
				<label className="sr-only" htmlFor="channel-search">
					Search channels
				</label>
				<input
					autoComplete="off"
					className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
					id="channel-search"
					onChange={(event) => setQuery(event.target.value)}
					placeholder="Search channels..."
					type="search"
					value={query}
				/>
			</div>

			<div className="flex flex-col gap-2">
				{isLoading && channels.length === 0 ? (
					<div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
						<p className="text-sm text-muted-foreground">Loading channels...</p>
					</div>
				) : null}

				{!isLoading && channels.length === 0 && !catalogError ? (
					<div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
						<p className="text-sm text-muted-foreground">
							No connector channels are available.
						</p>
					</div>
				) : null}

				{filteredChannels.map((channel) => {
					const isExpanded = expandedId === channel.id;
					const draft = draftForChannel(channel);
					const values = resolvedFieldValues(channel, draft);
					const visibleFields = visibleFieldsForChannel(channel, draft);
					const activeForChannel = activeConnectors.filter(
						(connector) => connector.type === channel.id,
					);
					const isConnected = activeForChannel.length > 0;
					const pendingType =
						pendingAction?.channelId === channel.id
							? pendingAction.type
							: undefined;
					const triggerId = `channel-${channel.id}-trigger`;
					const panelId = `channel-${channel.id}-panel`;

					return (
						<div
							className={cn(
								"rounded-lg border transition-colors",
								isExpanded
									? "border-border bg-accent/20"
									: "border-border hover:bg-accent/10",
							)}
							key={channel.id}
						>
							<div className="flex items-center">
								<button
									aria-controls={panelId}
									aria-expanded={isExpanded}
									className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
									id={triggerId}
									onClick={() =>
										setExpandedId((current) =>
											current === channel.id ? null : channel.id,
										)
									}
									type="button"
								>
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-2">
											<Circle
												aria-hidden="true"
												className={cn(
													"size-2 shrink-0",
													isConnected
														? "fill-primary text-primary"
														: "fill-muted-foreground/40 text-muted-foreground/40",
												)}
											/>
											<span className="text-sm font-medium text-foreground">
												{channel.name}
											</span>
										</div>
									</div>
								</button>
								<Switch
									aria-busy={pendingType !== undefined}
									aria-label={`${isConnected ? "Disconnect" : "Connect"} ${channel.name}`}
									checked={isConnected}
									className="mr-4"
									disabled={isBusy}
									onCheckedChange={(checked) => {
										if (checked) {
											void connectChannel(channel);
										} else {
											setDisconnectTargetId(channel.id);
										}
									}}
								/>
							</div>

							{isExpanded ? (
								<form
									aria-labelledby={triggerId}
									className="border-t border-border px-4 py-4"
									id={panelId}
									noValidate
									onSubmit={(event) => {
										event.preventDefault();
										void connectChannel(channel);
									}}
								>
									{channelErrors[channel.id] ? (
										<div
											className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
											role="alert"
										>
											{channelErrors[channel.id]}
										</div>
									) : null}

									{activeForChannel.length > 0 ? (
										<div className="mb-4 rounded-lg border border-border bg-background px-4 py-3">
											<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
												Active{" "}
												{activeForChannel.length === 1
													? "connection"
													: "connections"}
											</p>
											<div className="flex flex-col gap-2">
												{activeForChannel.map((connector) => (
													<div
														className="min-w-0 text-xs text-muted-foreground"
														key={connector.id}
													>
														<div className="flex flex-wrap items-center gap-1.5">
															<span className="font-medium text-foreground">
																{connectorIdentity(connector)}
															</span>
															<span className="rounded border border-border px-1.5 py-0.5">
																pid {connector.pid}
															</span>
															{connector.connectionMode ? (
																<span className="rounded border border-border px-1.5 py-0.5">
																	{connector.connectionMode}
																</span>
															) : null}
															{formatDateTime(connector.startedAt) ? (
																<span>
																	{formatDateTime(connector.startedAt)}
																</span>
															) : null}
														</div>
														<p
															className="mt-1 truncate"
															title={connector.baseUrl ?? connector.hubUrl}
														>
															{connector.baseUrl ?? connector.hubUrl}
														</p>
													</div>
												))}
											</div>
										</div>
									) : null}

									<div className="flex flex-col gap-4">
										<p className="text-xs text-muted-foreground">
											{channel.hint}
										</p>
										{visibleFields.map((field) => (
											<CredentialField
												description={fieldDescription(field)}
												disabled={isBusy}
												id={fieldDomId(channel.id, field.flag)}
												key={field.flag}
												label={field.label}
												multiline={isMultilineField(field)}
												onChange={(value) =>
													updateFieldValue(channel, field.flag, value)
												}
												options={field.options}
												placeholder={field.placeholder}
												required={field.required}
												secret={isSecretField(field)}
												value={values[field.flag] ?? ""}
											/>
										))}
									</div>

									{channel.security ? (
										<div className="mt-5 rounded-lg border border-border bg-background px-4 py-3">
											<div className="flex items-center justify-between gap-4">
												<div>
													<label
														className="text-sm font-medium text-foreground"
														htmlFor={`channel-${channel.id}-security-toggle`}
													>
														Restrict access
													</label>
													<p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
														{channel.security.prompt}
													</p>
												</div>
												<Switch
													checked={draft.securityEnabled}
													disabled={isBusy}
													id={`channel-${channel.id}-security-toggle`}
													onCheckedChange={(checked) =>
														setSecurityEnabled(channel, checked)
													}
												/>
											</div>
											{draft.securityEnabled ? (
												<div className="mt-4 flex flex-col gap-4 border-t border-border pt-4">
													{channel.security.fields.map((field) => (
														<CredentialField
															description={fieldDescription(field)}
															disabled={isBusy}
															id={fieldDomId(channel.id, field.key, "security")}
															key={field.key}
															label={field.label}
															onChange={(value) =>
																updateSecurityFieldValue(
																	channel,
																	field.key,
																	value,
																)
															}
															placeholder={field.placeholder}
															required
															secret={isSecretField(field)}
															value={draft.securityValues[field.key] ?? ""}
														/>
													))}
												</div>
											) : null}
										</div>
									) : null}

									<div className="mt-5 flex justify-end gap-2">
										<div className="flex shrink-0 justify-end gap-2">
											<button
												className={cn(
													"rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors",
													isConnected
														? "border-destructive/40 text-destructive hover:bg-destructive/10"
														: "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
												)}
												onClick={() => {
													if (isConnected) {
														setDisconnectTargetId(channel.id);
													} else {
														setExpandedId(null);
													}
												}}
												type="button"
											>
												{isConnected ? "Reset" : "Close"}
											</button>
											<button
												className="rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
												disabled={isBusy}
												type="submit"
											>
												{pendingType === "connecting" ? "Saving..." : "Save"}
											</button>
										</div>
									</div>
								</form>
							) : null}
						</div>
					);
				})}

				{!isLoading && channels.length > 0 && filteredChannels.length === 0 ? (
					<div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
						<p className="text-sm text-muted-foreground">
							No channels match &ldquo;{query}&rdquo;.
						</p>
					</div>
				) : null}
			</div>

			<AlertDialog
				onOpenChange={(open) => {
					if (!open) {
						setDisconnectTargetId(null);
					}
				}}
				open={disconnectTarget !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							Reset {disconnectTarget?.name ?? "channel"}?
						</AlertDialogTitle>
						<AlertDialogDescription>
							This stops{" "}
							{disconnectTargetConnectors.length === 1
								? `the active ${disconnectTarget?.name ?? "channel"} connector`
								: `all ${disconnectTargetConnectors.length} active ${disconnectTarget?.name ?? "channel"} connectors`}
							. You will need to save its credentials to connect it again.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pendingAction !== null}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							className={buttonVariants({ variant: "destructive" })}
							disabled={pendingAction !== null || !disconnectTarget}
							onClick={() => {
								if (disconnectTarget) {
									void disconnectChannel(disconnectTarget);
								}
							}}
						>
							Reset
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</PageFrame>
	);
}
