export const ocamlQuery = `
; Captures module definitions
(module_definition
  (module_binding
    name: (module_name) @name.definition)) @definition.module

; Captures type definitions
(type_definition
  (type_binding
    name: (type_constructor) @name.definition)) @definition.type

; Captures function definitions
(value_definition
  (let_binding
    pattern: (value_name) @name.definition
    (parameter))) @definition.function

; Captures class definitions
(class_definition
  (class_binding
    name: (class_name) @name.definition)) @definition.class

; Captures method definitions
(method_definition
  name: (method_name) @name.definition) @definition.method

; Captures value bindings
(value_definition
  (let_binding
    pattern: (value_name) @name.definition)) @definition.value
`
