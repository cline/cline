import { ToolArgs } from "./types"

export function getGenerateImageDescription(args: ToolArgs): string {
	return `## generate_image
Description: Request to generate or edit an image using AI models through OpenRouter API. This tool can create new images from text prompts or modify existing images based on your instructions. When an input image is provided, the AI will apply the requested edits, transformations, or enhancements to that image.
Parameters:
- prompt: (required) The text prompt describing what to generate or how to edit the image
- path: (required) The file path where the generated/edited image should be saved (relative to the current workspace directory ${args.cwd}). The tool will automatically add the appropriate image extension if not provided.
- image: (optional) The file path to an input image to edit or transform (relative to the current workspace directory ${args.cwd}). Supported formats: PNG, JPG, JPEG, GIF, WEBP.
Usage:
<generate_image>
<prompt>Your image description here</prompt>
<path>path/to/save/image.png</path>
<image>path/to/input/image.jpg</image>
</generate_image>

Example: Requesting to generate a sunset image
<generate_image>
<prompt>A beautiful sunset over mountains with vibrant orange and purple colors</prompt>
<path>images/sunset.png</path>
</generate_image>

Example: Editing an existing image
<generate_image>
<prompt>Transform this image into a watercolor painting style</prompt>
<path>images/watercolor-output.png</path>
<image>images/original-photo.jpg</image>
</generate_image>

Example: Upscaling and enhancing an image
<generate_image>
<prompt>Upscale this image to higher resolution, enhance details, improve clarity and sharpness while maintaining the original content and composition</prompt>
<path>images/enhanced-photo.png</path>
<image>images/low-res-photo.jpg</image>
</generate_image>`
}
