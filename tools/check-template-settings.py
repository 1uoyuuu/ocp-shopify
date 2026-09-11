#!/usr/bin/env python3
"""Validate template JSON setting values against the schemas they name.

    python3 tools/check-template-settings.py [templates/product.coffee.json ...]

Shopify validates every setting value in `templates/*.json` against its
type in the section or block schema, and **one bad value invalidates the
whole file**. It is then refused exactly the way a malformed
`{% schema %}` is: the push is clean, every other file lands, and the
template simply never appears on the store. Nothing surfaces in git, and
`shopify theme check` does not look at template setting values at all.

ERRORS are the ones proven to sink a file here:

  range off the step grid   `gap: 10` where the range is step 4. Legal
                            JSON, a legal number, inside min and max, and
                            fatal. This is what refused product.coffee.
  block_order inconsistent  naming a block that is not in `blocks`, or
                            listing a static one.

NOTES are suspicious but demonstrably survivable — the stock templates on
this store trip them and sync fine, so do not chase them unless a file is
already being refused and the errors are clean:

  richtext without a tag    `templates/product.json` holds a bare
                            `{{ closest.product.description }}` in a
                            richtext setting and is live.
  select off the options    `style_class: "link"` in 404 and cart, same.

Run it before pushing any hand-built or generated template.
"""
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parent.parent
ROOT_TAGS = ("p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "blockquote", "div")


def load_schema(kind, name):
    path = REPO / kind / f"{name}.liquid"
    if not path.exists():
        return None
    m = re.search(r"{%\s*schema\s*%}(.*?){%\s*endschema\s*%}", path.read_text(encoding="utf-8"), re.S)
    return json.loads(m.group(1)) if m else None


def settings_index(schema):
    return {s["id"]: s for s in (schema or {}).get("settings", []) if s.get("id")}


def check_values(where, values, index, problems, notes):
    for key, value in (values or {}).items():
        spec = index.get(key)
        if not spec:
            continue  # unknown keys are dropped by Shopify, not fatal
        if spec["type"] == "range" and isinstance(value, (int, float)):
            lo, hi, step = spec["min"], spec["max"], spec["step"]
            if not (lo <= value <= hi):
                problems.append(f"{where}.{key} = {value} outside {lo}–{hi}")
            elif round((value - lo) / step, 6) % 1 != 0:
                grid = [lo + i * step for i in range(int((hi - lo) / step) + 1)]
                near = min(grid, key=lambda g: abs(g - value))
                problems.append(
                    f"{where}.{key} = {value} is off the step grid "
                    f"(min {lo}, step {step}) — nearest legal value {near}")
        if spec["type"] == "richtext" and isinstance(value, str) and value.strip():
            stripped = value.strip()
            if not any(stripped.startswith(f"<{t}") for t in ROOT_TAGS):
                notes.append(
                    f"{where}.{key} is a richtext value not wrapped in a block-level tag: "
                    f"{stripped[:60]!r}")
        if spec["type"] == "select" and isinstance(value, str):
            allowed = [o["value"] for o in spec.get("options", [])]
            if allowed and value not in allowed:
                notes.append(f"{where}.{key} = {value!r} not in {allowed}")


def walk_blocks(where, blocks, problems, notes):
    for bid, block in (blocks or {}).items():
        schema = load_schema("blocks", block.get("type", ""))
        check_values(f"{where}.{bid}[{block.get('type')}]",
                     block.get("settings"), settings_index(schema), problems, notes)
        if "block_order" in block:
            missing = [b for b in block["block_order"] if b not in (block.get("blocks") or {})]
            if missing:
                problems.append(f"{where}.{bid}.block_order names absent blocks: {missing}")
            statics = [b for b, v in (block.get("blocks") or {}).items()
                       if v.get("static") and b in block["block_order"]]
            if statics:
                problems.append(f"{where}.{bid}.block_order includes static blocks: {statics}")
        walk_blocks(f"{where}.{bid}", block.get("blocks"), problems, notes)


def check(path):
    src = pathlib.Path(path).read_text(encoding="utf-8")
    body = re.sub(r"^/\*.*?\*/", "", src, flags=re.S)
    doc = json.loads(body)
    problems, notes = [], []
    for sid, section in doc.get("sections", {}).items():
        schema = load_schema("sections", section.get("type", ""))
        check_values(f"{sid}[{section.get('type')}]", section.get("settings"),
                     settings_index(schema), problems, notes)
        if "block_order" in section:
            missing = [b for b in section["block_order"] if b not in (section.get("blocks") or {})]
            if missing:
                problems.append(f"{sid}.block_order names absent blocks: {missing}")
        walk_blocks(sid, section.get("blocks"), problems, notes)
    return problems, notes


def main(paths):
    paths = paths or sorted(str(p) for p in (REPO / "templates").glob("*.json"))
    bad = 0
    for path in paths:
        problems, notes = check(path)
        name = pathlib.Path(path).name
        if problems:
            bad += 1
            print(f"{name}: {len(problems)} ERROR(s)")
            for p in problems:
                print(f"   ERROR  {p}")
        else:
            print(f"{name}: ok")
        for n in notes:
            print(f"   note   {n}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
