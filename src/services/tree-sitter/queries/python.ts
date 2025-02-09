/*
- class definitions
- function definitions
*/

// Query for finding imports
export const importQuery = `
[
  ; Regular imports
  (import_statement 
    name: (dotted_name 
      (identifier) @module))
  
  ; From imports with specific names
  (import_from_statement 
    module_name: (dotted_name 
      (identifier) @module)
    name: (identifier) @import)
  
  ; Wildcard imports
  (import_from_statement
    module_name: (dotted_name 
      (identifier) @module)
    name: (aliased_import
      name: (identifier) @import
      alias: (identifier)))
  
  ; Relative imports (with dots)
  (import_from_statement
    module_name: (relative_import
      (dotted_name 
        (identifier) @module)))
  
  ; Wildcard imports (*)
  (import_from_statement
    module_name: (dotted_name 
      (identifier) @module)
    name: "*" @import)
  
  ; Aliased imports
  (import_statement
    name: (dotted_name 
      (identifier) @module)
    alias: (identifier))
]
`

// Query for finding definitions
export default `
(class_definition
  name: (identifier) @name.definition.class) @definition.class

(function_definition
  name: (identifier) @name.definition.function) @definition.function
`
