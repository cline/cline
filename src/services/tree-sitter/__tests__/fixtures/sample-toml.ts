export const sampleToml = `# This is a TOML document with various structures

# Simple table
[database]
server = "192.168.1.1"
ports = [ 8001, 8001, 8002 ]
connection_max = 5000
enabled = true

# Table with inline table
[servers]
alpha = { ip = "10.0.0.1", role = "frontend" }
beta = { ip = "10.0.0.2", role = "backend" }

# Nested tables
[owner.personal]
name = "Tom Preston-Werner"
dob = 1979-05-27T07:32:00-08:00

# Array of tables
[[products]]
name = "Hammer"
sku = 738594937
color = "red"

[[products]]  # Array of tables
name = "Nail"
sku = 284758393
color = "gray"

# Complex types
[complex_values]
strings = [
    "basic string",
    '''
    multi-line
    basic string
    ''',
    'literal string',
    """
    multi-line
    literal string
    """
]
numbers = [ 42, -17, 3.14, 1e10 ]
dates = [
    1979-05-27T07:32:00-08:00,
    1979-05-27,
    07:32:00
]

# Dotted keys
"dotted.key.example" = "value"
physical.color = "orange"
physical.shape = "round"

# Mixed content table
[mixed_content]
title = "Mixed Content Example"
description = """
A table containing various TOML
data types and structures for
testing purposes
"""
features = [
    "tables",
    "arrays",
    "strings",
    "numbers"
]
metadata = { created = 2024-01-01, updated = 2024-04-13 }
`
