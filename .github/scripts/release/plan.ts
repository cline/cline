import {
	appendFileSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

export const planPath = ".github/release-plan.json";
export const products = {
	sdk: {
		manifest: "sdk/packages/llms/package.json",
		changelog: "sdk/CHANGELOG.md",
		tag: "sdk/sdk/v",
		paths: ["sdk/packages"],
	},
	cli: {
		manifest: "apps/cli/package.json",
		changelog: "apps/cli/CHANGELOG.md",
		tag: "cli-v",
		paths: ["apps/cli", "sdk/packages"],
	},
	desktop: {
		manifest: "apps/examples/desktop-app/package.json",
		changelog: "apps/examples/desktop-app/CHANGELOG.md",
		tag: "desktop-v",
		paths: ["apps/examples/desktop-app", "sdk/packages"],
	},
} as const;
export type Product = keyof typeof products;
export type Bump = "patch" | "minor" | "major";
export type Plan = {
	schema: 1;
	base: string;
	products: Record<Product, { from: string; to: string; bump: Bump }>;
};
const productNames = Object.keys(products) as Product[];
const tauriPath = "apps/examples/desktop-app/src-tauri/tauri.conf.json";

export function nextVersion(version: string, bump: string): string {
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version))
		throw new Error(`Expected a stable version, got ${version}`);
	const parts = version.split(".").map(Number);
	const index = ["major", "minor", "patch"].indexOf(bump);
	if (index < 0 || parts.some((part) => !Number.isSafeInteger(part)))
		throw new Error(`Invalid bump/version: ${bump} / ${version}`);
	parts[index]++;
	if (!Number.isSafeInteger(parts[index])) throw new Error("Version overflow");
	for (let i = index + 1; i < parts.length; i++) parts[i] = 0;
	return parts.join(".");
}

export function parsePlan(value: unknown): Plan {
	const plan = value as Plan;
	if (plan?.schema !== 1 || !/^[0-9a-f]{40}$/.test(plan.base))
		throw new Error("Invalid release plan");
	for (const name of productNames) {
		const entry = plan.products?.[name];
		if (!entry || nextVersion(entry.from, entry.bump) !== entry.to)
			throw new Error(`Invalid ${name} release increment`);
	}
	return plan;
}

