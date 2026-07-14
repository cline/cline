import { join } from "node:path";
import type { BasicLogger, RuntimeLoggerConfig } from "@cline/shared";
import { noopBasicLogger } from "@cline/shared";
import { resolveClineDataDir } from "@cline/shared/storage";
import type {
	ConnectIo,
	ConnectorLoggerAdapter,
	CreateConnectorLoggerInput,
} from "./types";

function normalizeRuntimeLoggerConfig(
	input: CreateConnectorLoggerInput,
): Required<RuntimeLoggerConfig> {
	return {
		enabled: input.runtimeConfig?.enabled ?? false,
		level: input.runtimeConfig?.level ?? "info",
		destination:
			input.runtimeConfig?.destination ??
			join(resolveClineDataDir(), "logs", "cline.log"),
		name: input.runtimeConfig?.name ?? `cline.${input.runtime}`,
		bindings: input.runtimeConfig?.bindings ?? {},
	};
}

export function createConnectorLogger(
	io: ConnectIo,
	input: CreateConnectorLoggerInput,
): ConnectorLoggerAdapter {
	const hosted = io.createLogger?.(input);
	if (hosted) {
		return hosted;
	}
	const fallback: ConnectorLoggerAdapter = {
		core: noopBasicLogger as BasicLogger,
		runtimeConfig: normalizeRuntimeLoggerConfig(input),
		child: () => fallback,
	};
	return fallback;
}
