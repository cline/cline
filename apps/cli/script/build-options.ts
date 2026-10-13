const BUILD_TARGET_OSES = ["darwin", "linux", "win32"] as const;

type BuildTargetOs = (typeof BUILD_TARGET_OSES)[number];

export interface BuildOptions {
	single: boolean;
	skipInstall: boolean;
	skipSdkBuild: boolean;
	installNativeVariants: boolean;
	targetOs: BuildTargetOs[];
}

export function parseBuildOptions(args: readonly string[]): BuildOptions {
	const targetOs: BuildTargetOs[] = [];
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] !== "--target-os") {
			continue;
		}

		const value = args[index + 1];
		if (
			!value ||
			!BUILD_TARGET_OSES.includes(value as (typeof BUILD_TARGET_OSES)[number])
		) {
			throw new Error(
				`--target-os requires one of: ${BUILD_TARGET_OSES.join(", ")}`,
			);
		}

		targetOs.push(value as BuildTargetOs);
		index += 1;
	}

	return {
		single: args.includes("--single"),
		skipInstall: args.includes("--skip-install"),
		skipSdkBuild: args.includes("--skip-sdk-build"),
		installNativeVariants: args.includes("--install-native-variants"),
		targetOs,
	};
}

export function shouldInstallNativeVariants(input: {
	options: BuildOptions;
	opentuiVersion: string | undefined;
}): boolean {
	return Boolean(
		input.opentuiVersion &&
			input.options.installNativeVariants &&
			!input.options.skipInstall,
	);
}

export function validateBuildOptions(input: {
	options: BuildOptions;
	opentuiVersion: string | undefined;
	targetCount: number;
}): string | undefined {
	if (input.targetCount === 0) {
		return "No matching targets for this platform.";
	}
	if (
		input.opentuiVersion &&
		!input.options.single &&
		!input.options.skipInstall &&
		!input.options.installNativeVariants
	) {
		return [
			"Cross-platform OpenTUI builds require native package variants.",
			"Pass --install-native-variants to allow the build script to run bun install for all OpenTUI native packages.",
			"Pass --skip-install only when those packages are already installed.",
		].join("\n");
	}
	return undefined;
}
