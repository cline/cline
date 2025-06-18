import { ApiHandler } from "@api/index"

// 팔로우업 질문 인터페이스
export interface FollowUpQuestion {
	question: string
	options: string[]
}

// 개선된 결과 인터페이스
export interface EnhancedRefinementResult {
	refinedPrompt: string
	explanation: string
	needsMoreInfo?: boolean
	followUpQuestions?: FollowUpQuestion[]
	extractedData?: any
	isInteractiveComplete?: boolean
}

export interface RefinedPromptResult {
	refinedPrompt: string
	needsMoreInfo: boolean
	followUpQuestions: FollowUpQuestion[]
	originalPrompt: string
	explanation: string
}

export async function refinePrompt(prompt: string, apiHandler: ApiHandler): Promise<RefinedPromptResult> {
	try {
		// Apply LLM-based prompt refinement
		const refinedPrompt = await performLLMPromptRefinement(prompt, apiHandler)

		return {
			originalPrompt: prompt,
			refinedPrompt: refinedPrompt.refinedPrompt,
			explanation: refinedPrompt.explanation,
			needsMoreInfo: refinedPrompt.needsMoreInfo || false,
			followUpQuestions: refinedPrompt.followUpQuestions || [],
		}
	} catch (error) {
		console.error("Error in prompt refinement:", error)
		return {
			originalPrompt: prompt,
			refinedPrompt: prompt,
			explanation: `LLM refinement failed.`,
			needsMoreInfo: false,
			followUpQuestions: [],
		}
	}
}

