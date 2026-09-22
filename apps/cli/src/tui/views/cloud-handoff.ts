import type { PreparedCloudHandoff } from "@cline/core/cloud";

export const CLOUD_HANDOFF_LABEL = "Continue this conversation in cloud";

export function cloudHandoffConfirmation(
	prepared: PreparedCloudHandoff,
): string {
	const { repoUrl, branch, headSha, modelId } = prepared.fingerprint;
	const model = prepared.modelFallback
		? `Model: ${prepared.modelFallback.from} → ${prepared.modelFallback.to} (cloud fallback)`
		: `Model: ${modelId}`;
	return `${repoUrl}\nBranch: ${branch} · ${headSha.slice(0, 8)}\n${model}`;
}

/** Preparation is read-only; dispatch the exact prepared handoff only after confirmation. */
export async function confirmCloudHandoff(input: {
	runtime: {
		hasHandoffSource(): boolean;
		prepareHandoff(): Promise<PreparedCloudHandoff>;
		handoff(prepared: PreparedCloudHandoff): Promise<void>;
	};
	isCurrent: () => boolean;
	confirm: (title: string, detail: string) => Promise<boolean | undefined>;
}): Promise<void> {
	const assertCurrent = () => {
		if (!input.isCurrent() || !input.runtime.hasHandoffSource()) {
			throw new Error(
				"The conversation or cloud account changed. Open Cloud and try again.",
			);
		}
	};
	assertCurrent();
	const prepared = await input.runtime.prepareHandoff();
	assertCurrent();
	if (
		!(await input.confirm(
			`${CLOUD_HANDOFF_LABEL}?`,
			cloudHandoffConfirmation(prepared),
		))
	)
		return;
	assertCurrent();
	await input.runtime.handoff(prepared);
}
