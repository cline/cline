import { randomBytes, randomUUID } from "node:crypto";
import {
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { resolveProviderSettingsPath } from "@cline/shared/storage";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import { withOAuthRefreshLock } from "../runtime/orchestration/oauth-refresh-lock";
import { startLocalOAuthServer } from "./server";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./types";
import { getProofKey } from "./utils";

export const CHATGPT_PLAN_SCOPE = "chatgpt.tokens.use.direct";
export const CHATGPT_ISSUER = "https://auth.openai.com";
export const CHATGPT_RESOURCE = "https://api.openai.com/v1";
const DYNAMIC_CLIENT_ID = "dynamic_agent_client";
const issuedClientId = z
	.string()
	.min(1)
	.refine((id) => id !== DYNAMIC_CLIENT_ID);
const registrationSchema = z.object({
	clientId: issuedClientId,
	subject: z.string().min(1).optional(),
});
const hostSchema = z.object({
	hostId: z
		.string()
		.regex(
			/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		),
	registration: registrationSchema.optional(),
});
const grantSchema = z.object({
	clientId: issuedClientId,
	issuer: z.literal(CHATGPT_ISSUER),
	subject: z.string().min(1),
	scopes: z.array(z.string()),
});
const tokenSchema = z.object({
	access_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	id_token: z.string().min(1).optional(),
	token_type: z.string().refine((value) => value.toLowerCase() === "bearer"),
	expires_in: z.number().finite().positive(),
	scope: z.string().optional(),
});

export function hasChatGPTPlanGrant(metadata: unknown): boolean {
	const result = grantSchema.safeParse(metadata);
	return result.success && result.data.scopes.includes(CHATGPT_PLAN_SCOPE);
}

function writeHost(path: string, host: z.infer<typeof hostSchema>): void {
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, JSON.stringify(host), { mode: 0o600 });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

function readHost(path: string): z.infer<typeof hostSchema> {
	try {
		return hostSchema.parse(JSON.parse(readFileSync(path, "utf8")));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		const host = { hostId: `urn:uuid:${randomUUID()}` };
		writeHost(path, host);
		return host;
	}
}

// The metadata document is pinned to the trusted issuer. Never discover from
// a callback or an unverified token, which would let it choose its own keys.
async function discover() {
	const response = await fetch(
		`${CHATGPT_ISSUER}/.well-known/openid-configuration`,
		{
			signal: AbortSignal.timeout(30_000),
			redirect: "error",
		},
	);
	if (!response.ok)
		throw new Error("Could not load ChatGPT sign-in configuration.");
	return z
		.object({
			issuer: z.literal(CHATGPT_ISSUER),
			authorization_endpoint: z.literal(
				`${CHATGPT_ISSUER}/api/accounts/authorize`,
			),
			token_endpoint: z.literal(`${CHATGPT_ISSUER}/api/accounts/oauth/token`),
			jwks_uri: z.literal(`${CHATGPT_ISSUER}/.well-known/jwks.json`),
		})
		.parse(await response.json());
}

const jwks = createRemoteJWKSet(
	new URL(`${CHATGPT_ISSUER}/.well-known/jwks.json`),
);

async function verifyIdentity(token: string, clientId: string, nonce?: string) {
	const { payload } = await jwtVerify(token, jwks, {
		issuer: CHATGPT_ISSUER,
		audience: clientId,
		algorithms: ["RS256"],
		requiredClaims: ["sub", "exp", "iat"],
		clockTolerance: 5,
	});
	if (
		typeof payload.sub !== "string" ||
		!payload.sub ||
		(nonce !== undefined && payload.nonce !== nonce)
	) {
		throw new Error("ChatGPT identity or nonce validation failed.");
	}
	if (
		(payload.azp !== undefined ||
			(Array.isArray(payload.aud) && payload.aud.length > 1)) &&
		payload.azp !== clientId
	) {
		throw new Error(
			"ChatGPT authorized party does not match this registration.",
		);
	}
	return payload;
}

async function requestTokens(body: URLSearchParams) {
	const response = await fetch(`${CHATGPT_ISSUER}/api/accounts/oauth/token`, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body,
		signal: AbortSignal.timeout(30_000),
		redirect: "error",
	});
	if (!response.ok) {
		// Do not put provider response bodies (which may contain credentials) in
		// errors, telemetry, or browser messages.
		throw new Error(
			`ChatGPT token request failed (${response.status}). Continue with ChatGPT again.`,
		);
	}
	return tokenSchema.parse(await response.json());
}

