// {
//     "role": "tool",
//     "tool_call_id": "call_abc123",
//     "content": "[{\"id\": 4300, \"title\": \"Ulysses\", \"authors\": [{\"name\": \"Joyce, James\"}]}]"
// }

export interface ClineToolResult {
	role: "tool"
	tool_call_id: string
	content: string
}
