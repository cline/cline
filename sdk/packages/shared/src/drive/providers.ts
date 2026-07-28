import { z } from "zod";
import {
	EgressClassSchema,
	SttBackendSchema,
	TtsBackendSchema,
} from "./topology";

export const DriveProviderSlotSchema = z.enum(["stt", "tts"]);
export type DriveProviderSlot = z.infer<typeof DriveProviderSlotSchema>;

export const DriveProviderOriginSchema = z.enum([
	"builtin",
	"workspace",
	"user",
]);
export type DriveProviderOrigin = z.infer<typeof DriveProviderOriginSchema>;

const SECRET_CONFIG_KEYS = ["apiKey", "token", "accessToken", "secret"] as const;

export const DriveProviderManifestSchema = z
	.object({
		schemaVersion: z.literal(1),
		id: z.string().min(1),
		slot: DriveProviderSlotSchema,
		title: z.string().min(1),
		origin: DriveProviderOriginSchema,
		egress: EgressClassSchema,
		backend: z.union([SttBackendSchema, TtsBackendSchema]),
		defaultConfig: z.record(z.string(), z.unknown()).default({}),
		configSchemaId: z.string().min(1),
		modulePath: z.string().min(1).optional(),
	})
	.strict()
	.superRefine((manifest, ctx) => {
		const slotOk =
			(manifest.slot === "stt" &&
				(manifest.backend.kind === "local-worker" ||
					manifest.backend.kind === "webSpeech" ||
					manifest.backend.kind === "cloud-api")) ||
			(manifest.slot === "tts" &&
				(manifest.backend.kind === "browser-speechSynthesis" ||
					manifest.backend.kind === "local-worker" ||
					manifest.backend.kind === "cloud-api"));
		if (!slotOk) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `backend kind does not match slot ${manifest.slot}`,
				path: ["backend"],
			});
		}
		for (const key of SECRET_CONFIG_KEYS) {
			if (
				Object.prototype.hasOwnProperty.call(manifest.defaultConfig, key)
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `secret field '${key}' is forbidden in Drive provider config`,
					path: ["defaultConfig", key],
				});
			}
		}
	});

export type DriveProviderManifest = z.infer<typeof DriveProviderManifestSchema>;

export function parseDriveProviderManifest(
	input: unknown,
): DriveProviderManifest {
	return DriveProviderManifestSchema.parse(input);
}

export function assertNoSecretProviderConfigKeys(
	config: Record<string, unknown>,
): void {
	for (const key of SECRET_CONFIG_KEYS) {
		if (Object.prototype.hasOwnProperty.call(config, key)) {
			throw new Error(
				`secret field '${key}' is forbidden in Drive provider config`,
			);
		}
	}
}

export const BUILTIN_WEB_SPEECH_STT_ID = "builtin.webSpeech" as const;
export const BUILTIN_LOCAL_WORKER_STT_ID = "builtin.localWorkerStt" as const;
export const BUILTIN_BROWSER_TTS_ID = "builtin.browserTts" as const;

export const BUILTIN_PROVIDER_MANIFESTS: readonly DriveProviderManifest[] = [
	parseDriveProviderManifest({
		schemaVersion: 1,
		id: BUILTIN_WEB_SPEECH_STT_ID,
		slot: "stt",
		title: "Web Speech (browser)",
		origin: "builtin",
		egress: "platform-cloud",
		backend: { kind: "webSpeech" },
		defaultConfig: {},
		configSchemaId: "builtin.webSpeech.v1",
	}),
	parseDriveProviderManifest({
		schemaVersion: 1,
		id: BUILTIN_LOCAL_WORKER_STT_ID,
		slot: "stt",
		title: "Local STT worker",
		origin: "builtin",
		egress: "loopback-only",
		backend: { kind: "local-worker", engine: "whisper-cpp" },
		defaultConfig: {},
		configSchemaId: "builtin.localWorkerStt.v1",
	}),
	parseDriveProviderManifest({
		schemaVersion: 1,
		id: BUILTIN_BROWSER_TTS_ID,
		slot: "tts",
		title: "Browser speechSynthesis",
		origin: "builtin",
		egress: "loopback-only",
		backend: { kind: "browser-speechSynthesis" },
		defaultConfig: {},
		configSchemaId: "builtin.browserTts.v1",
	}),
];
