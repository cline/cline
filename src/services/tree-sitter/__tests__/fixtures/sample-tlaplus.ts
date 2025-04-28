export default String.raw`
---- MODULE SimpleModule ----
EXTENDS Naturals, Sequences

CONSTANT N
VARIABLE x, y, z

\* Simple operator definition
Max(a, b) ==
    IF a > b THEN a
    ELSE b

\* Multi-line operator
ComplexOperator(seq) ==
    LET sum == 
        CHOOSE s \in Nat :
            \E i \in 1..Len(seq) :
                s = Sum(SubSeq(seq, 1, i))
    IN  sum

\* Function definition
SimpleFunction[a \in 1..N] ==
    LET square == a * a
    IN  square + 1

\* Procedure-style definition
ProcessStep ==
    /\ x' = Max(x, y)
    /\ y' = Min(x, y)
    /\ z' = x + y

\* Variable declaration with complex init
vars == <<x, y, z>>

\* Complex operator with multiple cases
HandleCase(val) ==
    CASE val = 1 -> "one"
      [] val = 2 -> "two"
      [] val = 3 -> "three"
      [] OTHER -> "unknown"

\* Recursive operator definition
Factorial[n \in Nat] ==
    IF n = 0 
    THEN 1
    ELSE n * Factorial[n-1]

====
`
