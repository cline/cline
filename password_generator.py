import random
import string
from typing import Sequence

DEFAULT_LENGTH = 12


def generate_password(length: int = DEFAULT_LENGTH) -> str:
    """
    Generate a random password with uppercase, lowercase, numbers,
    and special characters.
    """
    if length < 4:
        raise ValueError("Password length must be at least 4 to include all character types.")

    categories: Sequence[str] = (
        string.ascii_lowercase,
        string.ascii_uppercase,
        string.digits,
        string.punctuation,
    )

    # Ensure at least one character from each category
    password_chars = [random.choice(category) for category in categories]

    # Fill the remaining length with random choices from all categories combined
    all_chars = "".join(categories)
    password_chars.extend(random.choice(all_chars) for _ in range(length - len(password_chars)))

    random.shuffle(password_chars)
    return "".join(password_chars)


def main() -> None:
    try:
        password = generate_password()
        print(password)
    except ValueError as exc:
        print(f"Error: {exc}")


if __name__ == "__main__":
    main()
