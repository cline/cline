// Test script for MCP code escaping
// This script tests the code escaping functionality for MCP tools
// It simulates the behavior of useMcpToolTool.ts with different types of input

function testMcpEscaping(input, description) {
  console.log(`\n=== Testing ${description} ===`);
  console.log("Input:", input);
  
  try {
    // First try to parse as JSON directly (normal behavior)
    const parsed = JSON.parse(input);
    console.log("✅ Successfully parsed as JSON:", parsed);
    return parsed;
  } catch (error) {
    console.log("❌ Failed to parse as JSON, trying fallback handling...");
    
    try {
      // Check if it looks like a JSON object already (starts with { or [)
      const trimmed = input.trim();
      if (
        (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
        (trimmed.startsWith("[") && trimmed.endsWith("]"))
      ) {
        // If it looks like JSON but couldn't be parsed, then it's truly invalid
        console.log("❌ Input appears to be invalid JSON");
        return null;
      }

      // Otherwise, handle it as a raw string input - automatically place it in a properly escaped JSON object
      const parsedArguments = {
        input_data: input,
      };
      console.log("✅ Handled as raw string input:", parsedArguments);
      return parsedArguments;
    } catch (nestedError) {
      console.log("❌ Failed to process arguments:", nestedError);
      return null;
    }
  }
}

// Test cases
console.log("TESTING MCP CODE ESCAPING");

// Test 1: Valid JSON
testMcpEscaping('{"name": "test", "value": 123}', "Valid JSON");

// Test 2: Invalid JSON
testMcpEscaping('{name: "test", value: 123}', "Invalid JSON");

// Test 3: LaTeX code with backslashes and special characters
testMcpEscaping(`\\stepcounter{fragenummer}
\\arabic{fragenummer}. & \\multicolumn{1}{|p{12cm}|}{\\raggedright #1 } & \\ifthenelse{#2=1}{{
\\color{blue}{X}
}}{} & \\ifthenelse{#2=1}{}{
\\color{blue}{X}
}`, "LaTeX code with special characters");

// Test 4: Python code with indentation, quotes and backslashes
testMcpEscaping(`def process_string(s):
    # Handle escape sequences
    s = s.replace('\\n', '\\\\n')
    s = s.replace('\\t', '\\\\t')
    
    # Handle quotes
    s = s.replace('"', '\\"')
    s = s.replace("'", "\\'")
    
    return f"Processed: {s}"

print(process_string("Hello\\nWorld"))`, "Python code with quotes and backslashes");

// Test 5: Plain text
testMcpEscaping("This is just plain text without any special formatting", "Plain text");

console.log("\nAll tests completed!");