import { readFile, stat } from "node:fs/promises";
import { Agent as HttpsAgent } from "node:https";
import { isAbsolute, resolve } from "node:path";
import { fromNodeProviderChain } from "@aws-sdk/credential-providers";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import type { BedrockConnection } from "./config";

export interface BedrockTransport {
	ca?: string;
	fetch: typeof fetch;
	requestHandler?: NodeHttpHandler;
	dispose(): Promise<void>;
}

export type BedrockCredentialProvider = () => PromiseLike<{
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}>;

function resolveCaBundlePath(
	caBundlePath: string,
	workspaceRoot?: string,
): string {
	if (isAbsolute(caBundlePath)) {
		return caBundlePath;
	}
	if (!workspaceRoot) {
		throw new Error(
			"BEDROCK_CA_BUNDLE: A relative CA bundle path requires an open workspace.",
		);
	}
	return resolve(workspaceRoot, caBundlePath);
}

function validatePem(ca: string): void {
	if (
		!/-----BEGIN (?:TRUSTED )?CERTIFICATE-----[\s\S]+-----END (?:TRUSTED )?CERTIFICATE-----/.test(
			ca,
		)
	) {
		throw new Error(
			"BEDROCK_CA_BUNDLE: The CA bundle does not contain readable PEM certificate data.",
		);
	}
}

async function loadCaBundle(
	connection: BedrockConnection,
	workspaceRoot?: string,
): Promise<string | undefined> {
	const configuredPath = connection.caBundlePath?.trim();
	if (!configuredPath) return undefined;

	const absolutePath = resolveCaBundlePath(configuredPath, workspaceRoot);
	try {
		const details = await stat(absolutePath);
		if (!details.isFile()) {
			throw new Error("not a file");
		}
		const ca = await readFile(absolutePath, "utf8");
		validatePem(ca);
		return ca;
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.startsWith("BEDROCK_CA_BUNDLE:")
		) {
			throw error;
		}
		throw new Error(
			"BEDROCK_CA_BUNDLE: The configured CA bundle is missing or unreadable.",
		);
	}
}

export function validateBedrockConnection(
	connection: BedrockConnection,
): BedrockConnection {
	const region = connection.region.trim();
	if (!region || !/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) {
		throw new Error("BEDROCK_REGION: Enter a valid AWS region.");
	}

	const endpoint = connection.endpoint?.trim();
	const controlPlaneEndpoint = connection.controlPlaneEndpoint?.trim();
	for (const [value, errorPrefix] of [
		[endpoint, "BEDROCK_ENDPOINT"],
		[controlPlaneEndpoint, "BEDROCK_CONTROL_PLANE_ENDPOINT"],
	] as const) {
		if (!value) continue;
		let parsed: URL;
		try {
			parsed = new URL(value);
		} catch {
			throw new Error(`${errorPrefix}: Enter a valid HTTPS endpoint.`);
		}
		if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
			throw new Error(`${errorPrefix}: Enter a valid HTTPS endpoint.`);
		}
	}

	return {
		region,
		...(connection.profile?.trim()
			? { profile: connection.profile.trim() }
			: {}),
		...(endpoint ? { endpoint } : {}),
		...(connection.caBundlePath?.trim()
			? { caBundlePath: connection.caBundlePath.trim() }
			: {}),
		...(controlPlaneEndpoint ? { controlPlaneEndpoint } : {}),
	};
}

export async function createBedrockTransport(
	connection: BedrockConnection,
	workspaceRoot?: string,
): Promise<BedrockTransport> {
	const ca = await loadCaBundle(connection, workspaceRoot);
	if (!ca) {
		return {
			fetch: globalThis.fetch,
			async dispose() {},
		};
	}

	const httpsAgent = new HttpsAgent({ ca });
	const dispatcher = new UndiciAgent({ connect: { ca } });
	const requestHandler = new NodeHttpHandler({ httpsAgent });
	const transportFetch = (async (input, init) =>
		undiciFetch(input as Parameters<typeof undiciFetch>[0], {
			...(init as Parameters<typeof undiciFetch>[1]),
			dispatcher,
		}) as unknown as Promise<Response>) as typeof fetch;

	return {
		ca,
		fetch: transportFetch,
		requestHandler,
		async dispose() {
			httpsAgent.destroy();
			await dispatcher.close();
		},
	};
}

export function createBedrockCredentialProvider(
	connection: BedrockConnection,
	transport: Pick<BedrockTransport, "requestHandler">,
): BedrockCredentialProvider {
	const clientConfig = {
		region: connection.region,
		...(transport.requestHandler
			? { requestHandler: transport.requestHandler }
			: {}),
	};
	return connection.profile
		? fromNodeProviderChain({
				profile: connection.profile,
				ignoreCache: true,
				clientConfig,
			})
		: fromNodeProviderChain({ clientConfig });
}
