#!/usr/bin/env python3
"""Generate emoji-data.js with a full local RGI emoji set and richer aliases."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path
from typing import Dict, Iterable, List

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_FILE = PROJECT_ROOT / "emoji-data.js"

SOURCE_CANDIDATES = [
    Path("C:/Users/Elisha/AppData/Roaming/npm/node_modules/clawdbot/node_modules/zod/src/v4/classic/tests/string.test.ts"),
    Path("C:/Users/Elisha/AppData/Roaming/npm/node_modules/@google/gemini-cli/node_modules/zod/src/v4/classic/tests/string.test.ts"),
    Path("C:/Users/Elisha/AppData/Roaming/npm/node_modules/clawdbot/node_modules/zod/src/v3/tests/string.test.ts"),
    Path("C:/Users/Elisha/AppData/Roaming/npm/node_modules/@google/gemini-cli/node_modules/zod/src/v3/tests/string.test.ts"),
]

ZWJ = 0x200D
VS15 = 0xFE0E
VS16 = 0xFE0F
KEYCAP = 0x20E3
TAG_MIN = 0xE0061
TAG_MAX = 0xE007A
TAG_CANCEL = 0xE007F

SKIN_TONES = {
    0x1F3FB: "light_skin_tone",
    0x1F3FC: "medium_light_skin_tone",
    0x1F3FD: "medium_skin_tone",
    0x1F3FE: "medium_dark_skin_tone",
    0x1F3FF: "dark_skin_tone",
}

STOP_WORDS = {
    "a",
    "an",
    "and",
    "for",
    "with",
    "without",
    "of",
    "the",
    "sign",
    "symbol",
    "selector",
    "variation",
    "text",
    "emoji",
    "presentation",
    "zero",
    "width",
    "joiner",
}


def run_node(script: str, args: Iterable[str] = (), stdin_text: str | None = None) -> str:
    process = subprocess.run(
        ["node", "-e", script, *list(args)],
        input=stdin_text,
        text=True,
        encoding="utf-8",
        errors="replace",
        capture_output=True,
    )
    if process.returncode != 0:
        raise RuntimeError(process.stderr.strip() or process.stdout.strip() or "node command failed")
    return process.stdout


def load_curated_entries() -> List[dict]:
    file_script = r"""
const fs = require("node:fs");
const vm = require("node:vm");
const file = process.argv[1];
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
process.stdout.write(JSON.stringify(sandbox.window.EMOJI_COMPLETER_DATA || []));
""".strip()
    stdin_script = r"""
const fs = require("node:fs");
const vm = require("node:vm");
const text = fs.readFileSync(0, "utf8");
const sandbox = { window: {} };
vm.runInNewContext(text, sandbox);
process.stdout.write(JSON.stringify(sandbox.window.EMOJI_COMPLETER_DATA || []));
""".strip()

    current_data = json.loads(run_node(file_script, [str(DATA_FILE)]))
    if not isinstance(current_data, list):
        raise RuntimeError("emoji-data.js did not expose an array")

    merged: Dict[str, dict] = {}
    for entry in current_data:
        if isinstance(entry, dict) and entry.get("emoji"):
            merged[str(entry["emoji"])] = entry

    # If available, include data from HEAD (original curated entries) for missing emoji.
    git_show = subprocess.run(
        ["git", "show", "HEAD:emoji-data.js"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if git_show.returncode == 0 and git_show.stdout.strip():
        try:
            head_data = json.loads(run_node(stdin_script, stdin_text=git_show.stdout))
            if isinstance(head_data, list):
                for entry in head_data:
                    if isinstance(entry, dict) and entry.get("emoji"):
                        merged.setdefault(str(entry["emoji"]), entry)
        except Exception:
            pass

    return list(merged.values())


def find_source_string() -> str:
    best = ""
    pattern = re.compile(r'emoji\.parse\(\s*"([^"]{500,})"\s*\);')
    for candidate in SOURCE_CANDIDATES:
        if not candidate.exists():
            continue
        text = candidate.read_text(encoding="utf-8")
        for match in pattern.finditer(text):
            value = match.group(1)
            if len(value) > len(best):
                best = value
    return best


def extract_rgi_emojis(source: str) -> List[str]:
    script = r"""
const fs = require("node:fs");
const source = fs.readFileSync(0, "utf8");
const matches = source.match(/\p{RGI_Emoji}/gv) || [];
const seen = new Set();
const out = [];
for (const emoji of matches) {
  if (!seen.has(emoji)) {
    seen.add(emoji);
    out.push(emoji);
  }
}
process.stdout.write(JSON.stringify(out));
""".strip()
    output = run_node(script, stdin_text=source)
    return json.loads(output)


def discover_additional_rgi_emojis() -> List[str]:
    """Enumerate extra RGI emoji from JS Unicode properties to cover newer additions."""
    script = r"""
