"""Ingest the real WiLLstudio STEP files into render-rig GLBs (offline).

Phase 0.10 ingest.  Source: Engineering's STEP-Website drop
(Synology Drive: ``~/Library/CloudStorage/SynologyDrive-NickSynology206/Engineering/
Marketing-Engineering/STEP-Website/WiLLstudio`` — note this is the CloudStorage
mount, NOT ``~/SynologyDrive/...``, which exists but reads empty),
copied into ``scripts/render-rig/real-assets/step/`` — gitignored, like every
real-CAD input since the 0.6 spike.  The *outputs* that ship are the ~4 KB WebP
layers the render rig bakes from these GLBs; the GLBs themselves stay offline
(see docs/superpowers/plans/real-geometry-rig-results.md).

The filenames ARE ordering codes (``SS3-40F.STEP`` = Side Shepherds Hook, 3 arms,
4" flush pole fit), so this module is also the provenance record that maps real
geometry to catalog parts and part numbers — see ``INGEST`` below and
``docs/real-geometry.json``.

Run with the geometry-service venv python (has OCP + numpy):

    cd scripts/step-to-glb
    ../../geometry-service/.venv/bin/python ingest.py              # everything affordable
    ../../geometry-service/.venv/bin/python ingest.py SS1-40F.STEP # one file
    ../../geometry-service/.venv/bin/python ingest.py --fixtures   # the slow ones

Cost note (measured 2026-08-04): OCCT parses the small/medium parts in <0.5 s but
the 22-87 MB fixture masters take ~8 MINUTES each.  That is why fixtures are a
separate opt-in batch here, and why the geometry-service never parses a raw STEP
at request time (it reads a pre-baked BREP — see app/realgeom.py).
"""
from __future__ import annotations

import json
import os
import sys
import time

from convert import convert_color_aware, convert_monolithic

STEP_DIR = os.path.join(os.path.dirname(__file__), "..", "render-rig", "real-assets", "step")
GLB_DIR = os.path.join(os.path.dirname(__file__), "..", "render-rig", "real-assets", "glb")
_CATALOG_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "public", "catalog.json")
with open(_CATALOG_PATH, encoding="utf-8") as fh:
    _CATALOG = json.load(fh)

