export const newTaskToolResponse = () =>
	`<explicit_instructions type="new_task">
The user has explicitly asked you to help them create a new task with preloaded context, which you will generate. The user may have provided instructions or additional information for you to consider when summarizing existing work and creating the context for the new task.
Irrespective of whether additional information or instructions are given, you are ONLY allowed to respond to this message by calling the new_task tool.

The new_task tool is defined below:

Description:
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the new task.
The user will be presented with a preview of your generated context and can choose to create a new task or keep chatting in the current conversation.

Parameters:
- Context: (required) The context to preload the new task with. If applicable based on the current task, this should include:
  1. Current Work: Describe in detail what was being worked on prior to this request to create a new task. Pay special attention to the more recent messages / conversation.
  2. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for the new task.
  3. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  4. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  5. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.

Usage:
<new_task>
<context>context to preload new task with</context>
</new_task>

Below is the the user's input when they indicated that they wanted to create a new task.
</explicit_instructions>\n
`

export const condenseToolResponse = () =>
	`<explicit_instructions type="condense">
The user has explicitly asked you to create a detailed summary of the conversation so far, which will be used to compact the current context window while retaining key information. The user may have provided instructions or additional information for you to consider when summarizing the conversation.
Irrespective of whether additional information or instructions are given, you are only allowed to respond to this message by calling the condense tool.

The condense tool is defined below:

Description:
Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions. This summary should be thorough in capturing technical details, code patterns, and architectural decisions that would be essential for continuing with the conversation and supporting any continuing tasks.
The user will be presented with a preview of your generated summary and can choose to use it to compact their context window or keep chatting in the current conversation.
Users may refer to this tool as 'smol' or 'compact' as well. You should consider these to be equivalent to 'condense' when used in a similar context.

Parameters:
- Context: (required) The context to continue the conversation with. If applicable based on the current task, this should include:
  1. Previous Conversation: High level details about what was discussed throughout the entire conversation with the user. This should be written to allow someone to be able to follow the general overarching conversation flow.
  2. Current Work: Describe in detail what was being worked on prior to this request to compact the context window. Pay special attention to the more recent messages / conversation.
  3. Key Technical Concepts: List all important technical concepts, technologies, coding conventions, and frameworks discussed, which might be relevant for continuing with this work.
  4. Relevant Files and Code: If applicable, enumerate specific files and code sections examined, modified, or created for the task continuation. Pay special attention to the most recent messages and changes.
  5. Problem Solving: Document problems solved thus far and any ongoing troubleshooting efforts.
  6. Pending Tasks and Next Steps: Outline all pending tasks that you have explicitly been asked to work on, as well as list the next steps you will take for all outstanding work, if applicable. Include code snippets where they add clarity. For any next steps, include direct quotes from the most recent conversation showing exactly what task you were working on and where you left off. This should be verbatim to ensure there's no information loss in context between tasks.

Usage:
<condense>
<context>Your detailed summary</context>
</condense>

Example:
<condense>
<context>
1. Previous Conversation:
  [Detailed description]

2. Current Work:
  [Detailed description]

3. Key Technical Concepts:
  - [Concept 1]
  - [Concept 2]
  - [...]

4. Relevant Files and Code:
  - [File Name 1]
    - [Summary of why this file is important]
    - [Summary of the changes made to this file, if any]
    - [Important Code Snippet]
  - [File Name 2]
    - [Important Code Snippet]
  - [...]

5. Problem Solving:
  [Detailed description]

6. Pending Tasks and Next Steps:
  - [Task 1 details & next steps]
  - [Task 2 details & next steps]
  - [...]
</context>
</condense>

</explicit_instructions>\n
`

