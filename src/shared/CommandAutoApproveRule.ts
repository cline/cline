/**
 * Represents a rule for command auto-approval
 */
export interface CommandAutoApproveRule {
  /**
   * The pattern to match against commands
   */
  pattern: string

  /**
   * The action to take when the pattern matches
   */
  action: 'auto-approve' | 'require-approval'
}

/**
 * Auto-approval actions
 */
export type CommandAutoApproveAction = 'auto-approve' | 'require-approval'

/**
 * Utility function to determine if a command should be auto-approved based on rules
 */
export function shouldAutoApproveCommand(command: string, rules: CommandAutoApproveRule[]): boolean {
  if (!rules || rules.length === 0) {
    return false
  }

  // Check rules in reverse order (last matching rule wins)
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i]
    
    // Check if rule matches the command
    if (matchesRule(command, rule.pattern)) {
      return rule.action === 'auto-approve'
    }
  }

  // Default: require approval
  return false
}

/**
 * Check if a command matches a rule pattern
 * Supports simple string contains matching and regex patterns
 */
function matchesRule(command: string, pattern: string): boolean {
  // Check if pattern is a regex
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    try {
      // Extract regex and flags
      const lastSlashIndex = pattern.lastIndexOf('/')
      const regexPattern = pattern.substring(1, lastSlashIndex)
      const flags = pattern.substring(lastSlashIndex + 1)
      
      const regex = new RegExp(regexPattern, flags)
      return regex.test(command)
    } catch (error) {
      console.error('Invalid regex pattern:', error)
      return false
    }
  }
  
  // Default to simple contains matching
  return command.includes(pattern)
}
