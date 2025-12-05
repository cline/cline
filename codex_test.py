"""
Simple Stack implementation with basic operations.
"""
from __future__ import annotations

from typing import Generic, List, TypeVar

T = TypeVar("T")


class Stack(Generic[T]):
    """
    A Last-In-First-Out (LIFO) stack.
    """

    def __init__(self) -> None:
        """
        Initialize an empty stack.
        """
        self._items: List[T] = []

    def push(self, item: T) -> None:
        """
        Push an item onto the top of the stack.
        """
        self._items.append(item)

    def pop(self) -> T:
        """
        Remove and return the top item from the stack.

        Raises:
            IndexError: If the stack is empty.
        """
        if self.is_empty():
            raise IndexError("pop from empty stack")
        return self._items.pop()

    def peek(self) -> T:
        """
        Return the top item without removing it.

        Raises:
            IndexError: If the stack is empty.
        """
        if self.is_empty():
            raise IndexError("peek from empty stack")
        return self._items[-1]

    def is_empty(self) -> bool:
        """
        Check whether the stack is empty.
        """
        return len(self._items) == 0


def demo_stack_operations() -> None:
    """
    Demonstrate Stack operations.
    """
    stack: Stack[int] = Stack()
    print("Initial stack empty?", stack.is_empty())

    print("Pushing values 1, 2, 3")
    for value in (1, 2, 3):
        stack.push(value)
        print(f"Pushed {value}, top now {stack.peek()}")

    print("Current top:", stack.peek())
    print("Stack empty?", stack.is_empty())

    print("Popping all values")
    while not stack.is_empty():
        popped = stack.pop()
        print(f"Popped {popped}, empty now? {stack.is_empty()}")

    try:
        stack.pop()
    except IndexError as exc:
        print("Caught expected error on pop:", exc)

    try:
        stack.peek()
    except IndexError as exc:
        print("Caught expected error on peek:", exc)


if __name__ == "__main__":
    demo_stack_operations()