export async function loginChatGPT(options: {
	callbacks: OAuthLoginCallbacks;
	credentials?: OAuthCredentials | null;
	settingsPath?: string;
}): Promise<OAuthCredentials> {
	const path = `${options.settingsPath ?? resolveProviderSettingsPath()}.chatgpt-registration.json`;
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	// A registration has a host lifetime, independent of tokens or sign-out.
	// Serialize first-time creation and sign-ins across CLI/extension processes.
	return withOAuthRefreshLock(path, "chatgpt-registration", async () => {
		const host = readHost(path);
		const previous = grantSchema.safeParse(options.credentials?.metadata);
		const registration = previous.success ? previous.data : host.registration;
		const discovery = await discover();
		const state = randomBytes(32).toString("base64url");
		const nonce = randomBytes(32).toString("base64url");
		const { verifier, challenge } = await getProofKey();
		const server = await startLocalOAuthServer({
			host: "127.0.0.1",
			ports: [0],
			callbackPath: "/auth/callback",
			expectedState: state,
			onListening: options.callbacks.onServerListening,
			onClose: options.callbacks.onServerClose,
			successHtml:
				"<html><body>Authorization received. Return to Cline to finish signing in.</body></html>",
		});
		try {
			if (!server.callbackUrl)
				throw new Error("Could not start the ChatGPT callback listener.");
			const url = new URL(discovery.authorization_endpoint);
			url.search = new URLSearchParams({
				client_id: registration?.clientId ?? DYNAMIC_CLIENT_ID,
				...(!registration ? { agent_name_hint: "Cline" } : {}),
				ext_agent_host_id: host.hostId,
				response_type: "code",
				redirect_uri: server.callbackUrl,
				scope: `openid profile email offline_access resource.invoke ${CHATGPT_PLAN_SCOPE}`,
				resource: CHATGPT_RESOURCE,
				state,
				nonce,
				code_challenge: challenge,
				code_challenge_method: "S256",
			}).toString();
			// No ID-token hint in this URL: host callbacks may print it to a terminal.
			await options.callbacks.onAuth({
				url: url.toString(),
				instructions:
					"Continue with ChatGPT to authorize eligible requests using your ChatGPT plan.",
			});
			const callback = await server.waitForCallback();
			if (!callback || callback.state !== state)
				throw new Error("ChatGPT sign-in timed out or state did not match.");
			for (const name of ["state", "code", "client_id", "error"]) {
				if (callback.url.searchParams.getAll(name).length > 1)
					throw new Error("Ambiguous ChatGPT callback.");
			}
			if (callback.error)
				throw new Error(
					"ChatGPT authorization was declined. No plan usage was enabled.",
				);
			if (!callback.code)
				throw new Error("ChatGPT authorization code is missing.");
			const returnedId = callback.url.searchParams.get("client_id");
			const clientId = issuedClientId.parse(
				returnedId ?? registration?.clientId,
			);
			if (registration && clientId !== registration.clientId)
				throw new Error(
					"ChatGPT registration does not match the selected account.",
				);
			// Keep the issued ID even if the code exchange fails; never register
			// another client merely because an authorization code expired.
			host.registration = { clientId, subject: registration?.subject };
			writeHost(path, host);
			const tokens = await requestTokens(
				new URLSearchParams({
					grant_type: "authorization_code",
					client_id: clientId,
					code: callback.code,
					code_verifier: verifier,
					redirect_uri: server.callbackUrl,
					resource: CHATGPT_RESOURCE,
				}),
			);
			if (!tokens.id_token)
				throw new Error("ChatGPT did not return an ID token.");
			const identity = await verifyIdentity(tokens.id_token, clientId, nonce);
			if (registration?.subject && identity.sub !== registration.subject)
				throw new Error("ChatGPT account does not match the selected account.");
			host.registration = { clientId, subject: identity.sub };
			writeHost(path, host);
			const metadata = {
				clientId,
				issuer: CHATGPT_ISSUER,
				subject: identity.sub,
				scopes: tokens.scope?.split(/\s+/).filter(Boolean) ?? [],
				idToken: tokens.id_token,
			};
			if (!hasChatGPTPlanGrant(metadata))
				throw new Error(
					"ChatGPT plan usage was not granted (chatgpt.tokens.use.direct). Authorize plan usage before running a task.",
				);
			if (!tokens.refresh_token)
				throw new Error(
					"ChatGPT did not grant offline access. Please sign in again.",
				);
			options.callbacks.onProgress?.(
				"You're using your ChatGPT plan for eligible requests. Manage usage in ChatGPT settings.",
			);
			return {
				access: tokens.access_token,
				refresh: tokens.refresh_token,
				expires: Date.now() + tokens.expires_in * 1000,
				accountId: identity.sub,
				email: typeof identity.email === "string" ? identity.email : undefined,
				metadata,
			};
		} finally {
			server.close();
		}
	});
}

export async function refreshChatGPT(
	credentials: OAuthCredentials,
	forceRefresh = false,
): Promise<OAuthCredentials> {
	const grant = grantSchema.parse(credentials.metadata);
	if (!forceRefresh && credentials.expires > Date.now() + 60_000)
		return credentials;
	const tokens = await requestTokens(
		new URLSearchParams({
			grant_type: "refresh_token",
			client_id: grant.clientId,
			refresh_token: credentials.refresh,
			resource: CHATGPT_RESOURCE,
		}),
	);
	if (tokens.id_token) {
		const identity = await verifyIdentity(tokens.id_token, grant.clientId);
		if (identity.sub !== grant.subject)
			throw new Error("ChatGPT refresh changed account identity.");
	}
	return {
		...credentials,
		access: tokens.access_token,
		refresh: tokens.refresh_token ?? credentials.refresh,
		expires: Date.now() + tokens.expires_in * 1000,
		metadata: {
			...credentials.metadata,
			// An omitted scope retains the original grant; an explicit empty or
			// reduced scope replaces it and disables inference.
			scopes:
				tokens.scope === undefined
					? grant.scopes
					: tokens.scope.split(/\s+/).filter(Boolean),
			idToken: tokens.id_token ?? credentials.metadata?.idToken,
		},
	};
}
