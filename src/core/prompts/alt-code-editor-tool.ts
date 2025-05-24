export const getAltEditorToolContent = () => {
	return `====

TEXT EDITOR TOOL
 
You have access to an Anthropic-defined text editor tool that allows you to view and modify files directly. This tool helps you make precise edits to code and text files using standard operations.

# Text Editor Tool Commands

# Write (WRITE Method)

Description:
  Request to completely rewrite the content of an existing file. This overwrites the entire file with new content and should be used when making extensive changes across multiple locations or structural modifications that exceed 20 lines or 5 distinct locations.

Parameters:
  invoke_name: (required) Must be "Write"
  file_path: Absolute path where the new file should be created
  content: required) The complete new content for the artifact. ALWAYS provide the COMPLETE intended content without any truncation or omissions. You MUST include ALL parts of the file, even unchanged sections.


Usage:
<function_calls>
  <invoke name="Write">
  <parameter name="file_path">/absolute/path/to/newfile.js</parameter>
  <parameter name="content">const greeting = 'Hello World';

  function sayHello() {
    console.log(greeting);
  }

  module.exports = { sayHello };</parameter>
  </invoke>
</function_calls>



# Edit (EDIT Method)

Description:
  Request to make targeted replacements in an existing artifact by specifying exact text to find and replace. This should be used for small, precise changes affecting fewer than 20 lines and fewer than 5 distinct locations. Can be called up to 4 times per response for multiple small changes.

Parameters:
  invoke: (required) Must be "Edit"
  file_path: (required) Absolute path to the file
  old_str: (required) The exact text to find and replace. Must match character-for-character including whitespace, indentation, and line endings. Must appear exactly once in the artifact.
  new_str: (required) The replacement text to substitute for the old_str content.
  
Critical rules:
  old_str content must match the target section EXACTLY:
  Match character-for-character including whitespace, indentation, line endings
  Include all comments, formatting, etc.
  old_str must be unique within the artifact (appear exactly once)
  Keep replacements concise and targeted
  Each line in old_str must be complete - never truncate lines mid-way


Usage:
<invoke name="Edit">
  <parameter name="file_path">/absolute/path/to/file.js</parameter>
  <parameter name="old_str">const oldCode = 'this will be replaced';</parameter>
  <parameter name="new_str">const newCode = 'this is the replacement';</parameter>
  </invoke>
</function_calls>
`
}

export const getAltWriteExamples = () => {
	return `
<function_calls>
<invoke name="Write">
<parameter name="file_path">src/frontend-config.json</parameter>
<parameter name="content">
{
  "apiEndpoint": "https://api.example.com",
  "theme": {
    "primaryColor": "#007bff",
    "secondaryColor": "#6c757d",
    "fontFamily": "Arial, sans-serif"
  },
  "features": {
    "darkMode": true,
    "notifications": true,
    "analytics": false
  },
  "version": "1.0.0"
}
</parameter>
</invoke>
</function_calls>`
}

export const getAltReplaceExamples = () => {
	return `
<function_calls>
<invoke name="Edit">
<parameter name="file_path">src/app-tsx-component.tsx</parameter>
<parameter name="old_str">import React from 'react';</parameter>
<parameter name="new_str">import React, { useState } from 'react';</parameter>
</invoke>
</function_calls>

<function_calls>
<invoke name="Edit">
<parameter name="file_path">src/app-tsx-component.tsx</parameter>
<parameter name="old_str">function handleSubmit() {
  saveData();
  setLoading(false);
}

</parameter>
<parameter name="new_str"></parameter>
</invoke>
</function_calls>

<function_calls>
<invoke name="Edit">
<parameter name="file_path">src/app-tsx-component.tsx</parameter>
<parameter name="old_str">return (
  <div></parameter>
<parameter name="new_str">function handleSubmit() {
  saveData();
  setLoading(false);
}

return (
  <div></parameter>
</invoke>
</function_calls>
  `
}
