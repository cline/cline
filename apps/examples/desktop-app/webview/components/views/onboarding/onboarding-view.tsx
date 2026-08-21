"use client";

import { Button, IconButton } from "@cline/ui";
import {
	ArrowLeft,
	CheckCircle2,
	ChevronDown,
	ExternalLink,
	KeyRound,
	Loader2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ClineLogo } from "@/components/cline-logo";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { WelcomeHero } from "@/components/views/chat/welcome-hero";
import { useAccount } from "@/contexts/account-context";
import { OAUTH_MANAGED_PROVIDERS } from "@/hooks/chat-session/constants";
import { isClineAccountNotAuthenticatedResult } from "@/lib/cline-account-state";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "@/lib/model-selection";
import {
	CLINE_DASHBOARD_URL,
	getProviderApiKeyUrl,
} from "@/lib/provider-key-urls";
import {
	fetchProviderCatalog,
	invalidateProviderCatalogCache,
} from "@/lib/provider-model-catalog";
import type { Provider } from "@/lib/provider-schema";
import { cn } from "@/lib/utils";

const CREATE_ACCOUNT_URL = "https://app.cline.bot";

export type OnboardingStep = "welcome" | "connect" | "done";

type OnboardingConnection =
	| { kind: "cline" }
	| { kind: "provider"; providerName: string };

type SetupMethod = "cline" | "api-key";

/**
 * Providers surfaced first in the bring-your-own-key picker. Everything else
 * from the catalog follows alphabetically.
 */
const PREFERRED_PROVIDER_ORDER = [
	"anthropic",
	"openai-native",
	"openrouter",
	"gemini",
	"xai",
	"groq",
	"mistral",
	"deepseek",
	"ollama",
];

/**
 * True when entering an API key is all the provider needs: it declares an
 * API-key config field and nothing beyond key/base-URL. Providers with
 * structured setup (Vertex `gcp.*`, Bedrock `aws.*`) or no API-key field at
 * all (Claude Code) would "connect" here without working, so they stay in
 * Settings where the full form lives. Missing metadata means the catalog
 * fell back to a plain API-key field.
 */
function isApiKeyOnlyProvider(provider: Provider): boolean {
	const fields = provider.configFields;
	if (!fields) {
		return true;
	}
	return (
		fields.some((field) => field.path === "apiKey") &&
		fields.every((field) => field.path === "apiKey" || field.path === "baseUrl")
	);
}

/**
 * Orders the provider catalog for the API-key setup step: OAuth-managed
 * providers (Cline itself, ClinePass, ChatGPT, OCA) are excluded because they
 * have dedicated sign-in paths, providers needing more than an API key are
 * excluded because this form only collects one, popular API-key providers
 * come first, and the rest follow alphabetically.
 */
export function sortProvidersForApiKeySetup(providers: Provider[]): Provider[] {
	const rank = (id: string) => {
		const index = PREFERRED_PROVIDER_ORDER.indexOf(id);
		return index === -1 ? PREFERRED_PROVIDER_ORDER.length : index;
	};
	return providers
		.filter(
			(provider) =>
				!OAUTH_MANAGED_PROVIDERS.has(provider.id) &&
				isApiKeyOnlyProvider(provider),
		)
		.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
}

/**
 * Remembers the connected provider (and its default model when known) so the
 * chat composer opens pointed at what the user just set up.
 */
function rememberProviderSelection(provider: {
	id: string;
	defaultModelId?: string;
}): void {
	const selection = readModelSelectionStorageFromWindow();
	writeModelSelectionStorageToWindow({
		lastProvider: provider.id,
		lastModelByProvider: provider.defaultModelId
			? {
					...selection.lastModelByProvider,
					[provider.id]: provider.defaultModelId,
				}
			: selection.lastModelByProvider,
	});
}

function OnboardingContent({
	children,
	surface = "plain",
}: {
	children: React.ReactNode;
	surface?: "panel" | "plain" | "transparent";
}) {
	return (
		<div
			className={cn(
				"relative z-10 w-full max-w-148 rounded-2xl p-8 pb-6 max-[720px]:p-5",
				surface === "panel" && "border border-border bg-background",
				surface === "plain" && "bg-background",
				surface === "transparent" && "bg-transparent",
			)}
			data-onboarding-content={surface}
		>
			{children}
		</div>
	);
}

