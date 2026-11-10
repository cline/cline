import type { HubCommandEnvelope, HubReplyEnvelope } from "@cline/shared";
import { z } from "zod";
import { parseMcpInstallArgs } from "../../../services/mcp-install";
import type { McpManagementService } from "../../../services/mcp-management";
import { errorReply, okReply } from "./context";

const name = z
	.string()
	.trim()
	.min(1)
	.refine(
		(value) => !["__proto__", "prototype", "constructor"].includes(value),
		"Invalid server name",
	);
// Existing entries are addressed by their exact stored JSON key.
const storedKey = z.string();
const strings = z.record(z.string(), z.string());
const common = {
	name,
	previousName: storedKey.optional(),
	disabled: z.boolean().optional(),
	metadata: z.record(z.string(), z.unknown()).optional(),
};
const config = z.discriminatedUnion("transportType", [
	z
		.object({
			...common,
			transportType: z.literal("stdio"),
			command: z.string().trim().min(1),
			args: z.array(z.string()).optional(),
			cwd: z.string().min(1).optional(),
			env: strings.optional(),
		})
		.strict(),
	...(["sse", "streamableHttp"] as const).map((type) =>
		z
			.object({
				...common,
				transportType: z.literal(type),
				url: z
					.url()
					.refine((value) =>
						["http:", "https:"].includes(new URL(value).protocol),
					),
				headers: strings.optional(),
			})
			.strict(),
	),
]);
export async function handleMcpManagementCommand(
	envelope: HubCommandEnvelope,
	service: McpManagementService,
	owner: string,
): Promise<HubReplyEnvelope> {
	try {
		const payload = envelope.payload ?? {};
		switch (envelope.command) {
			case "mcp.oauth.start": {
				const input = z
					.object({ name, loginId: z.string().min(1) })
					.strict()
					.parse(payload);
				return okReply(
					envelope,
					service.oauth.start(owner, input.loginId, input.name),
				);
			}
			case "mcp.oauth.next": {
				const input = z
					.object({ loginId: z.string().min(1) })
					.strict()
					.parse(payload);
				return okReply(envelope, {
					...(await service.oauth.next(owner, input.loginId)),
				});
			}
			case "mcp.oauth.cancel": {
				const input = z
					.object({
						loginId: z.string().min(1),
						reason: z.enum(["user", "disconnected"]),
					})
					.strict()
					.parse(payload);
				return okReply(
					envelope,
					service.oauth.cancel(owner, input.loginId, input.reason),
				);
			}

			case "mcp.servers.list":
				z.object({}).strict().parse(payload);
				return okReply(envelope, { ...service.list() });
			case "mcp.settings.ensure":
				z.object({}).strict().parse(payload);
				return okReply(envelope, await service.ensure());
			case "mcp.servers.upsert":
				return okReply(envelope, {
					...(await service.upsert(config.parse(payload))),
				});
			case "mcp.servers.set_disabled": {
				const input = z
					.object({ name: storedKey, disabled: z.boolean() })
					.strict()
					.parse(payload);
				return okReply(envelope, {
					...(await service.setDisabled(input.name, input.disabled)),
				});
			}
			case "mcp.servers.delete": {
				const input = z.object({ name: storedKey }).strict().parse(payload);
				return okReply(envelope, { ...(await service.delete(input.name)) });
			}
			case "mcp.servers.inspect": {
				const input = z.object({ name: storedKey }).strict().parse(payload);
				return okReply(envelope, { ...(await service.inspect(input.name)) });
			}
			case "mcp.servers.install": {
				const input = z
					.object({ args: z.array(z.string()) })
					.strict()
					.parse(payload);
				name.parse(parseMcpInstallArgs(input.args).name);
				return okReply(envelope, { ...(await service.install(input.args)) });
			}
			default:
				return errorReply(
					envelope,
					"unknown_command",
					"Unknown MCP management command",
				);
		}
	} catch (error) {
		return errorReply(
			envelope,
			error instanceof z.ZodError ? "invalid_payload" : "mcp_management_failed",
			error instanceof Error ? error.message : String(error),
		);
	}
}
