/*
Supported SystemRDL structures:
- component declarations
- field declarations
- property assignments
- parameter declarations
- enum declarations
*/
export default `
; Component declarations
(component_named_def
  type: (component_type)
  id: (id) @name.definition.component) @definition.component

; Field declarations
(component_anon_def
  type: (component_type (component_primary_type))
  body: (component_body
    (component_body_elem
      (property_assignment)))) @definition.field

; Property declarations
(property_definition
  (id) @name.definition.property) @definition.property

; Parameter declarations
(component_inst
  id: (id) @name.definition.parameter) @definition.parameter

; Enum declarations
(enum_def
  (id) @name.definition.enum) @definition.enum
`