function SetupOptionCard({
	children,
	id,
	onSelect,
	selectLabel,
	selected,
}: {
	children: React.ReactNode;
	id: SetupMethod;
	onSelect: () => void;
	selectLabel: string;
	selected: boolean;
}) {
	const contentRef = useRef<HTMLDivElement>(null);
	const wasSelectedRef = useRef(selected);

	useEffect(() => {
		if (selected && !wasSelectedRef.current) {
			contentRef.current
				?.querySelector<HTMLElement>(
					'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
				)
				?.focus();
		}
		wasSelectedRef.current = selected;
	}, [selected]);

	return (
		<div
			className={cn(
				"relative rounded-xl border p-6 pb-8",
				selected
					? "border-primary/20 bg-primary/4 ring-1 ring-primary/20 ring-inset hover:bg-primary/8"
					: "border-border/70 hover:bg-surface-hover-lighter/60",
			)}
			data-onboarding-option={id}
			data-selected={selected}
		>
			{!selected ? (
				<button
					aria-label={selectLabel}
					className="absolute inset-0 z-10 cursor-pointer rounded-xl bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed"
					onClick={onSelect}
					type="button"
				/>
			) : null}
			<div
				data-onboarding-option-content
				inert={!selected ? true : undefined}
				ref={contentRef}
			>
				{children}
			</div>
		</div>
	);
}

function SetupOptionHeader({
	accessory,
	description,
	icon,
	title,
}: {
	accessory?: React.ReactNode;
	description: string;
	icon: React.ReactNode;
	title: string;
}) {
	return (
		<div className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4 text-left max-[720px]:gap-x-3 max-[720px]:gap-y-3">
			<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground/4 text-muted-foreground max-[720px]:mt-0">
				{icon}
			</span>
			<div className="min-w-0 mt-1 max-[720px]:col-span-3 max-[720px]:col-start-1 max-[720px]:row-start-2 max-[720px]:mt-0">
				<h4 className="text-lg font-semibold text-foreground">{title}</h4>
				<p className="mt-2 text-sm text-muted-foreground">{description}</p>
			</div>
			{accessory ? (
				<div className="mt-1 max-[720px]:col-start-3 max-[720px]:row-start-1 max-[720px]:mt-0">
					{accessory}
				</div>
			) : null}
		</div>
	);
}

function ExpandablePanel({
	children,
	className,
	expanded,
	...props
}: React.HTMLAttributes<HTMLDivElement> & {
	expanded: boolean;
}) {
	return (
		<div
			{...props}
			aria-hidden={!expanded}
			className={cn(
				"grid transition-[grid-template-rows,opacity] duration-120 ease-in-out motion-reduce:transition-none",
				expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
				className,
			)}
			data-expanded={expanded}
			inert={!expanded ? true : undefined}
		>
			<div className="min-h-0 overflow-hidden">{children}</div>
		</div>
	);
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
	return (
		<OnboardingContent surface="transparent">
			<div className="flex flex-col items-center py-4 text-center">
				<div className="w-full">
					<WelcomeHero variant="bot-only" />
				</div>
				<h1 className="mt-5 text-4xl font-semibold text-foreground">Cline</h1>
				<p className="mt-2 text-lg text-foreground">Build software your way</p>
				<p className="mt-6 text-md text-muted-foreground">
					Cline is an AI coding agent. It reads your code, edits files, runs
					commands, and works through tasks with you — in any project on your
					machine.
				</p>
				<Button
					className="mt-8 w-full max-w-64"
					onClick={onContinue}
					size="lg"
					tone="accent"
					type="button"
					variant="fill"
				>
					Get started
				</Button>
				<p className="mt-8 text-xs text-muted-foreground">
					Takes less than a minute. Everything can be changed later in Settings.
				</p>
			</div>
		</OnboardingContent>
	);
}

