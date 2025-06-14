/**
 * Utility functions for managing command blacklisting
 */

const BLACKLIST_KEY = 'CLINE_BLACKLISTED_COMMANDS';

/**
 * Get the list of blacklisted commands from localStorage
 * @returns Array of blacklisted commands
 */
export function getBlacklistedCommands(): string[] {
  try {
    const blacklist = localStorage.getItem(BLACKLIST_KEY);
    return blacklist ? JSON.parse(blacklist) : [];
  } catch (error) {
    console.error('Error retrieving blacklisted commands:', error);
    return [];
  }
}

/**
 * Check if a command is blacklisted
 * @param command The command to check
 * @returns True if the command is blacklisted, false otherwise
 */
export function isCommandBlacklisted(command: string): boolean {
  const blacklist = getBlacklistedCommands();
  return blacklist.some(blacklistedCmd => {
    // Exact match
    if (blacklistedCmd === command) return true;
    
    // Command starts with blacklisted command plus space or semicolon
    if (command.startsWith(`${blacklistedCmd} `) || command.startsWith(`${blacklistedCmd};`)) return true;
    
    return false;
  });
}