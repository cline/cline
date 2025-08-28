import { ToolArgs } from "./types"

export function getGenerateImageDescription(args: ToolArgs): string {
	return `## generate_image
Description: Request to generate an image using AI models through OpenRouter API. This tool creates images from text prompts and saves them to the specified path.
Parameters:
- prompt: (required) The text prompt describing the image to generate
- path: (required) The file path where the generated image should be saved (relative to the current workspace directory ${args.cwd}). The tool will automatically add the appropriate image extension if not provided.
Usage:
<generate_image>
<prompt>Your image description here</prompt>
<path>path/to/save/image.png</path>
</generate_image>

Example: Requesting to generate a sunset image
<generate_image>
<prompt>A beautiful sunset over mountains with vibrant orange and purple colors</prompt>
<path>images/sunset.png</path>
</generate_image>`
}
