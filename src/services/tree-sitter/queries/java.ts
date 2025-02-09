/*
- class declarations
- method declarations
- interface declarations
*/

// Query for finding imports
export const importQuery = `
[
  (import_declaration
    name: (scoped_identifier) @module)

  (import_declaration
    name: (scoped_identifier
      name: (identifier) @import))

  (static_import_declaration
    name: (scoped_identifier) @module)
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
`
