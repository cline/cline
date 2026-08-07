"use client";

import {
	CheckCircle2,
	CircleAlert,
	CloudCog,
	Loader2,
	Plus,
	RefreshCw,
	Server,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { desktopClient } from "@/lib/desktop-client";
import {
	createRemoteEnvironmentDraft,
	DEFAULT_REMOTE_ENVIRONMENT_RUNTIME_STATE,
	formatRemoteEnvironmentDestination,
	normalizeRemoteEnvironmentProfile,
	type RemoteEnvironmentDeleteResult,
	type RemoteEnvironmentListResult,
	type RemoteEnvironmentProfile,
	type RemoteEnvironmentRuntimeState,
	type RemoteEnvironmentTestResult,
	type RemoteEnvironmentUpsertResult,
	validateRemoteEnvironmentProfile,
} from "@/lib/remote-environments";
import { cn } from "@/lib/utils";
import { PageEmptyState, PageFrame, PageHeader } from "../page-layout";

type RemoteAction = "save" | "test" | "delete";

type BusyAction = {
	action: RemoteAction;
	profileId: string;
};

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function profileIdOrThrow(profile: RemoteEnvironmentProfile): string {
	if (!profile.id) {
		throw new Error("The desktop backend did not return an SSH profile ID.");
	}
	return profile.id;
}

function statusLabel(value: string): string {
	return value
		.split("-")
		.map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
		.join(" ");
}

function StatusBadge({ label, value }: { label: string; value: string }) {
	const isPositive =
		value === "connected" || value === "passed" || value === "ready";
	const isPending =
		value === "connecting" ||
		value === "disconnecting" ||
		value === "testing" ||
		value === "installing";
	const isError = value === "failed" || value === "error";

	return (
		<div className="flex min-w-0 items-center justify-between gap-3">
			<span className="text-xs text-muted-foreground">{label}</span>
			<Badge
				className={cn(
					isPositive &&
						"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
					isPending &&
						"border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
					isError && "border-destructive/30 bg-destructive/10 text-destructive",
				)}
				variant="outline"
			>
				{isPending ? <Loader2 className="animate-spin" /> : null}
				{isPositive ? <CheckCircle2 /> : null}
				{isError ? <CircleAlert /> : null}
				{statusLabel(value)}
			</Badge>
		</div>
	);
}

function runtimeStateFor(
	states: Record<string, RemoteEnvironmentRuntimeState>,
	profileId: string | undefined,
	activeProfileId: string | null,
): RemoteEnvironmentRuntimeState {
	if (profileId && states[profileId]) {
		return states[profileId];
	}
	if (profileId && profileId === activeProfileId) {
		return {
			...DEFAULT_REMOTE_ENVIRONMENT_RUNTIME_STATE,
			bootstrap: "ready",
			connection: "connected",
		};
	}
	return DEFAULT_REMOTE_ENVIRONMENT_RUNTIME_STATE;
}

export function RemoteEnvironmentsContent() {
	const [profiles, setProfiles] = useState<RemoteEnvironmentProfile[]>([]);
	const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
	const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
		null,
	);
	const [draft, setDraft] = useState<RemoteEnvironmentProfile>(() =>
		createRemoteEnvironmentDraft(),
	);
	const [runtimeStates, setRuntimeStates] = useState<
		Record<string, RemoteEnvironmentRuntimeState>
	>({});
	const [isLoading, setIsLoading] = useState(true);
	const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [formError, setFormError] = useState<string | null>(null);
	const [deleteTarget, setDeleteTarget] =
		useState<RemoteEnvironmentProfile | null>(null);

	const selectedProfile = useMemo(
		() => profiles.find((profile) => profile.id === selectedProfileId),
		[profiles, selectedProfileId],
	);
	const selectedRuntime = runtimeStateFor(
		runtimeStates,
		selectedProfileId ?? draft.id,
		activeProfileId,
	);
	const isBusy = isLoading || busyAction !== null;
	const hasSavedDestination = Boolean(draft.id);

	const setRuntimeState = useCallback(
		(
			profileId: string,
			updates:
				| Partial<RemoteEnvironmentRuntimeState>
				| ((
						current: RemoteEnvironmentRuntimeState,
				  ) => Partial<RemoteEnvironmentRuntimeState>),
		) => {
			setRuntimeStates((current) => {
				const previous = runtimeStateFor(current, profileId, activeProfileId);
				const nextUpdates =
					typeof updates === "function" ? updates(previous) : updates;
				return {
					...current,
					[profileId]: { ...previous, ...nextUpdates },
				};
			});
		},
		[activeProfileId],
	);

	const selectProfile = useCallback((profile: RemoteEnvironmentProfile) => {
		setSelectedProfileId(profile.id ?? null);
		setDraft(createRemoteEnvironmentDraft(profile));
		setFormError(null);
		setError(null);
	}, []);

	const startNewProfile = useCallback(() => {
		setSelectedProfileId(null);
		setDraft(createRemoteEnvironmentDraft());
		setFormError(null);
		setError(null);
	}, []);

	const loadProfiles = useCallback(async () => {
		setIsLoading(true);
		setError(null);
		try {
			const result = await desktopClient.invoke<RemoteEnvironmentListResult>(
				"list_remote_environments",
			);
			setProfiles(result.profiles);
			setActiveProfileId(result.activeProfileId);
			setRuntimeStates((current) => {
				if (!result.activeProfileId) return current;
				return {
					...current,
					[result.activeProfileId]: {
						...DEFAULT_REMOTE_ENVIRONMENT_RUNTIME_STATE,
						...current[result.activeProfileId],
						bootstrap: "ready",
						connection: "connected",
					},
				};
			});

			const nextProfile =
				result.profiles.find(
					(profile) => profile.id === result.activeProfileId,
				) ?? result.profiles[0];
			if (nextProfile) {
				setSelectedProfileId(nextProfile.id ?? null);
				setDraft(createRemoteEnvironmentDraft(nextProfile));
			} else {
				startNewProfile();
			}
		} catch (loadError) {
			setError(errorMessage(loadError));
		} finally {
			setIsLoading(false);
		}
	}, [startNewProfile]);

	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void loadProfiles();
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadProfiles]);

	const updateDraft = <Key extends keyof RemoteEnvironmentProfile>(
		key: Key,
		value: RemoteEnvironmentProfile[Key],
	) => {
		setDraft((current) => ({ ...current, [key]: value }));
		setFormError(null);
	};

	const upsertLocalProfile = useCallback(
		(profile: RemoteEnvironmentProfile) => {
			setProfiles((current) => {
				const existingIndex = current.findIndex(
					(candidate) => candidate.id === profile.id,
				);
				if (existingIndex < 0) return [...current, profile];
				return current.map((candidate, index) =>
					index === existingIndex ? profile : candidate,
				);
			});
			setSelectedProfileId(profile.id ?? null);
			setDraft(createRemoteEnvironmentDraft(profile));
		},
		[],
	);

	const persistDraft = useCallback(
		async (action: RemoteAction): Promise<RemoteEnvironmentProfile> => {
			const validationError = validateRemoteEnvironmentProfile(draft);
			if (validationError) {
				setFormError(validationError);
				throw new Error(validationError);
			}
			const normalized = normalizeRemoteEnvironmentProfile(draft);
			setFormError(null);
			setError(null);
			setBusyAction({ action, profileId: normalized.id ?? "new" });
			const result = await desktopClient.invoke<RemoteEnvironmentUpsertResult>(
				"upsert_remote_environment",
				{ profile: normalized },
			);
			profileIdOrThrow(result.profile);
			upsertLocalProfile(result.profile);
			return result.profile;
		},
		[draft, upsertLocalProfile],
	);

	const saveProfile = async () => {
		try {
			await persistDraft("save");
		} catch (saveError) {
			if (!validateRemoteEnvironmentProfile(draft)) {
				setError(errorMessage(saveError));
			}
		} finally {
			setBusyAction(null);
		}
	};

	const testProfile = async () => {
		let profile: RemoteEnvironmentProfile;
		try {
			profile = await persistDraft("test");
		} catch (saveError) {
			if (!validateRemoteEnvironmentProfile(draft)) {
				setError(errorMessage(saveError));
			}
			setBusyAction(null);
			return;
		}

		const profileId = profileIdOrThrow(profile);
		setRuntimeState(profileId, { test: "testing", message: undefined });
		setBusyAction({ action: "test", profileId });
		try {
			const result = await desktopClient.invoke<RemoteEnvironmentTestResult>(
				"test_remote_environment",
				{ id: profileId },
			);
			setRuntimeState(profileId, {
				test: result.status === "failed" ? "failed" : "passed",
				message: result.message,
				remotePlatform: result.remotePlatform,
				remoteArch: result.remoteArch,
			});
		} catch (testError) {
			setRuntimeState(profileId, {
				test: "failed",
				message: errorMessage(testError),
			});
		} finally {
			setBusyAction(null);
		}
	};

	const deleteProfile = async (profile: RemoteEnvironmentProfile) => {
		const profileId = profileIdOrThrow(profile);
		setBusyAction({ action: "delete", profileId });
		setError(null);
		try {
			await desktopClient.invoke<RemoteEnvironmentDeleteResult>(
				"delete_remote_environment",
				{ id: profileId },
			);
			const remaining = profiles.filter(
				(candidate) => candidate.id !== profileId,
			);
			setProfiles(remaining);
			setRuntimeStates((current) => {
				const next = { ...current };
				delete next[profileId];
				return next;
			});
			if (activeProfileId === profileId) setActiveProfileId(null);
			const nextProfile = remaining[0];
			if (nextProfile) selectProfile(nextProfile);
			else startNewProfile();
		} catch (deleteError) {
			setError(errorMessage(deleteError));
		} finally {
			setBusyAction(null);
			setDeleteTarget(null);
		}
	};

	return (
		<PageFrame>
			<PageHeader
				actions={
					<>
						<Button
							disabled={isBusy}
							onClick={startNewProfile}
							variant="outline"
						>
							<Plus />
							New host
						</Button>
						<Button
							aria-label="Refresh remote environments"
							disabled={isLoading || isBusy}
							onClick={() => void loadProfiles()}
							variant="outline"
						>
							<RefreshCw className={cn(isLoading && "animate-spin")} />
							Refresh
						</Button>
					</>
				}
				description="Save SSH hosts and verify access. Connect from the environment selector beside the workspace picker."
				icon={CloudCog}
				title="Remote environments"
			/>

			{error ? (
				<Alert className="mb-5" variant="destructive">
					<CircleAlert />
					<AlertTitle>Remote environment error</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			<div className="grid grid-cols-[minmax(16rem,0.75fr)_minmax(24rem,1.25fr)] gap-5 max-[960px]:grid-cols-1">
				<Card className="h-fit gap-4 py-5">
					<CardHeader className="px-5">
						<CardTitle>SSH hosts</CardTitle>
						<CardDescription>
							{profiles.length === 1
								? "1 configured environment"
								: `${profiles.length} configured environments`}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-2 px-3">
						{isLoading ? (
							<div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
								<Loader2 className="size-4 animate-spin" />
								Loading SSH hosts…
							</div>
						) : profiles.length === 0 ? (
							<PageEmptyState>
								No SSH hosts yet. Add the address for your first remote
								environment.
							</PageEmptyState>
						) : (
							profiles.map((profile) => {
								const runtime = runtimeStateFor(
									runtimeStates,
									profile.id,
									activeProfileId,
								);
								const isSelected = profile.id === selectedProfileId;
								const isActive = profile.id === activeProfileId;
								return (
									<button
										aria-current={isSelected ? "true" : undefined}
										className={cn(
											"w-full rounded-lg border border-transparent px-3 py-3 text-left transition-colors hover:bg-accent/60",
											isSelected && "border-border bg-accent",
										)}
										key={profile.id ?? `${profile.host}:${profile.port}`}
										onClick={() => selectProfile(profile)}
										type="button"
									>
										<div className="flex items-start justify-between gap-3">
											<div className="min-w-0">
												<p className="truncate text-sm font-medium text-foreground">
													{profile.name}
												</p>
												<p className="mt-1 truncate font-mono text-xs text-muted-foreground">
													{formatRemoteEnvironmentDestination(profile)}
												</p>
											</div>
											{isActive ? (
												<Badge
													className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
													variant="outline"
												>
													Active
												</Badge>
											) : runtime.connection === "connecting" ? (
												<Loader2 className="size-4 animate-spin text-muted-foreground" />
											) : null}
										</div>
									</button>
								);
							})
						)}
					</CardContent>
				</Card>

				<Card className="gap-5 py-5">
					<CardHeader className="px-5">
						<CardTitle>
							{selectedProfile
								? `Edit ${selectedProfile.name}`
								: "Add SSH host"}
						</CardTitle>
						<CardDescription>
							OpenSSH config aliases work in the host field. Explicit values
							here override matching SSH config values. v0 requires key-based or
							agent authentication; it cannot show an interactive password
							prompt.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-5 px-5">
						<div className="grid grid-cols-2 gap-4 max-[620px]:grid-cols-1">
							<div className="space-y-2">
								<Label htmlFor="remote-name">Name</Label>
								<Input
									disabled={isBusy}
									id="remote-name"
									onChange={(event) => updateDraft("name", event.target.value)}
									placeholder="Build server"
									value={draft.name}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="remote-host">SSH host</Label>
								<Input
									autoCapitalize="none"
									disabled={isBusy || hasSavedDestination}
									id="remote-host"
									onChange={(event) => updateDraft("host", event.target.value)}
									placeholder="dev.example.com or ssh-config-alias"
									spellCheck={false}
									value={draft.host}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="remote-user">User (optional)</Label>
								<Input
									autoCapitalize="none"
									disabled={isBusy || hasSavedDestination}
									id="remote-user"
									onChange={(event) => updateDraft("user", event.target.value)}
									placeholder="ubuntu"
									spellCheck={false}
									value={draft.user ?? ""}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="remote-port">Port</Label>
								<Input
									disabled={isBusy || hasSavedDestination}
									id="remote-port"
									max={65_535}
									min={1}
									onChange={(event) =>
										updateDraft(
											"port",
											event.target.value === ""
												? undefined
												: Number(event.target.value),
										)
									}
									placeholder="22 (from SSH config by default)"
									type="number"
									value={
										draft.port === undefined || Number.isNaN(draft.port)
											? ""
											: draft.port
									}
								/>
							</div>
						</div>
						{hasSavedDestination ? (
							<p className="text-xs text-muted-foreground">
								Create a new host to change the SSH host, user, or port.
							</p>
						) : null}

						<div className="space-y-2">
							<Label htmlFor="remote-identity">Identity file (optional)</Label>
							<Input
								disabled={isBusy}
								id="remote-identity"
								onChange={(event) =>
									updateDraft("identityFile", event.target.value)
								}
								placeholder="~/.ssh/id_ed25519"
								spellCheck={false}
								value={draft.identityFile ?? ""}
							/>
						</div>

						{formError ? (
							<p className="text-sm text-destructive">{formError}</p>
						) : null}

						<div className="rounded-lg border bg-muted/30 p-4">
							<div className="mb-3 flex items-center justify-between gap-3">
								<div className="flex items-center gap-2">
									<Server className="size-4 text-muted-foreground" />
									<p className="text-sm font-medium">Environment status</p>
								</div>
								{draft.id === activeProfileId ? (
									<Badge>Active</Badge>
								) : (
									<Badge variant="secondary">Inactive</Badge>
								)}
							</div>
							<div className="grid grid-cols-3 gap-x-5 gap-y-2 max-[620px]:grid-cols-1">
								<StatusBadge
									label="Connection"
									value={selectedRuntime.connection}
								/>
								<StatusBadge label="SSH test" value={selectedRuntime.test} />
								<StatusBadge
									label="Cline bootstrap"
									value={selectedRuntime.bootstrap}
								/>
							</div>
							{selectedRuntime.remotePlatform || selectedRuntime.remoteArch ? (
								<p className="mt-3 text-xs text-muted-foreground">
									Remote:{" "}
									{[selectedRuntime.remotePlatform, selectedRuntime.remoteArch]
										.filter(Boolean)
										.join(" · ")}
								</p>
							) : null}
							{selectedRuntime.message ? (
								<p
									className={cn(
										"mt-3 text-xs leading-5 text-muted-foreground",
										(selectedRuntime.connection === "error" ||
											selectedRuntime.test === "failed" ||
											selectedRuntime.bootstrap === "failed") &&
											"text-destructive",
									)}
								>
									{selectedRuntime.message}
								</p>
							) : null}
						</div>

						<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
							<div>
								{draft.id ? (
									<Button
										disabled={isBusy}
										onClick={() => setDeleteTarget(draft)}
										variant="ghost"
									>
										<Trash2 />
										Delete
									</Button>
								) : null}
							</div>
							<div className="flex flex-wrap justify-end gap-2">
								<Button
									disabled={isBusy}
									onClick={() => void saveProfile()}
									variant="outline"
								>
									{busyAction?.action === "save" ? (
										<Loader2 className="animate-spin" />
									) : null}
									Save
								</Button>
								<Button
									disabled={isBusy}
									onClick={() => void testProfile()}
									variant="outline"
								>
									{busyAction?.action === "test" ? (
										<Loader2 className="animate-spin" />
									) : null}
									Test connection
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			</div>

			<AlertDialog
				onOpenChange={(open) => {
					if (!open) setDeleteTarget(null);
				}}
				open={deleteTarget !== null}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete SSH host?</AlertDialogTitle>
						<AlertDialogDescription>
							{deleteTarget
								? `Delete “${deleteTarget.name}” from remote environments? Projects and Cline session data remain on the remote host.`
								: "Delete this SSH host from remote environments?"}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isBusy}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							className={buttonVariants({ variant: "destructive" })}
							disabled={isBusy || !deleteTarget}
							onClick={() => {
								if (deleteTarget) void deleteProfile(deleteTarget);
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
