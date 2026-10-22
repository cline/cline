import { z } from "zod"
import type { UserRemoteConfigDiscoveryResponse } from "@/shared/ClineAccount"
import { type RemoteConfig, RemoteConfigSchema } from "@/shared/remote-config/schema"

const RemoteConfigDiscoverySchema = z.object({
	organizationId: z.string().min(1),
	value: z.string(),
	organizations: z
		.array(
			z.object({
				organizationId: z.string().min(1),
				name: z.string(),
			}),
		)
		.optional(),
})

const OrganizationRemoteConfigDataSchema = z.object({
	enabled: z.boolean(),
	value: z.string(),
})

const OrganizationRemoteConfigResponseSchema = z.object({
	success: z.literal(true),
	error: z.string().optional(),
	data: OrganizationRemoteConfigDataSchema,
})

export function parseRemoteConfigDiscovery(value: unknown): UserRemoteConfigDiscoveryResponse {
	return RemoteConfigDiscoverySchema.parse(value)
}

export function parseRemoteConfigValue(value: string): RemoteConfig {
	return RemoteConfigSchema.parse(JSON.parse(value))
}

export function parseOrganizationRemoteConfigResponse(value: unknown): { enabled: boolean; remoteConfig?: RemoteConfig } {
	const response = OrganizationRemoteConfigResponseSchema.parse(value)
	return {
		enabled: response.data.enabled,
		remoteConfig: response.data.enabled ? parseRemoteConfigValue(response.data.value) : undefined,
	}
}