function ConnectStep({
	onBack,
	onConnected,
	onSkip,
}: {
	onBack: () => void;
	onConnected: (connection: OnboardingConnection) => void;
	onSkip: () => void;
}) {
	const { user, refreshAccount } = useAccount();
	const [signingIn, setSigningIn] = useState(false);
	const [signInError, setSignInError] = useState<string | null>(null);
	const [clineApiKey, setClineApiKey] = useState("");
	const [clineKeySaving, setClineKeySaving] = useState(false);
	const [clineKeyError, setClineKeyError] = useState<string | null>(null);

	// Increments whenever the user cancels a pending browser sign-in so a
	// stale OAuth round-trip (which can dangle until the transport timeout)
	// cannot advance or error the UI after the user has moved on.
	const signInAttemptRef = useRef(0);

	const signInWithCline = useCallback(async () => {
		signInAttemptRef.current += 1;
		const attempt = signInAttemptRef.current;
		setSigningIn(true);
		setSignInError(null);
		try {
			await desktopClient.invoke("run_provider_oauth_login", {
				provider: "cline",
			});
			if (signInAttemptRef.current !== attempt) {
				// The sign-in completed after the user cancelled but before the
				// backend processed the cancellation, so credentials were saved.
				// Refresh the account so the card reflects the real signed-in
				// state instead of silently diverging from disk.
				void refreshAccount();
				return;
			}
			rememberProviderSelection({ id: "cline" });
			await refreshAccount();
			onConnected({ kind: "cline" });
		} catch (error) {
			if (signInAttemptRef.current !== attempt) {
				return;
			}
			setSignInError(getErrorMessage(error));
		} finally {
			// The login may have persisted credentials; drop the short-lived
			// catalog cache so the app reloads them instead of a pre-save copy.
			invalidateProviderCatalogCache();
			if (signInAttemptRef.current === attempt) {
				setSigningIn(false);
			}
		}
	}, [onConnected, refreshAccount]);

	const cancelSignInWithCline = useCallback(() => {
		signInAttemptRef.current += 1;
		setSigningIn(false);
		// Cancel the backend browser round-trip so a later-completed
		// authorization in the abandoned tab can never persist credentials.
		// Retry transient delivery failures; if the transport itself is gone,
		// the sidecar cancels pending logins when the connection closes.
		void (async () => {
			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					await desktopClient.invoke("cancel_provider_oauth_login", {
						provider: "cline",
					});
					return;
				} catch {
					await new Promise((resolve) =>
						setTimeout(resolve, 250 * (attempt + 1)),
					);
				}
			}
		})();
	}, []);

	const connectWithClineApiKey = useCallback(async () => {
		const key = clineApiKey.trim();
		if (!key) {
			return;
		}
		setClineKeySaving(true);
		setClineKeyError(null);
		try {
			await desktopClient.invoke("save_provider_settings", {
				provider: "cline",
				enabled: true,
				api_key: key,
			});
			// Verify the key against the account API before advancing; the
			// account context swallows errors, so an invalid key would
			// otherwise onboard the user into a broken signed-in state.
			try {
				const verified = await desktopClient.invoke("cline_account", {
					action: "clineAccount",
					operation: "fetchMe",
				});
				// A typed not-authenticated result means the sidecar found no
				// usable credential after the save — the key did not stick.
				if (isClineAccountNotAuthenticatedResult(verified)) {
					throw new Error("no Cline account credentials were found");
				}
			} catch (verifyError) {
				// Roll back the persisted key so an unusable credential does
				// not linger in provider settings.
				await desktopClient
					.invoke("save_provider_settings", {
						provider: "cline",
						api_key: "",
					})
					.catch(() => undefined);
				throw new Error(
					`the key could not be verified (${getErrorMessage(verifyError)})`,
				);
			}
			rememberProviderSelection({ id: "cline" });
			await refreshAccount();
			onConnected({ kind: "cline" });
		} catch (error) {
			setClineKeyError(getErrorMessage(error));
		} finally {
			// Credentials may have been saved (or rolled back); drop the
			// short-lived catalog cache so consumers reload the persisted state.
			invalidateProviderCatalogCache();
			setClineKeySaving(false);
		}
	}, [clineApiKey, onConnected, refreshAccount]);

	const clineBusy = signingIn || clineKeySaving;

	const [providers, setProviders] = useState<Provider[]>([]);
	const [providersLoading, setProvidersLoading] = useState(true);
	const [providersError, setProvidersError] = useState<string | null>(null);
	const [selectedProviderId, setSelectedProviderId] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		async function loadProviders() {
			try {
				const payload = await fetchProviderCatalog();
				if (cancelled) {
					return;
				}
				setProviders(sortProvidersForApiKeySetup(payload.providers ?? []));
				setProvidersError(null);
			} catch (error) {
				if (cancelled) {
					return;
				}
				setProvidersError(getErrorMessage(error));
			} finally {
				if (!cancelled) {
					setProvidersLoading(false);
				}
			}
		}
		void loadProviders();
		return () => {
			cancelled = true;
		};
	}, []);

	const selectedProvider =
		providers.find((provider) => provider.id === selectedProviderId) ?? null;
	const selectedProviderKeyUrl = selectedProvider
		? getProviderApiKeyUrl(selectedProvider)
		: null;

	const connectProvider = useCallback(async () => {
		if (!selectedProvider || !apiKey.trim()) {
			return;
		}
		setSaving(true);
		setSaveError(null);
		try {
			await desktopClient.invoke("save_provider_settings", {
				provider: selectedProvider.id,
				enabled: true,
				api_key: apiKey.trim(),
			});
			rememberProviderSelection({
				id: selectedProviderId,
				defaultModelId: selectedProvider.defaultModelId,
			});
			onConnected({
				kind: "provider",
				providerName: selectedProvider.name,
			});
		} catch (error) {
			setSaveError(getErrorMessage(error));
		} finally {
			// Onboarding completion remounts the chat pane to reload provider
			// credentials; drop the short-lived catalog cache so that reload
			// sees the just-saved key rather than a pre-save copy.
			invalidateProviderCatalogCache();
			setSaving(false);
		}
	}, [apiKey, onConnected, selectedProvider, selectedProviderId]);

	const [selectedMethod, setSelectedMethod] = useState<SetupMethod>("cline");
	const [clineKeyFormExpanded, setClineKeyFormExpanded] = useState(false);

	return (
		<OnboardingContent surface="panel">
			<div className="flex flex-col">
				<IconButton
					aria-label="Back"
					className="-ml-2"
					onClick={onBack}
					size="md"
					tone="neutral"
					type="button"
					variant="ghost"
				>
					<ArrowLeft className="size-4" />
				</IconButton>
				<h1 className="mt-6 text-2xl font-semibold tracking-tight text-foreground">
					Set up Cline
				</h1>
				<p className="mt-4 text-sm text-muted-foreground">
					Choose how Cline connects to models. You can add more providers
					anytime in Settings.
				</p>
			</div>

			<div className="mt-8 flex flex-col gap-3">
				<SetupOptionCard
					id="cline"
					onSelect={() => setSelectedMethod("cline")}
					selectLabel="Sign in with Cline"
					selected={selectedMethod === "cline"}
				>
					<SetupOptionHeader
						accessory={
							<Badge
								className="-mt-2 rounded-sm border-primary/30 bg-primary/10 px-1.5 !pt-[0.3rem] !pb-[0.2rem] text-primary-emphasis"
								variant="outline"
							>
								Recommended
							</Badge>
						}
						description="Latest models with regular free promos. No API keys needed."
						icon={<ClineLogo className="size-5" />}
						title="Sign in with Cline"
					/>
					{user ? (
						<div className="mt-6 flex flex-wrap items-center justify-end gap-6">
							<p className="text-sm text-muted-foreground">
								Signed in as{" "}
								<span className="font-medium">
									{user.displayName || user.email}
								</span>
							</p>
							<Button
								onClick={() => {
									rememberProviderSelection({ id: "cline" });
									onConnected({ kind: "cline" });
								}}
								size="md"
								tone="accent"
								type="button"
								variant="fill"
							>
								Continue
							</Button>
						</div>
					) : (
						<div className="mt-8 ml-12 flex flex-wrap items-center gap-1 max-[720px]:ml-0">
							<Button
								disabled={clineBusy}
								onClick={() => void signInWithCline()}
								size="md"
								tone="accent"
								type="button"
								variant="fill"
							>
								{signingIn && <Loader2 className="size-4 animate-spin" />}
								{signingIn ? "Waiting for browser..." : "Sign in"}
							</Button>
							{signingIn ? (
								<Button
									onClick={cancelSignInWithCline}
									size="md"
									tone="neutral"
									type="button"
									variant="ghost"
								>
									Cancel
								</Button>
							) : (
								<Button
									onClick={() => void openExternalUrl(CREATE_ACCOUNT_URL)}
									size="md"
									tone="neutral"
									type="button"
									variant="ghost"
								>
									Sign up
								</Button>
							)}
						</div>
					)}
					{signInError ? (
						<p
							className="mt-6 ml-12 text-xs text-destructive max-[720px]:ml-0"
							role="alert"
						>
							Sign in failed: {signInError}
						</p>
					) : null}
					{!user ? (
						<div className="mt-6 ml-10 -mb-2 max-[720px]:ml-0">
							<Button
								aria-controls="onboarding-cline-key-form"
								aria-expanded={clineKeyFormExpanded}
								disabled={clineBusy}
								onClick={() => {
									setSelectedMethod("cline");
									setClineKeyFormExpanded(!clineKeyFormExpanded);
								}}
								size="xs"
								tone="neutral"
								type="button"
								variant="ghost"
							>
								Use a Cline API key
								<ChevronDown aria-hidden="true" className="size-3.5" />
							</Button>
							<ExpandablePanel
								data-onboarding-cline-key-form
								expanded={clineKeyFormExpanded}
								id="onboarding-cline-key-form"
							>
								<div className="flex flex-col gap-2 pt-3 ml-2 max-[720px]:ml-0">
									<div className="flex flex-wrap items-center gap-2">
										<Input
											aria-label="Cline API key"
											autoComplete="off"
											className="min-w-52 flex-1 bg-background"
											disabled={clineKeySaving}
											onChange={(event) => {
												setClineApiKey(event.target.value);
												setClineKeyError(null);
											}}
											onKeyDown={(event) => {
												if (
													event.key === "Enter" &&
													clineApiKey.trim() &&
													!clineKeySaving
												) {
													void connectWithClineApiKey();
												}
											}}
											placeholder="Cline API key"
											type="password"
											value={clineApiKey}
										/>
										<Button
											disabled={!clineApiKey.trim() || clineKeySaving}
											onClick={() => void connectWithClineApiKey()}
											size="md"
											tone="accent"
											type="button"
											variant="fill"
										>
											{clineKeySaving ? (
												<Loader2 className="size-4 animate-spin" />
											) : null}
											{clineKeySaving ? "Connecting..." : "Connect"}
										</Button>
									</div>
									<Button
										className="self-start -ml-1 mt-1"
										disabled={clineKeySaving}
										onClick={() => void openExternalUrl(CLINE_DASHBOARD_URL)}
										size="xs"
										tone="neutral"
										type="button"
										variant="ghost"
									>
										Find your key
										<ExternalLink className="size-3" />
									</Button>
									{clineKeyError ? (
										<p className="text-xs text-destructive" role="alert">
											Failed to save API key: {clineKeyError}
										</p>
									) : null}
								</div>
							</ExpandablePanel>
						</div>
					) : null}
				</SetupOptionCard>
				<SetupOptionCard
					id="api-key"
					onSelect={() => {
						setSelectedMethod("api-key");
						setClineKeyFormExpanded(false);
					}}
					selectLabel="Use your own API key"
					selected={selectedMethod === "api-key"}
				>
					<SetupOptionHeader
						description="Anthropic, OpenAI, OpenRouter, and more."
						icon={<KeyRound className="size-4" />}
						title="Use your own API key"
					/>
					<ExpandablePanel
						data-onboarding-api-key-form
						expanded={selectedMethod === "api-key"}
					>
						<div className="flex flex-col gap-3 pt-6">
							{providersError ? (
								<p className="text-xs text-destructive" role="alert">
									Failed to load providers: {providersError}
								</p>
							) : (
								<Select
									disabled={saving}
									onValueChange={(value) => {
										setSelectedProviderId(value);
										setSaveError(null);
									}}
									value={selectedProviderId || undefined}
								>
									<SelectTrigger
										aria-label="Provider"
										className="w-full bg-background"
									>
										<SelectValue
											placeholder={
												providersLoading
													? "Loading providers..."
													: "Choose a provider"
											}
										/>
									</SelectTrigger>
									<SelectContent>
										{providers.map((provider) => (
											<SelectItem key={provider.id} value={provider.id}>
												{provider.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
							<Input
								aria-label="API key"
								autoComplete="off"
								className="bg-background"
								disabled={saving}
								onChange={(event) => {
									setApiKey(event.target.value);
									setSaveError(null);
								}}
								placeholder={
									selectedProvider
										? `${selectedProvider.name} API key`
										: "API key"
								}
								type="password"
								value={apiKey}
							/>
							<div className="flex flex-wrap items-center justify-end gap-2">
								{selectedProvider && selectedProviderKeyUrl ? (
									<Button
										className="mr-auto"
										disabled={saving}
										onClick={() => void openExternalUrl(selectedProviderKeyUrl)}
										size="xs"
										tone="neutral"
										type="button"
										variant="ghost"
									>
										{selectedProvider.docLabel ||
											`Get a ${selectedProvider.name} API key`}
										<ExternalLink className="size-3.5" />
									</Button>
								) : null}
								<Button
									disabled={!selectedProvider || !apiKey.trim() || saving}
									onClick={() => void connectProvider()}
									size="md"
									tone="accent"
									type="button"
									variant="fill"
								>
									{saving ? <Loader2 className="size-4 animate-spin" /> : null}
									{saving ? "Connecting..." : "Connect"}
								</Button>
							</div>
							{saveError ? (
								<p className="text-xs text-destructive" role="alert">
									Failed to save provider: {saveError}
								</p>
							) : null}
						</div>
					</ExpandablePanel>
				</SetupOptionCard>
			</div>

			<div className="mt-5 flex justify-center">
				<Button
					onClick={onSkip}
					size="sm"
					tone="neutral"
					type="button"
					variant="ghost"
				>
					Skip
				</Button>
			</div>
		</OnboardingContent>
	);
}

function DoneStep({
	connection,
	onFinish,
}: {
	connection: OnboardingConnection | null;
	onFinish: () => void;
}) {
	return (
		<OnboardingContent surface="transparent">
			<div className="flex flex-col items-center py-4 text-center">
				<CheckCircle2 aria-hidden="true" className="size-10 text-primary" />
				<h1 className="mt-4 text-3xl font-semibold tracking-tight text-foreground">
					You&apos;re all set
				</h1>
				<p className="mt-3 text-md text-muted-foreground">
					{connection?.kind === "provider"
						? `${connection.providerName} is connected.`
						: "Your Cline account is connected."}
				</p>
				<Button
					className="mt-8 w-full max-w-64"
					onClick={onFinish}
					size="lg"
					tone="accent"
					type="button"
					variant="fill"
				>
					Start building
				</Button>
			</div>
		</OnboardingContent>
	);
}

/**
 * Full-screen first-run experience: welcome, connect a model provider (Cline
 * account or bring-your-own API key), done. Rendered by the app shell while
 * onboarding has not been completed (see lib/onboarding.ts); `onComplete`
 * marks it completed and returns to the chat.
 */
export function OnboardingView({
	onComplete,
	initialStep = "welcome",
}: {
	onComplete: () => void;
	initialStep?: OnboardingStep;
}) {
	const [step, setStep] = useState<OnboardingStep>(initialStep);
	const [connection, setConnection] = useState<OnboardingConnection | null>(
		null,
	);

	return (
		<div className="relative h-full w-full overflow-y-auto bg-background">
			<div className="relative flex min-h-full w-full items-center justify-center overflow-hidden p-6">
				<div
					className={
						step === "done"
							? "pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2"
							: "pointer-events-none absolute inset-0"
					}
					data-onboarding-grid={step}
				>
					<WelcomeHero
						interactive={step !== "done"}
						layout={step === "done" ? "wide-grid" : "full-bleed"}
						variant="grid-only"
					/>
				</div>
				{step === "welcome" ? (
					<WelcomeStep onContinue={() => setStep("connect")} />
				) : step === "connect" ? (
					<ConnectStep
						onBack={() => setStep("welcome")}
						onConnected={(nextConnection) => {
							setConnection(nextConnection);
							setStep("done");
						}}
						onSkip={onComplete}
					/>
				) : (
					<DoneStep connection={connection} onFinish={onComplete} />
				)}
			</div>
		</div>
	);
}
