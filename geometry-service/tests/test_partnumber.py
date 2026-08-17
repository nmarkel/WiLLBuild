"""Phase 0.11, Workstream Z1 — the Python side of the part-number contract.

Half of a cross-language drift guard.  ``docs/part-number-cases.json`` holds
one shared set of (config -> expected number) cases; ``src/lib/partNumber.
contract.test.ts`` pins the TypeScript reference implementation against it and
this module pins the Python mirror against the same strings.  Change the rules
in one language and the other language's suite fails — which is precisely what
0.10.5 lost when it dropped ``app/partnumber.py`` and left the number existing
only in the browser.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.models import PoleConfig
from app.naming import config_hash
from app.partnumber import (
    build_part_number,
    finish_for,
    is_complete,
    part_number_text,
    resolve_assembly_part_numbers,
    spec_codes,
)

_REPO_ROOT = Path(__file__).parent.parent.parent
_CASES_PATH = _REPO_ROOT / "docs" / "part-number-cases.json"

SLOTS = ("fixture", "arm", "pole", "baseCover")


def _load_cases() -> list[dict]:
    with open(_CASES_PATH, "r", encoding="utf-8") as f:
        return json.load(f)["cases"]


CASES = _load_cases()


def _config(case: dict) -> PoleConfig:
    return PoleConfig(**case["config"])


class TestSharedContract:
    """Every case in the shared fixture must resolve identically here."""

    def test_fixture_file_is_populated(self):
        assert CASES, "docs/part-number-cases.json has no cases"
        for case in CASES:
            assert "expected" in case, (
                f"case {case['name']!r} has no expectation — regenerate with "
                "UPDATE_PN_CASES=1 npx vitest run src/lib/partNumber.contract.test.ts"
            )

    @pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
    def test_matches_typescript(self, catalog, case):
        cfg = _config(case)
        actual = {slot: build_part_number(catalog, cfg, slot) for slot in SLOTS}
        assert actual == case["expected"], (
            f"Python resolver drifted from src/lib/summary.ts for {case['name']!r}. "
            "One of the two implementations changed without the other."
        )


class TestModelFieldsSurvive:
    """The 0.10.5 gap was plumbing: pydantic silently dropped these fields."""

    def test_spec_options_round_trip(self):
        cfg = PoleConfig(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="sh1-shepherds-hook", fixture="gvx-pendant", finish="matte-black", rev=1,
            specOptions={"fixture": {"lumen-output": "80", "options": ["PM"]}},
        )
        assert cfg.specOptions["fixture"]["lumen-output"] == "80"
        assert cfg.specOptions["fixture"]["options"] == ["PM"]

    def test_per_slot_finishes_round_trip(self):
        cfg = PoleConfig(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="sh1-shepherds-hook", fixture="gvx-pendant", finish="matte-black", rev=1,
            finishes={"pole": "forest-green"}, finishRal={"pole": "#123456"},
        )
        assert cfg.finishes["pole"] == "forest-green"
        assert cfg.finishRal["pole"] == "#123456"

    def test_unknown_fields_are_still_ignored(self):
        """The HTTP contract is frozen — a newer client must not 422 us."""
        cfg = PoleConfig(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="sh1-shepherds-hook", fixture="gvx-pendant", finish="matte-black", rev=1,
            somethingFromTheFuture={"a": 1},
        )
        assert cfg.configId == "c"


class TestFinishFor:
    """Mirrors finishFor in src/lib/compat.ts (Workstream A)."""

    def _cfg(self, **kw) -> PoleConfig:
        base = dict(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="sh1-shepherds-hook", fixture="gvx-pendant", finish="matte-black", rev=1,
        )
        base.update(kw)
        return PoleConfig(**base)

    def test_falls_back_to_base_finish(self):
        assert finish_for(self._cfg(), "pole") == "matte-black"

    def test_slot_override_wins(self):
        cfg = self._cfg(finishes={"pole": "forest-green"})
        assert finish_for(cfg, "pole") == "forest-green"
        assert finish_for(cfg, "fixture") == "matte-black"

    def test_non_assembly_slot_uses_base(self):
        cfg = self._cfg(finishes={"pole": "forest-green"})
        assert finish_for(cfg, "banner") == "matte-black"


class TestSpecCodes:
    """Mirrors specCodes in src/lib/compat.ts."""

    @pytest.mark.parametrize(
        "value,expected",
        [
            (None, []),
            ("", []),
            ("BK", ["BK"]),
            ([], []),
            (["BK", "WH"], ["BK", "WH"]),
            (["BK", "", "WH"], ["BK", "WH"]),
        ],
    )
    def test_normalises(self, value, expected):
        assert spec_codes(value) == expected


class TestCompleteness:
    def test_unanswered_column_is_incomplete(self):
        assert is_complete("WD-GVX-_-_-MV-5W-BK") is False

    def test_fully_answered_is_complete(self):
        assert is_complete("WD-GVX-80-30-MV-5W-BK") is True

    def test_no_number_is_never_complete(self):
        assert is_complete(None) is False
        assert is_complete("") is False

    def test_underscore_inside_a_code_is_not_a_placeholder(self):
        """Only a whole segment of '_' marks an unanswered column."""
        assert is_complete("WD-A_B-BK") is True


class TestAssemblyResolution:
    def test_every_configured_slot_is_present(self, catalog):
        cfg = _config(CASES[0])
        numbers = resolve_assembly_part_numbers(catalog, cfg)
        assert set(numbers) == set(SLOTS)

    def test_empty_slot_is_omitted(self, catalog):
        cfg = PoleConfig(
            configId="c", pole="alum-pole-20", baseCover="", arm="sh1-shepherds-hook",
            fixture="gvx-pendant", finish="matte-black", rev=1,
        )
        assert "baseCover" not in resolve_assembly_part_numbers(catalog, cfg)

    def test_text_line_flags_a_missing_matrix(self, catalog):
        cfg = PoleConfig(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="direct-mount", fixture="gvx-pendant", finish="matte-black", rev=1,
        )
        assert part_number_text(catalog, cfg, "arm") == "Arm: part number pending matrix"

    def test_text_line_prints_the_number(self, catalog):
        cfg = _config(CASES[0])
        # Tyler 8/12: the arm number carries its finish colour.
        assert part_number_text(catalog, cfg, "arm") == "Arm: WP-SH1-_-BK"


class TestConfigHashCoupling:
    """Workstream Z2 — coupled to Z1.

    Restoring the part number without this makes the cache serve a PDF showing
    a DIFFERENT config's number.  These tests are the reason the two shipped
    together.
    """

    def _cfg(self, **kw) -> PoleConfig:
        base = dict(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="sh1-shepherds-hook", fixture="gvx-pendant", finish="matte-black", rev=1,
        )
        base.update(kw)
        return PoleConfig(**base)

    def test_spec_options_change_the_hash(self):
        a = self._cfg()
        b = self._cfg(specOptions={"fixture": {"lumen-output": "80"}})
        assert config_hash(a) != config_hash(b)

    def test_different_option_values_hash_apart(self):
        a = self._cfg(specOptions={"fixture": {"lumen-output": "80"}})
        b = self._cfg(specOptions={"fixture": {"lumen-output": "40"}})
        assert config_hash(a) != config_hash(b)

    def test_per_slot_finish_changes_the_hash(self):
        a = self._cfg()
        b = self._cfg(finishes={"pole": "forest-green"})
        assert config_hash(a) != config_hash(b)

    def test_accent_finish_changes_the_hash(self):
        """Phase 0.12: TEX orders in TWO finishes.

        Two configs differing only in the Spider Mount & Accent Line colour
        print different part numbers (…-NA-BK vs …-NA-WH), so they must hash
        apart — otherwise the cache serves the first one's PDF for the second,
        showing a SKU the customer did not configure.  Exactly the coupling that
        made 0.11's Z1 and Z2 inseparable.
        """
        a = self._cfg(finishes={"fixture": "silver"})
        b = self._cfg(
            finishes={"fixture": "silver"}, accentFinishes={"fixture": "matte-black"}
        )
        c = self._cfg(
            finishes={"fixture": "silver"}, accentFinishes={"fixture": "gloss-white"}
        )
        assert config_hash(a) != config_hash(b)
        assert config_hash(b) != config_hash(c)

    def test_empty_accent_finishes_do_not_change_the_hash(self):
        """Every pre-0.12 config keeps its historical hash byte-for-byte."""
        base = config_hash(self._cfg())
        assert config_hash(self._cfg(accentFinishes={})) == base
        assert config_hash(self._cfg(accentFinishes={"fixture": ""})) == base

    def test_multi_select_order_changes_the_hash(self):
        """Codes append to the part number in stored order, so order matters."""
        a = self._cfg(specOptions={"pole": {"accessories": ["BA24", "FH"]}})
        b = self._cfg(specOptions={"pole": {"accessories": ["FH", "BA24"]}})
        assert config_hash(a) != config_hash(b)
        assert build_part_number.__module__  # sanity: same module under test

    def test_empty_selections_do_not_change_the_hash(self):
        """Historical configs must keep their hash byte-for-byte."""
        base = config_hash(self._cfg())
        assert config_hash(self._cfg(specOptions={})) == base
        assert config_hash(self._cfg(specOptions={"fixture": {}})) == base
        assert config_hash(self._cfg(finishes={})) == base
        assert config_hash(self._cfg(finishes={"pole": ""})) == base

    def test_hash_is_stable_across_key_order(self):
        a = self._cfg(specOptions={"fixture": {"a": "1", "b": "2"}})
        b = self._cfg(specOptions={"fixture": {"b": "2", "a": "1"}})
        assert config_hash(a) == config_hash(b)

    def test_view_only_axes_do_not_fragment_the_cache(self):
        """armOrientation/accessoryPlacements reach no artifact yet."""
        base = config_hash(self._cfg())
        assert config_hash(self._cfg(armOrientation=90)) == base
        assert config_hash(
            self._cfg(accessoryPlacements={"BA24": {"heightFt": 12, "orientation": 90}})
        ) == base


class TestPerSlotFinishReachesTheNumber:
    """Workstream A's DoD: the finish must flow through the RESTORED resolver."""

    def test_each_slot_number_carries_its_own_finish_code(self, catalog):
        cfg = PoleConfig(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="sh1-shepherds-hook", fixture="gvx-pendant", finish="matte-black", rev=1,
            finishes={"fixture": "gloss-white", "pole": "forest-green",
                      "baseCover": "statuary-bronze"},
        )
        # Cord (derived) rides after the finish now — WH is interior.
        assert "-WH-" in build_part_number(catalog, cfg, "fixture")
        # The SH1 bracket derives PF mounting (CR-OPT-15) — DG is interior now.
        assert "-DG-" in build_part_number(catalog, cfg, "pole")
        # Fit sits in the sheet position (Tyler 8/14 final): WP-CL1-4R-DB.
        assert build_part_number(catalog, cfg, "baseCover").endswith("-DB")

    def test_anodized_colour_drives_the_finish_type_segment(self, catalog):
        painted = PoleConfig(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="sh1-shepherds-hook", fixture="gvx-pendant", finish="matte-black", rev=1,
        )
        anodized = painted.model_copy(update={"finishes": {"pole": "bronze-anodized"}})
        assert "-FP-" in build_part_number(catalog, painted, "pole")
        assert "-AN-" in build_part_number(catalog, anodized, "pole")


