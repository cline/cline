import { Check, ChevronDown, ChevronUp } from "lucide-react-native";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { ClineAuthStore } from "@/cloud";
import {
	type CloudAccount,
	CloudAccountGateway,
} from "@/cloud/rest/CloudAccountGateway";
import { cloudEnv } from "@/config/env";
import { userErrorMessage } from "@/error-message";
import { useCloudAccountScope, useCloudAuth } from "@/state/cloud-auth";
import { Button, Text, useTheme } from "@/ui";

/** Account switching belongs in Account settings, just as it does on desktop. */
export function AccountSwitcher({ children }: { children?: ReactNode }) {
	const { store } = useCloudAuth();
	return (
		<AccountSwitcherBody key={store.identityVersion} store={store}>
			{children}
		</AccountSwitcherBody>
	);
}

function AccountSwitcherBody({
	store,
	children,
}: {
	store: ClineAuthStore;
	children?: ReactNode;
}) {
	const theme = useTheme();
	const identityVersion = store.identityVersion;
	const {
		scope,
		beginSelection,
		beginRefresh,
		selectionPending,
		isSelectionPending,
	} = useCloudAccountScope();
	const gateway = useMemo(
		() =>
			new CloudAccountGateway({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				getAccessToken: () => store.getValidAccessToken(),
			}),
		[store],
	);
	const [accounts, setAccounts] = useState<CloudAccount[]>([]);
	const [expanded, setExpanded] = useState(false);
	const visibleAccounts = accounts.map((account) => ({
		...account,
		active:
			scope === undefined
				? account.active
				: account.organizationId === scope.organizationId,
	}));
	const [error, setError] = useState<string>();
	const [loading, setLoading] = useState(true);
	const [retry, setRetry] = useState(0);
	const [switching, setSwitching] = useState(false);
	const busy = useRef(false);
	const mounted = useRef(false);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);
	useEffect(() => {
		void retry;
		let active = true;
		const publishScope = beginRefresh();
		setLoading(true);
		setError(undefined);
		void gateway
			.listAccounts()
			.then((next) => {
				if (active) {
					setAccounts(next);
					const selectedAccount = next.find((account) => account.active);
					publishScope({
						organizationId: selectedAccount?.organizationId,
						accountName: selectedAccount?.name,
					});
				}
			})
			.catch((cause) => {
				if (active)
					setError(
						userErrorMessage(cause, "Accounts could not be loaded. Try again."),
					);
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, [gateway, retry, beginRefresh]);
	const choose = async (account: CloudAccount) => {
		if (
			identityVersion !== store.identityVersion ||
			busy.current ||
			isSelectionPending() ||
			account.active
		)
			return;
		busy.current = true;
		const publishSelection = beginSelection();
		setSwitching(true);
		setError(undefined);
		try {
			await gateway.switchAccount(account.organizationId);
			// The server preference change survives leaving Settings. Publish it to
			// Home too; the selection lease still rejects sign-out/newer selections.
			if (
				!publishSelection({
					organizationId: account.organizationId,
					accountName: account.name,
				})
			)
				return;
			if (mounted.current)
				setAccounts((current) =>
					current.map((row) => ({
						...row,
						active: row.organizationId === account.organizationId,
					})),
				);
		} catch (cause) {
			if (publishSelection.fail() && mounted.current)
				setError(
					userErrorMessage(
						cause,
						"That account could not be selected. Try again.",
					),
				);
		} finally {
			busy.current = false;
			if (mounted.current) setSwitching(false);
		}
	};
	return (
		<View style={{ gap: 8 }}>
			{loading ? (
				<Text variant="caption" tone="muted">
					Loading accounts…
				</Text>
			) : null}
			{!loading && accounts.length > 0 ? (
				<Pressable
					accessibilityRole={accounts.length > 1 ? "button" : "text"}
					accessibilityLabel={`Current account: ${visibleAccounts.find((account) => account.active)?.name ?? "Unavailable"}`}
					accessibilityHint={
						accounts.length > 1 ? "Show or hide account choices" : undefined
					}
					accessibilityState={accounts.length > 1 ? { expanded } : undefined}
					onPress={
						accounts.length > 1
							? () => setExpanded((value) => !value)
							: undefined
					}
					style={{
						minHeight: 44,
						flexDirection: "row",
						alignItems: "center",
						gap: 8,
					}}
				>
					<View style={{ flex: 1, gap: 2 }}>
						<Text variant="caption" tone="muted">
							Current account
						</Text>
						<Text variant="small" weight="500" numberOfLines={2}>
							{visibleAccounts.find((account) => account.active)?.name ??
								"Unavailable"}
						</Text>
					</View>
					{selectionPending ? (
						<Text variant="caption" tone="muted">
							Changing…
						</Text>
					) : null}
					{accounts.length > 1 ? (
						expanded ? (
							<ChevronUp size={16} color={theme.color.textMuted} />
						) : (
							<ChevronDown size={16} color={theme.color.textMuted} />
						)
					) : null}
				</Pressable>
			) : null}
			{children}
			{expanded && accounts.length > 1 ? (
				<>
					<Text variant="small" weight="500">
						Accounts
					</Text>
					{visibleAccounts.map((account) => (
						<Pressable
							key={account.organizationId ?? "personal"}
							accessibilityRole="radio"
							accessibilityLabel={account.name}
							accessibilityState={{
								checked: account.active,
								disabled: switching || selectionPending,
							}}
							disabled={switching || selectionPending}
							onPress={() => void choose(account)}
							style={{
								minHeight: 46,
								padding: 10,
								borderRadius: theme.radius.sm,
								flexDirection: "row",
								alignItems: "center",
								gap: 8,
								backgroundColor: account.active
									? theme.color.surfaceMuted
									: "transparent",
								opacity: switching || selectionPending ? 0.6 : 1,
							}}
						>
							<Text variant="small" style={{ flex: 1 }}>
								{account.name}
							</Text>
							{account.active ? (
								<Check size={15} color={theme.brand.violet} />
							) : null}
						</Pressable>
					))}
				</>
			) : null}
			{error ? (
				<>
					<Text variant="small" tone="danger" accessibilityRole="alert">
						{error}
					</Text>
					{!accounts.length ? (
						<Button
							label="Retry accounts"
							variant="outline"
							onPress={() => setRetry((value) => value + 1)}
						/>
					) : null}
				</>
			) : null}
		</View>
	);
}
