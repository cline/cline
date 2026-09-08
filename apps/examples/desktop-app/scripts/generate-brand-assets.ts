import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

async function main() {
	const repoRoot = path.resolve(import.meta.dir, "../../../..");
	const brandingRoot = path.join(repoRoot, "assets/branding");
	const logoRoot = path.join(brandingRoot, "logos");
	const sourcePath = path.join(logoRoot, "cline-wordmark-dark.svg");

	const source = await readFile(sourcePath, "utf8");
	if (!source.includes('viewBox="0 0 497 128"')) {
		throw new Error("Expected the 497x128 master Cline wordmark");
	}

	const pathElements = source.match(/<path\b[^>]*\/>/g) ?? [];
	const rectElements = source.match(/<rect\b[^>]*\/>/g) ?? [];
	if (pathElements.length !== 6 || rectElements.length !== 2) {
		throw new Error("Unexpected master Cline wordmark structure");
	}

	const logoElements = [pathElements[0], ...rectElements].join("\n");
	const recolor = (svg: string, color: string) =>
		svg.replace(/fill="(?:#1C1C24|#282524)"/g, `fill="${color}"`);
	const iconSvg = (
		color: string,
	) => `<svg width="113" height="113" viewBox="0 0 113 113" fill="none" xmlns="http://www.w3.org/2000/svg">
${recolor(logoElements, color)}
</svg>
`;

	const files = new Map<string, string>([
		[path.join(logoRoot, "cline-wordmark-black.svg"), recolor(source, "black")],
		[path.join(logoRoot, "cline-wordmark-white.svg"), recolor(source, "white")],
		[path.join(logoRoot, "cline-icon-dark.svg"), iconSvg("#1C1C24")],
		[path.join(logoRoot, "cline-icon-white.svg"), iconSvg("#EDEDF0")],
		[
			path.join(repoRoot, "apps/vscode/assets/icons/icon.svg"),
			iconSvg("#1C1C24"),
		],
		[
			path.join(repoRoot, "apps/cline-hub/src/webview/public/icon.svg"),
			iconSvg("#1C1C24"),
		],
		[
			path.join(repoRoot, "apps/cline-hub/src/webview/public/favicon.svg"),
			iconSvg("#1C1C24"),
		],
		[
			path.join(
				repoRoot,
				"apps/cline-hub/src/webview/public/cline-logo-filled.svg",
			),
			iconSvg("#1C1C24"),
		],
		[
			path.join(repoRoot, "apps/examples/vscode/src/webview/public/icon.svg"),
			iconSvg("#1C1C24"),
		],
		[
			path.join(
				repoRoot,
				"apps/examples/vscode/src/webview/public/favicon.svg",
			),
			iconSvg("#1C1C24"),
		],
		[
			path.join(repoRoot, "docs/assets/cline-wordmark-black.svg"),
			recolor(source, "black"),
		],
		[
			path.join(repoRoot, "docs/assets/cline-wordmark-white.svg"),
			recolor(source, "white"),
		],
		[
			path.join(repoRoot, "docs/assets/cline-icon-dark.svg"),
			iconSvg("#1C1C24"),
		],
		[
			path.join(repoRoot, "docs/assets/cline-icon-white.svg"),
			iconSvg("#EDEDF0"),
		],
	]);

	for (const [filePath, contents] of files) {
		await Bun.write(filePath, contents);
	}

	const appIconSvg = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" fill="none" xmlns="http://www.w3.org/2000/svg">
<rect width="1024" height="1024" rx="256" fill="#343B42"/>
<g transform="translate(120 96) scale(6.92)">
${recolor(logoElements, "white")}
</g>
</svg>
`;
	const appIconSvgPath = path.join(brandingRoot, "cline-app-icon.svg");
	const appIconPngPath = path.join(brandingRoot, "cline-app-icon.png");
	await Bun.write(appIconSvgPath, appIconSvg);
	await sharp(Buffer.from(appIconSvg)).png().toFile(appIconPngPath);

	const appIconMetadata = await sharp(appIconPngPath).metadata();
	if (
		appIconMetadata.width !== 1024 ||
		appIconMetadata.height !== 1024 ||
		!appIconMetadata.hasAlpha
	) {
		throw new Error("Expected a 1024x1024 alpha app icon master");
	}

	const temporaryFont = await mkdtemp(path.join(tmpdir(), "cline-brand-font-"));
	try {
		const fontInput = path.join(temporaryFont, "input");
		const fontOutput = path.join(temporaryFont, "output");
		const configPath = path.join(temporaryFont, "fantasticonrc.json");
		await mkdir(fontInput);
		await mkdir(fontOutput);
		await Bun.write(path.join(fontInput, "cline.svg"), iconSvg("#1C1C24"));
		await Bun.write(
			configPath,
			JSON.stringify({
				inputDir: fontInput,
				outputDir: fontOutput,
				name: "cline-bot",
				fontTypes: ["svg", "ttf", "woff"],
				assetTypes: ["json"],
				codepoints: { cline: 0xe900 },
				fontHeight: 1024,
				descent: 64,
				normalize: true,
				round: 1_000_000_000_000,
			}),
		);
		const fontProcess = Bun.spawn(
			["bunx", "fantasticon@4.1.0", "--config", configPath],
			{
				cwd: repoRoot,
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		if ((await fontProcess.exited) !== 0) {
			throw new Error("fantasticon failed to generate the Cline icon font");
		}
		for (const extension of ["svg", "ttf", "woff"]) {
			await Bun.write(
				path.join(repoRoot, `apps/vscode/assets/icons/cline-bot.${extension}`),
				Bun.file(path.join(fontOutput, `cline-bot.${extension}`)),
			);
		}
	} finally {
		await rm(temporaryFont, { recursive: true, force: true });
	}

	const resizePng = async (destination: string, size: number) => {
		await sharp(appIconPngPath).resize(size, size).png().toFile(destination);
	};
	await resizePng(path.join(repoRoot, "assets/icons/icon.png"), 128);
	await resizePng(
		path.join(repoRoot, "apps/vscode/assets/icons/icon.png"),
		128,
	);
	await resizePng(
		path.join(repoRoot, "apps/cline-hub/src/webview/public/icon.png"),
		512,
	);
	await resizePng(
		path.join(repoRoot, "apps/examples/vscode/src/webview/public/icon.png"),
		512,
	);

	const runTauriIcon = async (input: string, output: string) => {
		const process = Bun.spawn(
			["bunx", "tauri", "icon", input, "--output", output],
			{
				cwd: path.join(repoRoot, "apps/examples/desktop-app"),
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		const exitCode = await process.exited;
		if (exitCode !== 0) {
			throw new Error(`tauri icon failed for ${input}`);
		}

		// The Tauri CLI writes ICNS chunks in completion order, which can vary
		// between runs even though every embedded image is identical. ICNS readers
		// do not require a particular chunk order, so sort the complete chunks by
		// type to keep the generated binary reproducible.
		const icnsPath = path.join(output, "icon.icns");
		const icns = Buffer.from(await readFile(icnsPath));
		if (icns.subarray(0, 4).toString("ascii") !== "icns") {
			throw new Error(`Unexpected ICNS header in ${icnsPath}`);
		}
		const declaredLength = icns.readUInt32BE(4);
		if (declaredLength !== icns.length) {
			throw new Error(`Invalid ICNS length in ${icnsPath}`);
		}
		const chunks: Buffer[] = [];
		for (let offset = 8; offset < icns.length; ) {
			const chunkLength = icns.readUInt32BE(offset + 4);
			if (chunkLength < 8 || offset + chunkLength > icns.length) {
				throw new Error(`Invalid ICNS chunk in ${icnsPath}`);
			}
			chunks.push(icns.subarray(offset, offset + chunkLength));
			offset += chunkLength;
		}
		chunks.sort((left, right) =>
			left.subarray(0, 4).compare(right.subarray(0, 4)),
		);
		const normalizedIcns = Buffer.concat([icns.subarray(0, 8), ...chunks]);
		normalizedIcns.writeUInt32BE(normalizedIcns.length, 4);
		await Bun.write(icnsPath, normalizedIcns);
	};

	const temporaryIcons = await mkdtemp(
		path.join(tmpdir(), "cline-brand-icons-"),
	);
	try {
		await runTauriIcon(appIconPngPath, temporaryIcons);
		for (const publicRoot of [
			path.join(repoRoot, "apps/cline-hub/src/webview/public"),
			path.join(repoRoot, "apps/examples/vscode/src/webview/public"),
		]) {
			await Bun.write(
				path.join(publicRoot, "32x32.png"),
				Bun.file(path.join(temporaryIcons, "32x32.png")),
			);
			await Bun.write(
				path.join(publicRoot, "icon.ico"),
				Bun.file(path.join(temporaryIcons, "icon.ico")),
			);
		}
	} finally {
		await rm(temporaryIcons, { recursive: true, force: true });
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
