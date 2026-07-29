/**
 * Hub drive_config_get / drive_config_put (durable facet lane).
 */

import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { parseDriveFacetValues, type ResolvedLlmEgress } from "@cline/shared";
import {
	loadOrSeedDriveFacets,
	setDriveFacets,
} from "../../drive-config/driveFacetsStore";
import { errorReply, type HubTransportContext, okReply } from "./context";

function readString(
	payload: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = payload?.[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function defaultLlm(): ResolvedLlmEgress {
	return { kind: "cloud", providerId: "anthropic" };
}

export function handleDriveConfigCommand(
	ctx: HubTransportContext,
	envelope: HubCommandEnvelope,
): HubReplyEnvelope {
	const configParent =
		readString(envelope.payload, "configParent") ??
		readString(envelope.payload, "workspaceRoot");
	if (!configParent) {
		return errorReply(
			envelope,
			"invalid_payload",
			"configParent or workspaceRoot is required",
		);
	}

	switch (envelope.command) {
		case "drive_config_get": {
			const facets = loadOrSeedDriveFacets({ configParent });
			return okReply(envelope, { facets });
		}
		case "drive_config_put": {
			let facets: ReturnType<typeof parseDriveFacetValues>;
			try {
				facets = parseDriveFacetValues(envelope.payload?.facets);
			} catch (error) {
				return errorReply(
					envelope,
					"invalid_payload",
					error instanceof Error ? error.message : String(error),
				);
			}
			const llm =
				(envelope.payload?.llm as ResolvedLlmEgress | undefined) ??
				defaultLlm();
			const result = setDriveFacets({ configParent, facets, llm });
			if (!result.ok) {
				return errorReply(envelope, "facet_rejected", result.message);
			}
			ctx.publish(
				ctx.buildEvent("drive.config.changed", {
					snapshot: result.snapshot as unknown as Record<string, unknown>,
				}),
			);
			return okReply(envelope, {
				facets: result.facets,
				snapshot: result.snapshot,
			});
		}
		default:
			return errorReply(
				envelope,
				"not_implemented",
				`Unknown drive config command: ${envelope.command}`,
			);
	}
}
