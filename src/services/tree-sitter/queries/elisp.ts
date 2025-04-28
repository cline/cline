// Query patterns for Emacs Lisp
export const elispQuery = `
; Function definitions - capture only name and actual function node
((function_definition
  name: (symbol) @name.definition.function) @_func
  (#match? @name.definition.function "^[^;]"))

; Macro definitions - capture only name and actual macro node
((macro_definition
  name: (symbol) @name.definition.macro) @_macro
  (#match? @name.definition.macro "^[^;]"))

; Custom forms - match defcustom specifically and avoid comments
((list
  . (symbol) @_def
  . (symbol) @name.definition.custom) @_custom
  (#eq? @_def "defcustom")
  (#match? @name.definition.custom "^[^;]"))

; Face definitions - match defface specifically and avoid comments
((list
  . (symbol) @_def
  . (symbol) @name.definition.face) @_face
  (#eq? @_def "defface")
  (#match? @name.definition.face "^[^;]"))

; Group definitions - match defgroup specifically and avoid comments
((list
  . (symbol) @_def
  . (symbol) @name.definition.group) @_group
  (#eq? @_def "defgroup")
  (#match? @name.definition.group "^[^;]"))

; Advice definitions - match defadvice specifically and avoid comments
((list
  . (symbol) @_def
  . (symbol) @name.definition.advice) @_advice
  (#eq? @_def "defadvice")
  (#match? @name.definition.advice "^[^;]"))
`
