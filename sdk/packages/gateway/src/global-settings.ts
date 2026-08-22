import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import type { VoiceInputSelection } from "@cline/shared";
import { resolveGlobalSettingsPath } from "@cline/shared/storage";
import { z } from "zod";

const WebSearchSettingsSchema = z.object({ enabled: z.boolean() }).strict();
const GlobalToolsSettingsSchema = z
	.object({ web_search: WebSearchSettingsSchema.optional() })
	.passthrough();
const VoiceInputSelectionSchema = z
	.object({
		providerId: z.string().min(1),
		modelId: z.string().min(1),
	})
	.strict();

const StoredGlobalSettingsSchema = z
	.object({
		telemetryOptOut: z.boolean().default(false),
		autoUpdateEnabled: z.boolean().default(true),
		tools: GlobalToolsSettingsSchema.optional(),
		voiceInput: VoiceInputSelectionSchema.optional(),
	})
	.passthrough();

export type GatewayGlobalSettings = z.infer<typeof StoredGlobalSettingsSchema>;

export interface GatewayGlobalSettingsPatch {
	readonly telemetryOptOut?: boolean;
	readonly autoUpdateEnabled?: boolean;
	readonly webSearchEnabled?: boolean;
}

/**
 * File-backed global settings owned by the Gateway process. Unknown fields
 * are preserved so this focused API can coexist with CLI-only preferences.
 */
export class GatewayGlobalSettingsStore {
	readonly filePath: string;

	constructor(options: { filePath?: string } = {}) {
		this.filePath = options.filePath ?? resolveGlobalSettingsPath();
	}

	get(): GatewayGlobalSettings {
		if (!existsSync(this.filePath)) {
			return StoredGlobalSettingsSchema.parse({});
		}
		try {
			return StoredGlobalSettingsSchema.parse(
				JSON.parse(readFileSync(this.filePath, "utf8")),
			);
		} catch {
			return StoredGlobalSettingsSchema.parse({});
		}
	}

	patch(patch: GatewayGlobalSettingsPatch): GatewayGlobalSettings {
		const current = this.get();
		const next = StoredGlobalSettingsSchema.parse({
			...current,
			...(patch.telemetryOptOut === undefined
				? {}
				: { telemetryOptOut: patch.telemetryOptOut }),
			...(patch.autoUpdateEnabled === undefined
				? {}
				: { autoUpdateEnabled: patch.autoUpdateEnabled }),
			...(patch.webSearchEnabled === undefined
				? {}
				: {
						tools: {
							...(current.tools ?? {}),
							web_search: { enabled: patch.webSearchEnabled },
						},
					}),
		});
		return this.write(next);
	}

	setVoiceInput(
		selection: VoiceInputSelection | undefined,
	): GatewayGlobalSettings {
		const current = this.get();
		const next = StoredGlobalSettingsSchema.parse({
			...current,
			voiceInput: selection,
		});
		return this.write(next);
	}

	private write(settings: GatewayGlobalSettings): GatewayGlobalSettings {
		mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
		const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
		try {
			writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
				mode: 0o600,
			});
			chmodSync(temporary, 0o600);
			renameSync(temporary, this.filePath);
			chmodSync(this.filePath, 0o600);
		} finally {
			rmSync(temporary, { force: true });
		}
		return settings;
	}
}
