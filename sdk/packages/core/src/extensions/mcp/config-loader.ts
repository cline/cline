import { existsSync, readFileSync } from "node:fs";
import { resolveMcpSettingsPath } from "@clinebot/shared/storage";
import { z } from "zod";
import type { McpManager, McpServerRegistration } from "./types";

const stringRecordSchema = z.record(z.string(), z.string());
const metadataSchema = z.record(z.string(), z.unknown());

const stdioTransportSchema = z.object({
	type: z.literal("stdio"),
	command: z.string().min(1),
	args: z.array(z.string()).optional(),
	cwd: z.string().min(1).optional(),
	env: stringRecordSchema.optional(),
});

const sseTransportSchema = z.object({
	type: z.literal("sse"),
	url: z.string().url(),
	headers: stringRecordSchema.optional(),
});

const streamableHttpTransportSchema = z.object({
	type: z.literal("streamableHttp"),
	url: z.string().url(),
	headers: stringRecordSchema.optional(),
});

const mcpTransportSchema = z.discriminatedUnion("type", [
	stdioTransportSchema,
	sseTransportSchema,
	streamableHttpTransportSchema,
]);

const nestedRegistrationBodySchema = z.object({
	transport: mcpTransportSchema,
	disabled: z.boolean().optional(),
	metadata: metadataSchema.optional(),
});

const legacyTransportTypeSchema = z
	.enum(["stdio", "sse", "http", "streamableHttp"])
	.optional();

const legacyRegistrationBaseSchema = z.object({
	type: z.enum(["stdio", "sse", "streamableHttp"]).optional(),
	transportType: legacyTransportTypeSchema,
	disabled: z.boolean().optional(),
	metadata: metadataSchema.optional(),
});

function mapLegacyTransportType(
	transportType: z.infer<typeof legacyTransportTypeSchema>,
): "stdio" | "sse" | "streamableHttp" | undefined {
	if (!transportType) {
		return undefined;
	}
	if (transportType === "http") {
		return "streamableHttp";
	}
	return transportType;
}

const legacyStdioRegistrationSchema = legacyRegistrationBaseSchema
	.extend({
		command: z.string().min(1),
		args: z.array(z.string()).optional(),
		cwd: z.string().min(1).optional(),
		env: stringRecordSchema.optional(),
	})
	.superRefine((value, ctx) => {
		const resolvedType =
			value.type ?? mapLegacyTransportType(value.transportType);
		if (resolvedType && resolvedType !== "stdio") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: 'Expected type "stdio" for command-based MCP server',
				path: ["type"],
			});
		}
	})
	.transform((value) => ({
		transport: {
			type: "stdio" as const,
			command: value.command,
			args: value.args,
			cwd: value.cwd,
			env: value.env,
		},
		disabled: value.disabled,
		metadata: value.metadata,
	}));

const legacyUrlRegistrationSchema = legacyRegistrationBaseSchema
	.extend({
		url: z.string().url(),
		headers: stringRecordSchema.optional(),
	})
	.superRefine((value, ctx) => {
		const resolvedType =
			value.type ?? mapLegacyTransportType(value.transportType) ?? "sse";
		if (resolvedType !== "sse" && resolvedType !== "streamableHttp") {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message:
					'Expected type "sse" or "streamableHttp" for URL-based MCP server',
				path: ["type"],
			});
		}
	})
	.transform((value) => {
		const resolvedType =
			value.type ?? mapLegacyTransportType(value.transportType) ?? "sse";
		if (resolvedType === "streamableHttp") {
			return {
				transport: {
					type: "streamableHttp" as const,
					url: value.url,
					headers: value.headers,
				},
				disabled: value.disabled,
				metadata: value.metadata,
			};
		}
		return {
			transport: {
				type: "sse" as const,
				url: value.url,
				headers: value.headers,
			},
			disabled: value.disabled,
			metadata: value.metadata,
		};
	});

const mcpRegistrationBodySchema = z.union([
	nestedRegistrationBodySchema,
	legacyStdioRegistrationSchema,
	legacyUrlRegistrationSchema,
]);

const mcpSettingsSchema = z
	.object({
		mcpServers: z.record(z.string(), mcpRegistrationBodySchema),
	})
	.strict();

export interface McpSettingsFile {
	mcpServers: Record<string, Omit<McpServerRegistration, "name">>;
}

export interface LoadMcpSettingsOptions {
	filePath?: string;
}

export interface RegisterMcpServersFromSettingsOptions {
	filePath?: string;
}

export function resolveDefaultMcpSettingsPath(): string {
	return resolveMcpSettingsPath();
}

export function loadMcpSettingsFile(
	options: LoadMcpSettingsOptions = {},
): McpSettingsFile {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	const raw = readFileSync(filePath, "utf8");
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const details = error instanceof Error ? error.message : String(error);
		throw new Error(
			`Failed to parse MCP settings JSON at "${filePath}": ${details}`,
		);
	}
	const result = mcpSettingsSchema.safeParse(parsed);
	if (!result.success) {
		const details = result.error.issues
			.map((issue) => {
				const path = issue.path.join(".");
				return path ? `${path}: ${issue.message}` : issue.message;
			})
			.join("; ");
		throw new Error(`Invalid MCP settings at "${filePath}": ${details}`);
	}
	return result.data;
}

export function hasMcpSettingsFile(
	options: LoadMcpSettingsOptions = {},
): boolean {
	const filePath = options.filePath ?? resolveDefaultMcpSettingsPath();
	return existsSync(filePath);
}

export function resolveMcpServerRegistrations(
	options: LoadMcpSettingsOptions = {},
): McpServerRegistration[] {
	const config = loadMcpSettingsFile(options);
	return Object.entries(config.mcpServers).map(([name, value]) => ({
		name,
		transport: value.transport,
		disabled: value.disabled,
		metadata: value.metadata,
	}));
}

export async function registerMcpServersFromSettingsFile(
	manager: Pick<McpManager, "registerServer">,
	options: RegisterMcpServersFromSettingsOptions = {},
): Promise<McpServerRegistration[]> {
	const registrations = resolveMcpServerRegistrations(options);
	for (const registration of registrations) {
		await manager.registerServer(registration);
	}
	return registrations;
}
