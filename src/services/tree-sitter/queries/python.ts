/*
- class definitions
- function definitions
*/

// Query for finding imports
export const importQuery = `
[
  (import_statement
    name: (dotted_name) @module)

  (import_from_statement
    module_name: (dotted_name) @module
    names: (import_from_clause 
      (identifier) @import))

  (import_from_statement
    module_name: (dotted_name) @module
    names: (import_from_clause
      (aliased_import
        name: (identifier) @import)))

  (import_from_statement
    module_name: (dotted_name) @module
    names: (wildcards) @import)
]
`

// Query for finding definitions
export default `
(class_definition
  name: (identifier) @name.definition.class) @definition.class

(function_definition
  name: (identifier) @name.definition.function) @definition.function
`
