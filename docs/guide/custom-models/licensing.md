---
title: Licensing your uploads
description: The license details every upload needs, how author and source fields appear in credits, and how to edit a license after you save.
---

# Licensing your uploads

Before you can save an upload, you must record its license. The editor uses this information in every export that includes the upload. It appears in `CREDITS.txt`, and it decides whether the export shows a warning.

## Fields you fill in

- **License**: choose one of the options in the table below.
- **Author**: the creator's name, from 1 to 128 characters.
- **Source link** (optional): a web address that starts with `http://` or `https://`, up to 2048 characters.
- **I have the right to use this asset**: a checkbox you must tick. It is required.

If you choose **Other**, you also fill in:

- **License name and notes**: from 1 to 500 characters.
- **Commercial use**: yes, no or unknown.
- **Attribution required**: yes or no.

## License options

| License      | Commercial use | Attribution required |
| ------------ | -------------- | -------------------- |
| CC0 1.0      | Yes            | No                   |
| CC BY 4.0    | Yes            | Yes                  |
| CC BY-SA 4.0 | Yes            | Yes, and share-alike |
| Own work     | Yes            | No                   |
| Other        | You choose     | You choose           |

For CC0 1.0, CC BY 4.0 and CC BY-SA 4.0, the editor sets the commercial use and attribution settings for you.

## Models with license information built in

A VRM file can contain its author and license. The editor fills in those fields from the file. Check them, because you are still the one who confirms the license.

If the file says the model is for personal, non-profit use only, the editor sets **Commercial use** to **No**. You can still change it.

## How credits use your details

- The author and title appear in `CREDITS.txt`.
- For CC BY and CC BY-SA, the file includes one line you can paste into your game's credits.
- Line breaks in the author or notes are removed, so a name cannot forge an extra line in the file.

## Edit a license later

Open the upload in your library, change the license details, and save. You must tick the rights checkbox again. The next export uses the new details.

## Export warnings

| Warning         | When it appears                                             |
| --------------- | ----------------------------------------------------------- |
| Unknown license | The license is Other, and commercial use is unknown         |
| Non-commercial  | Commercial use is not allowed                               |
| Share-alike     | The license requires your sprites to share the same license |

The export dialog lists the affected uploads, and it waits for your confirmation. See [Credits and licensing](../export/credits-and-licensing.md).

> [!IMPORTANT]
> The editor records the details you enter. It does not check them, and it is not legal advice. You are responsible for having the right to use each model.

<!-- spec: REQ-UPL-036 -->
<!-- spec: REQ-UPL-044 -->
<!-- spec: REQ-UPL-045 -->
<!-- spec: REQ-UPL-046 -->
