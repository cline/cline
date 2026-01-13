def fibonacci(n: int) -> list[int]:
    """Return a list containing the first n Fibonacci numbers."""
    if n <= 0:
        return []
    if n == 1:
        return [0]

    seq = [0, 1]
    for _ in range(2, n):
        seq.append(seq[-1] + seq[-2])
    return seq


def main():
    first_20 = fibonacci(20)
    for index, value in enumerate(first_20, start=1):
        print(f"{index}: {value}")


if __name__ == "__main__":
    main()
