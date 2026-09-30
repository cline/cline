import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPair, SignJWT } from "jose";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	CHATGPT_ISSUER,
	CHATGPT_PLAN_SCOPE,
	hasChatGPTPlanGrant,
	loginChatGPT,
	refreshChatGPT,
} from "./chatgpt";
import type { OAuthCredentials } from "./types";

const state = vi.hoisted(() => ({
	url: undefined as URL | undefined,
	publicKey: undefined as CryptoKey | undefined,
	callback: {} as Record<string, string | undefined>,
	claims: {} as Record<string, unknown>,
	scope: undefined as string | undefined,
	badSignature: false,
	tokenStatus: 200,
	close: vi.fn(),
}));
vi.mock("jose", async (original) => ({
	...(await original<typeof import("jose")>()),
	createRemoteJWKSet: () => async () => state.publicKey,
}));
vi.mock("../runtime/orchestration/oauth-refresh-lock", () => ({
	withOAuthRefreshLock: async (
		_path: string,
		_key: string,
		run: () => Promise<unknown>,
	) => run(),
}));
vi.mock("./server", () => ({
	startLocalOAuthServer: async () => ({
		callbackUrl: "http://127.0.0.1:23456/auth/callback",
		close: state.close,
		waitForCallback: async () => {
			const params = new URLSearchParams({
				code: "one-time-code",
				state: state.url!.searchParams.get("state")!,
				client_id: "oaiapp_test",
				scope: CHATGPT_PLAN_SCOPE,
			});
			for (const [key, value] of Object.entries(state.callback)) {
				if (value === undefined) params.delete(key);
				else params.set(key, value);
			}
			return {
				url: new URL(`http://127.0.0.1:23456/auth/callback?${params}`),
				code: params.get("code"),
				state: params.get("state"),
				error: params.get("error"),
			};
		},
	}),
}));

let privateKey: CryptoKey;
let wrongKey: CryptoKey;
let directory: string;
let settingsPath: string;
const requests: URLSearchParams[] = [];

beforeAll(async () => {
	const keys = await generateKeyPair("RS256");
	privateKey = keys.privateKey;
	state.publicKey = keys.publicKey;
	wrongKey = (await generateKeyPair("RS256")).privateKey;
});
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "cline-chatgpt-test-"));
	settingsPath = join(directory, "providers.json");
	state.callback = {};
	state.claims = {};
	state.scope = CHATGPT_PLAN_SCOPE;
	state.badSignature = false;
	state.tokenStatus = 200;
	state.close.mockClear();
	requests.length = 0;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (url.endsWith("openid-configuration"))
				return Response.json({
					issuer: CHATGPT_ISSUER,
					authorization_endpoint: `${CHATGPT_ISSUER}/api/accounts/authorize`,
					token_endpoint: `${CHATGPT_ISSUER}/api/accounts/oauth/token`,
					jwks_uri: `${CHATGPT_ISSUER}/.well-known/jwks.json`,
				});
			requests.push(new URLSearchParams(init?.body as URLSearchParams));
			if (state.tokenStatus !== 200)
				return new Response("sensitive-provider-body", {
					status: state.tokenStatus,
				});
			const idToken = await new SignJWT({
				iss: CHATGPT_ISSUER,
				aud: "oaiapp_test",
				sub: "subject-1",
				iat: Math.floor(Date.now() / 1000),
				exp: Math.floor(Date.now() / 1000) + 3600,
				nonce: state.url?.searchParams.get("nonce"),
				...state.claims,
			})
				.setProtectedHeader({ alg: "RS256" })
				.sign(state.badSignature ? wrongKey : privateKey);
			return Response.json({
				access_token: "access",
				refresh_token: "refresh",
				id_token: idToken,
				token_type: "Bearer",
				expires_in: 3600,
				scope: state.scope,
			});
		}),
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
	rmSync(directory, { recursive: true, force: true });
});

function login(credentials?: OAuthCredentials) {
	return loginChatGPT({
		settingsPath,
		credentials,
		callbacks: {
			onAuth: ({ url }) => {
				state.url = new URL(url);
			},
			onPrompt: async () => "",
		},
	});
}