# ---------------------------------------------------------------------------
# The mapping: real STEP file -> catalog part + ordering codes.
#
# `origin` follows the catalog convention "origin at the part's lower attachment
# point": 'base' floors Y and centres X/Z, 'top' ceilings Y, 'mount' trusts the
# CAD's native X/Z (pole-axis) and only floors Y, 'mount-center' trusts X/Z and
# centres Y (a mid-shaft accessory whose origin is its vertical centre).
# `mode` picks the converter: 'color' keeps STEP-authored colours on non-paintable
# solids and leaves only `will-body` for the finish; 'mono' is one uniform body.
# `slow` marks the masters whose OCCT parse takes minutes.
# ---------------------------------------------------------------------------
INGEST: list[dict] = [
    # --- pole ---
    dict(file="RSAA-4040-12.STEP", part="alum-pole-12", design="RSAA-4040-12", fit="40",
         origin="base", mode="mono", tol=0.5, cropBelowM=0.08,
         note="Phase 0.17 (Tyler 8/19): the tube is CROPPED below y=0.08 m — "
              "the shaft physically ends at its anchor base, and the "
              "CLE-lifted clamshell exposes anything rendered below it. 0.08 "
              "keeps the cut hidden inside the standard base's collar (top at "
              "0.0897). Applied AFTER the derived poles' axial scale, so the "
              "cut height never stretches with pole length."),
    # --- arms (single-arm files are the per-azimuth render source; the 2/3/4-arm
    #     files are whole clusters, used for the CAD downloads, not the layers) ---
    dict(file="FR2-40F.STEP", part="willstudio-fr2-decorative-crossarm", design="FR2",
         fit="40F", origin="mount", mode="mono", tol=0.5,
         note="MAPPED in Phase 0.12 (Workstream A1) — the first of the six C1 arms "
              "to clear alignment, and the only one that needed no socket change. "
              "Measured from the GLB's own vertices: after rotateY=-90 the mesh "
              "spans X[-0.611,+0.610], and its reaching tip sits at "
              "x=0.610, y=0.305..0.318 — against a catalog socket authored at "
              "[0.62, 0.30, 0]. That is within ~1 cm, so the placeholder-era "
              "socket was already right and only the axis was wrong. The other "
              "five DO need re-derived sockets (and PM1 a rotateY of +90, not "
              "-90 — its real reach reverses); they stay unmapped."),
    dict(file="SH1-40F.STEP", part="sh1-shepherds-hook", design="SH1", fit="40F",
         origin="mount", mode="mono", tol=0.5),
    dict(file="SS1-40F.STEP", part="willstudio-side-shepherds-hook-pole-top-brackets",
         design="SS1", fit="40F", origin="mount", mode="mono", tol=0.5),
    dict(file="AR1-40F.STEP", part="willstudio-suspension-arm-pole-top-brackets",
         design="AR1", fit="40F", origin="mount", mode="mono", tol=0.5),
    # --- Phase 0.13 (Nick) recorded in 0.14: the four remaining C1 arms cleared
    #     axis + socket alignment and were mapped in real-parts.json (PM1 with
    #     the reversed rotateY +90 the 8/11 audit predicted), but 0.13 left
    #     their entries in UNMAPPED and never regenerated the provenance record
    #     — which is exactly what kept generate.test.mjs red. These entries
    #     complete the record to match the shipped mapping. ---
    dict(file="PA1-40F.STEP", part="pa1-pendant-arm", design="PA1", fit="40F",
         origin="mount", mode="mono", tol=0.5),
    dict(file="PM1-40F.STEP", part="pm1-pendant-arm", design="PM1", fit="40F",
         origin="mount", mode="mono", tol=0.5),
    dict(file="HS1-40F.STEP", part="willstudio-hsx-decorative-upsweep-arms",
         design="HS1", fit="40F", origin="mount", mode="mono", tol=0.5),
    dict(file="SD1-40F.STEP", part="willstudio-supported-decorative-arms",
         design="SD1", fit="40F", origin="mount", mode="mono", tol=0.5),
    # --- Phase 0.14 (Tyler 8/14): placed shaft accessories get render layers.
    #     These are order-code adders, not slot parts — but the instanced
    #     accessoryPlacements system gives each checked instance a height +
    #     orientation, so a layer at that placement now renders the TRUTH of
    #     the configuration rather than a guess. Each maps to a render-only
    #     catalog part (slot "accessory", never selectable — the banner-part
    #     pattern), added by scripts/merge-accessory-parts.mjs and placed by
    #     the compositor from accessoryPlacements via the option value's
    #     renderPartId (docs/spec-option-corrections.json). ---
    dict(file="HH-4R.STEP", part="willstudio-acc-hand-hole", design="HHX", fit="4R",
         origin="mount-center", mode="mono", tol=0.5, featureOnlyRadiusM=0.0508,
         note="Additional Hand Hole, 4in round — a 6in pole SECTION centred on "
              "the pole axis (measured x/z exactly +/-0.0508 = 4.00in OD), hole "
              "frame reaching +X natively, so no rotateY. Origin at the "
              "section's vertical centre: the placement height reads to the "
              "hole centreline. WiLLstudio poles are all diameterIn 4, so 4R is "
              "the one render source; HH-5R/6R stay unmapped below."),
    dict(file="FH-4R.STEP", part="willstudio-acc-flag-holder", design="FH", fit="4R",
         origin="native", mode="mono", tol=0.5,
         note="Single Flag Holder Kit, staff included (measured 2.183 m tall, "
              "1.448 m reach along +Z -> rotateY -90 in real-parts.json). "
              "origin='native': the CAD's y=0 is the shaft bracket itself — the "
              "reference the placement height drives — with the staff running "
              "-0.868..+1.315 around it, so bbox re-basing would move the "
              "origin off the bracket."),
    dict(file="PH-4R.STEP", part="willstudio-acc-plant-holder", design="PH", fit="4R",
         origin="native", mode="mono", tol=0.5,
         note="Single Plant Holder Kit (measured 0.811 m reach along +X — no "
              "rotateY — basket hanging to y=-0.553 below the bracket at the "
              "native y=0; origin='native' for the same reason as FH-4R)."),
    # --- Phase 0.17 (Tyler 8/19): Cole's 8/17 base + extender exports. ---
    dict(file="4-RND-STANDARD-BASE.STEP", part="willstudio-pole-base-standard",
         design="SB", fit="4R", origin="base", mode="mono", tol=0.5, rotateX=-90,
         note="Standard 4in round pole anchor base — Tyler 8/19: THE standard "
              "pole base detail, replacing the 0.14 placeholder plate. Modeled "
              "Z-UP (verified: the 8.61in square flange at -Z, the pole-collar "
              "ring at +Z), so rotateX -90 stands it up; origin='base' floors Y "
              "with the flange on the foundation. A render-only catalog part "
              "(slot 'accessory', never selectable) whose GLB poleGraftPlan "
              "(generate.mjs) grafts onto every pole at the origin. 3.53in "
              "tall cast base, matches Tyler's 8/14 plan drawing (8.63in)."),
    dict(file="CLE.STEP", part="willstudio-acc-clamshell-extender", design="CLE",
         fit=None, origin="mount", mode="mono", tol=0.5,
         note="Clamshell Base Extender — Tyler 8/19: 'goes on the bottom of "
              "the base to extend the bottom of it.' Native Y-up: a 25.0in "
              "skirt tapering to 16.1in over 8.42in of height. The clamshells' "
              "17.0in bottom rim meets the taper at y=0.195 m (measured), so "
              "that is the compositor's cover lift (stackHeightM on the "
              "catalog part). Draws when the CLE option is checked on CL1/2/3; "
              "renderPartId on the CLE value wires it."),
    dict(file="CPL-P-12.STEP", part="willstudio-acc-coupling", design="CPL-P-12",
         fit=None, origin="mount-center", mode="mono", tol=0.5,
         note="Threaded Coupling, painted — like HH-4R a 6in pole SECTION on "
              "the pole axis with the coupling boss reaching +X natively "
              "(25 mm proud of the 4in OD), no rotateY. Origin at the vertical "
              "centre so the placement height reads to the boss centreline. "
              "Tyler confirmed 8/14 this file IS the coupling's visual "
              "representation in the tool; thread details (NPT vs NPSM, "
              "diameter) still resolve at quote/order entry per Tyler 8/13."),
    # --- base covers: CL1/CL2/CL3 are SIZES (Small/Medium/Large Clamshell) and
    #     SC1/SC2 are the 1-piece / split Spun Base Collar, per the Aluminum
    #     Round Straight Decorative pole spec sheet (8/4).  This corrects 0.10's
    #     pre-sheet guess of CL1→round / CL2→aluminum / CL3→fluted. ---
    dict(file="CL1-4R.STEP", part="bc-cl1-small-clamshell", design="CL1", fit="4R",
         origin="base", mode="mono", tol=0.5),
    dict(file="CL2-4R.STEP", part="bc-cl2-medium-clamshell", design="CL2", fit="4R",
         origin="base", mode="mono", tol=0.5),
    dict(file="CL3-4R.STEP", part="bc-cl3-large-clamshell", design="CL3", fit="4R",
         origin="base", mode="mono", tol=0.5),
    dict(file="SC1-4R.STEP", part="bc-sc1-spun-collar", design="SC1", fit="4R",
         origin="base", mode="mono", tol=0.5),
    dict(file="SC2-4R.STEP", part="bc-sc2-spun-collar-split", design="SC2", fit="4R",
         origin="base", mode="mono", tol=0.5),
    # --- banner arm (mid-shaft: origin is the banner's vertical centre) ---
    dict(file="BA24-4R.STEP", part="willstudio-ba1-banner-arm", design="BA24", fit="4R",
         origin="mount-center", mode="mono", tol=0.75),
    # --- fixtures: masters with full internal detail; minutes to parse ---
    # Phase 0.16.5 (Tyler's 8/19 punch list, Nick's call): the export's internal
    # light-engine stack hangs visibly under the shade, and the top stem is a
    # sleeve the ARM slides over in reality — neither should render. Measured
    # rules in the part's final frame: the under-junk is the skinny center
    # stack (r<0.08 m topping out below y=-0.30 — the lens r=0.203, gray ring
    # r=0.194 and bezel r=0.24 all stay); the stem stack is r<0.035 reaching
    # above y=-0.09 (the dome/ball, r 0.058-0.074, stays). Dropping art never
    # moves the frame: the normalization offset comes from the FULL solid set.
    dict(file="WD-GVX-PM", part="gvx-pendant", design="GVX", fit="PM",
         origin="top", mode="color", tol=1.0, slow=True,
         drop=[dict(r_below=0.08, top_below=-0.30),
               dict(r_below=0.035, top_above=-0.09)]),
    dict(file="DRX-Post-Top.STEP", part="drx-post-top", design="DRX", fit="3T",
         origin="base", mode="color", tol=1.5, slow=True),
    dict(file="TEX.STEP", part="tex-post-top", design="TEX", fit="3T",
         origin="base", mode="color", tol=1.5, slow=True),
    dict(file="MXV.STEP", part="mvx-coach", design="MVX", fit="3T",
         origin="base", mode="color", tol=1.5, slow=True),
    # --- standalone products (single hero render, no assembly) ---
    # The bollard + flood masters are modelled Z-UP (verified from their raw bboxes),
    # unlike every other file here, so they are stood up before re-basing.
    dict(file="RXB.STEP", part="willstudio-rxb-sxb-bollard", design="RXB", fit="C",
         origin="base", mode="color", tol=1.5, slow=True, rotateX=90),
    dict(file="DWX.STEP", part="willstudio-dwx-flood-spot", design="DWX", fit="C",
         origin="base", mode="color", tol=1.5, slow=True, rotateX=-90),
]

