import assert from "node:assert/strict"
import { describe, it } from "mocha"
import { commandLooksDestructive, shouldAutoApproveExecuteCommand } from "../commandSafety"

// Regression coverage for the model-controlled-command-approval-flag hardening.
//
// The execute_command tool exposes a `requires_approval` boolean that the MODEL
// fills in. With the shipped default (executeSafeCommands=true), a command the
// model marks requires_approval=false takes the auto-approve path and runs with
// no human prompt. A prompt-injected / over-eager model can therefore mark a
// destructive command as "safe" and have it auto-executed.
//
// The fix makes the auto-approval decision consult harness-trusted state in
// addition to the model flag: when the harness independently considers the
// command destructive, a model "safe" classification no longer suffices to skip
// the human prompt.
describe("commandLooksDestructive (harness-trusted destructive-command detection)", () => {
	it("flags the documented destructive payload (rm -rf)", () => {
		// Mirrors the PoC minimal payload: execute_command{command:'rm -rf ~/x'}
		assert.equal(commandLooksDestructive("rm -rf ~/x"), true)
		assert.equal(commandLooksDestructive("rm -rf /"), true)
		assert.equal(commandLooksDestructive("rm -rf /important/data"), true)
	})

	it("flags rm with combined / reordered recursive+force flags", () => {
		assert.equal(commandLooksDestructive("rm -fr ~/x"), true)
		assert.equal(commandLooksDestructive("rm -r -f ~/x"), true)
		assert.equal(commandLooksDestructive("rm -f -r ~/x"), true)
		assert.equal(commandLooksDestructive("rm --recursive --force ~/x"), true)
		assert.equal(commandLooksDestructive("rm --force --recursive ~/x"), true)
	})

	it("flags destructive commands hidden behind command chaining", () => {
		assert.equal(commandLooksDestructive('echo hi && rm -rf "$HOME"'), true)
		assert.equal(commandLooksDestructive("ls; rm -rf ~/x"), true)
		assert.equal(commandLooksDestructive("true || rm -rf ~/x"), true)
	})

	it("flags disk / filesystem destruction and privilege escalation", () => {
		assert.equal(commandLooksDestructive("dd if=/dev/zero of=/dev/sda"), true)
		assert.equal(commandLooksDestructive("mkfs.ext4 /dev/sdb1"), true)
		assert.equal(commandLooksDestructive("sudo rm -rf /etc"), true)
		assert.equal(commandLooksDestructive("git reset --hard HEAD~5"), true)
	})

	it("does NOT flag ordinary development commands (no false positives)", () => {
		// These are exactly the kinds of "safe" commands the auto-approve-safe
		// feature is designed to run unattended.
		assert.equal(commandLooksDestructive("ls -la"), false)
		assert.equal(commandLooksDestructive("npm install"), false)
		assert.equal(commandLooksDestructive("npm run build"), false)
		assert.equal(commandLooksDestructive("npm test"), false)
		assert.equal(commandLooksDestructive("git status"), false)
		assert.equal(commandLooksDestructive("git commit -m 'msg'"), false)
		assert.equal(commandLooksDestructive("cat package.json"), false)
		assert.equal(commandLooksDestructive("python manage.py runserver"), false)
		assert.equal(commandLooksDestructive("rm build/output.tmp"), false) // non-recursive single file delete
		assert.equal(commandLooksDestructive("echo 'rm -rf is dangerous'"), false) // literal text in single quotes
		assert.equal(commandLooksDestructive("grep -rf patterns.txt src/"), false) // -rf here is grep's flags, not rm
	})

	it("handles empty / whitespace commands without flagging", () => {
		assert.equal(commandLooksDestructive(""), false)
		assert.equal(commandLooksDestructive("   "), false)
	})
})

describe("shouldAutoApproveExecuteCommand (model flag is not the sole gate)", () => {
	// Shipped default: executeSafeCommands=true (autoApproveSafe), executeAllCommands=false.
	const SHIPPED_DEFAULT = { autoApproveSafe: true, autoApproveAll: false, isSubagentExecution: false }

	it("SECURITY: a model-'safe' destructive command is NOT auto-approved under shipped defaults", () => {
		// This is the core of the finding: model sets requires_approval=false on a
		// destructive command. Before the fix this auto-approved and ran with no
		// human prompt. After the fix the harness refuses auto-approval, so the
		// command routes to manual approval.
		const decision = shouldAutoApproveExecuteCommand({
			...SHIPPED_DEFAULT,
			requiresApprovalPerLLM: false, // model claims "safe"
			command: "rm -rf ~/x", // but it is destructive
		})
		assert.equal(decision, false, "destructive command marked 'safe' by the model must NOT auto-approve")
	})

	it("still auto-approves ordinary 'safe' commands (no UX regression)", () => {
		for (const command of ["npm install", "npm run build", "ls -la", "git status"]) {
			const decision = shouldAutoApproveExecuteCommand({
				...SHIPPED_DEFAULT,
				requiresApprovalPerLLM: false,
				command,
			})
			assert.equal(decision, true, `expected '${command}' to remain auto-approved`)
		}
	})

	it("does not auto-approve when the model itself flags approval (default: executeAllCommands=false)", () => {
		const decision = shouldAutoApproveExecuteCommand({
			...SHIPPED_DEFAULT,
			requiresApprovalPerLLM: true,
			command: "npm install left-pad",
		})
		assert.equal(decision, false)
	})

	it("honors the explicit all-commands opt-in for risky commands (unchanged behavior)", () => {
		const decision = shouldAutoApproveExecuteCommand({
			isSubagentExecution: false,
			autoApproveSafe: true,
			autoApproveAll: true, // user explicitly opted in to auto-approve everything
			requiresApprovalPerLLM: true,
			command: "rm -rf ~/x",
		})
		assert.equal(decision, true, "all-commands opt-in is a deliberate harness-trusted decision")
	})

	it("does not auto-approve a destructive command even with the all-commands opt-in if the model marked it safe", () => {
		// When the model claims "safe" the safe-path is taken, which is gated by the
		// destructive check regardless of the all-commands toggle.
		const decision = shouldAutoApproveExecuteCommand({
			isSubagentExecution: false,
			autoApproveSafe: true,
			autoApproveAll: true,
			requiresApprovalPerLLM: false, // model claims "safe"
			command: "rm -rf ~/x",
		})
		assert.equal(decision, false)
	})

	it("auto-approves subagent execution regardless of command (unchanged behavior)", () => {
		const decision = shouldAutoApproveExecuteCommand({
			isSubagentExecution: true,
			autoApproveSafe: false,
			autoApproveAll: false,
			requiresApprovalPerLLM: false,
			command: "rm -rf ~/x",
		})
		assert.equal(decision, true)
	})
})
