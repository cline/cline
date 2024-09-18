/*
Mention regex
- File and folder paths (starting with '/')
- URLs (containing '://')
- The 'problems' keyword
- Word boundary after 'problems' to avoid partial matches
*/
export const mentionRegex = /@((?:\/|\w+:\/\/)[^\s]+|problems\b)/
export const mentionRegexGlobal = new RegExp(mentionRegex.source, "g")
