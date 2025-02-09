/*
- class declarations
- function definitions
- method declarations
*/

// Query for finding imports
export const importQuery = `
[
  (namespace_use_declaration
    (namespace_use_clause
      name: (qualified_name) @module))

  (namespace_use_declaration
    (namespace_use_clause
      (namespace_aliasing_clause
        name: (name) @import)
      name: (qualified_name) @module))

  (namespace_use_declaration
    (namespace_use_clause
      name: (qualified_name) @module
      (#match? @module ".*\\\\.*")))
]
`

// Query for finding definitions
export default `
(method_declaration
  name: (name) @name.definition.method) @definition.method

(class_declaration
  name: (name) @name.definition.class) @definition.class

(interface_declaration
  name: (name) @name.definition.class) @definition.class

(namespace_definition
  name: (namespace_name) @name.definition.module) @definition.module
`
