"use client";

import { Circle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
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
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
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

type ConnectorField = {
	flag: string;
	label: string;
	placeholder?: string;
	required?: boolean;
	help?: string[];
	initialValue?: string;
	options?: Array<{ value: string; label: string; hint?: string }>;
	includeWhen?: {
		flag: string;
		equals?: string;
		notEquals?: string;
	};
};

type ConnectorSecurityField = {
	key: string;
	label: string;
	placeholder?: string;
	help?: string[];
	requiredMessage: string;
};

type ConnectorChannel = {
	id: string;
	name: string;
	type: "polling" | "webhook" | "hybrid";
	hint: string;
	fields: ConnectorField[];
	security?: {
		prompt: string;
		fields: ConnectorSecurityField[];
	};
};

type ActiveConnector = {
	id: string;
	type: string;
	pid: number;
	hubUrl: string;
	startedAt?: string;
	agentId?: string;
	applicationId?: string;
	botUsername?: string;
	userName?: string;
	agentPhoneNumber?: string;
	phoneNumberId?: string;
	phoneNumberCountry?: string;
	phoneNumberStatus?: string;
	phoneNumberType?: string;
	port?: number;
	baseUrl?: string;
	connectionMode?: string;
};

type ConnectorChannelsResponse = {
	available: ConnectorChannel[];
	active: ActiveConnector[];
};

type ConnectorFormState = {
	channelId: string;
	values: Record<string, string>;
	securityEnabled: boolean;
	securityValues: Record<string, string>;
};

type ConnectorFormMode = "add" | "edit";

function connectorName(
	connector: ActiveConnector,
	channels: ConnectorChannel[],
): string {
	return (
		channels.find((channel) => channel.id === connector.type)?.name ??
		connector.type
	);
}

function connectorIdentity(connector: ActiveConnector): string {
	if (connector.botUsername) {
		return `@${connector.botUsername}`;
	}
	if (connector.agentPhoneNumber) {
		return connector.agentPhoneNumber;
	}
	if (connector.userName) {
		return connector.userName;
	}
	if (connector.applicationId) {
		return connector.applicationId;
	}
	return `pid ${connector.pid}`;
}

function connectorDetailBadges(connector: ActiveConnector): string[] {
	return [
		connector.agentId ? `agent=${connector.agentId}` : undefined,
		connector.applicationId ? `app=${connector.applicationId}` : undefined,
		connector.agentPhoneNumber
			? `phone=${connector.agentPhoneNumber}`
			: undefined,
		connector.phoneNumberType ? `type=${connector.phoneNumberType}` : undefined,
		connector.phoneNumberStatus
			? `status=${connector.phoneNumberStatus}`
			: undefined,
		connector.phoneNumberId ? `numberId=${connector.phoneNumberId}` : undefined,
		connector.port ? `port=${connector.port}` : undefined,
		`pid=${connector.pid}`,
	].filter((detail): detail is string => Boolean(detail));
}

function connectorWebhookUrl(connector: ActiveConnector): string | undefined {
	if (!connector.baseUrl || connector.type === "telegram") {
		return undefined;
	}
	return `${connector.baseUrl.replace(/\/$/, "")}/api/webhooks/${connector.type}`;
}

function formatDateTime(value?: string): string {
	if (!value) {
		return "-";
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function isSecretField(
	field: ConnectorField | ConnectorSecurityField,
): boolean {
	const label = field.label.toLowerCase();
	const key =
		"flag" in field ? field.flag.toLowerCase() : field.key.toLowerCase();
	return (
		label.includes("token") ||
		label.includes("secret") ||
		label.includes("key") ||
		key.includes("token") ||
		key.includes("secret") ||
		key.includes("key")
	);
}

function isMultilineField(field: ConnectorField): boolean {
	const label = field.label.toLowerCase();
	return label.includes("json") || field.flag.includes("credentials");
}

function shouldIncludeField(
	field: ConnectorField,
	values: Record<string, string>,
): boolean {
	const condition = field.includeWhen;
	if (!condition) {
		return true;
	}
	const value = values[condition.flag] ?? "";
	if (condition.equals !== undefined && value !== condition.equals) {
		return false;
	}
	if (condition.notEquals !== undefined && value === condition.notEquals) {
		return false;
	}
	return true;
}

function initialValuesForChannel(
	channel?: ConnectorChannel,
): Record<string, string> {
	const values: Record<string, string> = {};
	for (const field of channel?.fields ?? []) {
		if (field.initialValue) {
			values[field.flag] = field.initialValue;
		}
	}
	return values;
}

function createFormState(channels: ConnectorChannel[]): ConnectorFormState {
	const channel = channels[0];
	return {
		channelId: channel?.id ?? "",
		values: initialValuesForChannel(channel),
		securityEnabled: false,
		securityValues: {},
	};
}

function connectorFieldValue(
	connector: ActiveConnector,
	flag: string,
): string | undefined {
	if (flag === "--agent-id") {
		return connector.agentId;
	}
	if (flag === "--application-id") {
		return connector.applicationId;
	}
	if (flag === "--phone-number-id") {
		return connector.phoneNumberId;
	}
	if (flag === "--base-url") {
		return connector.baseUrl;
	}
	if (flag === "--user-name") {
		return connector.userName;
	}
	if (flag === "--bot-username") {
		return connector.botUsername;
	}
	return undefined;
}

function createEditFormState(
	connector: ActiveConnector,
	channel: ConnectorChannel,
): ConnectorFormState {
	const values: Record<string, string> = {};
	for (const field of channel.fields) {
		const value = connectorFieldValue(connector, field.flag);
		if (value) {
			values[field.flag] = value;
		}
	}
	return {
		channelId: channel.id,
		values,
		securityEnabled: false,
		securityValues: {},
	};
}

export function ChannelsContent() {
	const [channels, setChannels] = useState<ConnectorChannel[]>([]);
	const [activeConnectors, setActiveConnectors] = useState<ActiveConnector[]>(
		[],
	);
	const [isLoading, setIsLoading] = useState(true);
	const [busyChannel, setBusyChannel] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [formMode, setFormMode] = useState<ConnectorFormMode>("add");
	const [editTarget, setEditTarget] = useState<ActiveConnector | null>(null);
	const [formState, setFormState] = useState<ConnectorFormState>({
		channelId: "",
		values: {},
		securityEnabled: false,
		securityValues: {},
	});
	const [formError, setFormError] = useState<string | null>(null);
	const [removeTarget, setRemoveTarget] = useState<ActiveConnector | null>(
		null,
	);

	const selectedChannel = useMemo(
		() => channels.find((channel) => channel.id === formState.channelId),
		[channels, formState.channelId],
	);
	const visibleFields = useMemo(() => {
		const values = {
			...initialValuesForChannel(selectedChannel),
			...formState.values,
		};
		return (selectedChannel?.fields ?? []).filter((field) =>
			shouldIncludeField(field, values),
		);
	}, [selectedChannel, formState.values]);

	const applyResponse = useCallback((response: ConnectorChannelsResponse) => {
		setChannels(response.available);
		setActiveConnectors(response.active);
		setFormState((prev) =>
			prev.channelId ? prev : createFormState(response.available),
		);
	}, []);

	const refreshChannels = useCallback(async () => {
		setIsLoading(true);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<ConnectorChannelsResponse>(
				"list_connector_channels",
			);
			applyResponse(response);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
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

	const openAddDialog = () => {
		setFormMode("add");
		setEditTarget(null);
		setFormState(createFormState(channels));
		setFormError(null);
		setDialogOpen(true);
	};

	const openEditDialog = (connector: ActiveConnector) => {
		const channel = channels.find((entry) => entry.id === connector.type);
		if (!channel) {
			setErrorMessage(`Unknown connector channel: ${connector.type}`);
			return;
		}
		setFormMode("edit");
		setEditTarget(connector);
		setFormState(createEditFormState(connector, channel));
		setFormError(null);
		setDialogOpen(true);
	};

	const updateFieldValue = (flag: string, value: string) => {
		setFormState((prev) => ({
			...prev,
			values: { ...prev.values, [flag]: value },
		}));
	};

	const updateSecurityFieldValue = (key: string, value: string) => {
		setFormState((prev) => ({
			...prev,
			securityValues: { ...prev.securityValues, [key]: value },
		}));
	};

	const saveConnector = async () => {
		if (!selectedChannel) {
			setFormError("Choose a channel");
			return;
		}
		for (const field of selectedChannel.fields) {
			if (!visibleFields.includes(field)) {
				continue;
			}
			if (field.required && !formState.values[field.flag]?.trim()) {
				setFormError(`${field.label} is required`);
				return;
			}
		}
		if (formState.securityEnabled && selectedChannel.security) {
			for (const field of selectedChannel.security.fields) {
				if (!formState.securityValues[field.key]?.trim()) {
					setFormError(field.requiredMessage);
					return;
				}
			}
		}
		setBusyChannel(selectedChannel.id);
		setFormError(null);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<ConnectorChannelsResponse>(
				formMode === "edit"
					? "update_connector_channel"
					: "start_connector_channel",
				{
					channel: selectedChannel.id,
					connectorId: editTarget?.id,
					values: formState.values,
					security: {
						enabled: formState.securityEnabled,
						values: formState.securityValues,
					},
				},
			);
			applyResponse(response);
			setDialogOpen(false);
			setEditTarget(null);
			setFormMode("add");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setFormError(message);
		} finally {
			setBusyChannel(null);
		}
	};

	const stopConnector = async (connector: ActiveConnector) => {
		setBusyChannel(connector.type);
		setErrorMessage(null);
		try {
			const response = await desktopClient.invoke<ConnectorChannelsResponse>(
				"stop_connector_channel",
				{ channel: connector.type },
			);
			applyResponse(response);
			setRemoveTarget(null);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setErrorMessage(message);
		} finally {
			setBusyChannel(null);
		}
	};

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
				<div className="flex items-center justify-between gap-3">
					<div>
						<h2 className="text-lg font-semibold">Channels</h2>
						<p className="text-sm text-muted-foreground">
							{activeConnectors.length} connected
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Button
							disabled={isLoading}
							onClick={() => void refreshChannels()}
							size="sm"
							type="button"
							variant="outline"
						>
							<RefreshCw
								className={cn("size-4", isLoading && "animate-spin")}
							/>
						</Button>
						<Button
							disabled={channels.length === 0}
							onClick={openAddDialog}
							size="sm"
							type="button"
						>
							<Plus className="size-4" />
							Add Channel
						</Button>
					</div>
				</div>

				{errorMessage ? (
					<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
						{errorMessage}
					</div>
				) : null}

				<section className="overflow-hidden rounded-lg border bg-card">
					<div className="grid gap-2 p-2.5">
						{isLoading ? (
							<p className="px-1 py-4 text-[13px] text-muted-foreground">
								Loading channels...
							</p>
						) : activeConnectors.length === 0 ? (
							<p className="px-1 py-4 text-[13px] text-muted-foreground">
								No channels connected.
							</p>
						) : (
							activeConnectors.map((connector) => (
								<div
									className="grid gap-3 border bg-[color-mix(in_oklch,var(--background)_70%,var(--card))] p-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
									key={connector.id}
								>
									<div className="min-w-0">
										<div className="flex items-center gap-2">
											<Circle className="size-2 fill-emerald-300 text-emerald-300" />
											<p className="truncate text-[13px] font-semibold leading-tight">
												{connectorName(connector, channels)}
											</p>
											<span className="rounded-md border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
												{connectorIdentity(connector)}
											</span>
										</div>
										<div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
											{connectorDetailBadges(connector).map((detail) => (
												<span
													className="rounded-md border bg-background px-1.5 py-0.5"
													key={detail}
												>
													{detail}
												</span>
											))}
											<span
												className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
												title={connector.hubUrl}
											>
												hub={connector.hubUrl}
											</span>
											{connector.baseUrl ? (
												<span
													className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
													title={connector.baseUrl}
												>
													base={connector.baseUrl}
												</span>
											) : null}
											{connectorWebhookUrl(connector) ? (
												<span
													className="max-w-full break-all rounded-md border bg-background px-1.5 py-0.5"
													title={connectorWebhookUrl(connector)}
												>
													webhook={connectorWebhookUrl(connector)}
												</span>
											) : null}
											<span className="rounded-md border bg-background px-1.5 py-0.5">
												{formatDateTime(connector.startedAt)}
											</span>
											{connector.connectionMode ? (
												<span className="rounded-md border bg-background px-1.5 py-0.5">
													{connector.connectionMode}
												</span>
											) : null}
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Button
											disabled={busyChannel === connector.type}
											onClick={() => openEditDialog(connector)}
											size="sm"
											type="button"
											variant="outline"
										>
											<Pencil className="size-4" />
										</Button>
										<Button
											disabled={busyChannel === connector.type}
											onClick={() => setRemoveTarget(connector)}
											size="sm"
											type="button"
											variant="outline"
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								</div>
							))
						)}
					</div>
				</section>
			</div>

			<Dialog
				open={dialogOpen}
				onOpenChange={(open: boolean) => {
					setDialogOpen(open);
					if (!open) {
						setEditTarget(null);
						setFormMode("add");
					}
				}}
			>
				<DialogContent className="max-h-[86vh] overflow-y-auto sm:max-w-xl">
					<DialogHeader>
						<DialogTitle>
							{formMode === "edit" ? "Edit Channel" : "Add Channel"}
						</DialogTitle>
						<DialogDescription>
							{formMode === "edit"
								? "Update this connector channel and restart it with the new settings."
								: "Start a connector channel for Cline Hub."}
						</DialogDescription>
					</DialogHeader>
					<div className="grid gap-4 py-2">
						<div className="grid gap-2">
							<Label>Channel</Label>
							<Select
								disabled={formMode === "edit"}
								onValueChange={(value) => {
									if (!value) {
										return;
									}
									setFormState({
										channelId: value,
										values: initialValuesForChannel(
											channels.find((channel) => channel.id === value),
										),
										securityEnabled: false,
										securityValues: {},
									});
								}}
								value={formState.channelId}
							>
								<SelectTrigger>
									<SelectValue placeholder="Select channel" />
								</SelectTrigger>
								<SelectContent>
									{channels.map((channel) => (
										<SelectItem key={channel.id} value={channel.id}>
											{channel.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{formMode === "edit" ? (
							<div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
								Stored runtime fields are prefilled. Secret fields are not read
								back from the running connector, so re-enter them before saving.
							</div>
						) : null}

						{visibleFields.map((field) => (
							<div className="grid gap-2" key={field.flag}>
								<Label>
									{field.label}
									{field.required ? (
										<span className="text-destructive"> *</span>
									) : null}
								</Label>
								{field.options ? (
									<Select
										onValueChange={(value) => {
											if (value) {
												updateFieldValue(field.flag, value);
											}
										}}
										value={
											formState.values[field.flag] ?? field.initialValue ?? ""
										}
									>
										<SelectTrigger>
											<SelectValue placeholder={field.placeholder} />
										</SelectTrigger>
										<SelectContent>
											{field.options.map((option) => (
												<SelectItem key={option.value} value={option.value}>
													{option.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								) : isMultilineField(field) ? (
									<Textarea
										onChange={(event) =>
											updateFieldValue(field.flag, event.target.value)
										}
										placeholder={field.placeholder}
										rows={5}
										value={formState.values[field.flag] ?? ""}
									/>
								) : (
									<Input
										onChange={(event) =>
											updateFieldValue(field.flag, event.target.value)
										}
										placeholder={field.placeholder}
										type={isSecretField(field) ? "password" : "text"}
										value={formState.values[field.flag] ?? ""}
									/>
								)}
								{field.help?.length ? (
									<div className="grid gap-1 text-xs text-muted-foreground">
										{field.help.map((line) => (
											<p key={line}>{line}</p>
										))}
									</div>
								) : null}
							</div>
						))}

						{selectedChannel?.security ? (
							<div className="grid gap-3 rounded-lg border p-3">
								<div className="flex items-center justify-between gap-3">
									<Label className="text-sm">Restrict access</Label>
									<Switch
										checked={formState.securityEnabled}
										onCheckedChange={(checked: boolean) =>
											setFormState((prev) => ({
												...prev,
												securityEnabled: checked,
											}))
										}
									/>
								</div>
								{formState.securityEnabled
									? selectedChannel.security.fields.map((field) => (
											<div className="grid gap-2" key={field.key}>
												<Label>{field.label}</Label>
												<Input
													onChange={(event) =>
														updateSecurityFieldValue(
															field.key,
															event.target.value,
														)
													}
													placeholder={field.placeholder}
													type={isSecretField(field) ? "password" : "text"}
													value={formState.securityValues[field.key] ?? ""}
												/>
												{field.help?.length ? (
													<div className="grid gap-1 text-xs text-muted-foreground">
														{field.help.map((line) => (
															<p key={line}>{line}</p>
														))}
													</div>
												) : null}
											</div>
										))
									: null}
							</div>
						) : null}

						{formError ? (
							<div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
								{formError}
							</div>
						) : null}
					</div>
					<DialogFooter>
						<Button
							disabled={busyChannel !== null}
							onClick={() => setDialogOpen(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={busyChannel !== null || !selectedChannel}
							onClick={() => void saveConnector()}
							type="button"
						>
							{busyChannel
								? formMode === "edit"
									? "Saving..."
									: "Starting..."
								: formMode === "edit"
									? "Save Changes"
									: "Add Channel"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog
				open={removeTarget !== null}
				onOpenChange={(open: boolean) => {
					if (!open) {
						setRemoveTarget(null);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove Channel</AlertDialogTitle>
						<AlertDialogDescription>
							Confirm that you want to stop the active{" "}
							{removeTarget ? connectorName(removeTarget, channels) : "channel"}{" "}
							channel for {removeTarget ? connectorIdentity(removeTarget) : ""}.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={busyChannel !== null}>
							Cancel
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={busyChannel !== null || !removeTarget}
							onClick={() => {
								if (removeTarget) {
									void stopConnector(removeTarget);
								}
							}}
							variant="destructive"
						>
							Remove
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</ScrollArea>
	);
}
