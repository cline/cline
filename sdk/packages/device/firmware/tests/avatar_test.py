import copy
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("sprites", ROOT / "tools/sprites.py")
sprites = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sprites)

class AvatarAssets(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "avatars"
        shutil.copytree(sprites.CATALOG.parent, self.root)
        self.catalog = self.root / "manifest.json"
        self.data = json.loads(self.catalog.read_text())

    def tearDown(self):
        self.temp.cleanup()

    def save(self):
        self.catalog.write_text(json.dumps(self.data))

    def test_current_devices_and_browser_are_complete(self):
        data = sprites.validate_catalog(self.catalog)
        for board in ("waveshare-s3-epaper-154", "waveshare-s3-175c", "m5stack-cardputer-adv"):
            generated = sprites.compile_variant(self.catalog, data, board, "")
            self.assertIn('[MOOD_DONE] = {anim_done, 2}', generated)
            self.assertIn('CLINE_AVATAR_VARIANT "mono-v1"', generated)
        with self.assertRaisesRegex(ValueError, 'not a firmware'):
            sprites.compile_variant(self.catalog, data, "browser", "")

    def test_device_can_select_a_new_version_without_filename_conventions(self):
        variant = copy.deepcopy(self.data["avatars"]["cline"]["variants"]["mono-v1"])
        variant.update(version=2, width=2, height=2)
        (self.root / "tiny.txt").write_text('#.\n.#\n')
        variant["states"] = {state: ["tiny.txt"] for state in sprites.STATES}
        self.data["avatars"]["cline"]["variants"]["tiny-v2"] = variant
        self.data["devices"]["m5stack-cardputer-adv"]["variant"] = "tiny-v2"
        self.save()
        data = sprites.validate_catalog(self.catalog)
        generated = sprites.compile_variant(self.catalog, data, "m5stack-cardputer-adv", "")
        self.assertIn('CLINE_AVATAR_VERSION 2', generated)
        self.assertIn('{0x80, 0x40}', generated)
        self.assertIn('spr_idle_0 = {2, 2,', generated)

    def test_missing_state_dimensions_and_invalid_device_selection_fail(self):
        variant = self.data["avatars"]["cline"]["variants"]["mono-v1"]
        variant["states"].pop("offline")
        self.save()
        with self.assertRaisesRegex(ValueError, 'nine states'):
            sprites.validate_catalog(self.catalog)
        variant["states"]["offline"] = ["cline/mono-v1/offline_0.txt"]
        variant["width"] = 95
        self.save()
        with self.assertRaisesRegex(ValueError, 'dimensions'):
            sprites.validate_catalog(self.catalog)
        variant["width"] = 96
        self.data["devices"]["waveshare-s3-epaper-154"]["variant"] = "animated-v1"
        self.save()
        with self.assertRaisesRegex(ValueError, 'mono TXT/PNG'):
            sprites.validate_catalog(self.catalog)

    def test_path_escape_and_ragged_txt_are_rejected(self):
        (self.root.parent / "outside.txt").write_text('#.\n.#\n')
        with self.assertRaisesRegex(ValueError, 'out-of-root'):
            sprites.asset_path(self.root, "../outside.txt")
        (self.root / "bad.txt").write_text('##\n#\n')
        with self.assertRaisesRegex(ValueError, 'Malformed TXT'):
            sprites.dimensions(self.root / "bad.txt", "txt")

if __name__ == "__main__":
    unittest.main()
