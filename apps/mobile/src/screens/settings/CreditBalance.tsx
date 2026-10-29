import { RefreshCw, Settings } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { AppState, Pressable, View } from "react-native";
import { CloudAccountGateway } from "@/cloud/rest/CloudAccountGateway";
import { cloudEnv } from "@/config/env";
import { useCloudAccountScope, useCloudAuth } from "@/state/cloud-auth";
import { IconButton, Text, useTheme } from "@/ui";

/** The selected billing account's balance; never fall back to Personal on failure. */
export function CreditBalance({ compact = false }: { compact?: boolean }) {
	const { store } = useCloudAuth();
	return (
		<CreditBalanceBody
			key={store.identityVersion}
			store={store}
			compact={compact}
		/>
	);
}

function CreditBalanceBody({
	store,
	compact,
}: {
	store: ReturnType<typeof useCloudAuth>["store"];
	compact: boolean;
}) {
	const theme = useTheme();
	const { scope, selectionPending } = useCloudAccountScope();
	const identityVersion = store.identityVersion;
	const key = scope ? (scope.organizationId ?? "personal") : undefined;
	const gateway = useMemo(
		() =>
			new CloudAccountGateway({
				apiBaseUrl: cloudEnv.apiBaseUrl,
				getAccessToken: () => store.getValidAccessToken(),
			}),
		[store],
	);
	const [revision, refresh] = useState(0);
	const [result, setResult] = useState<{
		key?: string;
		loading: boolean;
		dollars?: number;
		error?: boolean;
	}>({ loading: true });
	useEffect(() => {
		const listener = AppState.addEventListener("change", (state) => {
			if (state === "active") refresh((value) => value + 1);
		});
		return () => listener.remove();
	}, []);
	useEffect(() => {
		void revision;
		if (!scope || selectionPending) return;
		let active = true;
		setResult({ key, loading: true });
		void gateway
			.creditBalance(scope.organizationId)
			.then((dollars) => {
				if (active && store.identityVersion === identityVersion)
					setResult({ key, loading: false, dollars });
			})
			.catch(() => {
				if (active && store.identityVersion === identityVersion)
					setResult({ key, loading: false, error: true });
			});
		return () => {
			active = false;
		};
	}, [gateway, key, scope, revision, selectionPending, store, identityVersion]);
	const current: typeof result =
		result.key === key && scope && !selectionPending
			? result
			: { loading: true };
	const dollars = current.dollars;
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
			<View
				style={
					compact
						? {
								flex: 1,
								minWidth: 0,
								flexDirection: "row",
								flexWrap: "wrap",
								justifyContent: "space-between",
								alignItems: "center",
								gap: 6,
							}
						: { flex: 1, gap: 4 }
				}
			>
				<Text variant="caption" tone="muted" weight="500">
					{scope?.organizationId
						? "Organization credit balance"
						: "Credit balance"}
				</Text>
				{current.loading ? (
					<Text variant="caption" tone="muted">
						Loading credit balance…
					</Text>
				) : current.error || dollars === undefined ? (
					<Text variant="caption" tone="muted">
						Credit balance unavailable. Try again.
					</Text>
				) : (
					<Text
						variant={compact ? "small" : "title"}
						accessibilityLabel={`Credit balance: ${dollars.toFixed(2)} US dollars`}
					>
						{dollars < 0 ? "−" : ""}${Math.abs(dollars).toFixed(2)}
					</Text>
				)}
			</View>
			{!compact || current.error ? (
				<IconButton
					accessibilityLabel={
						current.error ? "Retry credit balance" : "Refresh credit balance"
					}
					disabled={current.loading || !scope || selectionPending}
					onPress={() => refresh((value) => value + 1)}
				>
					<RefreshCw size={16} color={theme.color.textMuted} />
				</IconButton>
			) : null}
		</View>
	);
}

/** Read accepted scope metadata only; account discovery stays with its existing owners. */
export function SidebarAccountSummary({
	onPress,
	compact = false,
}: {
	onPress(): void;
	compact?: boolean;
}) {
	const { account } = useCloudAuth();
	const { scope, selectionPending } = useCloudAccountScope();
	const theme = useTheme();
	if (account.phase !== "signed-in")
		return compact ? (
			<IconButton accessibilityLabel="Settings" onPress={onPress}>
				<Settings size={19} color={theme.color.textMuted} />
			</IconButton>
		) : null;
	const name = scope
		? scope.accountName?.trim() ||
			(scope.organizationId ? "Organization account" : "Personal")
		: "Account unavailable";
	if (compact)
		return (
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Account: ${name}`}
				accessibilityHint={
					selectionPending
						? "Changing account. Opens account settings."
						: "Opens account settings"
				}
				onPress={onPress}
				style={({ pressed }) => ({
					minHeight: 44,
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
					paddingHorizontal: 8,
					borderRadius: theme.radius.sm,
					backgroundColor: pressed ? theme.color.surfaceHover : "transparent",
				})}
			>
				<Text
					variant="small"
					weight="500"
					numberOfLines={1}
					style={{ flex: 1, minWidth: 0 }}
				>
					{name}
				</Text>
				{selectionPending ? (
					<Text variant="caption" tone="muted">
						Changing…
					</Text>
				) : null}
				<Settings size={17} color={theme.color.textMuted} />
			</Pressable>
		);
	return (
		<View style={{ paddingHorizontal: 12, paddingBottom: 8, gap: 2 }}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`Account: ${name}`}
				accessibilityHint="Opens account settings"
				onPress={onPress}
				style={({ pressed }) => ({
					minHeight: 44,
					justifyContent: "center",
					borderRadius: theme.radius.sm,
					backgroundColor: pressed ? theme.color.surfaceHover : "transparent",
				})}
			>
				<Text variant="small" weight="500" numberOfLines={2}>
					{name}
				</Text>
			</Pressable>
			{selectionPending ? (
				<Text variant="caption" tone="muted">
					Changing account…
				</Text>
			) : scope ? (
				<CreditBalance compact />
			) : null}
		</View>
	);
}