const seen = new Set();
const out = [];
const isRgi = (value) => /^\p{RGI_Emoji}$/v.test(value);
const add = (value) => {
  if (!value || seen.has(value)) return;
  seen.add(value);
  out.push(value);
};

for (let cp = 0; cp <= 0x10FFFF; cp += 1) {
  if (cp >= 0xD800 && cp <= 0xDFFF) continue;
  const ch = String.fromCodePoint(cp);
  if (isRgi(ch)) add(ch);
}

const ri = 0x1F1E6;
for (let a = 0; a < 26; a += 1) {
  for (let b = 0; b < 26; b += 1) {
    const flag = String.fromCodePoint(ri + a, ri + b);
    if (isRgi(flag)) add(flag);
  }
}

const keyBases = ["#", "*", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
for (const base of keyBases) {
  const withVs = base + "\uFE0F\u20E3";
  const withoutVs = base + "\u20E3";
  if (isRgi(withVs)) add(withVs);
  if (isRgi(withoutVs)) add(withoutVs);
}

const tones = [0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF];
const singles = out.slice();
for (const base of singles) {
  for (const tone of tones) {
    const seq = base + String.fromCodePoint(tone);
    if (isRgi(seq)) add(seq);
  }
}

process.stdout.write(JSON.stringify(out));
""".strip()
    return json.loads(run_node(script))


def normalize(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9_+\-]+", "_", str(value).lower())).strip("_")


def tokenize(value: str) -> List[str]:
    return [part for part in re.split(r"[_\-]+", normalize(value)) if part]


def unique(values: Iterable[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in values:
        value = normalize(str(raw))
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def trim_shortcode(value: str) -> str:
    base = normalize(value) or "emoji"
    return (base[:40].rstrip("_") or "emoji")


def dedupe_shortcode(base: str, used: set[str]) -> str:
    code = trim_shortcode(base)
    i = 2
    while code in used:
        suffix = f"_{i}"
        code = f"{code[: max(1, 40 - len(suffix))]}{suffix}"
        i += 1
    used.add(code)
    return code


def to_codepoints(emoji: str) -> List[int]:
    return [ord(ch) for ch in emoji]


def is_flag_pair(cps: List[int]) -> bool:
    return len(cps) == 2 and all(0x1F1E6 <= cp <= 0x1F1FF for cp in cps)


def country_code(cps: List[int]) -> str:
    return "".join(chr(cp - 0x1F1E6 + 65) for cp in cps)


def is_keycap(cps: List[int]) -> bool:
    return KEYCAP in cps


def keycap_base(cps: List[int]) -> str:
    for cp in cps:
        if cp in (KEYCAP, VS16):
            continue
        if 0x30 <= cp <= 0x39:
            return chr(cp)
        if cp == 0x23:
            return "hash"
        if cp == 0x2A:
            return "star"
    return "symbol"


def is_tag_flag(cps: List[int]) -> bool:
    return len(cps) > 3 and cps[0] == 0x1F3F4 and cps[-1] == TAG_CANCEL


def decode_tag_flag(cps: List[int]) -> str:
    letters = [chr(cp - TAG_MIN + ord("a")) for cp in cps[1:-1] if TAG_MIN <= cp <= TAG_MAX]
    raw = "".join(letters)
    if raw == "gbeng":
        return "england"
    if raw == "gbsct":
        return "scotland"
    if raw == "gbwls":
        return "wales"
    return raw or "tag"


def sequence_words(cps: List[int]) -> List[str]:
    words: List[str] = []
    for cp in cps:
        if cp in (ZWJ, VS15, VS16, KEYCAP, TAG_CANCEL):
            continue
        if TAG_MIN <= cp <= TAG_MAX:
            words.append(chr(cp - TAG_MIN + ord("a")))
            continue
        if 0x1F1E6 <= cp <= 0x1F1FF:
            words.append(chr(cp - 0x1F1E6 + ord("a")))
            continue
        name = unicodedata.name(chr(cp), f"u{cp:x}")
        for token in tokenize(name):
            if token not in STOP_WORDS:
                words.append(token)
    return [word for word in unique(words) if len(word) > 1]


def pair_words(words: List[str], limit: int = 5) -> List[str]:
    out: List[str] = []
    for i in range(0, max(0, len(words) - 1)):
        if len(out) >= limit:
            break
        out.append(f"{words[i]}_{words[i + 1]}")
    return out


def generate_base_entry(emoji: str) -> dict:
    cps = to_codepoints(emoji)
    aliases: List[str] = []
    keywords: List[str] = []

    tones = [SKIN_TONES[cp] for cp in cps if cp in SKIN_TONES]
    words = sequence_words(cps)

    if is_flag_pair(cps):
        cc = country_code(cps).lower()
        shortcode = f"flag_{cc}"
        aliases.extend([f"flag-{cc}", cc])
        keywords.extend(["flag", "country", cc])
    elif is_keycap(cps):
        base = keycap_base(cps)
        shortcode = f"keycap_{base}"
        aliases.extend([f"keycap-{base}", base])
        keywords.extend(["keycap", "number", base])
    elif is_tag_flag(cps):
        flag = decode_tag_flag(cps)
        shortcode = f"flag_{flag}"
        aliases.extend([f"flag-{flag}", flag])
        keywords.extend(["flag", "country", flag])
    elif words:
        shortcode = "_".join(words[:6])
        keywords.extend(words)
    else:
        shortcode = f"emoji_u{'_'.join(f'{cp:x}' for cp in cps)}"

    if tones:
        keywords.extend(tones)
        shortcode = f"{shortcode}_{tones[0]}"

    cp_alias = f"u{'_'.join(f'{cp:x}' for cp in cps)}"
    aliases.extend([cp_alias, shortcode.replace("_", "-"), shortcode.replace("_", "")])
    keywords.extend(words[:12])
    keywords.extend(pair_words(words))
    keywords.extend(aliases)

    return {
        "emoji": emoji,
        "shortcode": trim_shortcode(shortcode),
        "aliases": unique(aliases),
        "keywords": unique(keywords),
    }


def build_output(entries: List[dict]) -> str:
    lines = [
        "/* global window */",
        '"use strict";',
        "",
        "window.EMOJI_COMPLETER_DATA = [",
    ]
    for entry in entries:
        lines.append(
            "  { emoji: "
            + json.dumps(entry["emoji"], ensure_ascii=False)
            + ", shortcode: "
            + json.dumps(entry["shortcode"], ensure_ascii=False)
            + ", aliases: "
            + json.dumps(entry["aliases"], ensure_ascii=False)
            + ", keywords: "
            + json.dumps(entry["keywords"], ensure_ascii=False)
            + " },"
        )
    lines.extend(["];", ""])
    return "\n".join(lines)


def main() -> int:
    curated = load_curated_entries()
    curated_by_emoji: Dict[str, dict] = {entry.get("emoji", ""): entry for entry in curated if isinstance(entry, dict)}

    source = find_source_string()
    if not source:
        raise RuntimeError("Unable to find a local emoji source string")

    base_emojis = extract_rgi_emojis(source)
    extra_emojis = discover_additional_rgi_emojis()
    emojis = list(dict.fromkeys([*base_emojis, *extra_emojis]))
    if not emojis:
        raise RuntimeError("No emojis extracted from local source")

    used_shortcodes: set[str] = set()
    entries: List[dict] = []
    included_emoji: set[str] = set()

    for emoji in emojis:
        base = generate_base_entry(emoji)
        existing = curated_by_emoji.get(emoji)

        shortcode = base["shortcode"]
        aliases = list(base["aliases"])
        keywords = list(base["keywords"])

        if existing:
            cur_shortcode = normalize(str(existing.get("shortcode", "")))
            if cur_shortcode:
                shortcode = cur_shortcode
            aliases = unique(
                [*existing.get("aliases", []), *aliases, shortcode.replace("_", "-"), shortcode.replace("_", "")]
            )
            keywords = unique([*existing.get("keywords", []), *keywords])

        final_shortcode = dedupe_shortcode(shortcode, used_shortcodes)
        clean_aliases = [alias for alias in aliases if normalize(alias) != final_shortcode]
        entry = {
            "emoji": emoji,
            "shortcode": final_shortcode,
            "aliases": clean_aliases[:16],
            "keywords": keywords[:24],
        }
        entries.append(entry)
        included_emoji.add(emoji)

    # Preserve any hand-curated emoji not present in discovered local sources.
    for emoji, existing in curated_by_emoji.items():
        if not emoji or emoji in included_emoji:
            continue
        shortcode = dedupe_shortcode(existing.get("shortcode", "emoji"), used_shortcodes)
        aliases = [
            alias
            for alias in unique([*existing.get("aliases", []), shortcode.replace("_", "-"), shortcode.replace("_", "")])
            if normalize(alias) != shortcode
        ][:16]
        keywords = unique([*existing.get("keywords", []), shortcode, *aliases])[:24]
        entries.append(
            {
                "emoji": emoji,
                "shortcode": shortcode,
                "aliases": aliases,
                "keywords": keywords,
            }
        )

    DATA_FILE.write_text(build_output(entries), encoding="utf-8")
    print(f"Wrote {len(entries)} entries to {DATA_FILE.relative_to(PROJECT_ROOT)}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # pragma: no cover
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
