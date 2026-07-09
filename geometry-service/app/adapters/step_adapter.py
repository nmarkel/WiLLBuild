"""STEP format adapter.

Exports the fused assembly solid as a STEP file, then post-processes the
header to label the file with the WiLL config identity and DISCLAIMER.

Header rewriting
----------------
The raw FILE_DESCRIPTION line produced by build123d looks like:

    FILE_DESCRIPTION(('Open CASCADE Model'),'2;1');

This adapter replaces that with:

    FILE_DESCRIPTION(('WiLL concept model config <configId> rev <rev>',
        '<DISCLAIMER>'),'2;1');

STEP strings use single-quoted (apostrophe) delimiters.  The DISCLAIMER
uses a plain ASCII hyphen so no escaping is needed.  configId values are
UUIDs — no apostrophes — so the substitution is safe without escaping.

Determinism
-----------
build123d's export_step embeds the current timestamp in FILE_NAME.  That
line is the *only* non-deterministic element; callers that need to compare
two exports for identity should strip lines starting with FILE_NAME before
comparing.
"""

from __future__ import annotations

import re
from pathlib import Path

from build123d import export_step

from app.naming import DISCLAIMER

from .base import Adapter, GenContext


class StepAdapter:
    """Adapter that produces a labeled, deterministic STEP file."""

    format: str = "step"

    def available(self) -> bool:
        """build123d is a hard dependency of the service; always True."""
        return True

    def generate(self, ctx: GenContext) -> list[Path]:
        """Export assembly solid to STEP, patch the header, return [path]."""
        if ctx.assembly is None:
            raise RuntimeError("StepAdapter requires a built assembly (ctx.assembly is None)")

        out_path = ctx.out_dir / f"{ctx.base_name}.step"

        # --- Export ---
        export_step(ctx.assembly.solid, out_path)

        # --- Post-process header ---
        _label_step_header(out_path, ctx.cfg.configId, ctx.cfg.rev)

        return [out_path]


# ---------------------------------------------------------------------------
# Header patching
# ---------------------------------------------------------------------------

# Pattern: FILE_DESCRIPTION((<any quoted strings>),'2;1');
# We capture just enough to safely replace the description tuple while
# keeping the implementation level ('2;1') unchanged.
_FD_PATTERN = re.compile(
    r"^FILE_DESCRIPTION\(.*?\),'2;1'\);",
    re.MULTILINE | re.DOTALL,
)


def _label_step_header(path: Path, config_id: str, rev: int) -> None:
    """Rewrite FILE_DESCRIPTION in ``path`` in-place to carry WiLL metadata.

    The DISCLAIMER contains only ASCII hyphens and alphanumerics — no
    apostrophes — so it embeds safely in a STEP single-quoted string.
    configId values are UUIDs (hex + hyphens) and also need no escaping.
    """
    text = path.read_text(encoding="ascii")

    label_line = (
        f"FILE_DESCRIPTION("
        f"('WiLL concept model config {config_id} rev {rev}',"
        f"'{DISCLAIMER}'),"
        f"'2;1');"
    )

    # FILE_DESCRIPTION line is guaranteed to be a single ASCII line.
    # Replace only the first occurrence (the STEP header always has exactly one).
    new_text = re.sub(
        r"^FILE_DESCRIPTION\(.*?\),'2;1'\);",
        label_line,
        text,
        count=1,
        flags=re.MULTILINE,
    )

    path.write_text(new_text, encoding="ascii")
