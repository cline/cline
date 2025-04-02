# Command Auto-Approve Feature

The Command Auto-Approve feature allows you to specify commands that should be automatically approved without prompting. This is useful for repetitive commands that you frequently use and trust.

## Configuration

Configure command auto-approval rules in your VS Code settings. You can define rules in your `settings.json` file:

```json
"cline.commandAutoApproveRules": [
  {
    "pattern": "npm install",
    "action": "auto-approve"
  },
  {
    "pattern": "/^git (status|pull|push)/",
    "action": "auto-approve"
  },
  {
    "pattern": "rm -rf node_modules",
    "action": "require-approval"
  }
]
```

## How It Works

1. Each rule consists of a `pattern` and an `action`
2. When Cline asks to execute a command, it checks against these rules
3. If a rule matches, the specified action is taken
4. If multiple rules match, the last matching rule wins
5. If no rules match, the global auto-approval setting for commands is used

## Pattern Types

You can use two types of patterns:

### String Pattern

A simple string pattern will match if it's contained anywhere in the command:

```json
{
  "pattern": "npm start",
  "action": "auto-approve"
}
```

This will match any command containing "npm start", such as "npm start", "npm start --port=3000", etc.

### Regex Pattern

For more complex matching, use regex patterns by enclosing them in forward slashes:

```json
{
  "pattern": "/^npm (start|run dev)( --.*)?$/",
  "action": "auto-approve"
}
```

This will match commands that start with "npm start" or "npm run dev", optionally followed by arguments.

You can also use regex flags after the closing slash:

```json
{
  "pattern": "/docker/i",
  "action": "require-approval"
}
```

This will match any command containing "docker" (case-insensitive) and explicitly require approval.

## Actions

Two possible actions can be specified:

- `auto-approve`: Automatically approve the command without prompting
- `require-approval`: Always require manual approval for the command

## Best Practices

1. Start with a conservative set of rules and add more as you become comfortable
2. Use `require-approval` for potentially destructive commands
3. Use regex patterns for precise control
4. Place more specific patterns after more general ones
5. Test your rules to ensure they match as expected

## Command Execution Flow

1. Cline detects a command to run
2. Auto-approval for commands is checked:
   - If disabled, prompt for approval
   - If enabled, continue to rule checking
3. Rules are checked from top to bottom:
   - If a matching rule is found with `auto-approve`, execute without prompting
   - If a matching rule is found with `require-approval`, prompt for approval
4. If no matching rules are found, defer to the global "Auto-approve commands" setting

This feature works in conjunction with the global "Auto-approve commands" setting, allowing for more fine-grained control over which commands require approval.
