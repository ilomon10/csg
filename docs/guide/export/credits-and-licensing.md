---
title: Credits and licensing
description: What CREDITS.txt lists, how attribution lines are written, and what the export warnings about unknown, non-commercial or share-alike licenses mean for you.
---

# Credits and licensing

Every export includes a `CREDITS.txt` at the root of the ZIP. It lists every asset the export uses: the body, each part, each animation, any face decal and any palette. The file has no date or time, so the same export always produces the same credits.

## What the file looks like

The file has up to three parts, in this order.

1. **Attribution required**: one ready-to-paste line for each asset whose license asks for credit. If none does, the block says `(none)`.
2. **All assets**: every asset, with its title, license, author, source link and whether attribution is required.
3. **WARNINGS**: shown only when an export has license warnings.

```text
Credits for knight (exported with Character Sprite Generator 0.1.0)

== Attribution required ==
"Leather Hood" by Jane Doe (CC-BY-4.0) https://example.org/hood

== All assets ==
builtin:quaternius-ubc/body-regular-m
  Title: Regular Male | License: CC0-1.0 | Author: Quaternius
  Source: https://quaternius.itch.io/universal-base-characters | Attribution required: no
user:6f1c
  Title: Leather Hood | License: CC-BY-4.0 | Author: Jane Doe
  Source: https://example.org/hood | Attribution required: yes

== WARNINGS ==
LICENSE_UNKNOWN: user:9a2e
```

The entries are sorted by their asset reference. An asset without a source link shows `Source: n/a`.

The bundled characters, parts and animations come from Quaternius packs under the CC0 license. CC0 does not ask for credit, but the editor still lists them so you have a record.

## Your own uploads

Every model you upload needs a license before you can save it. The license decides how the editor treats it in credits and warnings. See [Licensing your uploads](../custom-models/licensing.md).

## Export warnings

Before an export starts, the editor checks every asset. If an asset has one of these licenses, a blocking dialog lists those assets under the warning that applies.

| Warning                | What it means                                                |
| ---------------------- | ------------------------------------------------------------ |
| Unknown license        | The license is "other" and commercial use is marked unknown. |
| Non-commercial license | Commercial use is not allowed by the license.                |
| Share-alike license    | Your sprites may need to use the same license.               |

The dialog blocks the export until you confirm or cancel. When you confirm, `CREDITS.txt` repeats each warning in a WARNINGS section, so the record travels with the sprites.

> [!IMPORTANT]
> The editor records the license you enter. It does not check that the license is correct, and it is not legal advice. Read the license terms yourself before you ship a game.

<!-- spec: REQ-EXP-020 -->
<!-- spec: REQ-EXP-021 -->
<!-- spec: REQ-EXP-022 -->
