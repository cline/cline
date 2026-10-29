/** Opt-in fixture responses only; production authentication uses the SDK unchanged. */
import type { FixtureFaults } from "./faults";

export function fixtureAuthResponse(
	path: string,
	faults: FixtureFaults,
	token: string,
	now = Date.now(),
): Response | undefined {
	if (path !== "/api/v1/auth/register" && path !== "/api/v1/auth/refresh")
		return undefined;
	if (
		path === "/api/v1/auth/refresh" &&
		faults.get("global", "auth-refresh-invalid")
	)
		return Response.json(
			{
				error: "invalid_grant",
				error_description: "Fixture refresh token was revoked",
			},
			{ status: 400 },
		);
	const lifetime = faults.get("global", "auth-short-credentials")
		? 7 * 60 * 1000
		: 24 * 60 * 60 * 1000;
	return Response.json({
		success: true,
		data: {
			accessToken: token,
			refreshToken: "fixture-refresh",
			tokenType: "Bearer",
			expiresAt: new Date(now + lifetime).toISOString(),
			userInfo: {
				subject: "fixture-user",
				email: "simulator@example.invalid",
				name: "Native Fixture",
				clineUserId: "fixture-account",
				accounts: [],
			},
		},
	});
}
