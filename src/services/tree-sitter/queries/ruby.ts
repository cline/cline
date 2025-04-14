/*
- method definitions (including singleton methods and aliases, with associated comments)
- class definitions (including singleton classes, with associated comments)
- module definitions
*/
export default `
(
  (comment)* @doc
  .
  [
    (method
      name: (_) @name.definition.method) @definition.method
    (singleton_method
      name: (_) @name.definition.method) @definition.method
  ]
  (#strip! @doc "^#\\s*")
  (#select-adjacent! @doc @definition.method)
)

(alias
  name: (_) @name.definition.method) @definition.method

(
  (comment)* @doc
  .
  [
    (class
      name: [
        (constant) @name.definition.class
        (scope_resolution
          name: (_) @name.definition.class)
      ]) @definition.class
    (singleton_class
      value: [
        (constant) @name.definition.class
        (scope_resolution
          name: (_) @name.definition.class)
      ]) @definition.class
  ]
  (#strip! @doc "^#\\s*")
  (#select-adjacent! @doc @definition.class)
)

(
  (module
    name: [
      (constant) @name.definition.module
      (scope_resolution
        name: (_) @name.definition.module)
    ]) @definition.module
)
`
