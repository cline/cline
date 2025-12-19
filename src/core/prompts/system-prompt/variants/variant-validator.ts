import { STANDARD_PLACEHOLDERS, SystemPromptSection, validateRequiredPlaceholders } from "../templates/placeholders"
import { TemplateEngine } from "../templates/TemplateEngine"
import type { PromptVariant } from "../types"

export interface ValidationResult {
	isValid: boolean
	errors: string[]
	warnings: string[]
}

export interface ValidationOptions {
	strict?: boolean // Enforce all best practices
	checkPlaceholders?: boolean // Validate placeholder usage
	checkComponents?: boolean // Validate component references
	checkTools?: boolean // Validate tool references
}

/**
 * Comprehensive validator for prompt variants
 */
export class VariantValidator {
	private templateEngine = new TemplateEngine()

	/**
	 * Validate a complete prompt variant
	 */
	validate(variant: PromptVariant, options: ValidationOptions = {}): ValidationResult {
		const errors: string[] = []
		const warnings: string[] = []

		// Default options
		const opts = {
			strict: false,
			checkPlaceholders: true,
			checkComponents: true,
			checkTools: true,
			...options,
		}

		// Basic required field validation
		this.validateRequiredFields(variant, errors)

		// Template validation
		if (opts.checkPlaceholders) {
			this.validateTemplate(variant, errors, warnings)
		}

		// Component validation
		if (opts.checkComponents) {
			this.validateComponents(variant, errors, warnings)
		}

		// Tool validation
		if (opts.checkTools) {
			this.validateTools(variant, errors, warnings)
		}

		// Strict mode additional checks
		if (opts.strict) {
			this.validateBestPractices(variant, warnings)
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
		}
	}

	private validateRequiredFields(variant: PromptVariant, errors: string[]): void {
		if (!variant.id) {
			errors.push("Variant ID is required")
		}
		if (!variant.description) {
			errors.push("Description is required")
		}
		if (!variant.baseTemplate) {
			errors.push("Base template is required")
		}
		if (!variant.componentOrder?.length) {
			errors.push("Component order is required")
		}
		if (variant.version < 1) {
			errors.push("Version must be >= 1")
		}
	}

	private validateTemplate(variant: PromptVariant, errors: string[], warnings: string[]): void {
		const { baseTemplate } = variant

		// Extract placeholders from template
		const templatePlaceholders = this.templateEngine.extractPlaceholders(baseTemplate)

		// Check for required placeholders
		const missingRequired = validateRequiredPlaceholders(Object.fromEntries(templatePlaceholders.map((p) => [p, true])))
		if (missingRequired.length > 0) {
			errors.push(`Missing required placeholders: ${missingRequired.join(", ")}`)
		}

		// Check for undefined placeholders (not in component order or standard placeholders)
		const validPlaceholders = new Set([
			...variant.componentOrder,
			...Object.values(STANDARD_PLACEHOLDERS),
			...Object.keys(variant.placeholders || {}),
		])

		const undefinedPlaceholders = templatePlaceholders.filter((p) => !validPlaceholders.has(p))
		if (undefinedPlaceholders.length > 0) {
			warnings.push(`Potentially undefined placeholders: ${undefinedPlaceholders.join(", ")}`)
		}

		// Check for unused components (in componentOrder but not in template)
		const unusedComponents = variant.componentOrder.filter((c) => !templatePlaceholders.includes(c))
		if (unusedComponents.length > 0) {
			warnings.push(`Components defined but not used in template: ${unusedComponents.join(", ")}`)
		}
	}

	private validateComponents(variant: PromptVariant, errors: string[], warnings: string[]): void {
		// Check for duplicate components
		const duplicates = this.findDuplicates([...variant.componentOrder])
		if (duplicates.length > 0) {
			errors.push(`Duplicate components in order: ${duplicates.join(", ")}`)
		}

		// Check component overrides reference valid components
		if (variant.componentOverrides) {
			const invalidOverrides = Object.keys(variant.componentOverrides).filter(
				(key) => !variant.componentOrder.includes(key as SystemPromptSection),
			)
			if (invalidOverrides.length > 0) {
				warnings.push(`Component overrides for unused components: ${invalidOverrides.join(", ")}`)
			}
		}
	}

	private validateTools(variant: PromptVariant, errors: string[], warnings: string[]): void {
		if (!variant.tools) {
			return
		}

		// Check for duplicate tools
		const duplicates = this.findDuplicates([...variant.tools])
		if (duplicates.length > 0) {
			errors.push(`Duplicate tools: ${duplicates.join(", ")}`)
		}

		// Check tool overrides reference valid tools
		if (variant.toolOverrides) {
			const invalidOverrides = Object.keys(variant.toolOverrides).filter((key) => !variant.tools?.includes(key as any))
			if (invalidOverrides.length > 0) {
				warnings.push(`Tool overrides for unused tools: ${invalidOverrides.join(", ")}`)
			}
		}
	}

	private validateBestPractices(variant: PromptVariant, warnings: string[]): void {
		// Check for recommended components
		const recommendedComponents = [SystemPromptSection.AGENT_ROLE, SystemPromptSection.RULES, SystemPromptSection.SYSTEM_INFO]

		const missingRecommended = recommendedComponents.filter((c) => !variant.componentOrder.includes(c))
		if (missingRecommended.length > 0) {
			warnings.push(`Missing recommended components: ${missingRecommended.join(", ")}`)
		}

		// Check for proper component ordering
		const agentRoleIndex = variant.componentOrder.indexOf(SystemPromptSection.AGENT_ROLE)
		const toolUseIndex = variant.componentOrder.indexOf(SystemPromptSection.TOOL_USE)

		if (agentRoleIndex > 0) {
			warnings.push("AGENT_ROLE should typically be the first component")
		}

		if (toolUseIndex >= 0 && agentRoleIndex >= 0 && toolUseIndex < agentRoleIndex) {
			warnings.push("TOOL_USE should typically come after AGENT_ROLE")
		}

		// Check for meaningful description
		if (variant.description.length < 20) {
			warnings.push("Description should be more descriptive (at least 20 characters)")
		}

		// Check for version labels
		if (Object.keys(variant.labels).length === 0) {
			warnings.push("Consider adding version labels (e.g., 'stable', 'production')")
		}
	}

	private findDuplicates<T>(array: T[]): T[] {
		const seen = new Set<T>()
		const duplicates = new Set<T>()

		for (const item of array) {
			if (seen.has(item)) {
				duplicates.add(item)
			}
			seen.add(item)
		}

		return Array.from(duplicates)
	}
}

/**
 * Convenience function to validate a variant
 */
export function validateVariant(variant: PromptVariant, options?: ValidationOptions): ValidationResult {
	const validator = new VariantValidator()
	return validator.validate(variant, options)
}

/**
 * Type guard to check if a variant is valid
 */
export function isValidVariant(variant: PromptVariant, options?: ValidationOptions): variant is PromptVariant {
	return validateVariant(variant, options).isValid
}
