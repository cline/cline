import {
  Tool,
  FunctionDeclaration,
  SchemaType,
  FunctionDeclarationsTool
} from "@google/generative-ai"

interface OpenAIFunctionTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: {
      type: string;
      properties: Record<string, {
        type: string;
        description?: string;
        enum?: string[];
      }>;
      required?: string[];
    };
  };
}

// Convert OpenAI function format to Gemini format
export function convertOpenAiToolsToGemini(tools?: OpenAIFunctionTool[]): Tool[] | undefined {
  if (!tools) return undefined;

  return tools.map(tool => ({
    functionDeclarations: [{
      name: tool.function.name,
      description: tool.function.description || "",
      parameters: {
        type: tool.function.parameters.type.toUpperCase() as SchemaType,
        properties: Object.fromEntries(
          Object.entries(tool.function.parameters.properties).map(([key, value]) => [
            key,
            {
              type: value.type.toUpperCase() as SchemaType,
              description: value.description || "",
              ...(value.enum ? { enum: value.enum } : {})
            }
          ])
        ),
        required: tool.function.parameters.required || []
      }
    }]
  })) as Tool[];
}

// Convert Gemini function format to OpenAI format
export function convertGeminiToolsToOpenAi(tools?: Tool[]): OpenAIFunctionTool[] | undefined {
  if (!tools) return undefined;

  return tools.flatMap(tool => {
    const functionTool = tool as FunctionDeclarationsTool;
    if (!functionTool.functionDeclarations) return [];

    return functionTool.functionDeclarations.map(declaration => {
      if (!declaration.parameters) {
        // Return a minimal valid function definition if parameters are missing
        return {
          type: 'function' as const,
          function: {
            name: declaration.name,
            description: declaration.description || "",
            parameters: {
              type: "object",
              properties: {},
              required: []
            }
          }
        };
      }

      return {
        type: 'function' as const,
        function: {
          name: declaration.name,
          description: declaration.description || "",
          parameters: {
            type: declaration.parameters.type.toLowerCase(),
            properties: Object.fromEntries(
              Object.entries(declaration.parameters.properties || {}).map(([key, prop]) => [
                key,
                {
                  type: (prop as { type: SchemaType }).type.toLowerCase(),
                  description: (prop as { description?: string }).description || "",
                  ...(prop as { enum?: string[] }).enum ? { enum: (prop as { enum: string[] }).enum } : {}
                }
              ])
            ),
            required: declaration.parameters.required || []
          }
        }
      };
    });
  });
}