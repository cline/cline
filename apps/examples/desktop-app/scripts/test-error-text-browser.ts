import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { chromium, type Locator } from "playwright";

async function main() {
	const appRoot = fileURLToPath(new URL("..", import.meta.url));
	const compiled = await compile('@import "./webview/app/globals.css";', {
		base: appRoot,
		onDependency() {},
	});
	const built = await Bun.build({
		entrypoints: [`${appRoot}/webview/test-fixtures/error-text-browser.tsx`],
		format: "iife",
		target: "browser",
		define: { "process.env.NODE_ENV": '"production"' },
	});
	assert(built.success, "Desktop error-text fixture must bundle successfully");

	async function contrast(locator: Locator) {
		return locator.evaluate((element) => {
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 1;
			const context = canvas.getContext("2d");
			if (!context) throw new Error("Canvas unavailable");
			const paint = (color: string) => {
				if (!CSS.supports("color", color))
					throw new Error(`Invalid color: ${color}`);
				context.fillStyle = color;
				context.fillRect(0, 0, 1, 1);
				return Array.from(context.getImageData(0, 0, 1, 1).data);
			};
			const luminance = (rgb: number[]) =>
				rgb.slice(0, 3).reduce((sum, channel, i) => {
					const value = channel / 255;
					return (
						sum +
						(value <= 0.04045
							? value / 12.92
							: ((value + 0.055) / 1.055) ** 2.4) *
							[0.2126, 0.7152, 0.0722][i]
					);
				}, 0);
			const layers = [];
			for (
				let node: Element | null = element;
				node;
				node = node.parentElement
			) {
				const style = getComputedStyle(node);
				if (
					style.opacity !== "1" ||
					style.filter !== "none" ||
					style.backgroundImage !== "none"
				) {
					throw new Error(
						"Contrast sampling must account for opacity, filters, and images",
					);
				}
				layers.unshift(style.backgroundColor);
			}
			paint("white");
			for (const color of layers) paint(color);
			const background = luminance(
				Array.from(context.getImageData(0, 0, 1, 1).data),
			);
			const foreground = luminance(paint(getComputedStyle(element).color));
			return (
				(Math.max(foreground, background) + 0.05) /
				(Math.min(foreground, background) + 0.05)
			);
		});
	}

	const browser = await chromium.launch();
	try {
		const page = await browser.newPage();
		await page.setContent('<div id="root"></div>');
		await page.addScriptTag({ content: await built.outputs[0].text() });
		await page.getByRole("button", { name: "Start Ollama" }).click();
		const error = page.locator("#runtime-fixture [role=alert]");
		await error.waitFor({ state: "visible" });
		assert.equal(
			await error.textContent(),
			"Ollama could not be started. Try again.",
			"The real runtime setup must display the rejected start request",
		);
		// compile() does not scan @source files. Read the real rendered utilities,
		// including the stateful start error and the alert's descendant variants.
		const candidates = await page
			.locator("[class]")
			.evaluateAll((elements) =>
				Array.from(
					new Set(
						elements.flatMap((element) =>
							(element.getAttribute("class") ?? "").split(/\s+/),
						),
					),
				),
			);
		await page.addStyleTag({ content: compiled.build(candidates) });
		await page.mouse.move(0, 0);
		let minimum = Number.POSITIVE_INFINITY;
		for (const mode of ["light", "dark"]) {
			await page.evaluate(async (mode) => {
				document.documentElement.classList.toggle("dark", mode === "dark");
				await new Promise(requestAnimationFrame);
				await Promise.all(
					document.getAnimations().map((animation) => animation.finished),
				);
			}, mode);
			for (const [name, selector] of [
				["runtime start error", "#runtime-fixture [role=alert]"],
				["alert title", '#error-alert [data-slot="alert-title"]'],
				["alert description", '#error-alert [data-slot="alert-description"]'],
				["tinted error", '#tinted-error [data-slot="alert-description"]'],
				["destructive button label", "#destructive-action"],
			]) {
				const ratio = await contrast(page.locator(selector));
				assert(ratio >= 4.5, `${mode} ${name}: ${ratio.toFixed(2)}:1 contrast`);
				minimum = Math.min(minimum, ratio);
				console.log(`${mode} ${name}: ${ratio.toFixed(2)}:1`);
			}
		}
		console.log(
			`Desktop error-text browser checks passed (minimum ${minimum.toFixed(2)}:1).`,
		);
	} finally {
		await browser.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
