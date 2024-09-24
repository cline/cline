import { CUSTOM_INSTRUCTION, SYSTEM_PROMPT, tools } from './prompts'
import { Tool } from "./../shared/Tool"
import * as path from 'path';
import * as fs from 'fs';
import os from "os"
import osName from "os-name"

export class PromptBuilder {

    private cwd : string
    private noImagesSystemPrompt: string = ""
    private imagesSystemPrompt: string = ""
    private customInstructions: string = ""
    private claudePromptsTools: { [key: string]: string } = {}

    constructor(_cwd : string){
        this.cwd = _cwd
        if(this.ensureGitignoreEntry()){
            this.ensureClaudePromptsFile();
        }
    }    
    
    private ensureGitignoreEntry(): boolean {
        const gitignorePath = path.join(this.cwd, '.gitignore');
        if (fs.existsSync(gitignorePath)) {
            const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
            if (!gitignoreContent.includes('.claude_prompts.json')) {
                fs.appendFileSync(gitignorePath, '\n.claude_prompts.json');
            }
            return true;
        }
        return false;
    }

    private ensureClaudePromptsFile(): void {
        const claudePromptsPath = path.join(this.cwd, '.claude_prompts.json');
        if (!fs.existsSync(claudePromptsPath)) {
            this.createClaudePromptsFile(claudePromptsPath);
        } else {
            this.readClaudePromptsFile(claudePromptsPath);
        }
    }

    private createClaudePromptsFile(filePath: string): void {
        const emptyPrompts = {
            no_images_system_prompt: ["", "", "", "", ""],
            images_system_prompt: ["", "", "", "", ""],
            custom_instructions: ["", "", ""]
        };
        fs.writeFileSync(filePath, JSON.stringify(emptyPrompts, null, 2));
    }

    private readClaudePromptsFile(filePath: string): void {
        const claudePromptsContent = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        this.noImagesSystemPrompt = this.concatenateArray(claudePromptsContent.no_images_system_prompt);
        this.imagesSystemPrompt = this.concatenateArray(claudePromptsContent.images_system_prompt);
        this.customInstructions = this.concatenateArray(claudePromptsContent.custom_instructions);
        
        // Read tools descriptions if available
        if (claudePromptsContent.tools) {
            this.claudePromptsTools = claudePromptsContent.tools;
        }
    }

    private concatenateArray(arr: string[]): string {
        return arr.map(line => line === "" ? "" : line + "\n").join("");
    }

    getTools(supportsImages: boolean): Tool[] {
        const defaultTools = tools(supportsImages, this.cwd);
        
        // Override descriptions if custom descriptions are available
        if (Object.keys(this.claudePromptsTools).length > 0) {
            return defaultTools.map(tool => {
                if (this.claudePromptsTools[tool.name]) {
                    return {
                        ...tool,
                        description: this.claudePromptsTools[tool.name]
                    };
                }
                return tool;
            });
        }
        
        return defaultTools;
    }

    getSystemPrompt(supportsImages: boolean, defaultShell: string): string {
        const prompt = supportsImages ? this.imagesSystemPrompt : this.noImagesSystemPrompt;
        if(!prompt){
            return SYSTEM_PROMPT(supportsImages, this.cwd, defaultShell)
        }
        return prompt.replace("{cwd}", this.cwd)
            .replace("{defaultShell}", defaultShell)
            .replace("{osName}", osName())
            .replace("{homedir}", os.homedir().toPosix());
    }

    getCustomInstructions(customText: string): string {
        if(!this.customInstructions){
            return CUSTOM_INSTRUCTION(customText)
        }
        return this.customInstructions.replace("{customText}", customText);
    }
}
