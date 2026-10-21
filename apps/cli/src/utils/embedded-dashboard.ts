declare const __CLINE_DASHBOARD_RUNTIME_DIR__: string | undefined;

export function resolveEmbeddedDashboard(): string | undefined {
	return typeof __CLINE_DASHBOARD_RUNTIME_DIR__ === "undefined"
		? undefined
		: __CLINE_DASHBOARD_RUNTIME_DIR__;
}
