import { describe, it, beforeEach, afterEach } from "mocha"
import { expect } from "chai"
import sinon from "sinon"
import type Anthropic from "@anthropic-ai/sdk"
import { LmStudioHandler } from "../lmstudio"

const fakeClient = {
  chat: {
    completions: {
      create: sinon.stub(),
    },
  },
  baseURL: "fake",
}

describe("LmStudioHandler", () => {
  let handler: LmStudioHandler

  const createAsyncIterable = (data: any[] = []) => {
    return {
      [Symbol.asyncIterator]: async function* () {
        yield* data
      },
    }
  }

  beforeEach(() => {
    handler = new LmStudioHandler({
      lmStudioBaseUrl: "http://localhost:1234",
      lmStudioModelId: "openai/gpt-oss-20b",
      lmStudioMaxTokens: "4096",
    } as any)
    sinon.stub(handler as any, "ensureClient").returns(fakeClient)
  })

  afterEach(() => {
    sinon.restore()
  })

  it("streams text and converts tool_calls/function_call deltas into Cline XML tool blocks", async () => {
    // Simulate streaming:
    // 1) normal text
    // 2) tool_calls deltas with name and split arguments
    // 3) finish reason triggers flush -> emits XML tool block
    // 4) usage
    fakeClient.chat.completions.create.resolves(
      createAsyncIterable([
        {
          choices: [{ delta: { content: "Hello " } }],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { name: "write_to_file" } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      // split arguments across chunks to simulate real streaming behavior
                      arguments: '{"path":"a.txt","content":"Hi","foo":"bar"',
                    },
                  },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: {
                      arguments: '}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
        {
          choices: [{}],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 7,
          },
        },
      ]),
    )

    const systemPrompt = "You are a helpful assistant."
    const messages: Anthropic.Messages.MessageParam[] = [
      {
        role: "user",
        content: "Please write a file.",
      },
    ] as any

    const textChunks: string[] = []
    let usage: { inputTokens: number; outputTokens: number } | null = null

    for await (const chunk of handler.createMessage(systemPrompt, messages)) {
      if (chunk.type === "text") {
        textChunks.push(chunk.text)
      } else if (chunk.type === "usage") {
        usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens }
      }
    }

    // 1) The first text delta should come through
    expect(textChunks[0]).to.equal("Hello ")

    // 2) The tool XML should be emitted after finish_reason=tool_calls
    const xml = textChunks.find((t) => t.includes("<write_to_file>"))
    expect(xml, "Expected an XML tool block for write_to_file").to.be.a("string")
    expect(xml).to.include("<path>a.txt</path>")
    expect(xml).to.include("<content>Hi</content>")
    // Unknown keys should be captured in <arguments> JSON
    expect(xml).to.include("<arguments>")
    expect(xml).to.include('"foo":"bar"')

    // 3) Usage should be emitted at the end
    expect(usage).to.deep.equal({ inputTokens: 12, outputTokens: 7 })

    // Validate we passed tools to the OpenAI-compatible call so models can trigger tool calls
    const callArgs = fakeClient.chat.completions.create.getCall(0).args[0]
    expect(callArgs).to.have.property("tools")
    expect(callArgs.tools).to.be.an("array").that.is.not.empty
    // One of the tool names should be write_to_file, as advertised from toolUseNames
    const toolNames = (callArgs.tools || []).map((t: any) => t?.function?.name).filter(Boolean)
    expect(toolNames).to.include("write_to_file")
  })

  it("supports legacy function_call delta format", async () => {
    fakeClient.chat.completions.create.resolves(
      createAsyncIterable([
        {
          choices: [{ delta: { content: "Start " } }],
        },
        {
          choices: [
            {
              delta: {
                function_call: { name: "search_files", arguments: '{"regex":"' },
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                function_call: { name: "search_files", arguments: 'hello","file_pattern":"*.ts"}' },
              },
              finish_reason: "function_call",
            },
          ],
        },
      ]),
    )

    const systemPrompt = "sys"
    const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: "Search for hello" }] as any

    const textChunks: string[] = []
    for await (const chunk of handler.createMessage(systemPrompt, messages)) {
      if (chunk.type === "text") textChunks.push(chunk.text)
    }

    expect(textChunks[0]).to.equal("Start ")
    const xml = textChunks.find((t) => t.includes("<search_files>"))
    expect(xml, "Expected an XML tool block for search_files").to.be.a("string")
    expect(xml).to.include("<regex>hello</regex>")
    expect(xml).to.include("<arguments>")
  })
})
