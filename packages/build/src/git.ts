import { execSync } from "child_process"

export function getGitSha() {
	let gitSha: string | undefined = undefined

	try {
		gitSha = execSync("git rev-parse HEAD").toString().trim()
	} catch (_e) {
		// Do nothing.
	}

	return gitSha
}
