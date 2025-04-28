export default String.raw`
; Module, Protocol, and Implementation definitions
(call
  target: (identifier) @function
  (arguments) @args
  (do_block)?
  (#match? @function "^(defmodule|defprotocol|defimpl)$")) @definition.module

; Function definitions
(call
  target: (identifier) @function
  (arguments) @args
  (do_block)?
  (#eq? @function "def")) @definition.function

; Macro definitions
(call
  target: (identifier) @function
  (arguments) @args
  (do_block)?
  (#eq? @function "defmacro")) @definition.macro

; Struct definitions
(call
  target: (identifier) @function
  (arguments (list))
  (#eq? @function "defstruct")) @definition.struct

; Guard definitions
(call
  target: (identifier) @function
  (arguments) @args
  (#eq? @function "defguard")) @definition.guard

; Behaviour callback definitions
(call
  target: (identifier) @function
  (arguments) @args
  (#eq? @function "@callback")) @definition.behaviour

; Sigils
(sigil
  (sigil_name)
  (quoted_content)) @definition.sigil

; Module attributes
(unary_operator
  operator: "@"
  operand: (call)) @definition.attribute

; Test definitions with string name and map args
(call
  target: (identifier) @function
  (arguments
    (string)
    (map))
  (#eq? @function "test")) @definition.test

; Pipeline operator usage
(binary_operator
  operator: "|>"
  left: (_) @left
  right: (_) @right) @definition.pipeline

; For comprehensions with generator and filter clauses
(call
  target: (identifier) @function
  (arguments) @args
  (do_block)?
  (#eq? @function "for")) @definition.for_comprehension`
