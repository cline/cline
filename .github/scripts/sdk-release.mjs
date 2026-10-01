import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const packages = ["shared", "llms", "agents", "core", "sdk"];
const manifestPath = (name) => `sdk/packages/${name}/package.json`;

function parseVersion(version) {
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
		throw new Error(`Expected a stable SDK version, received ${version}`);
	}
	return version.split(".").map(BigInt);
}

export function assertNewVersion(current, next) {
	const previous = parseVersion(current);
	const proposed = parseVersion(next);
	for (let i = 0; i < previous.length; i++) {
		if (proposed[i] > previous[i]) return;
		if (proposed[i] < previous[i]) break;
	}
	throw new Error(`SDK version ${next} must be greater than ${current}`);
}

function manifests(root, ref) {
	return packages.map((name) => {
		const path = manifestPath(name);
		const content = ref
			? execFileSync("git", ["show", `${ref}:${path}`], {
					cwd: root,
					encoding: "utf8",
				})
			: readFileSync(resolve(root, path), "utf8");
		const pkg = JSON.parse(content);
		if (pkg.name !== `@cline/${name}`)
			throw new Error(`Unexpected package in ${path}`);
		return pkg;
	});
}

function sharedVersion(manifests) {
	const version = manifests[0].version;
	parseVersion(version);
	if (manifests.some((pkg) => pkg.version !== version)) {
		throw new Error("All five SDK package versions must match");
	}
	return version;
}

function assertChangelog(root, version) {
	const content = readFileSync(resolve(root, "sdk/CHANGELOG.md"), "utf8");
	if (content.match(/^## (.+)$/m)?.[1] !== version) {
		throw new Error(`The first SDK changelog entry must be ${version}`);
	}
}

export function prepareRelease(root, requestedVersion, releaseNotes) {
	const currentManifests = manifests(root);
	const current = sharedVersion(currentManifests);
	const [major, minor, patch] = parseVersion(current);
	const version = requestedVersion || `${major}.${minor}.${patch + 1n}`;
	assertNewVersion(current, version);
	assertChangelog(root, current);

	let notes = releaseNotes?.trim();
	if (!notes) {
		const tag = `sdk/sdk/v${current}`;
		// A missing release tag is an error: never silently draft the entire history.
		execFileSync("git", ["rev-parse", "--verify", `refs/tags/${tag}`], {
			cwd: root,
		});
		notes = execFileSync(
			"git",
			["log", "--format=- %s", `${tag}..HEAD`, "--", "sdk"],
			{
				cwd: root,
				encoding: "utf8",
			},
		).trim();
	}
	if (!notes)
		throw new Error(
			"No SDK changes found; provide release notes to prepare a release",
		);

	for (let i = 0; i < packages.length; i++) {
		const pkg = currentManifests[i];
		pkg.version = version;
		writeFileSync(
			resolve(root, manifestPath(packages[i])),
			`${JSON.stringify(pkg, null, "\t")}\n`,
		);
	}
	const changelogPath = resolve(root, "sdk/CHANGELOG.md");
	const changelog = readFileSync(changelogPath, "utf8");
	writeFileSync(
		changelogPath,
		changelog.replace(/^## /m, `## ${version}\n\n${notes}\n\n## `),
	);
	return version;
}

export function shouldPublish(root, before) {
	if (!/^[a-f0-9]{40}$/.test(before) || /^0+$/.test(before)) {
		throw new Error("A valid previous main commit is required");
	}
	const current = sharedVersion(manifests(root));
	const previous = sharedVersion(manifests(root, before));
	if (current === previous) return false;
	assertNewVersion(previous, current);
	assertChangelog(root, current);
	return true;
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const command = process.argv[2];
	let output;
	if (command === "prepare") {
		output = `version=${prepareRelease(process.cwd(), process.env.RELEASE_VERSION, process.env.RELEASE_NOTES)}`;
	} else if (command === "check-push") {
		output = `publish=${shouldPublish(process.cwd(), process.env.BEFORE_SHA)}`;
	} else {
		throw new Error(
			"Usage: bun .github/scripts/sdk-release.mjs <prepare|check-push>",
		);
	}
	console.log(output);
	if (process.env.GITHUB_OUTPUT)
		appendFileSync(process.env.GITHUB_OUTPUT, `${output}\n`);
}
