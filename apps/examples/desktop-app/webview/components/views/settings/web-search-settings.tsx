import { providerOffersModelTool } from "@cline/llms/browser";
import { Switch } from "@cline/ui";
import { useEffect, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import {
	fetchProviderCatalog,
	subscribeToProviderCatalogInvalidation,
} from "@/lib/provider-model-catalog";

type GlobalSettingsResponse = {
	tools?: Partial<Record<"web_search", { enabled: boolean }>>;
};

export function WebSearchSettings({
	onOpenModelProviders,
}: {
	onOpenModelProviders: () => void;
}) {
	const [webSearchEnabled, setWebSearchEnabled] = useState(false);
	const [webSearchLoading, setWebSearchLoading] = useState(true);
	const [webSearchSaving, setWebSearchSaving] = useState(false);
	const [webSearchError, setWebSearchError] = useState<string | null>(null);
	// Connected providers that offer native web search; null until the
	// catalog loads. The toggle silently does nothing with other providers,
	// so the row spells out whether it will actually take effect.
	const [webSearchReadyProviders, setWebSearchReadyProviders] = useState<
		string[] | null
	>(null);

	useEffect(() => {
		let cancelled = false;
		const loadWebSearchSupport = () => {
			void fetchProviderCatalog()
				.then((payload) => {
					if (cancelled) return;
					setWebSearchReadyProviders(
						(payload.providers ?? [])
							.filter(
								(provider) =>
									provider.enabled &&
									providerOffersModelTool(provider.id, "web_search"),
							)
							.map((provider) => provider.name),
					);
				})
				.catch(() => {
					// Support status is best-effort; the toggle works without it.
				});
		};
		loadWebSearchSupport();
		// Provider saves invalidate the catalog cache when they complete, so
		// refetching on invalidation keeps the status current even when the
		// user navigates here while a save is still in flight.
		const unsubscribe =
			subscribeToProviderCatalogInvalidation(loadWebSearchSupport);
		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, []);

	useEffect(() => {
		let cancelled = false;
		void desktopClient
			.invoke<GlobalSettingsResponse>("get_global_settings")
			.then((settings) => {
				if (!cancelled)
					setWebSearchEnabled(settings.tools?.web_search?.enabled === true);
			})
			.catch((error: unknown) => {
				if (!cancelled)
					setWebSearchError(
						error instanceof Error ? error.message : String(error),
					);
			})
			.finally(() => {
				if (!cancelled) setWebSearchLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const updateWebSearchEnabled = async (nextValue: boolean) => {
		const previousValue = webSearchEnabled;
		setWebSearchEnabled(nextValue);
		setWebSearchSaving(true);
		setWebSearchError(null);
		try {
			const settings = await desktopClient.invoke<GlobalSettingsResponse>(
				"set_web_search_enabled",
				{ web_search_enabled: nextValue },
			);
			setWebSearchEnabled(settings.tools?.web_search?.enabled === true);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			setWebSearchEnabled(previousValue);
			setWebSearchError(message);
		} finally {
			setWebSearchSaving(false);
		}
	};

	return (
		<div className="flex py-4 items-center justify-between gap-5 border-b max-[720px]:flex-col max-[720px]:items-stretch max-[720px]:py-4">
			<div className="flex flex-col gap-1">
				<p className="text-base font-semibold text-foreground">Web search</p>
				<p className="text-sm text-muted-foreground">
					Let the model search the web during a task. Only providers with
					built-in web search honor this setting; other providers ignore it.
					Applies to new sessions.
				</p>
				{webSearchReadyProviders ===
				null ? null : webSearchReadyProviders.length > 0 ? (
					<p className="text-xs text-muted-foreground">
						Ready to use with {webSearchReadyProviders.join(", ")} on models
						that support it — no extra setup needed.
					</p>
				) : (
					<p className="text-xs text-amber-700 dark:text-amber-300">
						None of your connected providers include built-in web search, so
						this setting has no effect yet.{" "}
						<button
							className="underline underline-offset-2 hover:text-foreground"
							onClick={onOpenModelProviders}
							type="button"
						>
							Connect a provider
						</button>{" "}
						that supports it, such as Anthropic, OpenAI, Google Gemini, or
						Cline.
					</p>
				)}
				{webSearchError ? (
					<p className="mt-2 text-xs text-destructive" role="alert">
						Failed to update web search setting: {webSearchError}
					</p>
				) : null}
			</div>
			<Switch
				aria-label="Web search"
				checked={webSearchEnabled}
				disabled={webSearchLoading || webSearchSaving}
				onCheckedChange={(checked) => void updateWebSearchEnabled(checked)}
			/>
		</div>
	);
}
