"use client";

import { Button } from "@cline/ui";
import { ExternalLink, Loader2, LogIn, RefreshCw } from "lucide-react";
import { useState } from "react";

import { ConnectorLogo } from "@/components/connectors/connector-logo";
import { useAccount } from "@/contexts/account-context";
import { useOAuthUserCode } from "@/hooks/use-oauth-user-code";
import type { ComposioToolkitSlug } from "@/lib/composio-types";
import { openExternalUrl } from "@/lib/desktop-client";
import { runProviderOAuthLogin } from "@/lib/provider-connection";
import { invalidateProviderCatalogCache } from "@/lib/provider-model-catalog";

const CREATE_ACCOUNT_URL = "https://app.cline.bot";

/** A taste of what connectors cover, shown while the account cannot use them. */
const PREVIEW_CONNECTORS: { slug: ComposioToolkitSlug; name: string }[] = [
	{ slug: "gmail", name: "Gmail" },
	{ slug: "slack", name: "Slack" },
	{ slug: "github", name: "GitHub" },
	{ slug: "googlecalendar", name: "Google Calendar" },
	{ slug: "notion", name: "Notion" },
	{ slug: "linear", name: "Linear" },
];

/** Customize > Connectors when the account cannot use connectors: signed out
 * (sign in right here, same device-code flow as the Account page) or signed
 * in without beta access (explain and offer a refresh). */
export function ConnectorsUnavailable({
	onRefresh,
	refreshing,
}: {
	onRefresh: () => Promise<void>;
	refreshing: boolean;
}) {
	const { user, accountReady, refreshAccount } = useAccount();
	const [signingIn, setSigningIn] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const deviceUserCode = useOAuthUserCode(signingIn);

	const signIn = async () => {
		setSigningIn(true);
		setError(null);
		try {
			await runProviderOAuthLogin("cline");
			invalidateProviderCatalogCache();
			await Promise.all([refreshAccount(), onRefresh()]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSigningIn(false);
		}
	};

	const signedIn = user !== null;
	// A cached identity renders immediately; otherwise wait for the lookup
	// rather than telling a signed-in user to sign in.
	if (!signedIn && !accountReady) {
		return (
			<output
				aria-label="Loading account"
				className="flex items-center justify-center py-16"
			>
				<Loader2 className="size-6 animate-spin text-muted-foreground" />
			</output>
		);
	}
	return (
		<div className="select-text rounded-lg border bg-card p-6">
			<div className="mx-auto flex max-w-xl flex-col items-center gap-5 py-6 text-center">
				<div className="flex items-center gap-2">
					{PREVIEW_CONNECTORS.map((connector) => (
						<ConnectorLogo
							className="size-9 rounded-lg border"
							key={connector.slug}
							name={connector.name}
							slug={connector.slug}
						/>
					))}
				</div>
				<div className="grid gap-2">
					<h4 className="font-semibold text-foreground text-lg">
						{signedIn
							? "Connectors aren't enabled for your account yet"
							: "Sign in to Cline to use connectors"}
					</h4>
					<p className="text-muted-foreground text-sm">
						{signedIn
							? "Connectors are rolling out in beta. Once your Cline account has access, Gmail, Slack, GitHub, and hundreds of other apps will show up here, ready to connect in one click."
							: "Connectors give Cline tools for Gmail, Slack, GitHub, and hundreds of other apps with a quick sign-in to each, no API keys. They require a Cline account."}
					</p>
				</div>
				{signedIn ? (
					<Button
						disabled={refreshing}
						onClick={() => void onRefresh()}
						size="sm"
						tone="neutral"
						type="button"
						variant="secondary"
						leadingIcon={RefreshCw}
						loading={refreshing}
						loadingIcon={RefreshCw}
					>
						Check again
					</Button>
				) : (
					<div className="flex flex-wrap items-center justify-center gap-2">
						<Button
							disabled={signingIn}
							onClick={() => void signIn()}
							size="sm"
							tone="accent"
							type="button"
							variant="primary"
							leadingIcon={LogIn}
							loading={signingIn}
						>
							{signingIn ? "Waiting for browser…" : "Sign in"}
						</Button>
						<Button
							onClick={() => void openExternalUrl(CREATE_ACCOUNT_URL)}
							size="sm"
							tone="neutral"
							type="button"
							variant="secondary"
							trailingIcon={ExternalLink}
						>
							Create account
						</Button>
					</div>
				)}
				{signingIn && deviceUserCode ? (
					<p className="text-muted-foreground text-sm">
						Confirm this code in your browser:{" "}
						<span className="font-medium font-mono text-foreground">
							{deviceUserCode}
						</span>
					</p>
				) : null}
				{error ? (
					<p className="text-error-text text-xs" role="alert">
						{error}
					</p>
				) : null}
			</div>
		</div>
	);
}
