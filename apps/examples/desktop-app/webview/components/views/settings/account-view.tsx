"use client";

import type {
	ClineAccountBalance,
	ClineAccountOrganization,
	ClineAccountOrganizationBalance,
	ClineAccountOrganizationUsageTransaction,
	ClineAccountPaymentTransaction,
	ClineAccountUsageTransaction,
	ClineAccountUser,
} from "@cline/core";
import {
	AlertCircle,
	Building,
	CreditCard,
	ExternalLink,
	Loader2,
	LogIn,
	LogOut,
	Plus,
	Receipt,
	RefreshCw,
	User,
	UserCircleIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAccount } from "@/contexts/account-context";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";
import { cn } from "@/lib/utils";

const DASHBOARD_URL = "https://app.cline.bot/dashboard";
const USER_CREDITS_URL =
	"https://app.cline.bot/dashboard/account?tab=credits&redirect=true";
const ORGANIZATION_CREDITS_URL =
	"https://app.cline.bot/dashboard/organization?tab=credits&redirect=true";
const CREATE_ORGANIZATION_URL = "https://app.cline.bot/onboarding?step=1";
const CREATE_ACCOUNT_URL = "https://app.cline.bot";

function normalizeAccountViewError(error: unknown): Error {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("unsupported desktop command: cline_account")) {
		return new Error(
			"The desktop sidecar is running an older build that does not support account commands. Restart the sidecar or reload the app, then try again.",
		);
	}
	return error instanceof Error ? error : new Error(message);
}

function isAccountAuthError(message: string): boolean {
	const normalized = message.toLowerCase();
	return (
		normalized.includes("no cline account auth token found") ||
		normalized.includes("requires re-authentication") ||
		normalized.includes("auth token") ||
		normalized.includes("unauthorized")
	);
}

// ---------------------------------------------------------------------------
// Data fetching helpers via sidecar command
// ---------------------------------------------------------------------------

async function fetchAccountUser(): Promise<ClineAccountUser> {
	return await desktopClient.invoke<ClineAccountUser>("cline_account", {
		action: "clineAccount",
		operation: "fetchMe",
	});
}

async function fetchAccountBalance(): Promise<ClineAccountBalance> {
	return await desktopClient.invoke<ClineAccountBalance>("cline_account", {
		action: "clineAccount",
		operation: "fetchBalance",
	});
}

async function fetchAccountOrganizations(): Promise<
	ClineAccountOrganization[]
> {
	return await desktopClient.invoke<ClineAccountOrganization[]>(
		"cline_account",
		{
			action: "clineAccount",
			operation: "fetchUserOrganizations",
		},
	);
}

async function fetchOrganizationBalance(
	organizationId: string,
): Promise<ClineAccountOrganizationBalance> {
	return await desktopClient.invoke<ClineAccountOrganizationBalance>(
		"cline_account",
		{
			action: "clineAccount",
			operation: "fetchOrganizationBalance",
			organizationId,
		},
	);
}

async function fetchUsageTransactions(): Promise<
	ClineAccountUsageTransaction[]
> {
	return await desktopClient.invoke<ClineAccountUsageTransaction[]>(
		"cline_account",
		{
			action: "clineAccount",
			operation: "fetchUsageTransactions",
		},
	);
}

async function fetchOrganizationUsageTransactions(
	organizationId: string,
	memberId?: string,
): Promise<ClineAccountOrganizationUsageTransaction[]> {
	return await desktopClient.invoke<ClineAccountOrganizationUsageTransaction[]>(
		"cline_account",
		{
			action: "clineAccount",
			operation: "fetchOrganizationUsageTransactions",
			organizationId,
			...(memberId?.trim() ? { memberId: memberId.trim() } : {}),
		},
	);
}

async function fetchPaymentTransactions(): Promise<
	ClineAccountPaymentTransaction[]
> {
	return await desktopClient.invoke<ClineAccountPaymentTransaction[]>(
		"cline_account",
		{
			action: "clineAccount",
			operation: "fetchPaymentTransactions",
		},
	);
}

