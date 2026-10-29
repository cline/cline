"use client";

import type { CloudArtifactDownload } from "@cline/core/cloud";
import type { GeneratedMediaSource } from "@cline/shared/browser";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "@/contexts/account-context";
import { desktopClient, openExternalUrl } from "@/lib/desktop-client";

export type ArtifactReference = Extract<
	GeneratedMediaSource,
	{ type: "artifact" }
>;

const EXPIRY_MARGIN_MS = 30_000;

type ResourceState =
	| { status: "idle" | "loading" | "error" }
	| { status: "ready"; resource: CloudArtifactDownload; attempt: number };

const IDLE: ResourceState = { status: "idle" };

export function useArtifactResource({
	sessionId,
	reference,
}: {
	sessionId: string;
	reference: ArtifactReference;
}) {
	const { user, activeOrganization, accountReady } = useAccount();
	const scope = useMemo(
		() => ({
			sessionId,
			artifactId: reference.artifactId,
			userId: user?.id,
			organizationId: activeOrganization?.organizationId,
			accountReady,
		}),
		[
			sessionId,
			reference.artifactId,
			user?.id,
			activeOrganization?.organizationId,
			accountReady,
		],
	);
	const [stored, setStored] = useState<{
		scope: typeof scope;
		value: ResourceState;
	}>({
		scope,
		value: IDLE,
	});
	const activeScope = useRef<typeof scope | null>(null);
	const generation = useRef(0);
	const cache = useRef<Extract<ResourceState, { status: "ready" }> | null>(
		null,
	);
	const recovered = useRef(false);

	useLayoutEffect(() => {
		activeScope.current = scope;
		return () => {
			activeScope.current = null;
			generation.current += 1;
			cache.current = null;
			recovered.current = false;
		};
	}, [scope]);

	const run = useCallback(
		async ({ force = false, open = false } = {}) => {
			if (activeScope.current !== scope || !scope.accountReady) return;
			const attempt = ++generation.current;
			const isCurrent = () =>
				activeScope.current === scope && generation.current === attempt;
			const cached = cache.current?.resource;
			const fresh =
				cached && Date.parse(cached.expiresAt) > Date.now() + EXPIRY_MARGIN_MS;
			if (force || !fresh) cache.current = null;
			setStored({ scope, value: { status: "loading" } });
			try {
				const resource =
					!force && fresh
						? cached
						: await desktopClient.invoke<CloudArtifactDownload>(
								"resolve_artifact",
								{
									sessionId: scope.sessionId,
									artifactId: scope.artifactId,
								},
							);
				if (!isCurrent()) return;
				const ready: Extract<ResourceState, { status: "ready" }> = {
					status: "ready",
					resource,
					attempt,
				};
				cache.current = ready;
				if (open) await openExternalUrl(resource.url);
				if (isCurrent()) setStored({ scope, value: ready });
			} catch {
				if (!isCurrent()) return;
				cache.current = null;
				setStored({
					scope,
					value: { status: "error" },
				});
			}
		},
		[scope],
	);

	const load = useCallback(() => {
		if (activeScope.current === scope) recovered.current = false;
		return run();
	}, [run, scope]);
	const retry = useCallback(() => {
		if (activeScope.current === scope) recovered.current = false;
		return run({ force: true });
	}, [run, scope]);
	const open = useCallback(() => run({ open: true }), [run]);
	const reportLoadError = useCallback(
		(attempt: number) => {
			if (
				activeScope.current !== scope ||
				generation.current !== attempt ||
				cache.current?.attempt !== attempt
			)
				return;
			cache.current = null;
			if (!recovered.current) {
				recovered.current = true;
				void run({ force: true });
			} else {
				setStored({
					scope,
					value: { status: "error" },
				});
			}
		},
		[run, scope],
	);

	// Identity changes must hide the previous resource before effects run.
	const state: ResourceState = !accountReady
		? { status: "loading" }
		: stored.scope === scope
			? stored.value
			: IDLE;

	return {
		state,
		load,
		retry,
		open,
		reportLoadError,
	};
}