async function performLLMPromptRefinement(prompt: string, apiHandler: ApiHandler): Promise<EnhancedRefinementResult> {
	// 웹 프로젝트 템플릿 (RAG를 통해 가져왔다고 가정)
	const webProjectTemplate = {
		name: "Modern Web Application Template",
		description: "A template for creating modern web applications",
		slots: {
			projectName: {
				description: "Name of the project/application",
				required: true,
			},
			projectType: {
				description: "Type of web application",
				required: true,
				options: ["portfolio", "blog", "dashboard", "landing-page"],
			},
			mainFeatures: {
				description: "Key features and functionality",
				required: true,
			},
			designStyle: {
				description: "Visual design preferences",
				required: true,
			},
			primaryColor: {
				description: "Primary color scheme",
				required: true,
			},
			targetAudience: {
				description: "Target users or audience",
				required: false,
			},
			technologies: {
				description: "Preferred technologies or frameworks",
				required: false,
			},
			pages: {
				description: "Specific pages or sections needed",
				required: false,
			},
			animations: {
				description: "Animation or interaction preferences",
				required: false,
			},
		},
	}

	// Project Specification Format (Markdown format)
	const projectSpecificationFormat = `
	## Project Specification Format

	Create a comprehensive project specification using the following structure:

	### Project Overview
	- **Project Name**: [Extracted or inferred project name]
	- **Project Type**: [Type of web application (portfolio, e-commerce, blog, etc.)]
	- **Target Audience**: [Who will use this application]
	- **Project Goals**: [Main objectives and purpose]

	### Technical Requirements
	- **Preferred Technologies**: [Frontend frameworks, libraries, tools]
	- **Architecture**: [Basic structure and approach]
	- **Platform**: [Web, mobile-responsive, PWA, etc.]

	### Design Specifications
	- **Design Style**: [Modern, minimalist, professional, etc.]
	- **Color Palette**: 
	  - Primary Color: [Main brand color with hex code]
	  - Secondary Colors: [Supporting colors]
	  - Accent Colors: [Call-to-action and highlight colors]
	- **Typography**: 
	  - Heading Fonts: [Font family for titles and headings]
	  - Body Fonts: [Font family for content text]
	  - Font Sizes: [Responsive text scaling approach]
	- **Layout & Spacing**:
	  - Grid System: [12-column, flexbox, css grid approach]
	  - Breakpoints: [Mobile: 768px, Tablet: 1024px, Desktop: 1200px+]
	  - Spacing Scale: [Consistent margin/padding system]
	- **UI Components**:
	  - Button Styles: [Primary, secondary, outline variations]
	  - Form Elements: [Input fields, dropdowns, checkboxes styling]
	  - Navigation: [Header, sidebar, breadcrumb styles]
	- **Visual Effects**:
	  - Shadows: [Box shadows, text shadows]
	  - Border Radius: [Corner rounding approach]
	  - Animations: [Hover effects, transitions, loading states]

	### Feature Requirements
	- **Core Features**: [Essential functionality that must be included]
	- **Additional Features**: [Nice-to-have features]
	- **User Interactions**: [How users will interact with the application]

	### Page Structure
	- **Required Pages**: [List of necessary pages/sections]
	- **Content Strategy**: [Type of content for each page]
	- **Navigation**: [How users will move through the site]

	### Implementation Details
	- **Development Approach**: [Step-by-step implementation strategy]
	- **File Structure**: 
	  - Project Organization: [Root directory structure and main folders]
	  - Asset Management: [Images, fonts, icons, media files organization]
	  - Source Code Structure: [Main code files, modules, components organization]
	  - Configuration Files: [Settings, environment, build configuration placement]
	  - Documentation: [README, docs, comments structure]
	  - Build Output: [Distribution, compiled files location]

	Use this format to create a clear, actionable specification that a developer can immediately use to build the project.`

	// Dynamically extract required and optional fields from template
	const requiredFields = Object.entries(webProjectTemplate.slots)
		.filter(([_, slot]) => slot.required === true)
		.map(([key, _]) => key)

	const optionalFields = Object.entries(webProjectTemplate.slots)
		.filter(([_, slot]) => slot.required === false)
		.map(([key, _]) => key)

	// Generate extractedData structure dynamically
	const allSlotKeys = Object.keys(webProjectTemplate.slots)
	const extractedDataStructure = allSlotKeys.map((key) => `    "${key}": "extracted value or null"`).join(",\n")

	const systemPrompt = `You are a web project specification assistant. Extract information from user prompts and generate follow-up questions for any missing required data.

IMPORTANT: All follow-up questions and options must be generated in Korean language.

TEMPLATE STRUCTURE:
${JSON.stringify(webProjectTemplate, null, 2)}

${projectSpecificationFormat}

QUESTION GENERATION RULES:
- For ANY missing required field (required: true), MUST generate a specific follow-up question IN KOREAN with multiple choice options
- For all optional fields (required: false), create ONE comprehensive question IN KOREAN that includes all optional field names in the question text itself, with EMPTY options array (for open-ended response)
- ALL follow-up questions and options must be written in Korean language
- Required fields: ${requiredFields.join(", ")}
- Optional fields: ${optionalFields.join(", ")}

CRITICAL: You must respond with COMPLETE, VALID JSON only. No truncation, no "...", no partial responses.

RESPONSE FORMAT (COMPLETE THIS EXACT STRUCTURE):
{
  "extractedData": {
${extractedDataStructure}
  },
  "missingRequiredSlots": ["array of missing required slot names"],
  "followUpQuestions": [
    {
      "question": "Specific question text for missing required slot OR comprehensive question for optional slots",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"]
    }
  ],
  "needsMoreInfo": boolean,
  "refinedPrompt": "A comprehensive project specification in English following the Project Specification Format above, filled with extracted information, detailed technical specifications, and professional recommendations"
}

RULES:
- For required fields: Generate 3-4 realistic options for each follow-up question IN KOREAN
- For optional fields: Include all optional field names (${optionalFields.join(", ")}) directly in the question text with empty options array
- MUST ask about ALL missing required fields individually: ${requiredFields.join(", ")}
- Optional fields question format: "추가적으로 다음 항목들에 대해 선호사항이 있으시면 자유롭게 알려주세요: [list all optional fields with descriptions]" with "options": []
- ALL questions must be written in Korean
- REFINED PROMPT MUST BE WRITTEN IN ENGLISH with detailed, specific, and professional content
- Use the Project Specification Format structure exactly, filling each section with comprehensive details in English
- Include concrete technical specifications, specific recommendations, and actionable implementation details
- NEVER use "..." or truncate any part of the JSON response
- Always close all brackets and quotes properly`

	const userMessage = `Analyze this web project request and extract template slot information:

User Request: "${prompt}"

Please extract available information, identify missing required elements, and generate follow-up questions if needed.`

	// Call LLM for template-based analysis
	const stream = apiHandler.createMessage(systemPrompt, [
		{
			role: "user",
			content: userMessage,
		},
	])

	let response = ""
	for await (const chunk of stream) {
		if (chunk.type === "text") {
			response += chunk.text
		}
	}

	// Parse LLM response
	try {
		// Extract JSON from response (in case there's extra text)
		const jsonMatch = response.match(/\{[\s\S]*\}/)
		if (!jsonMatch) {
			throw new Error("No JSON found in LLM response")
		}

		const analysisResult = JSON.parse(escapeNewlinesInJsonStrings(jsonMatch[0]))

		return {
			refinedPrompt: analysisResult.refinedPrompt || "",
			followUpQuestions: analysisResult.followUpQuestions || [],
			explanation: `Generated ${analysisResult.followUpQuestions.length} follow-up questions to gather missing information.`,
			needsMoreInfo: true,
			extractedData: analysisResult.extractedData,
			isInteractiveComplete: false,
		}
	} catch (parseError) {
		console.error("Error parsing LLM template analysis response:", parseError)
		throw new Error("Failed to parse LLM response")
	}
}

/**
 * Escape *literal* new-line characters (`\n`) that occur **inside** string
 * literals of a JSON-like text, so it can be fed to JSON.parse().
 *
 * @param raw  –  JSON-looking text emitted by an LLM
 * @returns fixed text safe for JSON.parse()
 */
export function escapeNewlinesInJsonStrings(raw: string): string {
	let inString = false // are we currently between unescaped double quotes?
	let result = ""

	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i]

		// toggle when we hit a non-escaped "
		if (ch === '"' && raw[i - 1] !== "\\") {
			inString = !inString
			result += ch
			continue
		}

		// inside a string → replace real newline with the 2-char sequence \n
		if (ch === "\n" && inString) {
			result += "\\n"
			continue
		}

		result += ch
	}

	return result
}