async function switchActiveAccount(
	organizationId: string | null,
): Promise<void> {
	await desktopClient.invoke("cline_account", {
		action: "clineAccount",
		operation: "switchAccount",
		organizationId,
	});
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AccountView() {
	const [activeTab, setActiveTab] = useState<"overview" | "usage" | "billing">(
		"overview",
	);
	const { refreshAccount } = useAccount();

	// Overview data
	const [user, setUser] = useState<ClineAccountUser | null>(null);
	const [balance, setBalance] = useState<ClineAccountBalance | null>(null);
	const [organizationBalance, setOrganizationBalance] =
		useState<ClineAccountOrganizationBalance | null>(null);
	const [organizations, setOrganizations] = useState<
		ClineAccountOrganization[]
	>([]);
	const [overviewLoading, setOverviewLoading] = useState(true);
	const [overviewError, setOverviewError] = useState<string | null>(null);
	const [accountActionPending, setAccountActionPending] = useState<
		"sign-in" | "sign-out" | null
	>(null);
	// Organization id being switched to, "" while switching to the personal
	// account, null when no switch is in flight.
	const [switchTargetId, setSwitchTargetId] = useState<string | null>(null);

	// Usage data
	const [usageTransactions, setUsageTransactions] = useState<
		ClineAccountUsageTransaction[]
	>([]);
	const [usageLoading, setUsageLoading] = useState(false);
	const [usageError, setUsageError] = useState<string | null>(null);
	const [usageLoaded, setUsageLoaded] = useState(false);
	const usageGenerationRef = useRef(0);

	// Billing data
	const [paymentTransactions, setPaymentTransactions] = useState<
		ClineAccountPaymentTransaction[]
	>([]);
	const [billingLoading, setBillingLoading] = useState(false);
	const [billingError, setBillingError] = useState<string | null>(null);
	const [billingLoaded, setBillingLoaded] = useState(false);
	const activeOrganization = organizations.find((org) => org.active) ?? null;

	const resetAccountData = useCallback(() => {
		setUser(null);
		setBalance(null);
		setOrganizationBalance(null);
		setOrganizations([]);
		setUsageTransactions([]);
		setUsageLoaded(false);
		setUsageError(null);
		setPaymentTransactions([]);
		setBillingLoaded(false);
		setBillingError(null);
	}, []);

	// -- Overview fetch --
	const loadOverview = useCallback(async () => {
		setOverviewLoading(true);
		setOverviewError(null);
		try {
			const [userData, balanceData, orgsData] = await Promise.all([
				fetchAccountUser(),
				fetchAccountBalance(),
				fetchAccountOrganizations(),
			]);
			const nextActiveOrganization =
				orgsData.find((organization) => organization.active) ?? null;
			const organizationBalanceData = nextActiveOrganization
				? await fetchOrganizationBalance(nextActiveOrganization.organizationId)
				: null;
			setUser(userData);
			setBalance(balanceData);
			setOrganizationBalance(organizationBalanceData);
			setOrganizations(orgsData);
		} catch (err) {
			resetAccountData();
			const message = normalizeAccountViewError(err).message;
			setOverviewError(message);
		} finally {
			setOverviewLoading(false);
		}
	}, [resetAccountData]);

	useEffect(() => {
		void loadOverview();
	}, [loadOverview]);

	const signIn = async () => {
		setAccountActionPending("sign-in");
		setOverviewError(null);
		try {
			await desktopClient.invoke("run_provider_oauth_login", {
				provider: "cline",
			});
			await loadOverview();
			setActiveTab("overview");
		} catch (err) {
			const message = normalizeAccountViewError(err).message;
			setOverviewError(message);
			resetAccountData();
		} finally {
			setAccountActionPending(null);
			void refreshAccount();
		}
	};

	const signOut = async () => {
		setAccountActionPending("sign-out");
		try {
			await desktopClient.invoke("save_provider_settings", {
				provider: "cline",
				api_key: "",
				settings: {
					auth: {
						accessToken: "",
						refreshToken: "",
						accountId: "",
					},
				},
			});
			resetAccountData();
			setActiveTab("overview");
			setOverviewError("No Cline account auth token found");
		} catch (err) {
			const message = normalizeAccountViewError(err).message;
			setOverviewError(message);
		} finally {
			setAccountActionPending(null);
			void refreshAccount();
		}
	};

	const switchAccount = async (organizationId: string | null) => {
		if (switchTargetId !== null) {
			return;
		}
		setSwitchTargetId(organizationId ?? "");
		try {
			await switchActiveAccount(organizationId);
			await loadOverview();
		} catch (err) {
			const message = normalizeAccountViewError(err).message;
			setOverviewError(message);
		} finally {
			setSwitchTargetId(null);
			void refreshAccount();
		}
	};

	// -- Usage fetch (lazy on tab switch) --
	const loadUsage = useCallback(async () => {
		const generation = usageGenerationRef.current;
		setUsageLoading(true);
		setUsageError(null);
		try {
			const data = activeOrganization
				? await fetchOrganizationUsageTransactions(
						activeOrganization.organizationId,
						activeOrganization.memberId,
					)
				: await fetchUsageTransactions();
			if (usageGenerationRef.current !== generation) return;
			setUsageTransactions(data);
			setUsageLoaded(true);
		} catch (err) {
			if (usageGenerationRef.current !== generation) return;
			const message = normalizeAccountViewError(err).message;
			setUsageError(message);
		} finally {
			if (usageGenerationRef.current === generation) {
				setUsageLoading(false);
			}
		}
	}, [activeOrganization]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: we need to reset usage state when the organization changes
	useEffect(() => {
		usageGenerationRef.current += 1;
		setUsageTransactions([]);
		setUsageLoaded(false);
		setUsageError(null);
	}, [activeOrganization?.organizationId]);

	useEffect(() => {
		if (activeTab === "usage" && !usageLoaded) {
			void loadUsage();
		}
	}, [activeTab, usageLoaded, loadUsage]);

	// -- Billing fetch (lazy on tab switch) --
	const loadBilling = useCallback(async () => {
		setBillingLoading(true);
		setBillingError(null);
		try {
			const data = await fetchPaymentTransactions();
			setPaymentTransactions(data);
			setBillingLoaded(true);
		} catch (err) {
			const message = normalizeAccountViewError(err).message;
			setBillingError(message);
		} finally {
			setBillingLoading(false);
		}
	}, []);

	useEffect(() => {
		if (activeTab === "billing" && !billingLoaded) {
			void loadBilling();
		}
	}, [activeTab, billingLoaded, loadBilling]);

	// -- Formatters --

	const formatDate = (dateStr: string) => {
		return new Date(dateStr).toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		});
	};

	const formatTime = (dateStr: string) => {
		return new Date(dateStr).toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
		});
	};

	const formatCreditBalance = (value: number, decimalPlaces = 2) => {
		return new Intl.NumberFormat("en-US", {
			minimumFractionDigits: decimalPlaces,
			maximumFractionDigits: decimalPlaces,
		}).format(value / 1_000_000);
	};

	const displayedBalance = activeOrganization
		? (organizationBalance?.balance ?? balance?.balance ?? null)
		: (balance?.balance ?? null);

	const tabs = ["overview", "usage", "billing"] as const;

	// -- Shared error / loading UI --

	const renderError = (message: string, onRetry: () => void) => (
		<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
			<AlertCircle className="h-8 w-8 text-destructive" />
			<p className="text-sm text-muted-foreground max-w-md">{message}</p>
			<button
				type="button"
				onClick={onRetry}
				className="flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
			>
				<RefreshCw className="h-4 w-4" />
				Retry
			</button>
		</div>
	);

	const renderSignedOut = () => (
		<div className="rounded-lg border border-border p-6">
			<div className="mx-auto flex max-w-xl flex-col items-center gap-4 py-8 text-center">
				<div className="flex size-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
					<UserCircleIcon className="h-6 w-6" />
				</div>
				<div>
					<h3 className="text-lg font-semibold text-foreground">
						Sign in to Cline
					</h3>
					<p className="mt-2 text-sm text-muted-foreground">
						Connect your Cline account to review credits, usage, billing, and
						organization details.
					</p>
				</div>
				<div className="flex flex-wrap items-center justify-center gap-2">
					<button
						type="button"
						disabled={accountActionPending !== null}
						onClick={() => void signIn()}
						className="flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
					>
						{accountActionPending === "sign-in" ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<LogIn className="h-4 w-4" />
						)}
						{accountActionPending === "sign-in" ? "Signing in" : "Sign in"}
					</button>
					<button
						type="button"
						onClick={() => void openExternalUrl(CREATE_ACCOUNT_URL)}
						className="flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
					>
						Create account
						<ExternalLink className="h-4 w-4" />
					</button>
				</div>
			</div>
		</div>
	);

	const renderLoading = () => (
		<div className="flex items-center justify-center py-12">
			<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
		</div>
	);

	const renderAccountRow = (input: {
		key: string;
		name: string;
		subtitle: string;
		icon: React.ReactNode;
		active: boolean;
		switching: boolean;
		onSelect: () => void;
	}) => (
		<button
			key={input.key}
			type="button"
			disabled={input.active || switchTargetId !== null}
			onClick={input.onSelect}
			className={cn(
				"flex w-full items-center gap-3 rounded-lg border border-border px-4 py-3 text-left transition-colors",
				input.active ? "cursor-default" : "hover:bg-accent/20",
				!input.active && switchTargetId !== null && "opacity-60",
			)}
		>
			<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-sm font-bold text-foreground">
				{input.icon}
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-medium text-foreground">{input.name}</p>
				<p className="text-xs text-muted-foreground capitalize">
					{input.subtitle}
				</p>
			</div>
			{input.switching ? (
				<Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
			) : input.active ? (
				<span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
					Active
				</span>
			) : (
				<span className="text-xs text-muted-foreground">Switch</span>
			)}
		</button>
	);

	return (
		<ScrollArea className="h-full">
			<div className="mx-auto max-w-3xl px-8 py-6">
				{/* Header */}
				<div className="mb-6 flex items-center justify-between">
					<h2 className="text-lg font-semibold text-foreground">Account</h2>
					{user && (
						<button
							type="button"
							disabled={accountActionPending !== null}
							onClick={() => void signOut()}
							className="flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-60"
						>
							{accountActionPending === "sign-out" ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<LogOut className="h-4 w-4" />
							)}
							{accountActionPending === "sign-out" ? "Signing Out" : "Sign Out"}
						</button>
					)}
				</div>

				{/* Tabs */}
				<div className="mb-6 flex items-center gap-0 border-b border-border">
					{tabs.map((tab) => {
						const disabled = !user && tab !== "overview";
						return (
							<button
								key={tab}
								type="button"
								disabled={disabled}
								onClick={() => setActiveTab(tab)}
								className={cn(
									"relative px-4 py-2.5 text-sm font-medium capitalize transition-colors",
									activeTab === tab
										? "text-foreground"
										: "text-muted-foreground hover:text-foreground",
									disabled &&
										"cursor-not-allowed opacity-45 hover:text-muted-foreground",
								)}
							>
								{tab}
								{activeTab === tab && (
									<span className="absolute inset-x-0 -bottom-px h-0.5 bg-foreground" />
								)}
							</button>
						);
					})}
				</div>

				{/* Overview Tab */}
				{activeTab === "overview" && (
					<div className="flex flex-col gap-6">
						{overviewLoading && renderLoading()}
						{overviewError &&
							(isAccountAuthError(overviewError)
								? renderSignedOut()
								: renderError(overviewError, loadOverview))}
						{!overviewLoading && !overviewError && user && (
							<>
								{/* User Profile Card */}
								<div className="rounded-lg border border-border p-5">
									<div className="flex items-start gap-4">
										<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary/20 text-2xl font-bold text-primary">
											{user.displayName?.charAt(0) ??
												user.email?.charAt(0) ??
												"?"}
										</div>
										<div className="min-w-0 flex-1">
											<h3 className="text-base font-semibold text-foreground">
												{user.displayName || user.email}
											</h3>
											<p className="mt-0.5 text-sm text-muted-foreground">
												{user.email}
											</p>
											<p className="mt-2 text-xs text-muted-foreground">
												Member since {formatDate(user.createdAt)}
											</p>
										</div>
										<button
											type="button"
											title="Open dashboard"
											onClick={() => void openExternalUrl(DASHBOARD_URL)}
											className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
										>
											<ExternalLink className="h-4 w-4" />
										</button>
									</div>
								</div>

								{/* Balance Card */}
								{displayedBalance !== null && (
									<div className="rounded-lg border border-border p-5">
										<div className="flex items-center justify-between mb-4">
											<div className="flex items-center gap-3">
												<CreditCard className="h-5 w-5 text-primary" />
												<h3 className="text-sm font-semibold text-foreground">
													{activeOrganization
														? `${activeOrganization.name} Balance`
														: "Credits Balance"}
												</h3>
											</div>
											<button
												type="button"
												onClick={() =>
													void openExternalUrl(
														activeOrganization
															? ORGANIZATION_CREDITS_URL
															: USER_CREDITS_URL,
													)
												}
												className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
											>
												<Plus className="h-3.5 w-3.5" />
												Credit
											</button>
										</div>
										<div className="flex items-baseline gap-2">
											<span className="text-3xl font-bold text-foreground">
												${formatCreditBalance(displayedBalance)}
											</span>
										</div>
										{activeOrganization && balance && (
											<p className="mt-2 text-xs text-muted-foreground">
												Personal account: {formatCreditBalance(balance.balance)}{" "}
												credits
											</p>
										)}
									</div>
								)}

								{/* Organizations */}
								<div className="rounded-lg border border-border p-5">
									<div className="flex items-center justify-between mb-4">
										<div className="flex items-center gap-3">
											<Building className="h-5 w-5 text-muted-foreground" />
											<h3 className="text-sm font-semibold text-foreground">
												Organizations
											</h3>
										</div>
										<button
											type="button"
											onClick={() =>
												void openExternalUrl(CREATE_ORGANIZATION_URL)
											}
											className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
										>
											<Plus className="h-3.5 w-3.5" />
											Create
										</button>
									</div>
									<div className="flex flex-col gap-2">
										{renderAccountRow({
											key: "personal",
											name: "Personal",
											subtitle: user.email ?? "Personal account",
											icon: <User className="h-4 w-4" />,
											active: !activeOrganization,
											switching: switchTargetId === "",
											onSelect: () => void switchAccount(null),
										})}
										{organizations.map((org) =>
											renderAccountRow({
												key: org.organizationId,
												name: org.name,
												subtitle: org.roles.join(", "),
												icon: org.name.charAt(0),
												active: org.active,
												switching: switchTargetId === org.organizationId,
												onSelect: () => void switchAccount(org.organizationId),
											}),
										)}
									</div>
								</div>
							</>
						)}
					</div>
				)}

				{/* Usage Tab */}
				{activeTab === "usage" && (
					<div>
						<p className="mb-6 text-sm text-muted-foreground">
							{activeOrganization
								? `Recent API usage and token consumption for ${activeOrganization.name}.`
								: "Recent API usage and token consumption across all providers."}
						</p>
						{usageLoading && renderLoading()}
						{usageError && renderError(usageError, loadUsage)}
						{!usageLoading &&
							!usageError &&
							usageLoaded &&
							(usageTransactions.length === 0 ? (
								<p className="py-8 text-center text-sm text-muted-foreground">
									No usage transactions yet.
								</p>
							) : (
								<div className="rounded-lg border border-border overflow-hidden">
									<div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-border bg-secondary/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
										<span>Model</span>
										<span className="text-right">Tokens</span>
										<span className="text-right">Credits</span>
										<span className="text-right">Time</span>
									</div>
									<div className="divide-y divide-border">
										{usageTransactions.map((tx) => (
											<div
												key={tx.id}
												className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-3 text-sm transition-colors hover:bg-accent/20"
											>
												<div className="min-w-0">
													<p className="font-medium text-foreground truncate">
														{tx.aiModelName}
													</p>
													<p className="text-xs text-muted-foreground">
														{tx.aiInferenceProviderName}
													</p>
												</div>
												<div className="text-right text-muted-foreground">
													{tx.totalTokens.toLocaleString()}
												</div>
												<div className="text-right text-foreground font-medium">
													{formatCreditBalance(tx.creditsUsed)}
												</div>
												<div className="text-right text-xs text-muted-foreground">
													<p>{formatDate(tx.createdAt)}</p>
													<p>{formatTime(tx.createdAt)}</p>
												</div>
											</div>
										))}
									</div>
								</div>
							))}
					</div>
				)}

				{/* Billing Tab */}
				{activeTab === "billing" && (
					<div>
						<p className="mb-6 text-sm text-muted-foreground">
							Payment history and credit purchases.
						</p>
						{billingLoading && renderLoading()}
						{billingError && renderError(billingError, loadBilling)}
						{!billingLoading &&
							!billingError &&
							billingLoaded &&
							(paymentTransactions.length === 0 ? (
								<p className="py-8 text-center text-sm text-muted-foreground">
									No payment transactions yet.
								</p>
							) : (
								<div className="rounded-lg border border-border overflow-hidden">
									<div className="grid grid-cols-[1fr_auto_auto] gap-4 border-b border-border bg-secondary/50 px-4 py-2.5 text-xs font-medium text-muted-foreground">
										<span>Date</span>
										<span className="text-right">Amount</span>
										<span className="text-right">Credits</span>
									</div>
									<div className="divide-y divide-border">
										{paymentTransactions.map((tx) => (
											<div
												key={`${tx.paidAt}-${tx.amountCents}-${tx.credits}`}
												className="grid grid-cols-[1fr_auto_auto] gap-4 px-4 py-3 text-sm transition-colors hover:bg-accent/20"
											>
												<div className="flex items-center gap-3">
													<Receipt className="h-4 w-4 text-muted-foreground" />
													<span className="text-foreground">
														{formatDate(tx.paidAt)}
													</span>
												</div>
												<div className="text-right text-foreground font-medium">
													${(tx.amountCents / 100).toFixed(2)}
												</div>
												<div className="text-right text-primary font-medium">
													+{formatCreditBalance(tx.credits)}
												</div>
											</div>
										))}
									</div>
								</div>
							))}
					</div>
				)}
			</div>
		</ScrollArea>
	);
}
