const DEFAULT_PROVIDER_CONCURRENCY = 3;

export const LIVE_PROVIDER_CONCURRENCY = parseLiveProviderConcurrency(
	process.env.LLMS_LIVE_PROVIDER_CONCURRENCY,
);

function parseLiveProviderConcurrency(value: string | undefined): number {
	if (!value) {
		return DEFAULT_PROVIDER_CONCURRENCY;
	}
	const parsed = Number(value);
	if (!Number.isFinite(parsed)) {
		return DEFAULT_PROVIDER_CONCURRENCY;
	}
	return Math.max(1, Math.floor(parsed));
}

export async function runLiveProviderTargets<Target>(options: {
	targets: readonly Target[];
	concurrency?: number;
	runTarget(target: Target): Promise<string | undefined>;
}): Promise<string[]> {
	const concurrency = Math.max(
		1,
		Math.floor(options.concurrency ?? LIVE_PROVIDER_CONCURRENCY),
	);
	const failures: string[] = [];
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (true) {
			const target = options.targets[nextIndex];
			nextIndex += 1;
			if (target === undefined) {
				return;
			}
			const failure = await options.runTarget(target);
			if (failure) {
				failures.push(failure);
			}
		}
	}

	const workerCount = Math.min(concurrency, options.targets.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return failures;
}