# Cluster/variant files that carry real CAD for a *configured design code* but are
# not a per-part render source (the rig renders one arm and repeats it radially).
CLUSTERS: list[dict] = [
    dict(file="SS2-40F.STEP", part="willstudio-side-shepherds-hook-pole-top-brackets",
         design="SS2", fit="40F", armCount=2),
    dict(file="SS3-40F.STEP", part="willstudio-side-shepherds-hook-pole-top-brackets",
         design="SS3", fit="40F", armCount=3),
    dict(file="SS4-40F.STEP", part="willstudio-side-shepherds-hook-pole-top-brackets",
         design="SS4", fit="40F", armCount=4),
    dict(file="AR2-40F.STEP", part="willstudio-suspension-arm-pole-top-brackets",
         design="AR2", fit="40F", armCount=2),
    dict(file="AR3-40F.STEP", part="willstudio-suspension-arm-pole-top-brackets",
         design="AR3", fit="40F", armCount=3),
    dict(file="AR4-40F.STEP", part="willstudio-suspension-arm-pole-top-brackets",
         design="AR4", fit="40F", armCount=4),
    dict(file="DRX-Area-4R-Side-Mount.STEP", part="drx-post-top", design="DRX",
         fit="SMR", note="Area/side-mount variant of the DRX (mounting code SMR)."),
    dict(file="SXB.STEP", part="willstudio-rxb-sxb-bollard", design="SXB", fit="C",
         note="Second bollard variant sharing the RXB/SXB catalog entry."),
    # --- Phase 0.11 (Workstream I) ---
    dict(file="SD2-40F.STEP", part="willstudio-supported-decorative-arms", design="SD2",
         fit="40F", armCount=2),
    dict(file="BA30-4R.STEP", part="willstudio-ba1-banner-arm", design="BA30", fit="4R",
         note="30in banner-arm kit — the BA30 order code's own CAD. The rig renders "
              "the banner layer from BA24; this is the second size variant."),
    # --- Phase 0.13: Cole's 8/11-8/12 exports.  Both are CAD for a CONFIGURED
    #     CODE on a part that already renders from its own master, so neither is
    #     a second render source.  Registering them here is the whole job: it
    #     puts the order code next to its released file. ---
    dict(file="TEX-AREA.STEP", part="tex-post-top", design="TEX", fit="SMR",
         note="Area/side-mount variant of the TEX — the exact counterpart of "
              "DRX-Area-4R-Side-Mount.STEP above, and classified the same way. The "
              "catalog part is named 'TEX Post Top & Area' and its mounting column "
              "already offers 3T/SMS/SMR, so this file serves the SMS and SMR codes "
              "of a part that renders from TEX.STEP. It is NOT a render source: the "
              "compositor keys layers by part id, so a second mounting of one part "
              "has nowhere to render to. Measured 2026-08-13: 208 solids, 431.80 x "
              "203.20 x 591.22 mm, with z running -375.32..+215.90 — the extra 375 mm "
              "in -Z is the side-mount arm, so the file is fixture PLUS bracket, not "
              "a bare head. That is also why it could not be dropped in as a "
              "tex-post-top layer even if the asset model allowed it."),
    dict(file="GVX-HSS.STEP", part="gvx-pendant", design="HSS-GVX", fit="PM",
         note="The GVX assembled WITH its House Side Shield fitted (88 MB, the same "
              "order as the WD-GVX-PM master it is built from). HSS-GVX is an "
              "ACCESSORY code in gvx-pendant's `accessories` column, and an "
              "accessory-driven variant has nowhere to render to today for the same "
              "part-id-keyed reason as TEX-AREA. Keyed by the accessory code rather "
              "than a design code so it cannot collide with the master. Measured "
              "2026-08-13: 214 solids, 479.37 x 516.62 x 479.37 mm — the master plus "
              "the 1-solid shield (HSS-GVX.STEP, in UNMAPPED below)."),
]

