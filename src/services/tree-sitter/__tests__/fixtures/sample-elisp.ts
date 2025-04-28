export default `
;; Function definition with docstring and args
(defun test-function
    (arg1 arg2 &optional arg3)
  "Docstring explaining function purpose
and providing usage examples."
  (let ((result (+ arg1 arg2)))
    (when arg3
      (setq result (+ result arg3)))
    result))

;; Macro definition with pattern matching
(defmacro test-macro
    (pattern &rest body)
  "Docstring explaining macro purpose
and transformation rules."
  \`(cond
     ((null ,pattern) nil)
     ((atom ,pattern) ,@body)
     (t (cons (car ,pattern)
              (cdr ,pattern)))))

;; Variable definition
(defvar test-variable 42
  "A test variable with documentation.")

;; Constant definition
(defconst test-constant 3.14159
  "Mathematical constant pi.")

;; Custom form definition
(defcustom test-custom 'default
  "A customizable variable."
  :type 'symbol
  :group 'test-group)

;; Face definition
(defface test-face
  '((t :foreground "red" :weight bold))
  "Face used for testing purposes."
  :group 'test-faces)

;; Advice definition
(defadvice test-advice (around test-advice-function)
  "Advice docstring explaining modification."
  (let ((old-value (do-something)))
    ad-do-it
    (unless (equal old-value (do-something))
      (message "Value changed"))))

;; Group definition
(defgroup test-group nil
  "Test customization group."
  :group 'tools
  :prefix "test-")
`