export const newRuleToolResponse = () =>
	`<explicit_instructions type="new_rule">
The user has explicitly asked you to help them create a new Cline rule file inside the .clinerules top-level directory based on the conversation up to this point in time. The user may have provided instructions or additional information for you to consider when creating the new Cline rule.
When creating a new Cline rule file, you should NOT overwrite or alter an existing Cline rule file. To create the Cline rule file you MUST use the new_rule tool. The new_rule tool can be used in either of the PLAN or ACT modes.

The new_rule tool is defined below:

Description:
Your task is to create a new Cline rule file which includes guidelines on how to approach developing code in tandem with the user, which can be either project specific or cover more global rules. This includes but is not limited to: desired conversational style, favorite project dependencies, coding styles, naming conventions, architectural choices, ui/ux preferences, etc.
The Cline rule file must be formatted as markdown and be a '.md' file. The name of the file you generate must be as succinct as possible and be encompassing the main overarching concept of the rules you added to the file (e.g., 'memory-bank.md' or 'project-overview.md').

Parameters:
- Path: (required) The path of the file to write to (relative to the current working directory). This will be the Cline rule file you create, and it must be placed inside the .clinerules top-level directory (create this if it doesn't exist). The filename created CANNOT be "default-clineignore.md". For filenames, use hyphens ("-") instead of underscores ("_") to separate words.
- Content: (required) The content to write to the file. ALWAYS provide the COMPLETE intended content of the file, without any truncation or omissions. You MUST include ALL parts of the file, even if they haven't been modified. The content for the Cline rule file MUST be created according to the following instructions:
  1. Format the Cline rule file to have distinct guideline sections, each with their own markdown heading, starting with "## Brief overview". Under each of these headings, include bullet points fully fleshing out the details, with examples and/or trigger cases ONLY when applicable.
  2. These guidelines can be specific to the task(s) or project worked on thus far, or cover more high-level concepts. Guidelines can include coding conventions, general design patterns, preferred tech stack including favorite libraries and language, communication style with Cline (verbose vs concise), prompting strategies, naming conventions, testing strategies, comment verbosity, time spent on architecting prior to development, and other preferences.
  3. When creating guidelines, you should not invent preferences or make assumptions based on what you think a typical user might want. These should be specific to the conversation you had with the user. Your guidelines / rules should not be overly verbose.
  4. Your guidelines should NOT be a recollection of the conversation up to this point in time, meaning you should NOT be including arbitrary details of the conversation.

Usage:
<new_rule>
<path>.clinerules/{file name}.md</path>
<content>Cline rule file content here</content>
</new_rule>

Example:
<new_rule>
<path>.clinerules/project-preferences.md</path>
<content>
## Brief overview
  [Brief description of the rules, including if this set of guidelines is project-specific or global]

## Communication style
  - [Description, rule, preference, instruction]
  - [...]

## Development workflow
  - [Description, rule, preference, instruction]
  - [...]

## Coding best practices
  - [Description, rule, preference, instruction]
  - [...]

## Project context
  - [Description, rule, preference, instruction]
  - [...]

## Other guidelines
  - [Description, rule, preference, instruction]
  - [...]
</content>
</new_rule>

Below is the user's input when they indicated that they wanted to create a new Cline rule file.
</explicit_instructions>\n
`

