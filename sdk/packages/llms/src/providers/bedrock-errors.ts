type ErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): ErrorRecord | undefined {
	return value && typeof value === "object"
		? (value as ErrorRecord)
		: undefined;
}

function errorChain(error: unknown): ErrorRecord[] {
	const chain: ErrorRecord[] = [];
	let current = asRecord(error);
	for (let index = 0; current && index < 5; index += 1) {
		chain.push(current);
		current = asRecord(current.cause);
	}
	return chain;
}

function readString(record: ErrorRecord, key: string): string | undefined {
	const value = record[key];
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requestId(chain: ErrorRecord[]): string | undefined {
	for (const item of chain) {
		const metadata = asRecord(item.$metadata);
		const value =
			readString(item, "requestId") ??
			(metadata ? readString(metadata, "requestId") : undefined);
		if (value) return value;
	}
	return undefined;
}

function errorCode(chain: ErrorRecord[]): string | undefined {
	for (const item of chain) {
		const value = readString(item, "code") ?? readString(item, "name");
		if (
			value &&
			/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value) &&
			value !== "Error"
		) {
			return value;
		}
	}
	return undefined;
}

export type BedrockErrorCategory =
	| "ca-bundle"
	| "tls-certificate"
	| "network"
	| "endpoint"
	| "credentials"
	| "access-denied"
	| "region"
	| "validation"
	| "service";

export function sanitizeBedrockError(error: unknown): string {
	const chain = errorChain(error);
	const description = chain
		.flatMap((item) => [
			readString(item, "name"),
			readString(item, "code"),
			readString(item, "message"),
		])
		.filter(Boolean)
		.join(" ")
		.toLowerCase();

	let category: BedrockErrorCategory = "service";
	let message = "AWS Bedrock request failed.";

	if (description.includes("bedrock_ca_bundle")) {
		category = "ca-bundle";
		message = "The configured CA bundle is missing, unreadable, or invalid.";
	} else if (
		/(certificate|self.signed|unable.to.verify|tls|ssl|cert_)/.test(description)
	) {
		category = "tls-certificate";
		message = "TLS certificate validation failed.";
	} else if (
		/(enotfound|eai_again|econnrefused|etimedout|socket|proxy|dns)/.test(
			description,
		)
	) {
		category = "network";
		message =
			"AWS Bedrock could not be reached through DNS or the configured proxy.";
	} else if (
		description.includes("bedrock_endpoint") ||
		description.includes("invalid endpoint")
	) {
		category = "endpoint";
		message = "The Bedrock endpoint is invalid.";
	} else if (
		/(credential|expiredtoken|unrecognizedclient|invalidclienttokenid|sso.*expired)/.test(
			description,
		)
	) {
		category = "credentials";
		message = "AWS credentials are missing or expired.";
	} else if (/(accessdenied|unauthorized|forbidden)/.test(description)) {
		category = "access-denied";
		message = "AWS denied access to the requested Bedrock resource.";
	} else if (
		description.includes("bedrock_region") ||
		/invalid.*region/.test(description)
	) {
		category = "region";
		message = "The AWS region is invalid.";
	} else if (
		/(validationexception|validation error|bad request)/.test(description)
	) {
		category = "validation";
		message = "AWS Bedrock rejected the request as invalid.";
	}

	const code = errorCode(chain);
	const id = requestId(chain);
	return `Bedrock ${category}: ${message}${code ? ` Error code: ${code}.` : ""}${id ? ` Request ID: ${id}` : ""}`;
}