# Files with no catalog PART mapping — recorded, never guessed.
# (0.14: FH/PH/HH-4R/CPL-P-12 moved UP into INGEST — the instanced-placement
# system made an accessory layer the truth of the configuration, so "adders
# get no layer" no longer holds for placeable accessories with real CAD.)
UNMAPPED: list[dict] = [
    # --- Phase 0.17: Cole's 8/17 batch, second file. ---
    dict(file="4-RND-STANDARD-CUSTOM-BASE.STEP", part=None, design=None, fit="4R",
         note="Custom-base variant (10.00in square x 3.50in, native Y-up — a "
              "simpler plate than the standard casting). Recorded, not used: "
              "Tyler named 4-RND-STANDARD-BASE.STEP as the pole base detail "
              "(8/19); this likely pairs with a custom-base order path that "
              "has no catalog code yet."),
    # --- Phase 0.13: Cole's 8/12 accessory exports. ---
    dict(file="HSS-GVX.STEP", part=None, design="HSS-GVX", fit=None,
         note="House Side Shield for the GVX, as its own component (0.29 MB; the "
              "fitted assembly is GVX-HSS.STEP in CLUSTERS). Measured 405 x 127 x "
              "220 mm, one solid, and asymmetric in Z (-202.6..+17.0) — it wraps one "
              "side, which is what a house-side shield is. An `accessories` order "
              "code on gvx-pendant, not a slot part, so it gets no render layer."),
    # HH-*R are the hand hole itself, NOT a cover plate: each is a 6in-tall
    # section of round pole at its named OD (4R = 4.00in, 5R = 4.98in, 6R =
    # 6.00in, all 152.40 mm tall) — the opening plus its frame.  0.14 mapped
    # HH-4R (the WiLLstudio fit — `diameterIn: 4` on all 8 poles) as the
    # ADDITIONAL-hand-hole render layer; 5R/6R wait for a 5/6in pole line.
    #
    # ⚠️ Separate, still-open decision: the pole's OWN hand hole is a grafted
    # placeholder box Tyler thinned twice on 8/11 (20 -> 12 -> 8 mm). Swapping
    # that graft for HH-4R geometry re-renders all 8 poles, and the graft
    # doubles as the rig's visible 0-degree homing reference, so a recessed
    # real hole must be checked to still read at 360 px/m first.
    dict(file="HH-5R.STEP", part=None, design="HHX", fit="5R",
         note="Additional Hand Hole, 5in round — no 5in pole in the catalog."),
    dict(file="HH-6R.STEP", part=None, design="HHX", fit="6R",
         note="Additional Hand Hole, 6in round — no 6in pole in the catalog."),
    # --- Phase 0.11 (Workstream I): CONVERTED BUT NOT MAPPED — pending socket
    #     alignment. These five DO have an unambiguous catalog part (each file's
    #     code is that part's own `modelCodes` entry) and each converts cleanly
    #     to a GLB, but they are deliberately NOT wired into the render rig yet,
    #     because doing so renders them MISALIGNED — visibly worse than the
    #     placeholder they replace, and invisible to the coverage gate (the
    #     renders exist; they are merely in the wrong place).
    #
    #     Two independent mismatches, measured 2026-08-10:
    #       1. AXIS. Every one of these reaches along Z (bbox z = 0.45-1.44 m)
    #          with x pinned at ~0.102 m — that is the 4in pole clamp. Every
    #          catalog placeholder reaches along +X. So each needs a `rotateY`
    #          in real-parts.json, the way sh1-shepherds-hook (-90) and
    #          willstudio-ba1-banner-arm (+90) already do.
    #       2. SOCKET. Rotation alone is not enough: the real reaches disagree
    #          with the catalog fixture sockets, which were authored against the
    #          placeholder solids. PA1 reaches 0.995 m against a socket at
    #          x=0.68; HS1 reaches 1.437 m against a socket at x=0.50. (FR2 is
    #          a crossarm and its 1.221 m is symmetric ±0.61 against x=0.62 —
    #          that one is close.) Each part's fixture socket has to be
    #          re-derived from the real CAD's own attachment point, which is
    #          exactly what the 0.10 ingest did when it "corrected two arm
    #          sockets" from the released files.
    #
    #     Verified in the browser before reverting: with these mapped, the PA1
    #     arm floats clear of both the pole top and its pendant, and the SD1
    #     arm's fixture hangs far off its tip.
    #
    #     The STEP files, the GLBs and this record are all in place, so the next
    #     pass starts from measurement, not from re-ingest.
    # (0.14: PA1/PM1/HS1/SD1 moved UP into INGEST — 0.13 cleared their axis +
    # socket alignment and mapped them in real-parts.json; the block comment
    # above survives as the record of WHY they were held back through 0.12.)
    # --- Phase 0.11 (Workstream I): the rest of Cole's 8/6 batch. Each of these
    #     has real CAD but NO defensible catalog part, so each is recorded with
    #     the reason rather than mapped. Mapping any of them would put invented
    #     geometry under a real product name. ---
    dict(file="CR2-40F.STEP", part=None, design="CR2", fit="40F",
         note="Renamed at the source: this was 'CR1-40F.STEP', which Nick "
              "confirmed on 2026-08-10 was mislabelled — the geometry is a CR2. "
              "Someone applied the correction on Synology, so the file is now "
              "CR2-40F.STEP and this record follows it (Phase 0.12, A3). Before "
              "that it was the only Synology file referenced nowhere in the repo, "
              "because the name recorded here no longer existed. Intended part "
              "willstudio-cr2-decorative-crossarm (modelCodes {1: CR2}). Still "
              "blocked on the same axis + socket alignment as the five below."),
    dict(file="BR12-40F.STEP", part=None, design="BR12", fit="40F",
         note="Upsweep, no gusset. docs/part-numbers.md maps the curated 'Decorative "
              "Upsweep' (catalog id `upsweep`) to the BR family with BR12/BR13 as the "
              "24in/36in reaches, but that mapping is explicitly UNCONFIRMED pending "
              "Cole, and `upsweep` carries no modelCodes to check it against."),
    dict(file="BR13-40F.STEP", part=None, design="BR13", fit="40F",
         note="See BR12-40F — same unconfirmed upsweep family, the other reach."),
    dict(file="BR22-40F.STEP", part=None, design="BR22", fit="40F",
         note="See BR12-40F — two-arm sibling of the unconfirmed upsweep family."),
    dict(file="BR23-40F.STEP", part=None, design="BR23", fit="40F",
         note="See BR12-40F — two-arm sibling of the unconfirmed upsweep family."),
    dict(file="CF1.STEP", part=None, design="CF1", fit=None,
         note="Centre Shepherds Hook Decorative Feature. Phase 0.11 Workstream C makes "
              "CF1/CF2/CF3 single-select order codes on SH1 — an option adder, not a "
              "slot part, so no render layer of its own."),
    dict(file="CF2.STEP", part=None, design="CF2", fit=None,
         note="Centre Shepherds Hook Brand/Logo/City Round Feature. See CF1."),
    dict(file="CF3.STEP", part=None, design="CF3", fit=None,
         note="Centre Shepherds Hook Brand/Logo Feature. See CF1."),
    dict(file="CPL-P-12.STEP", part=None, design="CPL-P-12", fit=None,
         note="Coupling, 12in painted. A placeable pole Accessory adder "
              "(accessoryPlacements), not a slot part."),
    dict(file="PC1.STEP", part=None, design="PC1", fit=None,
         note="Pendant Ceiling Mount. On the ordering sheet but has NO catalog part "
              "yet (docs/part-numbers.md, 'Open confirmations')."),
    dict(file="PC2.STEP", part=None, design="PC2", fit=None, note="See PC1."),
    dict(file="PC3.STEP", part=None, design="PC3", fit=None, note="See PC1."),
    dict(file="WM1.STEP", part=None, design="WM1", fit=None,
         note="Wall Mount. On the ordering sheet but has NO catalog part yet "
              "(docs/part-numbers.md, 'Open confirmations')."),
    dict(file="WM2.STEP", part=None, design="WM2", fit=None, note="See WM1."),
    dict(file="GVX-Simple.STEP", part=None, design="GVX", fit="PM",
         note="⚠️ NEEDS A HUMAN CALL. A 27 MB GVX against the 88 MB WD-GVX-PM master "
              "already ingested — the name and the size are consistent with Cole's "
              "de-featured shell, which is the thing the customer STEP download is "
              "GATED on. Deliberately NOT wired into anything: gvx-pendant already "
              "renders from the full master, and treating this as the approved "
              "stripped shell without confirmation is exactly the assumption the gate "
              "exists to prevent. If Cole confirms it, it un-gates factory-cad for GVX."),
]