export const reportBugToolResponse = () =>
	`<explicit_instructions type="report_bug">
The user has explicitly asked you to help them submit a bug to the Cline github page (you MUST now help them with this irrespective of what your conversation up to this point in time was). To do so you will use the report_bug tool which is defined below. However, you must first ensure that you have collected all required information to fill in all the parameters for the tool call. If any of the the required information is apparent through your previous conversation with the user, you can suggest how to fill in those entries. However you should NOT assume you know what the issue about unless it's clear.
Otherwise, you should converse with the user until you are able to gather all the required details. When conversing with the user, make sure you ask for/reference all required information/fields. When referencing the required fields, use human friendly versions like "Steps to reproduce" rather than "steps_to_reproduce". Only then should you use the report_bug tool call.
The report_bug tool can be used in either of the PLAN or ACT modes.

The report_bug tool call is defined below:

Description:
Your task is to fill in all of the required fields for a issue/bug report on github. You should attempt to get the user to be as verbose as possible with their description of the bug/issue they encountered. Still, it's okay, when the user is unaware of some of the details, to set those fields as "N/A".

Parameters:
- title: (required) Concise description of the issue.
- what_happened: (required) What happened and also what the user expected to happen instead.
- steps_to_reproduce: (required) What steps are required to reproduce the bug.
- api_request_output: (optional) Relevant API request output.
- additional_context: (optional) Any other context about this bug not already mentioned.

Usage:
<report_bug>
<title>Title of the issue</title>
<what_happened>Description of the issue</what_happened>
<steps_to_reproduce>Steps to reproduce the issue</steps_to_reproduce>
<api_request_output>Output from the LLM API related to the bug</api_request_output>
<additional_context>Other issue details not already covered</additional_context>
</report_bug>

Below is the user's input when they indicated that they wanted to submit a Github issue.
</explicit_instructions>\n
`

