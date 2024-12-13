const CallToolResultSchema = {
  parse: jest.fn().mockReturnValue({})
}

const ListToolsResultSchema = {
  parse: jest.fn().mockReturnValue({
    tools: []
  })
}

const ListResourcesResultSchema = {
  parse: jest.fn().mockReturnValue({
    resources: []
  })
}

const ListResourceTemplatesResultSchema = {
  parse: jest.fn().mockReturnValue({
    resourceTemplates: []
  })
}

const ReadResourceResultSchema = {
  parse: jest.fn().mockReturnValue({
    contents: []
  })
}

const ErrorCode = {
  InvalidRequest: 'InvalidRequest',
  MethodNotFound: 'MethodNotFound',
  InvalidParams: 'InvalidParams',
  InternalError: 'InternalError'
}

class McpError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

module.exports = {
  CallToolResultSchema,
  ListToolsResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ReadResourceResultSchema,
  ErrorCode,
  McpError
}