# Poles derived by axial scaling from the one real pole export (Phase 0.10.5,
# spec D10).  A decorative pole is a straight extrusion, so scaling
# RSAA-4040-12 along its axis carries the real profile and wall thickness to
# the other catalog heights — this is a derivation, not a guess, and it is
# recorded as kind="derived" so it is never mistaken for a native export from
# Engineering.
#
# RSAA-4040-12.STEP itself has NO hand hole (verified: 6 faces, 1 solid, a
# plain hollow tube — no cutout anywhere along the shaft).  The hand hole is a
# fixed-size access door at a fixed height, not a feature of the extrusion, so
# it must never be scaled with pole height; a later render-rig task grafts the
# placeholder's hand-hole geometry onto the real tube at native size, after
# this scale is applied.
_DERIVED_POLE_SOURCE = "alum-pole-12"
_DERIVED_POLE_SOURCE_FT = 12.0


def derive_scaled_poles(catalog: dict) -> list[dict]:
    """One DERIVED entry per alum-pole-* height other than the real 12 ft."""
    out: list[dict] = []
    for part in catalog["parts"]:
        part_id = part["id"]
        if not part_id.startswith("alum-pole-") or part_id == _DERIVED_POLE_SOURCE:
            continue
        height_ft = part["heightFt"]
        out.append(
            dict(
                part=part_id,
                kind="derived",
                source=_DERIVED_POLE_SOURCE,
                scaleY=height_ft / _DERIVED_POLE_SOURCE_FT,
                note=(
                    f"Axially scaled from RSAA-4040-12.STEP "
                    f"({_DERIVED_POLE_SOURCE_FT:g} ft -> {height_ft:g} ft): carries the "
                    "real profile and wall thickness. This STEP export has no hand hole "
                    "(verified: 6 faces, a plain hollow tube) -- the hand-hole cover is "
                    "grafted separately by the render rig at native size and fixed "
                    "height, not scaled with pole height."
                ),
            )
        )
    return sorted(out, key=lambda e: e["part"])


