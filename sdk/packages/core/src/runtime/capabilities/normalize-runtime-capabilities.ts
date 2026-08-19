import type { RuntimeCapabilities } from "./runtime-capabilities";

export function normalizeRuntimeCapabilities(
	...sources: Array<RuntimeCapabilities | undefined>
): RuntimeCapabilities | undefined {
	let toolExecutors: RuntimeCapabilities["toolExecutors"] | undefined;
	let requestToolApproval:
		| RuntimeCapabilities["requestToolApproval"]
		| undefined;

	for (const source of sources) {
		if (!source) continue;
		if (source.toolExecutors) {
			toolExecutors = {
				...(toolExecutors ?? {}),
				...source.toolExecutors,
			};
		}
		if (source.requestToolApproval) {
			requestToolApproval = source.requestToolApproval;
		}
	}

	const hasToolExecutors =
		toolExecutors && Object.keys(toolExecutors).length > 0;
	if (!hasToolExecutors && !requestToolApproval) {
		return undefined;
	}
	return {
		...(hasToolExecutors ? { toolExecutors } : {}),
		...(requestToolApproval ? { requestToolApproval } : {}),
	};
}
