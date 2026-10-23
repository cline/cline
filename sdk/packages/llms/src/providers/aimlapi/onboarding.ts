import { type AimlapiBalanceResult, AimlapiClient } from "./client";
import { resolveAimlapiEndpoints } from "./config";

export type AimlapiEmailOnboardingResult =
	| { action: "code-sent" }
	| { action: "new-account"; sessionToken: string };

export interface AimlapiCodeSignInResult {
	sessionToken: string;
	apiKey: string;
	apiKeyId: string;
	lowBalance: boolean;
}

export function validateAimlapiApiKey(
	apiKey: string,
	signal?: AbortSignal,
): Promise<AimlapiBalanceResult> {
	return new AimlapiClient(resolveAimlapiEndpoints()).getBalance(
		apiKey.trim(),
		signal,
	);
}

export async function beginAimlapiEmailOnboarding(
	email: string,
	signal?: AbortSignal,
): Promise<AimlapiEmailOnboardingResult> {
	const client = new AimlapiClient(resolveAimlapiEndpoints());
	const account = await client.checkAccount(email.trim(), signal);
	if (account.action === "sign-in") {
		await client.sendSignInCode(email.trim(), signal);
		return { action: "code-sent" };
	}
	const auth = await client.createPasswordlessAccount(email.trim(), signal);
	return { action: "new-account", sessionToken: auth.token };
}

export async function completeAimlapiCodeSignIn(
	email: string,
	code: string,
	signal?: AbortSignal,
): Promise<AimlapiCodeSignInResult> {
	const client = new AimlapiClient(resolveAimlapiEndpoints());
	const auth = await client.verifySignInCode(email.trim(), code.trim(), signal);
	const created = await client.createKey(auth.token, "Cline", signal);
	let lowBalance = false;
	try {
		lowBalance = (await client.getBalance(created.key, signal)).lowBalance;
	} catch (error) {
		if (signal?.aborted) throw error;
	}
	return {
		sessionToken: auth.token,
		apiKey: created.key,
		apiKeyId: created.id,
		lowBalance,
	};
}
