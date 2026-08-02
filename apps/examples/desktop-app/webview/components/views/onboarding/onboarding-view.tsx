"use client";

import { AgentAurora } from "@cline/ui";
import {
	ArrowLeft,
	CheckCircle2,
	ExternalLink,
	KeyRound,
	Loader2,
	LogIn,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAccount } from "@/contexts/account-context";
import { OAUTH_MANAGED_PROVIDERS } from "@/hooks/chat-session/constants";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import {
	readModelSelectionStorageFromWindow,
	writeModelSelectionStorageToWindow,
} from "@/lib/model-selection";
import {
	fetchProviderCatalog,
	invalidateProviderCatalogCache,
} from "@/lib/provider-model-catalog";
import type { Provider } from "@/lib/provider-schema";

const CREATE_ACCOUNT_URL = "https://app.cline.bot";

export type OnboardingStep = "welcome" | "connect" | "done";

type OnboardingConnection =
	| { kind: "cline" }
	| { kind: "provider"; providerName: string };

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
 * providers (Cline itself, ChatGPT, OCA) are excluded because they have
 * dedicated sign-in paths, providers needing more than an API key are
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

function OnboardingCard({
	children,
	wide = false,
}: {
	children: React.ReactNode;
	wide?: boolean;
}) {
	return (
		<div
			className={
				wide
					? "relative z-10 w-full max-w-130 rounded-3xl border border-border/50 bg-background/80 p-8 shadow-2xl backdrop-blur-2xl max-[720px]:p-6"
					: "relative z-10 w-full max-w-105 rounded-3xl border border-border/50 bg-background/80 p-8 shadow-2xl backdrop-blur-2xl max-[720px]:p-6"
			}
		>
			{children}
		</div>
	);
}