DERIVED: list[dict] = derive_scaled_poles(_CATALOG)


def convert_one(entry: dict) -> dict:
    step_path = os.path.join(STEP_DIR, entry["file"])
    out_path = os.path.join(GLB_DIR, f"{entry['part']}.glb")
    os.makedirs(GLB_DIR, exist_ok=True)
    t0 = time.time()
    rot = dict(rotate_x=entry.get("rotateX", 0.0), rotate_z=entry.get("rotateZ", 0.0))
    if entry["mode"] == "color":
        stats = convert_color_aware(step_path, out_path, origin=entry["origin"],
                                    tol_mm=entry["tol"],
                                    drop_solids=entry.get("drop"), **rot)
    else:
        stats = convert_monolithic(step_path, out_path, origin=entry["origin"],
                                   tol_mm=entry["tol"],
                                   crop_below_m=entry.get("cropBelowM"),
                                   feature_only_radius_m=entry.get("featureOnlyRadiusM"),
                                   **rot)
    stats["seconds"] = round(time.time() - t0, 1)
    stats["glb_bytes"] = os.path.getsize(out_path)
    stats["glb"] = os.path.relpath(out_path, os.path.join(os.path.dirname(__file__), "..", "render-rig"))
    return stats


def _source_entry(derived_entry: dict) -> dict:
    """Look up the INGEST entry a DERIVED entry's `source` part came from."""
    for entry in INGEST:
        if entry["part"] == derived_entry["source"]:
            return entry
    raise KeyError(f"no INGEST entry for source part {derived_entry['source']!r}")


