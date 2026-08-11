/**
 * Shared applier for docs/spec-option-corrections.json (Phase 0.12).
 *
 * `scripts/spec-parse/parse_specs.py` assigns ordering-table cells to columns by
 * PDF x-coordinate. On sheets with two-line headers that merges adjacent columns
 * — fatal for the part number, because one column can only ever emit ONE
 * segment. The corrections file names each merged column and the reviewed
 * columns it splits into; this module performs the substitution.
 *
 * Two callers start from different places and share one behaviour:
 *
 *   scripts/merge-spec-options.mjs         regenerates from the RAW parse
 *   scripts/apply-spec-option-corrections  patches the live public/catalog.json
 *
 * A rule is skipped when its corrected columns are already present verbatim, so
 * running either script twice is a no-op. A rule that is neither applied nor
 * able to find its `rawKey` throws: that means the parse changed underneath the
 * correction, and silently skipping would ship the merged column and quietly
 * corrupt a customer-facing SKU.
 */

/** Deep value equality via canonical JSON — column objects are plain JSON. */
const sameColumn = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * True when every one of a rule's corrected columns is already present, with
 * exactly the reviewed content. This — not the absence of `rawKey` — is what
 * "already applied" means, and it doubles as the drift check: a corrected
 * column edited by hand in the catalog no longer matches, so the rule re-fires
 * and restores the reviewed version.
 */
function isApplied(options, columns) {
  return columns.every((c) => {
    const existing = options.find((o) => o.key === c.key);
    return existing !== undefined && sameColumn(existing, c);
  });
}

/**
 * @param {Array} options  the part's ordering/options columns
 * @param {string} handle  willbrands.com product handle
 * @param {object} corrections  the `products` map from the corrections file
 * @returns {{options: Array, applied: number, skipped: number}}
 */
export function applyCorrections(options, handle, corrections) {
  const entry = corrections[handle];
  if (!entry) return { options, applied: 0, skipped: 0 };

  let out = options;
  let applied = 0;
  let skipped = 0;

  for (const rule of entry.replace || []) {
    // "Already applied" must be tested BEFORE looking for rawKey, because a
    // split legitimately re-emits a column under the raw key it replaces
    // (`lumen-output` -> `design` + `lumen-output`). Matching on rawKey alone
    // would make such a rule re-fire on every run and duplicate its siblings.
    if (isApplied(out, rule.columns)) {
      skipped++;
      continue;
    }
    const at = out.findIndex((o) => o.key === rule.rawKey);
    if (at < 0) {
      throw new Error(
        `spec-option correction for "${handle}" targets column "${rule.rawKey}", which is ` +
          `neither present in the input nor already applied. Re-check ` +
          `docs/spec-option-corrections.json against docs/spec-options.json.`,
      );
    }
    // structuredClone: one handle can match many parts (all 8 alum-pole-NN
    // heights share one sheet), and handing out the same objects would alias
    // one part's options into another's.
    out = [...out.slice(0, at), ...structuredClone(rule.columns), ...out.slice(at + 1)];
    applied += rule.columns.length;
  }
  return { options: out, applied, skipped };
}

/** Extract the product handle from a willbrands.com productUrl. */
export function handleFromUrl(url) {
  if (!url) return null;
  const m = url.match(/\/products\/([^/?#]+)/);
  return m ? m[1] : null;
}