export const deepPlanningToolResponse = () =>
	`<explicit_instructions type="deep-planning">
Your task is to create a comprehensive implementation plan before writing any code. This process has four distinct steps that must be completed in order.

Your behavior should be methodical and thorough - take time to understand the codebase completely before making any recommendations. The quality of your investigation directly impacts the success of the implementation.

## STEP 1: Silent Investigation

<important>
until explicitly instructed by the user to proceed with coding.
You must thoroughly understand the existing codebase before proposing any changes.
Perform your research without commentary or narration. Execute commands and read files without explaining what you're about to do. Only speak up if you have specific questions for the user.
</important>

### Required Research Activities
You must use the read_file tool to examine relevant source files, configuration files, and documentation. You must use terminal commands to gather information about the codebase structure and patterns. All terminal output must be piped to cat for visibility.

### Essential Terminal Commands
Execute these commands to build your understanding. You must tailor them to the codebase and ensure the output is not overly verbose. These are only examples, the exact commands will differ depending on the codebase.


# Discover project structure and file types
find . -type f -name "*.py" -o -name "*.js" -o -name "*.ts" -o -name "*.java" -o -name "*.cpp" | head -30 | cat

# Find all class and function definitions
grep -r "class\|function\|def\|interface\|struct" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" --include="*.cpp" . | cat

# Analyze import patterns and dependencies
grep -r "import\|from\|require\|#include" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" --include="*.cpp" . | sort | uniq | cat

# Find dependency manifests
find . -name "requirements*.txt" -o -name "package.json" -o -name "Cargo.toml" -o -name "pom.xml" -o -name "Gemfile" | xargs cat

# Identify technical debt and TODOs
grep -r "TODO\|FIXME\|XXX\|HACK\|NOTE" --include="*.py" --include="*.js" --include="*.ts" --include="*.java" --include="*.cpp" . | cat


## STEP 2: Discussion and Questions

Ask the user brief, targeted questions that will influence your implementation plan. Keep your questions concise and conversational. Ask only essential questions needed to create an accurate plan.

**Ask questions only when necessary for:**
- Clarifying ambiguous requirements or specifications
- Choosing between multiple equally valid implementation approaches  
- Confirming assumptions about existing system behavior or constraints
- Understanding preferences for specific technical decisions that will affect the implementation

Your questions should be direct and specific. Avoid long explanations or multiple questions in one response.

## STEP 3: Create Implementation Plan Document

Create a structured markdown document containing your complete implementation plan. The document must follow this exact format with clearly marked sections:

### Document Structure Requirements

Your implementation plan must be saved as implementation_plan.md, and *must* be structured as follows:


# Implementation Plan

[Overview]
Single sentence describing the overall goal.

Multiple paragraphs outlining the scope, context, and high-level approach. Explain why this implementation is needed and how it fits into the existing system.

[Types]  
Single sentence describing the type system changes.

Detailed type definitions, interfaces, enums, or data structures with complete specifications. Include field names, types, validation rules, and relationships.

[Files]
Single sentence describing file modifications.

Detailed breakdown:
- New files to be created (with full paths and purpose)
- Existing files to be modified (with specific changes)  
- Files to be deleted or moved
- Configuration file updates

[Functions]
Single sentence describing function modifications.

Detailed breakdown:
- New functions (name, signature, file path, purpose)
- Modified functions (exact name, current file path, required changes)
- Removed functions (name, file path, reason, migration strategy)

[Classes]
Single sentence describing class modifications.

Detailed breakdown:
- New classes (name, file path, key methods, inheritance)
- Modified classes (exact name, file path, specific modifications)
- Removed classes (name, file path, replacement strategy)

[Dependencies]
Single sentence describing dependency modifications.

Details of new packages, version changes, and integration requirements.

[Testing]
Single sentence describing testing approach.

Test file requirements, existing test modifications, and validation strategies.

[Implementation Order]
Single sentence describing the implementation sequence.

Numbered steps showing the logical order of changes to minimize conflicts and ensure successful integration.


## STEP 4: Create Implementation Task

Use the new_task command to create a task for implementing the plan. The task must include a <task_progress> list that breaks down the implementation into trackable steps.

### Task Creation Requirements

Your new task should be self-contained and reference the plan document rather than requiring additional codebase investigation. Include these specific instructions in the task description:

**Plan Document Navigation Commands:**
The implementation agent should use these commands to read specific sections of the implementation plan. You should adapt these examples to conform to the structure of the .md file you createdm, and explicitly provide them when creating the new task:


# Read Overview section
sed -n '/\[Overview\]/,/\[Types\]/p' implementation_plan.md | head -n 1 | cat

# Read Types section  
sed -n '/\[Types\]/,/\[Files\]/p' implementation_plan.md | head -n 1 | cat

# Read Files section
sed -n '/\[Files\]/,/\[Functions\]/p' implementation_plan.md | head -n 1 | cat

# Read Functions section
sed -n '/\[Functions\]/,/\[Classes\]/p' implementation_plan.md | head -n 1 | cat

# Read Classes section
sed -n '/\[Classes\]/,/\[Dependencies\]/p' implementation_plan.md | head -n 1 | cat

# Read Dependencies section
sed -n '/\[Dependencies\]/,/\[Testing\]/p' implementation_plan.md | head -n 1 | cat

# Read Testing section
sed -n '/\[Testing\]/,/\[Implementation Order\]/p' implementation_plan.md | head -n 1 | cat

# Read Implementation Order section
sed -n '/\[Implementation Order\]/,$p' implementation_plan.md | cat


**Task Progress Format:**
<IMPORTANT>
You absolutely must include the task_progress contents in context when creating the new task. When providing it, do not wrap it in XML tags- instead provide it like this:


task_progress Items:
- [ ] Step 1: Brief description of first implementation step
- [ ] Step 2: Brief description of second implementation step  
- [ ] Step 3: Brief description of third implementation step
- [ ] Step N: Brief description of final implementation step


You also MUST include the path to the markdown file you have created in your new task prompt. You should do this as follows:

Refer to @path/to/file/markdown.md for a complete breakdown of the task requirements and steps. You should periodically read this file again.



### Mode Switching

When creating the new task, request a switch to "act mode" if you are currently in "plan mode". This ensures the implementation agent operates in execution mode rather than planning mode.
</IMPORTANT>

## Quality Standards

You must be specific with exact file paths, function names, and class names. You must be comprehensive and avoid assuming implicit understanding. You must be practical and consider real-world constraints and edge cases. You must use precise technical language and avoid ambiguity.

Your implementation plan should be detailed enough that another developer could execute it without additional investigation.

---

**Execute all four steps in sequence. Your role is to plan thoroughly, not to implement. Code creation begins only after the new task is created and you receive explicit instruction to proceed.**

Below is the user's input when they indicated that they wanted to create a comprehensive implementation plan.
</explicit_instructions>\n
`
