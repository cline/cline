import { z } from "zod";

const optionalString = z.preprocess(
	(value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
	z.string().min(1).optional(),
);

const serverEnvSchema = z.object({
	NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
	NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
	SUPABASE_SERVICE_ROLE_KEY: optionalString,
	OPENROUTER_API_KEY: optionalString,
	OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
	OPENROUTER_SITE_URL: z.string().url().default("http://localhost:3000"),
	OPENROUTER_APP_NAME: z.string().default("21 Agent"),
	DAYTONA_API_KEY: optionalString,
	DAYTONA_API_URL: z.string().url().default("https://app.daytona.io/api"),
	DAYTONA_TARGET: optionalString,
	DAYTONA_WORKSPACE_ROOT: z.string().default("workspace"),
	SANDBOX_PROVIDER: z.enum(["daytona"]).default("daytona"),
	APP_URL: z.string().url().default("http://localhost:3000"),
	ENCRYPTION_KEY: optionalString,
	WORKER_INTERNAL_SECRET: optionalString,
	WORKER_ID: optionalString,
	WORKER_POLL_MS: z.coerce.number().int().min(500).max(60_000).default(1500),
	WORKER_LEASE_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
	WORKER_MAX_JOBS: z.coerce.number().int().min(1).max(8).default(1),
	APPROVAL_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(1800).default(600),
	TERMINAL_MAX_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(300).default(120),
	SANDBOX_MAX_OUTPUT_CHARS: z.coerce.number().int().min(2000).max(200_000).default(40_000),
	SANDBOX_AUTO_STOP_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
	SANDBOX_AUTO_ARCHIVE_MINUTES: z.coerce.number().int().min(10).max(10080).default(240),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
	if (cached) return cached;

	const parsed = serverEnvSchema.safeParse({
		NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
		NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
		SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
		OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
		OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
		OPENROUTER_SITE_URL: process.env.OPENROUTER_SITE_URL,
		OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME,
		DAYTONA_API_KEY: process.env.DAYTONA_API_KEY,
		DAYTONA_API_URL: process.env.DAYTONA_API_URL,
		DAYTONA_TARGET: process.env.DAYTONA_TARGET,
		DAYTONA_WORKSPACE_ROOT: process.env.DAYTONA_WORKSPACE_ROOT,
		SANDBOX_PROVIDER: process.env.SANDBOX_PROVIDER,
		APP_URL: process.env.APP_URL,
		ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
		WORKER_INTERNAL_SECRET: process.env.WORKER_INTERNAL_SECRET,
		WORKER_ID: process.env.WORKER_ID,
		WORKER_POLL_MS: process.env.WORKER_POLL_MS,
		WORKER_LEASE_SECONDS: process.env.WORKER_LEASE_SECONDS,
		WORKER_MAX_JOBS: process.env.WORKER_MAX_JOBS,
		APPROVAL_TIMEOUT_SECONDS: process.env.APPROVAL_TIMEOUT_SECONDS,
		TERMINAL_MAX_TIMEOUT_SECONDS: process.env.TERMINAL_MAX_TIMEOUT_SECONDS,
		SANDBOX_MAX_OUTPUT_CHARS: process.env.SANDBOX_MAX_OUTPUT_CHARS,
		SANDBOX_AUTO_STOP_MINUTES: process.env.SANDBOX_AUTO_STOP_MINUTES,
		SANDBOX_AUTO_ARCHIVE_MINUTES: process.env.SANDBOX_AUTO_ARCHIVE_MINUTES,
	});

	if (!parsed.success) {
		const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
		throw new Error(`Invalid 21 Agent environment configuration — ${issues}`);
	}

	cached = parsed.data;
	return cached;
}

export function hasServiceRole(): boolean {
	return Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function hasOpenRouter(): boolean {
	return Boolean(process.env.OPENROUTER_API_KEY);
}

export function hasDaytona(): boolean {
	return Boolean(process.env.DAYTONA_API_KEY);
}

export function hasEncryptionKey(): boolean {
	return Boolean(process.env.ENCRYPTION_KEY);
}

export function getPublicSupabaseConfig(): { url: string; anonKey: string } {
	const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
	const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !anonKey) {
		throw new Error("Supabase public environment variables are not configured");
	}
	return { url, anonKey };
}

export function getAppUrl(): string {
	return process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
