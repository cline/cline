import assert from "node:assert/strict"
import { describe, it } from "mocha"
import {
	createMalformedExecuteCommandXmlError,
	getMalformedExecuteCommandXmlCloseTag,
	isLikelyLongRunningCommand,
	isMalformedExecuteCommandXml,
	resolveCommandTimeoutSeconds,
} from "../ExecuteCommandToolHandler"

describe("ExecuteCommandToolHandler timeout policy", () => {
	it("returns undefined when managed timeout is disabled", () => {
		const timeout = resolveCommandTimeoutSeconds("npm test", undefined, false)
		assert.equal(timeout, undefined)
	})

	it("uses explicit timeout when provided", () => {
		const timeout = resolveCommandTimeoutSeconds("npm test", "45", true)
		assert.equal(timeout, 45)
	})

	it("falls back to default timeout for short commands", () => {
		const timeout = resolveCommandTimeoutSeconds("ls -la", undefined, true)
		assert.equal(timeout, 30)
	})

	it("uses extended timeout for known long-running commands", () => {
		const timeout = resolveCommandTimeoutSeconds("npm run build", undefined, true)
		assert.equal(timeout, 300)
	})

	it("detects common long-running command families", () => {
		assert.equal(isLikelyLongRunningCommand("cargo build --release"), true)
		assert.equal(isLikelyLongRunningCommand("docker build ."), true)
		assert.equal(isLikelyLongRunningCommand("pytest -q"), true)
	})
})

describe("ExecuteCommandToolHandler malformed XML detection", () => {
	it("detects execute_command XML swallowed into the command parameter", () => {
		const command =
			"npm test</unexpected>\n" +
			"<requires_approval>false</requires_approval>\n" +
			"</execute_command>"

		assert.equal(isMalformedExecuteCommandXml(command), true)
		assert.equal(getMalformedExecuteCommandXmlCloseTag(command), "</unexpected>")
	})

	it("does not flag normal command text", () => {
		const command = "npm test -- --reporter spec"

		assert.equal(isMalformedExecuteCommandXml(command), false)
		assert.equal(getMalformedExecuteCommandXmlCloseTag(command), undefined)
	})

	it("detects a swallowed execute_command close tag without a close-tag hint", () => {
		const command = "npm test\n</execute_command>"

		assert.equal(isMalformedExecuteCommandXml(command), true)
		assert.equal(getMalformedExecuteCommandXmlCloseTag(command), undefined)

		const message = createMalformedExecuteCommandXmlError(command)
		assert.match(message, /Malformed XML in execute_command/)
		assert.doesNotMatch(message, /instead of '<\/command>'/)
	})

	it("tells the model to fix malformed execute_command XML", () => {
		const message = createMalformedExecuteCommandXmlError(
			"npm test</unexpected>\n<requires_approval>false</requires_approval>",
		)

		assert.match(message, /Malformed XML in execute_command/)
		assert.match(message, /<\/unexpected>/)
		assert.match(message, /<\/command>/)
		assert.match(message, /<requires_approval>false<\/requires_approval>/)
	})
})
