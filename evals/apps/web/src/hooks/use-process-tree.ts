import { useQuery } from "@tanstack/react-query"

import { getProcessList } from "@/lib/server/processes"

export const useProcessList = (pid: number | null) =>
	useQuery({
		queryKey: ["process-tree", pid],
		queryFn: () => (pid ? getProcessList(pid) : []),
		enabled: !!pid,
		refetchInterval: 30_000,
	})
