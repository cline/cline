import { useQuery } from "@tanstack/react-query"

import { getRunners } from "@/lib/server/runners"

export const useRunners = (runId: number) =>
	useQuery({
		queryKey: ["runners", runId],
		queryFn: () => getRunners(runId),
		refetchInterval: 10_000,
	})
