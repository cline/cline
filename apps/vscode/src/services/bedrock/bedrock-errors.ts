import type { BedrockDoctorError, BedrockDoctorErrorCategory } from "@shared/bedrock-startup"

type ErrorRecord = Record<string, unknown>

function asRecord(value: unknown): ErrorRecord | undefined {
	return value && typeof value === "object" ? (value as ErrorRecord) : undefined
}

function errorChain(error: unknown): ErrorRecord[] {
	const chain: ErrorRecord[] = []
	let current = asRecord(error)
	for (let index = 0; current && index < 5; index += 1) {
		chain.push(current)
		current = asRecord(current.cause)
	}
	return chain
}

function readString(record: ErrorRecord, key: string): string | undefined {
	const value = record[key]
	return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function readNumber(record: ErrorRecord, key: string): number | undefined {
	const value = record[key]
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function firstString(chain: ErrorRecord[], keys: string[]): string | undefined {
	for (const record of chain) {
		for (const key of keys) {
			const value = readString(record, key)
			if (value) return value
		}
	}
	return undefined
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
	[/"(aws_access_key_id|accesskeyid)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"'],
	[/"(aws_secret_access_key|secretaccesskey)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"'],
	[/"(aws_session_token|sessiontoken|x-amz-security-token)"\s*:\s*"[^"]*"/gi, '"$1":"[REDACTED]"'],
	[/"authorization"\s*:\s*"[^"]*"/gi, '"Authorization":"[REDACTED]"'],
	[/\b(AKIA|ASIA)[A-Z0-9]{12,}\b/g, "[REDACTED_AWS_ACCESS_KEY]"],
	[/\b(aws_access_key_id|accesskeyid)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]"],
	[/\b(aws_secret_access_key|secretaccesskey)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]"],
	[/\b(aws_session_token|sessiontoken|x-amz-security-token)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]"],
	[/\b(authorization)\s*[:=]\s*[^\r\n]+/gi, "$1: [REDACTED]"],
	[/([?&](?:X-Amz-(?:Credential|Signature|Security-Token)|token|credential)=)[^&\s]+/gi, "$1[REDACTED]"],
	[/([?&][^=&]*(?:key|secret|password|auth|signature|token|credential)[^=&]*=)[^&\s"]+/gi, "$1[REDACTED]"],
	[/\barn:aws(?:-[a-z]+)?:sts::\d{12}:[^"\s,;]+/gi, "[REDACTED_STS_IDENTITY]"],
]

export function redactBedrockDiagnostics(value: unknown): string {
	let serialized: string
	if (typeof value === "string") {
		serialized = value
	} else {
		try {
			serialized = JSON.stringify(value)
		} catch {
			serialized = String(value)
		}
	}
	for (const [pattern, replacement] of SECRET_PATTERNS) {
		serialized = serialized.replace(pattern, replacement)
	}
	return serialized.slice(0, 2_000)
}

function categoryFor(description: string, stage: string): BedrockDoctorErrorCategory {
	if (/abort|cancel/.test(description)) return "cancelled"
	if (/bedrock_ca_bundle|enoent|not a file|pem certificate/.test(description)) return "configuration"
	if (/certificate|self.signed|unable.to.verify|tls|ssl|cert_/.test(description)) return "tls"
	if (/enotfound|eai_again|dns/.test(description)) return "dns"
	if (/proxy/.test(description)) return "proxy"
	if (/invalid endpoint|endpoint.*invalid|bedrock_endpoint|control_plane_endpoint/.test(description)) return "endpoint"
	if (/credential|expiredtoken|unrecognizedclient|invalidclienttokenid|sso.*expired/.test(description)) {
		return "credentials"
	}
	if (/accessdenied|unauthorized|forbidden/.test(description)) return "authorization"
	if (/throttl|too.?many.?requests|requestlimitexceeded/.test(description)) return "throttling"
	if (/validationexception|validation error|model.*not.*supported|resource.*not.*found/.test(description)) {
		return "model-validation"
	}
	if (stage === "probingSelection" && /stream|eventstream/.test(description)) return "streaming"
	return "unknown"
}

function suggestionFor(category: BedrockDoctorErrorCategory): string | undefined {
	switch (category) {
		case "configuration":
			return "Check the region, endpoint, and CA-bundle path, then retry."
		case "credentials":
			return "Refresh environment credentials or authenticate the selected AWS profile/SSO session."
		case "tls":
			return "Verify the configured CA bundle contains the issuing certificates."
		case "dns":
		case "proxy":
			return "Check DNS and proxy access from the VS Code extension host."
		case "endpoint":
			return "Use separate HTTPS endpoints for Bedrock Runtime and the Bedrock control plane."
		case "authorization":
			return "Grant the required STS/Bedrock discovery and invocation actions, then retry."
		case "throttling":
			return "Wait briefly and retry the failed stage."
		case "model-validation":
			return "Choose another discovered target or inspect the AWS validation details."
		case "streaming":
			return "Confirm response streaming is allowed for this target and endpoint."
		case "cancelled":
			return "Retry when you are ready."
		default:
			return "Inspect the diagnostic log and retry."
	}
}

export function mapBedrockDoctorError(
	error: unknown,
	context: Pick<BedrockDoctorError, "stage" | "service" | "operation">,
): BedrockDoctorError {
	const chain = errorChain(error)
	const rawDescription = chain
		.flatMap((item) => [readString(item, "name"), readString(item, "code"), readString(item, "message")])
		.filter(Boolean)
		.join(" ")
	const description = rawDescription.toLowerCase()
	const category = categoryFor(description, context.stage)
	const metadata = chain.map((item) => asRecord(item.$metadata)).find(Boolean)
	const awsCode = firstString(chain, ["code", "name"])
	const requestId = firstString(chain, ["requestId"]) ?? (metadata ? readString(metadata, "requestId") : undefined)
	const httpStatus =
		chain.map((item) => readNumber(item, "statusCode")).find((value) => value !== undefined) ??
		(metadata ? readNumber(metadata, "httpStatusCode") : undefined)
	const safeDetail = redactBedrockDiagnostics(rawDescription)
	const includeAwsDetail = category === "model-validation" || category === "streaming"
	const baseMessage =
		category === "cancelled"
			? "The Bedrock startup check was cancelled."
			: category === "credentials"
				? "AWS credentials are missing, invalid, or expired."
				: category === "authorization"
					? "AWS denied the requested operation."
					: category === "configuration"
						? "The Bedrock connection configuration is invalid."
						: category === "tls"
							? "TLS certificate validation failed."
							: category === "dns"
								? "The AWS service hostname could not be resolved."
								: category === "proxy"
									? "The AWS service could not be reached through the configured proxy."
									: category === "endpoint"
										? "The configured AWS endpoint is invalid or unreachable."
										: category === "throttling"
											? "AWS throttled the request."
											: category === "model-validation"
												? "AWS rejected the selected Bedrock target."
												: category === "streaming"
													? "The Bedrock streaming probe failed."
													: "The Bedrock startup check failed."

	return {
		...context,
		category,
		...(awsCode && awsCode !== "Error" ? { awsCode } : {}),
		...(httpStatus !== undefined ? { httpStatus } : {}),
		...(requestId ? { requestId } : {}),
		message: includeAwsDetail && safeDetail ? `${baseMessage} ${safeDetail}` : baseMessage,
		suggestion: suggestionFor(category),
	}
}
