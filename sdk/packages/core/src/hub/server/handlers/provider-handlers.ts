import { isDeepStrictEqual } from "node:util";
import {
	type HubCommandEnvelope,
	type HubReplyEnvelope,
	ProviderCapabilitySchema,
	ProviderClientSchema,
	ProviderProtocolSchema,
	type ProviderSettingsObjectPatch,
} from "@cline/shared";
import { z } from "zod";
import { getProviderAuthHandler } from "../../../auth/provider-auth-registry";
import { fetchClineRecommendedModels } from "../../../services/llms/cline-recommended-models";
import { ProviderSettingsSchema } from "../../../services/llms/provider-settings";
import { clearLegacyProviderCredentials } from "../../../services/providers/legacy-provider-credentials";
import {
	addLocalProvider,
	ensureCustomProvidersLoaded,
	getLocalProviderModels,
	listLocalProviders,
	saveLocalProviderSettings,
	updateLocalProvider,
} from "../../../services/providers/local-provider-service";
import { ProviderSettingsManager } from "../../../services/storage/provider-settings-manager";
import { errorReply, okReply } from "./context";

const providerId = z.string().trim().min(1);
const listSchema = z
	.object({ isClinePassEnabled: z.boolean().optional() })
	.strict();
const modelsSchema = z
	.object({
		providerId,
		includeCloudModels: z.boolean().optional(),
	})
	.strict();
/** Match the merge/delete semantics of saveLocalProviderSettings before validating persisted state. */
function objectPatch<T extends z.ZodRawShape>(schema: z.ZodObject<T>) {
	const fields = Object.fromEntries(
		Object.entries(schema.shape).map(([key, field]) => [
			key,
			z.union([field, z.null(), z.literal("")]).optional(),
		]),
	);
	return z.object(fields).strict() as z.ZodType<
		ProviderSettingsObjectPatch<z.infer<z.ZodObject<T>>>
	>;
}

const saveSchema = ProviderSettingsSchema.omit({
	provider: true,
	modelCatalog: true,
})
	.extend({
		providerId,
		enabled: z.boolean().optional(),
		auth: objectPatch(ProviderSettingsSchema.shape.auth.unwrap()).optional(),
		reasoning: objectPatch(
			ProviderSettingsSchema.shape.reasoning.unwrap(),
		).optional(),
		aws: objectPatch(ProviderSettingsSchema.shape.aws.unwrap()).optional(),
		gcp: objectPatch(ProviderSettingsSchema.shape.gcp.unwrap()).optional(),
		azure: objectPatch(ProviderSettingsSchema.shape.azure.unwrap()).optional(),
		sap: objectPatch(ProviderSettingsSchema.shape.sap.unwrap()).optional(),
		oca: objectPatch(ProviderSettingsSchema.shape.oca.unwrap()).optional(),
		headers: z.record(z.string(), z.string().nullable()).optional(),
		capabilities: z
			.array(
				z.enum([
					"reasoning",
					"prompt-cache",
					"streaming",
					"tools",
					"vision",
					"computer-use",
					"oauth",
				]),
			)
			.optional(),
		// An empty endpoint clears the persisted override.
		baseUrl: z.union([z.literal(""), z.url()]).optional(),
	})
	.strict();
const addSchema = z
	.object({
		providerId,
		name: z.string().trim().min(1),
		baseUrl: z.url(),
		apiKey: z.string().optional(),
		headers: z.record(z.string(), z.string()).optional(),
		timeoutMs: z.number().positive().optional(),
		models: z.array(z.string()).optional(),
		defaultModelId: z.string().optional(),
		modelsSourceUrl: z.string().optional(),
		protocol: ProviderProtocolSchema.optional(),
		client: ProviderClientSchema.optional(),
		capabilities: z.array(ProviderCapabilitySchema).optional(),
	})
	.strict();
const updateModelsSchema = z
	.object({
		providerId,
		models: z.array(z.string()).optional(),
	})
	.strict();

/** Provider configuration is machine-local and independent of session workspaces. */
export async function handleProviderCommand(
	envelope: HubCommandEnvelope,
): Promise<HubReplyEnvelope> {
	try {
		const payload = envelope.payload ?? {};
		const manager = new ProviderSettingsManager();
		switch (envelope.command) {
			case "providers.list": {
				const options = listSchema.parse(payload);
				await ensureCustomProvidersLoaded(manager);
				return okReply(envelope, await listLocalProviders(manager, options));
			}
			case "providers.models.list": {
				const input = modelsSchema.parse(payload);
				await ensureCustomProvidersLoaded(manager);
				return okReply(
					envelope,
					await getLocalProviderModels(
						input.providerId,
						manager.getProviderConfig(input.providerId, {
							includeKnownModels: false,
						}),
						{
							loadLatest:
								input.providerId === "cline" &&
								input.includeCloudModels === true,
						},
					),
				);
			}
			case "providers.models.recommended": {
				z.object({}).strict().parse(payload);
				return okReply(envelope, {
					...(await fetchClineRecommendedModels({
						providerSettingsManager: manager,
					})),
				});
			}
			case "providers.settings.save": {
				const input = saveSchema.parse(payload);
				const storageProviderId =
					getProviderAuthHandler(input.providerId)?.storageProviderId ??
					input.providerId;
				const previous =
					storageProviderId === "cline"
						? manager.getProviderSettings("cline")
						: undefined;
				const saved = await saveLocalProviderSettings(manager, input);
				if (!saved.enabled) {
					if (storageProviderId !== saved.providerId) {
						await saveLocalProviderSettings(manager, {
							providerId: storageProviderId,
							enabled: false,
						});
					}
					clearLegacyProviderCredentials(storageProviderId);
				}
				const current =
					storageProviderId === "cline"
						? manager.getProviderSettings("cline")
						: undefined;
				return okReply(envelope, {
					...saved,
					clineCredentialsChanged:
						storageProviderId === "cline" &&
						(previous?.apiKey !== current?.apiKey ||
							!isDeepStrictEqual(previous?.auth, current?.auth)),
				});
			}
			case "providers.add": {
				const input = addSchema.parse(payload);
				await ensureCustomProvidersLoaded(manager);
				return okReply(envelope, await addLocalProvider(manager, input));
			}
			case "providers.models.update": {
				const input = updateModelsSchema.parse(payload);
				await ensureCustomProvidersLoaded(manager);
				return okReply(envelope, await updateLocalProvider(manager, input));
			}
			default:
				return errorReply(
					envelope,
					"unsupported_command",
					`Unsupported provider command: ${envelope.command}`,
				);
		}
	} catch (error) {
		return errorReply(
			envelope,
			error instanceof z.ZodError ? "invalid_payload" : "provider_error",
			error instanceof Error ? error.message : String(error),
		);
	}
}