def convert_derived(entry: dict) -> dict:
    """Convert a DERIVED pole: re-run the source STEP with an axial scale."""
    src = _source_entry(entry)
    if src["mode"] != "mono":
        # Only the monolithic path takes scale_y today; no derived entry needs
        # color-aware conversion (poles are one uniform aluminum body).
        raise ValueError(
            f"derived source {src['file']} uses mode={src['mode']!r}; "
            "convert_derived only supports mode='mono'"
        )
    step_path = os.path.join(STEP_DIR, src["file"])
    out_path = os.path.join(GLB_DIR, f"{entry['part']}.glb")
    os.makedirs(GLB_DIR, exist_ok=True)
    t0 = time.time()
    stats = convert_monolithic(step_path, out_path, origin=src["origin"],
                               tol_mm=src["tol"], scale_y=entry["scaleY"],
                               crop_below_m=src.get("cropBelowM"))
    stats["seconds"] = round(time.time() - t0, 1)
    stats["glb_bytes"] = os.path.getsize(out_path)
    stats["glb"] = os.path.relpath(out_path, os.path.join(os.path.dirname(__file__), "..", "render-rig"))
    return stats


def _sha256(path: str) -> str:
    import hashlib

    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


MANIFEST_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "docs", "real-geometry.json")


def write_manifest() -> str:
    """Write docs/real-geometry.json — the tracked provenance record.

    The STEP/GLB binaries are gitignored, so this file IS the repo's memory of what
    real CAD exists, where it came from, which catalog part and part-number code it
    maps to, and what is still unmapped.  Sizes/hashes are read from the local
    ingest directory; entries whose file is absent are still listed (with
    ``present: false``) so the record survives a machine without the drive.
    """
    def describe(entry: dict, kind: str) -> dict:
        step_path = os.path.join(STEP_DIR, entry["file"])
        present = os.path.isfile(step_path)
        glb_path = os.path.join(GLB_DIR, f"{entry.get('part', '')}.glb")
        out = {
            "file": entry["file"],
            "kind": kind,
            "present": present,
            "bytes": os.path.getsize(step_path) if present else None,
            "sha256": _sha256(step_path) if present else None,
            "partId": entry.get("part"),
            "designCode": entry.get("design"),
            "fitCode": entry.get("fit"),
        }
        if "armCount" in entry:
            out["armCount"] = entry["armCount"]
        if kind == "component":
            out["origin"] = entry.get("origin")
            out["converter"] = entry.get("mode")
            out["tolMm"] = entry.get("tol")
            if entry.get("rotateX"):
                out["rotateXDeg"] = entry["rotateX"]
            out["glb"] = (
                os.path.relpath(glb_path, os.path.join(os.path.dirname(__file__), ".."))
                if os.path.isfile(glb_path)
                else None
            )
            out["glbBytes"] = os.path.getsize(glb_path) if os.path.isfile(glb_path) else None
        if entry.get("note"):
            out["note"] = entry["note"]
        return out

    def describe_derived(entry: dict) -> dict:
        """DERIVED entries have no `file` of their own — they reuse the source
        part's STEP, scaled axially — so this is a separate, smaller shape than
        ``describe()`` above."""
        src = _source_entry(entry)
        glb_path = os.path.join(GLB_DIR, f"{entry['part']}.glb")
        return {
            "kind": entry["kind"],
            "partId": entry["part"],
            "source": entry["source"],
            "sourceFile": src["file"],
            "scaleY": entry["scaleY"],
            "note": entry["note"],
            "glb": (
                os.path.relpath(glb_path, os.path.join(os.path.dirname(__file__), ".."))
                if os.path.isfile(glb_path)
                else None
            ),
            "glbBytes": os.path.getsize(glb_path) if os.path.isfile(glb_path) else None,
        }

    manifest = {
        # Phase 0.11: the live Synology Drive path. The old /Volumes/WiLLdrive mount
        # no longer exists, and ~/SynologyDrive/NickSynology206 resolves but reads
        # EMPTY — the real content is under ~/Library/CloudStorage.
        "source": (
            "~/Library/CloudStorage/SynologyDrive-NickSynology206/Engineering/"
            "Marketing-Engineering/STEP-Website/WiLLstudio"
        ),
        "ingestedBy": "scripts/step-to-glb/ingest.py",
        "localStepDir": "scripts/render-rig/real-assets/step (gitignored)",
        "localGlbDir": "scripts/render-rig/real-assets/glb (gitignored)",
        "note": (
            "Filenames are WiLL ordering codes. 'component' files are the render-rig + "
            "geometry-service geometry source for one part; 'cluster' files are whole "
            "multi-arm assemblies shipped as-is in the download bundle; 'unmapped' files "
            "have no confirmed catalog part yet and are never guessed at; 'derived' parts "
            "have no STEP export of their own — they are the source part's geometry, "
            "scaled axially to a different catalog height, and are never native."
        ),
        "components": [describe(e, "component") for e in INGEST],
        "clusters": [describe(e, "cluster") for e in CLUSTERS],
        "unmapped": [describe(e, "unmapped") for e in UNMAPPED],
        "derived": [describe_derived(e) for e in DERIVED],
    }
    path = os.path.abspath(MANIFEST_PATH)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, indent=2)
        fh.write("\n")
    return path


