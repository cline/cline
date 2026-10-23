import { useCallback, useEffect, useRef, useState } from "react";
import type { CloudRepository, CloudSetupGateway } from "@/cloud";
import { userErrorMessage } from "@/error-message";

export type CloudBranchesState =
	| { phase: "idle" }
	| { phase: "loading" }
	| {
			phase: "ready";
			repository: CloudRepository;
			branches: readonly string[];
			hasMore: boolean;
	  }
	| { phase: "error"; message: string };

export function useCloudBranches({
	gateway,
	resolveRepository,
	organizationId,
	query,
	enabled = true,
}: {
	gateway: Pick<CloudSetupGateway, "listBranches">;
	resolveRepository(): Promise<CloudRepository>;
	organizationId?: string;
	query: string;
	enabled?: boolean;
}) {
	const [state, setState] = useState<CloudBranchesState>({ phase: "idle" });
	const request = useRef(0);
	const reload = useCallback(async () => {
		if (!enabled) return;
		const current = ++request.current;
		setState({ phase: "loading" });
		try {
			const repository = await resolveRepository();
			if (current !== request.current) return;
			const page = await gateway.listBranches(repository.id, {
				...(organizationId ? { organizationId } : {}),
				...(query.trim() ? { query: query.trim() } : {}),
			});
			if (current !== request.current) return;
			setState({
				phase: "ready",
				repository,
				branches: page.branches,
				hasMore: Boolean(page.nextToken),
			});
		} catch (error) {
			if (current !== request.current) return;
			setState({
				phase: "error",
				message: userErrorMessage(error, "Branches could not be loaded."),
			});
		}
	}, [enabled, resolveRepository, gateway, organizationId, query]);

	useEffect(() => {
		setState({ phase: "idle" });
		if (!enabled) return;
		const timer = setTimeout(() => void reload(), query.trim() ? 300 : 0);
		return () => {
			// Retire immediately, including the debounce window before the next load.
			++request.current;
			clearTimeout(timer);
		};
	}, [enabled, query, reload]);

	return { state, reload };
}

export function pinnedBranchChoices({
	defaultBranch,
	selected,
	branches,
}: {
	defaultBranch: string;
	selected?: string;
	branches: readonly string[];
}) {
	const pinned = [
		defaultBranch,
		...(selected && selected !== defaultBranch ? [selected] : []),
	];
	return {
		pinnedCount: pinned.length,
		rows: [...pinned, ...branches.filter((branch) => !pinned.includes(branch))],
	};
}
