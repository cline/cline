/*
- class declarations
- interface declarations
- method declarations
- namespace declarations
- using declarations
*/

// Query for finding imports
export const importQuery = `
[
  (using_directive
    name: (qualified_name) @module)

  (using_directive
    name: (identifier) @module)

  (using_directive
    alias: (identifier) @import
    name: (qualified_name) @module)
]
`

// Query for finding definitions
export default `
(method_declaration
  name: (identifier) @name.definition.method) @definition.method

(class_declaration
  name: (identifier) @name.definition.class) @definition.class

(interface_declaration
  name: (identifier) @name.definition.class) @definition.class

(namespace_declaration
  name: (qualified_name) @name.definition.module) @definition.module
`