class TestCustomerDownloadGate:
    """Phase 0.11 (Workstream I) — the factory-cad allowlist must FAIL CLOSED.

    Phase 0.10 resolved the bundle's STEP attachment from "any part with real
    CAD", which would have shipped Engineering's full 88 MB master to a
    customer. That is why the whole attachment was dropped in 0.10.5. It is
    back now, but only through an explicit allowlist of de-featured shells.
    """

    def test_only_allowlisted_parts_are_downloadable(self):
        from app.realgeom import BASE_FILES, CUSTOMER_STEP_FILES

        # Every entry must be a real catalog part that also has real CAD...
        assert set(CUSTOMER_STEP_FILES) <= set(BASE_FILES)
        # ...and the allowlist must be a STRICT subset: having real CAD is not
        # the same as being cleared to ship it.
        assert set(CUSTOMER_STEP_FILES) != set(BASE_FILES)

    def test_the_allowlist_never_points_at_a_full_master(self):
        """A cleared shell must be a DIFFERENT file from the viewer's master."""
        from app.realgeom import BASE_FILES, CUSTOMER_STEP_FILES

        for part_id, shell in CUSTOMER_STEP_FILES.items():
            assert shell != BASE_FILES[part_id], (
                f"{part_id}: the customer download points at the same file as the "
                "viewer master — that is the full engineering model, not a shell."
            )

    def test_a_part_with_real_cad_but_no_shell_is_not_downloadable(self, tmp_path):
        """The gate stays shut for everything Cole has not de-featured yet."""
        from app.realgeom import customer_step_path

        # drx-post-top has real CAD (DRX-Post-Top.STEP) but no cleared shell.
        assert customer_step_path("drx-post-top") is None
        assert customer_step_path("mvx-coach") is None
        assert customer_step_path("not-a-part") is None

    def test_disable_real_geometry_closes_the_gate(self, monkeypatch):
        from app.realgeom import customer_step_path

        monkeypatch.setenv("DISABLE_REAL_GEOMETRY", "1")
        assert customer_step_path("gvx-pendant") is None

    def test_an_incomplete_part_number_never_names_a_file(self, catalog):
        """`WD-GVX-_-_-…-BK.step` would label a file with a SKU that doesn't exist."""
        from app.adapters.bundle_adapter import _factory_cad_entries
        from app.adapters.base import GenContext

        cfg = PoleConfig(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="sh1-shepherds-hook", fixture="gvx-pendant", finish="matte-black", rev=1,
        )
        assert not is_complete(build_part_number(catalog, cfg, "fixture"))
        ctx = GenContext(catalog=catalog, cfg=cfg, out_dir=Path("."), base_name="x",
                         assembly=None, render_png=None, summary={})
        assert _factory_cad_entries(ctx) == []

    def test_a_complete_number_attaches_the_shell_when_present(self, catalog):
        from app.adapters.bundle_adapter import _factory_cad_entries
        from app.adapters.base import GenContext
        from app.realgeom import customer_step_path

        cfg = PoleConfig(
            configId="c", pole="alum-pole-20", baseCover="bc-cl1-small-clamshell",
            arm="sh1-shepherds-hook", fixture="gvx-pendant", finish="matte-black", rev=1,
            specOptions={"fixture": {"lumen-output": "80", "color-temp": "30",
                                     "voltage": "MV", "distribution": "5W"}},
        )
        number = build_part_number(catalog, cfg, "fixture")
        assert is_complete(number), number
        ctx = GenContext(catalog=catalog, cfg=cfg, out_dir=Path("."), base_name="x",
                         assembly=None, render_png=None, summary={})
        entries = _factory_cad_entries(ctx)
        if customer_step_path("gvx-pendant") is None:
            # No real CAD on this machine (every deploy) — must add nothing.
            assert entries == []
        else:
            assert [name for name, _ in entries] == [f"factory-cad/{number}.step"]
            # ...and nothing from a non-allowlisted component sneaks in.
            assert len(entries) == 1