describe("ChatGPT plan sign-in", () => {
	it("registers with persistent host ID, fresh PKCE/state/nonce, then reuses the issued client and identity", async () => {
		const first = await login();
		const initial = state.url!;
		expect(initial.searchParams.get("client_id")).toBe("dynamic_agent_client");
		expect(initial.searchParams.get("agent_name_hint")).toBe("Cline");
		expect(initial.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
		expect(initial.searchParams.get("code_challenge")).toBe(
			createHash("sha256")
				.update(requests[0]!.get("code_verifier")!)
				.digest("base64url"),
		);
		expect(Object.fromEntries(requests[0]!)).toMatchObject({
			client_id: "oaiapp_test",
			redirect_uri: initial.searchParams.get("redirect_uri"),
			resource: "https://api.openai.com/v1",
		});
		expect(first.metadata).toMatchObject({
			clientId: "oaiapp_test",
			subject: "subject-1",
			scopes: [CHATGPT_PLAN_SCOPE],
		});
		state.callback = { client_id: undefined };
		await login(first);
		expect(state.url!.searchParams.get("client_id")).toBe("oaiapp_test");
		expect(state.url!.searchParams.has("agent_name_hint")).toBe(false);
		expect(state.url!.searchParams.get("ext_agent_host_id")).toBe(
			initial.searchParams.get("ext_agent_host_id"),
		);
		for (const key of ["state", "nonce", "code_challenge"])
			expect(state.url!.searchParams.get(key)).not.toBe(
				initial.searchParams.get(key),
			);
		// Simulate restart/sign-out: registration survives without any tokens.
		await login();
		expect(state.url!.searchParams.get("client_id")).toBe("oaiapp_test");
		const path = `${settingsPath}.chatgpt-registration.json`;
		expect(readFileSync(path, "utf8")).not.toContain("access");
		if (process.platform !== "win32")
			expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it.each([
		{ state: "wrong" },
		{ state: undefined },
		{ error: "access_denied" },
		{ client_id: undefined },
		{ client_id: "dynamic_agent_client" },
	])("rejects invalid callback before exchange: %j", async (callback) => {
		state.callback = callback;
		await expect(login()).rejects.toThrow();
		expect(requests).toHaveLength(0);
		expect(state.close).toHaveBeenCalled();
	});

	it.each([
		{ nonce: "wrong" },
		{ iss: "https://attacker.example" },
		{ aud: "other-client" },
		{ exp: 1 },
		{ sub: "" },
		{ azp: "other-client" },
		{ aud: ["oaiapp_test", "other-client"] },
	])("validates the signed OIDC claims: %j", async (claims) => {
		state.claims = claims;
		await expect(login()).rejects.toThrow();
	});

	it("rejects an invalid signature", async () => {
		state.badSignature = true;
		await expect(login()).rejects.toThrow();
	});

	it.each([
		undefined,
		"",
		"openid profile",
		`${CHATGPT_PLAN_SCOPE}.extra`,
	])("requires the exact granted scope from the token response: %s", async (scope) => {
		state.scope = scope;
		await expect(login()).rejects.toThrow("plan usage was not granted");
	});

	it("retains the issued client after failed exchange without persisting credentials", async () => {
		state.tokenStatus = 400;
		await expect(login()).rejects.toThrow("ChatGPT token request failed (400)");
		state.tokenStatus = 200;
		await login();
		expect(state.url!.searchParams.get("client_id")).toBe("oaiapp_test");
	});

	it("rejects a different client or subject during reauthorization", async () => {
		const credentials = await login();
		state.callback = { client_id: "other-client" };
		await expect(login(credentials)).rejects.toThrow(
			"registration does not match",
		);
		state.callback = {};
		state.claims = { sub: "subject-2" };
		await expect(login(credentials)).rejects.toThrow("account does not match");
	});

	it("refreshes with the issued client, preserves omitted scopes, and records an explicit reduced grant", async () => {
		const credentials = await login();
		state.scope = undefined;
		const refreshed = await refreshChatGPT(credentials, true);
		expect(hasChatGPTPlanGrant(refreshed.metadata)).toBe(true);
		expect(Object.fromEntries(requests.at(-1)!)).toEqual({
			grant_type: "refresh_token",
			client_id: "oaiapp_test",
			refresh_token: "refresh",
			resource: "https://api.openai.com/v1",
		});
		state.scope = "openid";
		expect(
			hasChatGPTPlanGrant((await refreshChatGPT(refreshed, true)).metadata),
		).toBe(false);
	});
});