function WelcomeStep({ onContinue }: { onContinue: () => void }) {
	return (
		<OnboardingCard>
			<div className="flex flex-col items-center py-4 text-center">
				<img
					alt=""
					aria-hidden="true"
					className="h-28 w-auto drop-shadow-[0_16px_32px_color-mix(in_oklab,var(--brand-violet)_35%,transparent)]"
					draggable={false}
					height={477}
					src="/cline-logo-glass.png"
					width={486}
				/>
				<h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">
					Cline
				</h1>
				<p className="mt-2 text-[15px] text-muted-foreground">
					Build software your way
				</p>
				<Button
					className="mt-9 h-11 w-full rounded-full text-[15px]"
					onClick={onContinue}
					type="button"
				>
					Get started
				</Button>
				<p className="mt-4 text-xs text-muted-foreground">
					Takes less than a minute. Everything can be changed later in Settings.
				</p>
			</div>
		</OnboardingCard>
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

	const [showClineKeyForm, setShowClineKeyForm] = useState(false);
	const [clineApiKey, setClineApiKey] = useState("");
	const [clineKeySaving, setClineKeySaving] = useState(false);
	const [clineKeyError, setClineKeyError] = useState<string | null>(null);

	const [showApiKeyForm, setShowApiKeyForm] = useState(false);
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
				setProvidersError(
					error instanceof Error ? error.message : String(error),
				);
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
			setSignInError(error instanceof Error ? error.message : String(error));
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
				await desktopClient.invoke("cline_account", {
					action: "clineAccount",
					operation: "fetchMe",
				});
			} catch (verifyError) {
				// Roll back the persisted key so an unusable credential does
				// not linger in provider settings.
				await desktopClient
					.invoke("save_provider_settings", {
						provider: "cline",
						api_key: "",
					})
					.catch(() => undefined);
				const message =
					verifyError instanceof Error
						? verifyError.message
						: String(verifyError);
				throw new Error(`the key could not be verified (${message})`);
			}
			rememberProviderSelection({ id: "cline" });
			await refreshAccount();
			onConnected({ kind: "cline" });
		} catch (error) {
			setClineKeyError(error instanceof Error ? error.message : String(error));
		} finally {
			// Credentials may have been saved (or rolled back); drop the
			// short-lived catalog cache so consumers reload the persisted state.
			invalidateProviderCatalogCache();
			setClineKeySaving(false);
		}
	}, [clineApiKey, onConnected, refreshAccount]);

	const selectedProvider =
		providers.find((provider) => provider.id === selectedProviderId) ?? null;

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
			rememberProviderSelection(selectedProvider);
			onConnected({
				kind: "provider",
				providerName: selectedProvider.name,
			});
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error));
		} finally {
			// Onboarding completion remounts the chat pane to reload provider
			// credentials; drop the short-lived catalog cache so that reload
			// sees the just-saved key rather than a pre-save copy.
			invalidateProviderCatalogCache();
			setSaving(false);
		}
	}, [apiKey, onConnected, selectedProvider]);

	return (
		<OnboardingCard wide>
			<div className="flex items-center gap-2">
				<Button
					aria-label="Back"
					className="-ml-2 size-8 rounded-full p-0 text-muted-foreground"
					onClick={onBack}
					type="button"
					variant="ghost"
				>
					<ArrowLeft className="size-4" />
				</Button>
				<h1 className="text-2xl font-semibold tracking-tight text-foreground">
					Set up Cline
				</h1>
			</div>
			<p className="mt-2 text-sm text-muted-foreground">
				Choose how Cline connects to a model. You can add more providers anytime
				in Settings.
			</p>

			<div className="mt-6 flex flex-col gap-3">
				{/* Cline account */}
				<div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
					<div className="flex items-center gap-2">
						<p className="text-[15px] font-semibold text-foreground">
							Sign in with Cline
						</p>
						<Badge className="bg-primary/15 text-primary" variant="secondary">
							Recommended
						</Badge>
					</div>
					<p className="mt-1 text-sm text-muted-foreground">
						Latest models with regular free promos. No API keys needed.
					</p>
					{user ? (
						<div className="mt-3 flex flex-wrap items-center justify-between gap-2">
							<p className="text-sm text-foreground">
								Signed in as{" "}
								<span className="font-medium">
									{user.displayName || user.email}
								</span>
							</p>
							<Button
								className="rounded-full"
								onClick={() => {
									rememberProviderSelection({ id: "cline" });
									onConnected({ kind: "cline" });
								}}
								type="button"
							>
								Continue
							</Button>
						</div>
					) : (
						<div className="mt-3 flex flex-wrap items-center gap-3">
							<Button
								className="rounded-full"
								disabled={signingIn}
								onClick={() => void signInWithCline()}
								type="button"
							>
								{signingIn ? (
									<Loader2 className="size-4 animate-spin" />
								) : (
									<LogIn className="size-4" />
								)}
								{signingIn ? "Waiting for browser..." : "Sign in"}
							</Button>
							{signingIn ? (
								<button
									className="text-sm text-muted-foreground transition-colors hover:text-foreground"
									onClick={cancelSignInWithCline}
									type="button"
								>
									Cancel
								</button>
							) : (
								<button
									className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
									onClick={() => void openExternalUrl(CREATE_ACCOUNT_URL)}
									type="button"
								>
									Create account
									<ExternalLink className="size-3.5" />
								</button>
							)}
						</div>
					)}
					{signInError ? (
						<p className="mt-2 text-xs text-destructive" role="alert">
							Sign in failed: {signInError}
						</p>
					) : null}
					{!user ? (
						<div className="mt-3">
							<button
								aria-expanded={showClineKeyForm}
								className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
								onClick={() => setShowClineKeyForm((current) => !current)}
								type="button"
							>
								{showClineKeyForm
									? "Hide Cline API key"
									: "Use a Cline API key instead"}
							</button>
							{showClineKeyForm ? (
								<div className="mt-3 flex flex-col gap-2">
									<div className="flex flex-wrap items-center gap-2">
										<Input
											aria-label="Cline API key"
											autoComplete="off"
											className="min-w-52 flex-1 bg-background"
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
											className="rounded-full"
											disabled={!clineApiKey.trim() || clineKeySaving}
											onClick={() => void connectWithClineApiKey()}
											type="button"
										>
											{clineKeySaving ? (
												<Loader2 className="size-4 animate-spin" />
											) : null}
											{clineKeySaving ? "Connecting..." : "Connect"}
										</Button>
									</div>
									<p className="text-xs text-muted-foreground">
										Find your key in the Cline dashboard under Account.
									</p>
									{clineKeyError ? (
										<p className="text-xs text-destructive" role="alert">
											Failed to save API key: {clineKeyError}
										</p>
									) : null}
								</div>
							) : null}
						</div>
					) : null}
				</div>

				{/* Bring your own key */}
				<div className="rounded-2xl border border-border/70 bg-background/60 p-4">
					<button
						aria-expanded={showApiKeyForm}
						className="flex w-full items-start gap-3 text-left"
						onClick={() => setShowApiKeyForm((current) => !current)}
						type="button"
					>
						<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
							<KeyRound className="size-4" />
						</span>
						<span className="min-w-0">
							<span className="block text-[15px] font-semibold text-foreground">
								Use your own API key
							</span>
							<span className="mt-0.5 block text-sm text-muted-foreground">
								Anthropic, OpenAI, OpenRouter, and more.
							</span>
						</span>
					</button>
					{showApiKeyForm ? (
						<div className="mt-4 flex flex-col gap-3">
							{providersError ? (
								<p className="text-xs text-destructive" role="alert">
									Failed to load providers: {providersError}
								</p>
							) : (
								<Select
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
							<div className="flex flex-wrap items-center justify-between gap-2">
								{selectedProvider?.docUrl ? (
									<button
										className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
										onClick={() =>
											void openExternalUrl(selectedProvider.docUrl ?? "")
										}
										type="button"
									>
										{selectedProvider.docLabel || "Get an API key"}
										<ExternalLink className="size-3.5" />
									</button>
								) : (
									<span />
								)}
								<Button
									className="rounded-full"
									disabled={!selectedProvider || !apiKey.trim() || saving}
									onClick={() => void connectProvider()}
									type="button"
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
					) : null}
				</div>
			</div>

			<div className="mt-5 flex justify-center">
				<button
					className="text-sm text-muted-foreground transition-colors hover:text-foreground"
					onClick={onSkip}
					type="button"
				>
					Skip for now
				</button>
			</div>
		</OnboardingCard>
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
		<OnboardingCard>
			<div className="flex flex-col items-center py-4 text-center">
				<CheckCircle2 aria-hidden="true" className="size-10 text-primary" />
				<h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">
					You&apos;re all set
				</h1>
				<p className="mt-2 text-sm text-muted-foreground">
					{connection?.kind === "provider"
						? `${connection.providerName} is connected. Pick a project and start your first session.`
						: "Your Cline account is connected. Pick a project and start your first session."}
				</p>
				<Button
					className="mt-8 h-11 w-full rounded-full text-[15px]"
					onClick={onFinish}
					type="button"
				>
					Start building
				</Button>
			</div>
		</OnboardingCard>
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
		<div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-background p-6">
			<AgentAurora />
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
	);
}