def main(argv: list[str]) -> int:
    only = [a for a in argv if not a.startswith("--")]
    include_slow = "--fixtures" in argv or "--all" in argv
    fast_only = not include_slow and not only

    if "--manifest" in argv:
        print(f"wrote {write_manifest()}")
        return 0

    if "--derived" in argv:
        # DERIVED entries are keyed by `part`, not `file` (they have no STEP of
        # their own — see convert_derived), so this is a separate filter loop
        # rather than reusing the INGEST loop's `entry["file"] not in only` check.
        results = {}
        for entry in DERIVED:
            if only and entry["part"] not in only:
                continue
            print(
                f"deriving {entry['part']} <- {entry['source']} "
                f"(scaleY={entry['scaleY']:.4f}) ...",
                flush=True,
            )
            try:
                stats = convert_derived(entry)
            except Exception as exc:  # noqa: BLE001 — one bad entry must not stop the batch
                print(f"  FAILED: {exc}", flush=True)
                results[entry["part"]] = {"error": str(exc)}
                continue
            print(
                f"  {stats['glb_bytes'] / 1e6:.1f} MB, {stats.get('triangles', 0)} tris, "
                f"{stats['seconds']}s",
                flush=True,
            )
            results[entry["part"]] = stats
        print(json.dumps(results, indent=2))
        return 0

    results = {}
    for entry in INGEST:
        if only and entry["file"] not in only:
            continue
        if fast_only and entry.get("slow"):
            print(f"skip (slow master, pass --fixtures): {entry['file']}")
            continue
        print(f"converting {entry['file']} -> {entry['part']}.glb ...", flush=True)
        try:
            stats = convert_one(entry)
        except Exception as exc:  # noqa: BLE001 — one bad file must not stop the batch
            print(f"  FAILED: {exc}", flush=True)
            results[entry["part"]] = {"error": str(exc)}
            continue
        print(
            f"  {stats['glb_bytes'] / 1e6:.1f} MB, {stats.get('triangles', 0)} tris, "
            f"{stats['seconds']}s",
            flush=True,
        )
        results[entry["part"]] = stats

    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
