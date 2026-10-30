import { Daytona } from "@daytona/sdk";
import { handleApiError, jsonOk } from "@/lib/api";
import { getServerEnv } from "@/lib/env";
import { requireInternalSecret } from "@/lib/internal-auth";
import { getServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function timed<T>(
	fn: () => Promise<T>,
): Promise<{ ok: boolean; ms: number; detail?: string }> {
	const started = Date.now();
	try {
		await fn();
		return { ok: true, ms: Date.now() - started };
	} catch (error) {
		return {
			ok: false,
			ms: Date.now() - started,
			detail: error instanceof Error ? error.message.slice(0, 300) : String(error),
		};
	}
}

export async function GET(request: Request) {
	try {
		requireInternalSecret(request);
		const url = new URL(request.url);
		const deep = url.searchParams.get("deep") === "1";
		const env = getServerEnv();

		const checks: Record<string, { ok: boolean; ms: number; detail?: string }> = {
			supabase: await timed(async () => {
				const { error } = await getServiceClient()
					.from("a21_projects")
					.select("id", { head: true, count: "exact" })
					.limit(1);
				if (error) throw new Error(error.message);
			}),
		};

		if (deep) {
			checks.openrouter = await timed(async () => {
				const response = await fetch(`${env.OPENROUTER_BASE_URL}/models`, {
					headers: { Accept: "application/json" },
					signal: AbortSignal.timeout(20_000),
					cache: "no-store",
				});
				if (!response.ok) throw new Error(`HTTP ${response.status}`);
				const payload = (await response.json()) as { data?: unknown[] };
				if (!Array.isArray(payload.data) || payload.data.length === 0) {
					throw new Error("Unexpected models payload");
				}
			});

			checks.daytona = await timed(async () => {
				if (!env.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY missing");
				const daytona = new Daytona({
					apiKey: env.DAYTONA_API_KEY,
					...(env.DAYTONA_API_URL ? { apiUrl: env.DAYTONA_API_URL } : {}),
					...(env.DAYTONA_TARGET ? { target: env.DAYTONA_TARGET } : {}),
				});
				const sandboxes = await daytona.list({ limit: 1 });
				if (!Array.isArray(sandboxes)) throw new Error("Unexpected sandbox list");
			});
		}

		return jsonOk({
			ok: Object.values(checks).every((check) => check.ok),
			checks,
			configured: {
				openrouterServerKey: Boolean(env.OPENROUTER_API_KEY),
				daytona: Boolean(env.DAYTONA_API_KEY),
				serviceRole: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
				encryption: Boolean(env.ENCRYPTION_KEY),
			},
			region: process.env.VERCEL_REGION ?? null,
			commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
		});
	} catch (error) {
		return handleApiError(error);
	}
}
