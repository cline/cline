import { describe, it } from "mocha"
import "should"
import { parseAssistantMessageV3 } from "../../../src/core/assistant-message"

describe("parseAssistantMessageV3", () => {
	it("parses LS invoke with path and default recursive", () => {
		const msg = '<function_calls><invoke name="LS"><parameter name="path">/tmp</parameter></invoke></function_calls>'
		const result = parseAssistantMessageV3(msg)
		result.length.should.equal(1)
		const tool = result[0] as any
		tool.type.should.equal("tool_use")
		tool.name.should.equal("list_files")
		tool.params.should.have.property("path", "/tmp")
		tool.params.should.have.property("recursive", "false")
		tool.partial.should.equal(false)
	})

	it("parses Grep invoke and maps params", () => {
		const msg =
			'<function_calls><invoke name="Grep"><parameter name="pattern">TODO</parameter><parameter name="path">./src</parameter><parameter name="include">*.ts</parameter></invoke></function_calls>'
		const result = parseAssistantMessageV3(msg)
		result.length.should.equal(1)
		const tool = result[0] as any
		tool.type.should.equal("tool_use")
		tool.name.should.equal("search_files")
		tool.params.should.have.property("regex", "TODO")
		tool.params.should.have.property("path", "./src")
		tool.params.should.have.property("file_pattern", "*.ts")
		tool.partial.should.equal(false)
	})

	it("parses Bash invoke and transforms requires_approval", () => {
		const msg =
			'<function_calls><invoke name="Bash"><parameter name="command">echo hi</parameter><parameter name="requires_approval">true</parameter></invoke></function_calls>'
		const result = parseAssistantMessageV3(msg)
		result.length.should.equal(1)
		const tool = result[0] as any
		tool.type.should.equal("tool_use")
		tool.name.should.equal("execute_command")
		tool.params.should.have.property("command", "echo hi")
		tool.params.should.have.property("requires_approval", "true")
		tool.partial.should.equal(false)
	})

	it("parses Write invoke and maps file_path and content", () => {
		const msg =
			'<function_calls><invoke name="Write"><parameter name="file_path">/a/b.txt</parameter><parameter name="content">hello</parameter></invoke></function_calls>'
		const result = parseAssistantMessageV3(msg)
		result.length.should.equal(1)
		const tool = result[0] as any
		tool.type.should.equal("tool_use")
		tool.name.should.equal("write_to_file")
		tool.params.should.have.property("path", "/a/b.txt")
		tool.params.should.have.property("content", "hello")
		tool.partial.should.equal(false)
	})

	it("parses multiple invokes in order", () => {
		const msg =
			"<function_calls>" +
			'<invoke name="LS"><parameter name="path">/x</parameter></invoke>' +
			'<invoke name="Grep"><parameter name="pattern">fixme</parameter><parameter name="path">./y</parameter></invoke>' +
			"</function_calls>"
		const result = parseAssistantMessageV3(msg)
		result.length.should.equal(2)
		const tool1 = result[0] as any
		const tool2 = result[1] as any
		tool1.name.should.equal("list_files")
		tool1.params.should.have.property("path", "/x")
		tool2.name.should.equal("search_files")
		tool2.params.should.have.property("regex", "fixme")
		tool2.params.should.have.property("path", "./y")
	})

	it("ignores unknown invoke names", () => {
		const msg = '<function_calls><invoke name="Unknown"><parameter name="x">y</parameter></invoke></function_calls>'
		const result = parseAssistantMessageV3(msg)
		result.length.should.equal(0)
	})
})
