import { useEffect, useMemo, useState } from "react";
import { AppState, View } from "react-native";
import { CloudAccountGateway } from "@/cloud/rest/CloudAccountGateway";
import { cloudEnv } from "@/config/env";
import { useCloudAccountScope, useCloudAuth } from "@/state/cloud-auth";
import { Button, Text } from "@/ui";

/** The selected billing account's balance; never fall back to Personal on failure. */
export function CreditBalance() {
	const { store } = useCloudAuth();
	const { scope } = useCloudAccountScope();
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
		if (!scope) return;
		let active = true;
		setResult({ key, loading: true });
		void gateway
			.creditBalance(scope.organizationId)
			.then((dollars) => {
				if (active) setResult({ key, loading: false, dollars });
			})
			.catch(() => {
				if (active) setResult({ key, loading: false, error: true });
			});
		return () => {
			active = false;
		};
	}, [gateway, key, scope, revision]);
	const current: typeof result =
		result.key === key && scope ? result : { loading: true };
	return (
		<View style={{ gap: 6 }}>
			<Text variant="small" weight="500">
				{scope?.organizationId
					? "Organization credit balance"
					: "Credit balance"}
			</Text>
			{current.loading ? (
				<Text variant="caption" tone="muted">
					Loading credit balance…
				</Text>
			) : current.error ? (
				<Text variant="caption" tone="muted">
					Credit balance unavailable. Try again.
				</Text>
			) : (
				<Text
					variant="title"
					accessibilityLabel={`Credit balance: ${current.dollars!.toFixed(2)} US dollars`}
				>
					{current.dollars! < 0 ? "−" : ""}$
					{Math.abs(current.dollars!).toFixed(2)}
				</Text>
			)}
			<Button
				label={
					current.error ? "Retry credit balance" : "Refresh credit balance"
				}
				variant="ghost"
				disabled={current.loading || !scope}
				style={{ alignSelf: "flex-start" }}
				onPress={() => refresh((value) => value + 1)}
			/>
		</View>
	);
}
