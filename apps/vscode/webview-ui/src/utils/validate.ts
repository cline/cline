import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"

export function validateApiConfiguration(_mode: Mode, apiConfiguration?: ApiConfiguration): string | undefined {
	if (!apiConfiguration?.awsRegion?.trim()) {
		return "You must choose an AWS region."
	}
	return undefined
}
