import { Badge, ItemCard } from "@cline/ui";
import { Code } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { desktopClient } from "@/lib/desktop-client";
import { PageCardGrid } from "../../shared/page-card-grid";
import { CustomizationEmptyState } from "../shared/customization-empty-state";
import { CustomizationExecutionStatus } from "../shared/customization-item-card";
import {
	ExtensionSectionLayout,
	type ExtensionSectionProps,
	ScopeBadge,
} from "./extension-section-shared";
import { selectInstalledHooks } from "./installed-inventory-selectors";
import { useExtensionSection } from "./use-extension-section";

type SessionHookEvent = {
	ts: string;
	hookEventName: string;
};
type CliDiscoveredSession = {
	sessionId: string;
	startedAt: string;
};
type HookExecutionSummary = {
	count: number;
	lastTs: string | null;
};
const EXTENSION_HOOK_STATS_CACHE_TTL_MS = 30000;
let extensionHookStatsCache: {
	hookExecutionByEvent: Record<string, HookExecutionSummary>;
	hookExecutionSessionId: string | null;
	fetchedAt: number;
} | null = null;
export function HooksSection({
	onInventoryChanged,
	includeBuiltinItems = true,
	searchQuery,
	searchResults = false,
	onViewAll,
	previewLimit,
	itemOffset = 0,
}: ExtensionSectionProps) {
	const {
		inventory,
		loading: isLoading,
		error: errorMessage,
		loadError,
		actionError,
		refresh,
	} = useExtensionSection(onInventoryChanged, includeBuiltinItems);
	const { workspaceRoot, hooks, warnings } = inventory;
	const [hookExecutionByEvent, setHookExecutionByEvent] = useState<
		Record<string, HookExecutionSummary>
	>(() => extensionHookStatsCache?.hookExecutionByEvent ?? {});
	const [hookExecutionSessionId, setHookExecutionSessionId] = useState<
		string | null
	>(() => extensionHookStatsCache?.hookExecutionSessionId ?? null);
	const [hookExecutionLoading, setHookExecutionLoading] = useState(false);
	const normalizedSearchQuery = (searchQuery ?? "").trim().toLowerCase();
	const loadHookExecutionStats = useCallback(async (force = false) => {
		const now = Date.now();
		if (
			!force &&
			extensionHookStatsCache &&
			now - extensionHookStatsCache.fetchedAt <
				EXTENSION_HOOK_STATS_CACHE_TTL_MS
		) {
			setHookExecutionByEvent(extensionHookStatsCache.hookExecutionByEvent);
			setHookExecutionSessionId(extensionHookStatsCache.hookExecutionSessionId);
			return;
		}
		setHookExecutionLoading(true);
		try {
			const sessions = await desktopClient.invoke<CliDiscoveredSession[]>(
				"list_cli_sessions",
				{
					limit: 300,
				},
			);
			const latestSession = (sessions ?? [])
				.filter(
					(session) =>
						typeof session.sessionId === "string" &&
						session.sessionId.trim().length > 0,
				)
				.sort((left, right) =>
					(right.startedAt ?? "").localeCompare(left.startedAt ?? ""),
				)[0];
			if (!latestSession?.sessionId) {
				setHookExecutionByEvent({});
				setHookExecutionSessionId(null);
				extensionHookStatsCache = {
					hookExecutionByEvent: {},
					hookExecutionSessionId: null,
					fetchedAt: Date.now(),
				};
				return;
			}
			const events = await desktopClient.invoke<SessionHookEvent[]>(
				"read_session_hooks",
				{
					sessionId: latestSession.sessionId,
					limit: 5000,
				},
			);
			const next: Record<string, HookExecutionSummary> = {};
			for (const event of events ?? []) {
				const hookName = event.hookEventName?.trim();
				if (!hookName) {
					continue;
				}
				const current = next[hookName] ?? {
					count: 0,
					lastTs: null,
				};
				current.count += 1;
				if (event.ts && (!current.lastTs || event.ts > current.lastTs)) {
					current.lastTs = event.ts;
				}
				next[hookName] = current;
			}
			setHookExecutionByEvent(next);
			setHookExecutionSessionId(latestSession.sessionId);
			extensionHookStatsCache = {
				hookExecutionByEvent: next,
				hookExecutionSessionId: latestSession.sessionId,
				fetchedAt: Date.now(),
			};
		} catch {
			// Keep existing execution status when lookup fails.
		} finally {
			setHookExecutionLoading(false);
		}
	}, []);
	const formatExecutionTs = useCallback((value: string | null): string => {
		if (!value) {
			return "never";
		}
		const asNumber = Number(value);
		const date = Number.isFinite(asNumber)
			? new Date(asNumber)
			: new Date(value);
		if (Number.isNaN(date.getTime())) {
			return value;
		}
		return date.toLocaleString();
	}, []);
	useEffect(() => {
		const timeoutId = window.setTimeout(() => {
			void loadHookExecutionStats(false);
		}, 0);
		return () => window.clearTimeout(timeoutId);
	}, [loadHookExecutionStats]);
	const scopedHooks = useMemo(
		() =>
			selectInstalledHooks(
				{ hooks, workspaceRoot },
				{ searchQuery: normalizedSearchQuery, includeBuiltinItems },
			),
		[hooks, workspaceRoot, normalizedSearchQuery, includeBuiltinItems],
	);
	const searchCount = scopedHooks.length;
	const searchLoading = isLoading;
	const searchError = Boolean(errorMessage) || warnings.length > 0;
	const handleRefresh = useCallback(async () => {
		await Promise.all([refresh(true), loadHookExecutionStats(true)]);
	}, [refresh, loadHookExecutionStats]);
	const inventoryCount =
		isLoading || errorMessage || warnings.length > 0 ? undefined : hooks.length;
	const content = (
		<ExtensionSectionLayout
			title="Hooks"
			count={inventoryCount}
			loading={isLoading}
			loadError={loadError}
			actionError={actionError}
			warnings={warnings}
			searchResults={searchResults}
			onViewAll={onViewAll}
			onRefresh={handleRefresh}
		>
			<div>
				{!searchResults && hookExecutionLoading && hookExecutionSessionId && (
					<p className="mb-4 text-muted-foreground text-xs">
						Execution status is based on hook events in session{" "}
						<span className="font-mono">{hookExecutionSessionId}</span>.
					</p>
				)}

				<div className="grid gap-3">
					{scopedHooks.length > 0 && (
						<PageCardGrid>
							{scopedHooks
								.slice(
									itemOffset,
									previewLimit === undefined
										? undefined
										: itemOffset + previewLimit,
								)
								.map(({ hook, scope }) => {
									const stats = hook.hookEventName
										? hookExecutionByEvent[hook.hookEventName]
										: undefined;
									return (
										<ItemCard
											key={hook.path}
											title={hook.fileName}
											icon={<Code className="size-5" />}
											description={
												hook.hookEventName
													? `Last run: ${formatExecutionTs(stats?.lastTs ?? null)}`
													: undefined
											}
											badges={
												<>
													<ScopeBadge scope={scope} />
													{hook.hookEventName ? (
														<Badge tone="neutral">{hook.hookEventName}</Badge>
													) : null}
												</>
											}
											actions={
												hook.hookEventName ? (
													<CustomizationExecutionStatus
														count={stats?.count ?? 0}
													/>
												) : undefined
											}
											footer={
												<span className="block min-w-0 truncate font-mono">
													{hook.path}
												</span>
											}
										/>
									);
								})}
						</PageCardGrid>
					)}
					{!searchResults && scopedHooks.length === 0 && (
						<CustomizationEmptyState itemLabel="hooks" />
					)}
				</div>
			</div>
		</ExtensionSectionLayout>
	);
	if (searchResults && searchCount === 0 && !searchLoading && !searchError)
		return null;
	return content;
}
