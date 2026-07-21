export type DesktopPathSource = "shell" | "inherited";

export interface DesktopRuntimeInfo {
	readonly app: {
		readonly name: "Cline Code";
		readonly version: string;
	};
	readonly sdk: {
		readonly coreVersion: string;
	};
	readonly runtime: {
		readonly name: "bun";
		readonly version: string;
		readonly nodeVersion: string;
	};
	readonly os: {
		readonly platform: string;
		readonly name: string;
		readonly version: string;
		readonly release: string;
		readonly arch: string;
	};
	readonly environment: {
		readonly pathSource: DesktopPathSource;
		readonly pathChanged: boolean;
	};
}
