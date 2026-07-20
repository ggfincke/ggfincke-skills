# tests/test_eslint_registry.py
# eslint plugin registry: rule modules, index.js imports & keys, & documented names stay in sync

from __future__ import annotations

import re
import unittest

import support

RULES_DIR = support.REPO_ROOT / "skills" / "comment-style" / "assets" / "eslint-rules"
TYPESCRIPT_REF = support.REPO_ROOT / "skills" / "comment-style" / "references" / "typescript.md"

# index.js is the registry itself; rule-context.js is the shared helper
NON_RULE_STEMS = {"index", "rule-context"}

# a registry entry is a quoted rule name bound to a bare imported identifier
REGISTRY_ENTRY_RE = re.compile(r'^\s*"([\w-]+)":\s*([A-Za-z_$][\w$]*)\s*,?\s*$', re.MULTILINE)
IMPORT_RE = re.compile(
    r"""^import\s+([A-Za-z_$][\w$]*)\s+from\s+["']\./([\w-]+)\.js["'];""", re.MULTILINE
)
DOCUMENTED_RULE_RE = re.compile(r"ggfincke/([\w-]+)")


def index_source() -> str:
    return (RULES_DIR / "index.js").read_text(encoding="utf-8")


def rule_module_names() -> set[str]:
    return {path.stem for path in RULES_DIR.glob("*.js") if path.stem not in NON_RULE_STEMS}


# rule name -> identifier it is bound to in the exported rules map
def registry_entries() -> dict[str, str]:
    return dict(REGISTRY_ENTRY_RE.findall(index_source()))


# module stem -> identifier that stem is imported as
def import_bindings() -> dict[str, str]:
    return {stem: identifier for identifier, stem in IMPORT_RE.findall(index_source())}


def registry_names() -> set[str]:
    return set(registry_entries())


class EslintRuleRegistry(unittest.TestCase):
    def test_every_rule_module_is_registered(self) -> None:
        modules = rule_module_names()
        # guard against a path typo passing vacuously on two empty sets
        self.assertTrue(modules, "found no rule modules")
        # a rule file index.js never exports silently never runs in any consumer
        self.assertEqual(modules, registry_names())

    def test_documented_rule_names_match_registry(self) -> None:
        documented = set(DOCUMENTED_RULE_RE.findall(TYPESCRIPT_REF.read_text(encoding="utf-8")))
        self.assertEqual(documented, registry_names())

    def test_registry_keys_are_bound_to_their_own_module_import(self) -> None:
        entries = registry_entries()
        bindings = import_bindings()
        # guard against a regex drift passing vacuously on two empty dicts
        self.assertTrue(entries, "found no registry entries")
        self.assertTrue(bindings, "found no rule imports")
        # each key must be bound to the identifier imported from ./<key>.js.
        # name-only checks miss the worst drift: a dropped import leaves the key
        # intact & throws ReferenceError at plugin load in every consuming repo,
        # and a key bound to the wrong identifier silently runs the wrong rule
        self.assertEqual(entries, {name: bindings.get(name) for name in entries})
