export const solidityQuery = `
; Contract declarations
(contract_declaration
  name: (identifier) @name.definition.contract) @definition.contract

(interface_declaration
  name: (identifier) @name.definition.interface) @definition.interface

(library_declaration
  name: (identifier) @name.definition.library) @definition.library

; Function declarations
(function_definition
  name: (identifier) @name.definition.function) @definition.function

(modifier_definition
  name: (identifier) @name.definition.modifier) @definition.modifier

(constructor_definition) @definition.constructor

(fallback_receive_definition
  (visibility)
  (state_mutability)) @definition.fallback

; Type declarations
(struct_declaration
  name: (identifier) @name.definition.struct) @definition.struct

(enum_declaration
  name: (identifier) @name.definition.enum) @definition.enum

(event_definition
  name: (identifier) @name.definition.event) @definition.event

(error_declaration
  name: (identifier) @name.definition.error) @definition.error

; Variable declarations
(state_variable_declaration
  name: (identifier) @name.definition.variable) @definition.variable

; Using directives
(using_directive
  (type_alias) @name.definition.using) @definition.using`
