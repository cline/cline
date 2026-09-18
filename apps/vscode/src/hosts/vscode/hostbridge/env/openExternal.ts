import { Empty, StringRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"

// Central allowlist for external URI schemes. http/https for web navigation,
// mailto for email links (pre-filled mailto URIs are technically phishing-adjacent
// but the scheme itself is safe from code execution; restricted to http/https only
// would also be acceptable if product decides to remove mailto).
const ALLOWED_EXTERNAL_URI_SCHEMES = new Set(["http", "https", "mailto"])

export function isAllowedExternalUriScheme(scheme: string): boolean {
	return ALLOWED_EXTERNAL_URI_SCHEMES.has(scheme.toLowerCase())
}

export function assertAllowedExternalUrl(url: string): void {
	// Use strict parsing to reject malformed URIs early
	const uri = vscode.Uri.parse(url, true)
	if (!uri.scheme) {
		throw new Error(`Invalid external URL: missing scheme: ${url}`)
	}
	if (!isAllowedExternalUriScheme(uri.scheme)) {
		throw new Error(`Unsupported external URI scheme: ${uri.scheme}`)
	}
}

export async function openExternal(request: StringRequest): Promise<Empty> {
	// Strict parsing + allowlist validation before any external launch
	const uri = vscode.Uri.parse(request.value, true)
	if (!ALLOWED_EXTERNAL_URI_SCHEMES.has(uri.scheme.toLowerCase())) {
		throw new Error(`Unsupported external URI scheme: ${uri.scheme}`)
	}
	await vscode.env.openExternal(uri) // ← Routes to local browser in remote setups!
	return Empty.create({})
}
