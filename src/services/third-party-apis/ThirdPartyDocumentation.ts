

export class ThirdPartyDocumentation {

	async getOpenaiDocumentation(languageType: string): Promise<any> {
		try {
			switch (languageType) {
                case "python":
                    return this.getOpenaiPythonDocumentation();
                case "typescript":
                    return this.getOpenaiTypescriptDocumentation();
                    
                default:
                    throw new Error(`Unsupported language type: ${languageType}`)
            }
		} catch (error) {
			throw error
		}
	}

    async getStripeDocumentation(languageType: string): Promise<any> {
        try {
            switch (languageType) {
                case "python":
                    return this.getStripePythonDocumentation();
                case "typescript":
                    return this.getStripeTypescriptDocumentation();
                    
                default:
                    throw new Error(`Unsupported language type: ${languageType}`)
            }   
        } catch (error) {
            throw error
        }
    }

    async getOpenaiPythonDocumentation(): Promise<any> {
        return `
Here's documentation on how to use openai apis:

1. Import the package:
\`\`\`python
from opengig_openai_wrapper import OpenAIWrapper
\`\`\`

2. Initialize the wrapper:
\`\`\`python
openAIWrapper = OpenAIWrapper(
    api_key=os.getenv("OPENAI_API_KEY"),
    service_provider="openai",
    max_retries=3
)
\`\`\`
- Method you can use:
- generate_response(system_prompt, user_prompt, output_format)

Example usage:
\`\`\`python
response = openAIWrapper.generate_response(
    system_prompt="You are a json formator.", 
    user_prompt="extract name and skills from the text and return in json format. text: 'name: John, skills: python, java, c++'",
    output_format="json" # "json" | "string"
)
print(response)
\`\`\`

The package provides a simplified interface to OpenAI's API with automatic retries and error handling.`;
    }

    async getOpenaiTypescriptDocumentation(): Promise<any> {
        return '';
    }

    async getStripePythonDocumentation(): Promise<any> {
        return '';
    }

    async getStripeTypescriptDocumentation(): Promise<any> {
        return '';
    }
}
