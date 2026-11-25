import { DaytonaSandboxProvider } from "@/lib/sandbox/daytona";
import { SandboxNotConfiguredError, type SandboxProvider } from "@/lib/sandbox/types";

let provider: SandboxProvider | null = null;

export function getSandboxProvider(): SandboxProvider {
	if (provider) return provider;
	if (process.env.SANDBOX_PROVIDER && process.env.SANDBOX_PROVIDER !== "daytona") {
		throw new SandboxNotConfiguredError();
	}
	if (!process.env.DAYTONA_API_KEY) {
		throw new SandboxNotConfiguredError();
	}
	provider = new DaytonaSandboxProvider();
	return provider;
}

export function resetSandboxProviderForTests(): void {
	provider = null;
}

export * from "@/lib/sandbox/types";
