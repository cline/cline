import { execSync } from "child_process"

export function getGitSha() {
	let gitSha = undefined

	try {
		gitSha = execSync("git rev-parse HEAD").toString().trim()
	} catch (e) {}

	return gitSha
}
