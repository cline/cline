import type {
	BasicLogger,
	FeatureFlagsAndPayloads,
	FeatureFlagsContext,
	FeatureFlagsSettings,
	IFeatureFlagsProvider,
} from "@cline/shared";
import { PostHog } from "posthog-node";

export interface PostHogFeatureFlagsProviderConfig {
	apiKey: string;
	host?: string;
	timeoutMs?: number;
	fetch?: typeof fetch;
	logger?: BasicLogger;
}

export interface PostHogFeatureFlagsProviderOptions {
	config: PostHogFeatureFlagsProviderConfig;
	client?: PostHog;
}

export class PostHogFeatureFlagsProvider implements IFeatureFlagsProvider {
	private readonly client: PostHog;
	private readonly settings: FeatureFlagsSettings;
	private readonly logger?: BasicLogger;

	constructor(options: PostHogFeatureFlagsProviderOptions) {
		const apiKey = options.config.apiKey.trim();
		if (!apiKey && !options.client) {
			throw new Error("PostHog API key is required for feature flags");
		}

		this.logger = options.config.logger;
		this.settings = {
			enabled: true,
			timeoutMs: options.config.timeoutMs ?? 5000,
		};

		this.client =
			options.client ??
			new PostHog(apiKey, {
				host: options.config.host ?? "https://data.cline.bot",
				fetch: options.config.fetch,
			});
	}

	async getAllFlagsAndPayloads(options: {
		flagKeys?: readonly string[];
		context: FeatureFlagsContext;
	}): Promise<FeatureFlagsAndPayloads | undefined> {
		if (!this.enabled) {
			return undefined;
		}

		const distinctId = this.resolveDistinctId(options.context);
		if (!distinctId) {
			this.logger?.log?.(
				"PostHog feature flags requested without a distinct ID",
			);
			return {};
		}

		try {
			const result = await this.client.getAllFlagsAndPayloads(distinctId, {
				flagKeys: options.flagKeys ? [...options.flagKeys] : undefined,
			});
			return result as FeatureFlagsAndPayloads;
		} catch (error) {
			this.logger?.error?.("Error getting PostHog feature flags", { error });
			return {};
		}
	}

	get enabled(): boolean {
		return this.settings.enabled;
	}

	getSettings(): FeatureFlagsSettings {
		return { ...this.settings };
	}

	async dispose(): Promise<void> {
		try {
			await this.client.shutdown();
		} catch (error) {
			this.logger?.error?.("Error shutting down PostHog feature flags client", {
				error,
			});
		}
	}

	private resolveDistinctId(context?: FeatureFlagsContext): string | undefined {
		return context?.distinctId?.trim() || context?.userId?.trim() || undefined;
	}
}
