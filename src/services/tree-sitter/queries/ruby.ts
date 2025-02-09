/*
- method definitions (including singleton methods and aliases, with associated comments)
- class definitions (including singleton classes, with associated comments)
- module definitions
*/

// Query for finding imports
export const importQuery = `
[
  (call
    method: (identifier) @import
    (#match? @import "^(require|require_relative|load)$")
    arguments: (argument_list
      (string) @module))

  (call
    method: (identifier) @import
    (#match? @import "^(include|extend)$")
    arguments: (argument_list
      (constant) @module))
]
`

// Query for finding definitions
export default `
(class
  name: (constant) @name.definition.class) @definition.class

(module
  name: (constant) @name.definition.module) @definition.module

(method
  name: (identifier) @name.definition.method) @definition.method

(singleton_method
  name: (identifier) @name.definition.method) @definition.method
`