export function run(args: string[], cwd = process.cwd()): string {
	const result = Bun.spawnSync(args, { cwd, stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0)
		throw new Error(`${args.join(" ")}: ${result.stderr.toString()}`);
	return result.stdout.toString().trim();
}
function json(root: string, path: string) {
	return JSON.parse(readFileSync(join(root, path), "utf8"));
}
function writeJson(root: string, path: string, value: unknown) {
	writeFileSync(join(root, path), `${JSON.stringify(value, null, "\t")}\n`);
}
function sdkManifests(root: string): string[] {
	return readdirSync(join(root, "sdk/packages"), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `sdk/packages/${entry.name}/package.json`)
		.filter((path) => json(root, path).internal !== true);
}
export function releaseTags(plan: Plan): string[] {
	return [
		...["shared", "llms", "agents", "core", "sdk"].map(
			(name) => `sdk/${name}/v${plan.products.sdk.to}`,
		),
		`cli-v${plan.products.cli.to}`,
		`desktop-v${plan.products.desktop.to}`,
	];
}
function output(name: string, value: string) {
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

export function prepare(root: string, bumps: Record<Product, Bump>): Plan {
	const base = run(["git", "rev-parse", "HEAD"], root);
	const plan: Plan = { schema: 1, base, products: {} as Plan["products"] };
	// Validate everything before writing any version files.
	for (const name of productNames) {
		const from = json(root, products[name].manifest).version;
		plan.products[name] = {
			from,
			to: nextVersion(from, bumps[name]),
			bump: bumps[name],
		};
	}
	for (const path of sdkManifests(root)) {
		if (json(root, path).version !== plan.products.sdk.from)
			throw new Error(`SDK versions disagree: ${path}`);
	}
	if (json(root, tauriPath).version !== plan.products.desktop.from)
		throw new Error("Desktop and Tauri versions disagree");
	for (const tag of releaseTags(plan)) {
		if (run(["git", "tag", "--list", tag], root))
			throw new Error(`Release tag already exists: ${tag}`);
	}
	for (const name of productNames) {
		const product = products[name];
		const { to } = plan.products[name];
		const paths =
			name === "sdk"
				? sdkManifests(root)
				: [product.manifest, ...(name === "desktop" ? [tauriPath] : [])];
		for (const path of paths)
			writeJson(root, path, { ...json(root, path), version: to });
		// Exact current-version tag is the baseline; first releases include all scoped history.
		const tag = `${product.tag}${plan.products[name].from}`;
		const baseline = run(["git", "tag", "--list", tag], root);
		if (baseline)
			run(["git", "merge-base", "--is-ancestor", tag, "HEAD"], root);
		const commits = run(
			[
				"git",
				"log",
				baseline ? `${tag}..HEAD` : "HEAD",
				"--no-merges",
				"--format=- %s (%h)",
				"--",
				...product.paths,
			],
			root,
		);
		const notes = commits || "- Release updated workspace dependencies.";
		const old = readFileSync(join(root, product.changelog), "utf8");
		writeFileSync(
			join(root, product.changelog),
			`## ${to}\n\n${notes}\n\n${old}`,
		);
	}
	writeJson(root, planPath, plan);
	return plan;
}

export function validate(
	root: string,
	expectedSha: string,
	phase: "merged" | "pull-request" = "merged",
): Plan {
	if (
		!/^[0-9a-f]{40}$/.test(expectedSha) ||
		run(["git", "rev-parse", "HEAD"], root) !== expectedSha
	)
		throw new Error("Checkout must match the merged release commit");
	const plan = parsePlan(json(root, planPath));
	run(["git", "merge-base", "--is-ancestor", plan.base, "HEAD"], root);
	// A PR's synthetic merge is not on main yet; its first parent is the base.
	run(
		[
			"git",
			"merge-base",
			"--is-ancestor",
			phase === "merged" ? "HEAD" : "HEAD^",
			"origin/main",
		],
		root,
	);
	if (!run(["git", "diff", "HEAD^", "HEAD", "--", planPath], root))
		throw new Error("Merge does not introduce a release plan");
	for (const name of productNames) {
		const product = products[name];
		const entry = plan.products[name];
		for (const ref of [plan.base, "HEAD^"]) {
			const previous = JSON.parse(
				run(["git", "show", `${ref}:${product.manifest}`], root),
			);
			if (previous.version !== entry.from)
				throw new Error(
					`${name} release plan is stale; recreate it against current main`,
				);
		}
		if (json(root, product.manifest).version !== entry.to)
			throw new Error(`${name} manifest does not match release plan`);
		const changelog = readFileSync(join(root, product.changelog), "utf8");
		const section = changelog.match(
			/^## ([^\n]+)\n([\s\S]*?)(?=^## |$(?![\s\S]))/m,
		);
		if (section?.[1] !== entry.to || !section[2].trim())
			throw new Error(`${name} needs release notes for ${entry.to}`);
	}
	for (const path of sdkManifests(root)) {
		if (json(root, path).version !== plan.products.sdk.to)
			throw new Error(`SDK version mismatch: ${path}`);
	}
	if (json(root, tauriPath).version !== plan.products.desktop.to)
		throw new Error("Tauri version mismatch");
	// Preflight every tag before creating any. Retries may reuse tags, never move them.
	for (const tag of releaseTags(plan)) {
		if (
			run(["git", "tag", "--list", tag], root) &&
			run(["git", "rev-parse", `${tag}^{commit}`], root) !== expectedSha
		)
			throw new Error(`Tag ${tag} points at another commit`);
	}
	return plan;
}

if (import.meta.main) {
	const mode = process.argv[2];
	if (mode === "prepare") {
		const plan = prepare(process.cwd(), {
			sdk: process.env.SDK_BUMP as Bump,
			cli: process.env.CLI_BUMP as Bump,
			desktop: process.env.DESKTOP_BUMP as Bump,
		});
		const rows = productNames
			.map(
				(name) =>
					`| ${name} | ${plan.products[name].from} | ${plan.products[name].to} | ${plan.products[name].bump} |`,
			)
			.join("\n");
		const body = `## Coordinated release\n\n| Product | Current | Next | Bump |\n| --- | --- | --- | --- |\n${rows}\n\nReview and edit the three generated changelog sections into user-facing release notes before merging. For major bumps, describe breaking changes and migration steps where applicable.\n\nMerge with **squash or a merge commit**. Merging starts SDK → CLI → Desktop publishing from the merged commit. Desktop retains its PublishDesktop approval. Tags are created after merge. If another release changes the base versions, close this PR and prepare a fresh one.\n`;
		writeFileSync(
			join(process.env.RUNNER_TEMP || "/tmp", "release-pr.md"),
			body,
		);
		output(
			"title",
			`chore: release SDK ${plan.products.sdk.to}, CLI ${plan.products.cli.to}, Desktop ${plan.products.desktop.to}`,
		);
	} else if (mode === "validate") {
		validate(process.cwd(), process.env.RELEASE_SHA || "", "pull-request");
	} else if (mode === "tag") {
		const plan = validate(process.cwd(), process.env.RELEASE_SHA || "");
		for (const tag of releaseTags(plan)) {
			if (!run(["git", "tag", "--list", tag]))
				run(["git", "tag", "-a", tag, "-m", tag]);
		}
		run([
			"git",
			"push",
			"--atomic",
			"origin",
			...releaseTags(plan).map((tag) => `refs/tags/${tag}`),
		]);
		output("sha", run(["git", "rev-parse", "HEAD"]));
		output("cli_tag", `cli-v${plan.products.cli.to}`);
		output("desktop_tag", `desktop-v${plan.products.desktop.to}`);
	} else
		throw new Error(
			"Usage: bun .github/scripts/release/plan.ts prepare|validate|tag",
		);
}
