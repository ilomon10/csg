---
title: Credits and licensing
description: What CREDITS.txt lists, how attribution lines are written, and what the export warnings about unknown or restricted licenses mean for you.
---

# Credits and licensing

Every export includes a `CREDITS.txt` at the top of the ZIP. It lists every asset the export uses: the body, each part, each animation, any face decal and any palette. The file does not contain a date or time, so the same export always produces the same credits.

## What the file looks like

The file has up to three parts, in this order.

1. **Attribution required**: one ready-to-paste line for each asset whose license asks for credit.
2. **All assets**: every asset, with its title, license, author and source link.
3. **WARNINGS**: shown only when an export has license warnings.

```text
Credits for knight (exported with Character Sprite Generator 0.1.0)

== Attribution required ==
"Leather Hood" by Jane Doe (CC-BY-4.0) https://example.org/hood

== All assets ==
builtin:quaternius-ubc/body-regular-m
  Title: Regular Male | License: CC0-1.0 | Author: Quaternius
  Source: https://quaternius.itch.io/universal-base-characters | Attribution required: no
```

The bundled characters, parts and animations come from Quaternius packs under the CC0 license. CC0 does not ask for credit, but the editor still lists them so you have a record.

## Your own uploads

Every model you upload needs a license before you can save it. The license decides how the editor treats it in credits and warnings. See [Licensing your uploads](../custom-models/licensing.md).

## Export warnings

Before an export starts, the editor checks every asset. If an asset has one of these licenses, a dialog lists those assets under a heading that names the problem.

| Warning                | What it means                                                |
| ---------------------- | ------------------------------------------------------------ |
| Unknown license        | The license is "other" and commercial use is marked unknown. |
| Non-commercial license | Commercial use is not allowed by the license.                |
| Share-alike license    | Your sprites may need to use the same license.               |

The export starts only after you confirm. When you confirm, `CREDITS.txt` repeats each warning in a WARNINGS section, so the record travels with the sprites.

> [!IMPORTANT]
> The editor records the license you enter. It does not check that the license is correct, and it is not legal advice. Read the license terms yourself before you ship a game.

<!-- spec: REQ-EXP-020 -->
<!-- spec: REQ-EXP-021 -->
<!-- spec: REQ-EXP-022 -->
