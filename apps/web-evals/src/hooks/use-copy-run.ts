import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import { copyRunToProduction } from "@/lib/actions"

export function useCopyRun(runId: number) {
	const [copied, setCopied] = useState(false)

	const { isPending, mutate: copyRun } = useMutation({
		mutationFn: () => copyRunToProduction(runId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(result.message)
				setCopied(true)
				setTimeout(() => setCopied(false), 3000)
			} else {
				toast.error(result.error)
			}
		},
		onError: (error) => {
			console.error("Copy to production failed:", error)
			toast.error("Failed to copy run to production")
		},
	})

	return { isPending, copyRun, copied }
}
