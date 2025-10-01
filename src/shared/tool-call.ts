// Tool call response from OpenAI
//  "tool_calls": [
//         {
//           "id": "call_abc123",
//           "type": "function",
//           "function": {
//             "name": "search_gutenberg_books",
//             "arguments": "{\"search_terms\": [\"James\", \"Joyce\"]}"
//           }
//         }
//       ]

// Tool result message constructed by Cline
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
