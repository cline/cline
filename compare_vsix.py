import zipfile
import hashlib
import os

base = r"C:\Users\bob43\Downloads\Bcline"
file_a = os.path.join(base, "claude-dev-3.49.0.vsix")
file_b = os.path.join(base, "bcline-3.50.0.vsix")


def zip_map(path: str) -> dict[str, str]:
    with zipfile.ZipFile(path, "r") as z:
        mapping: dict[str, str] = {}
        for info in z.infolist():
            if info.is_dir():
                continue
            data = z.read(info.filename)
            mapping[info.filename] = hashlib.sha256(data).hexdigest()
        return mapping


map_a = zip_map(file_a)
map_b = zip_map(file_b)
set_a = set(map_a)
set_b = set(map_b)

only_a = sorted(set_a - set_b)
only_b = sorted(set_b - set_a)
changed = sorted(name for name in (set_a & set_b) if map_a[name] != map_b[name])

print("ONLY_IN_3_49:")
for name in only_a:
    print(name)

print("\nONLY_IN_3_50:")
for name in only_b:
    print(name)

print("\nCHANGED_IN_BOTH:")
for name in changed:
    print(name)
