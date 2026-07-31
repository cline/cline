/** Supported ACP OAuth provider IDs. */
export const ACP_AUTH_METHODS = [
	{ id: "cline", name: "Sign in with Cline" },
	{ id: "cline-pass", name: "Sign in with ClinePass" },
	{ id: "openai-codex", name: "Sign in with ChatGPT Subscription" },
] as const;

export type AcpAuthMethodId = (typeof ACP_AUTH_METHODS)[number]["id"];

export function isAcpAuthMethodId(id: string): id is AcpAuthMethodId {
	return ACP_AUTH_METHODS.some((method) => method.id === id);
}
