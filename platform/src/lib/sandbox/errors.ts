import { ApiError } from "@/lib/api";
import { SandboxError, SandboxNotConfiguredError } from "@/lib/sandbox/types";

/**
 * Maps provider-specific failures onto safe, user-facing API errors. Raw SDK
 * messages can include internal URLs and are kept in `details` for debugging,
 * never in the top-level message.
 */
export function normalizeSandboxError(error: unknown): unknown {
	if (error instanceof ApiError) return error;
	if (error instanceof SandboxNotConfiguredError) {
		return new ApiError(
			503,
			"sandbox_not_configured",
			"Cloud execution is not configured. Ask the operator to set DAYTONA_API_KEY.",
		);
	}
	if (error instanceof SandboxError) {
		return new ApiError(502, "sandbox_error", error.message, error.detail);
	}
	return error;
}
