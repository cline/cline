#!/bin/bash
# Fix all remaining verbose checks to use helper functions

# Replace patterns like:
# if Config.Verbose && Config.OutputFormat != "json" {
#     fmt.Printf("message %s\n", arg)
# }
# With: verboseLogf("message %s", arg)

# This is complex to do with sed, so just document what needs manual fixing
grep -n 'if Config.Verbose && Config.OutputFormat != "json"' cline-clients.go
