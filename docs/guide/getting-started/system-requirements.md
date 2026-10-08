---
title: System requirements
description: Supported browsers, the WebGPU and WebGL2 graphics requirement, storage needs, and screen sizes for the editor.
---

# System requirements

## Browsers

Use the latest stable version of one of these browsers on a desktop or laptop:

- Google Chrome
- Microsoft Edge
- Mozilla Firefox
- Safari

Other browsers may work, but they are not tested.

## Graphics

The editor draws your character on the graphics card. It uses one of two paths:

- **WebGPU**, the preferred path, when your browser offers it.
- **WebGL2**, the fallback, when WebGPU is not available.

The badge in the top bar shows which one is active: `WebGPU`, `WebGL2`, or `No GPU`.

> [!IMPORTANT]
> Exports can differ slightly between WebGPU and WebGL2. Each export records which renderer made it.

If your browser has neither WebGPU nor WebGL2, the editor shows a message that names the missing capability and links to supported browsers. You will not see a blank canvas.

> [!NOTE]
> **Planned.** A notice next to **Open the editor** on the home page will warn about missing graphics support before you open the editor.

## Storage

Your projects, autosaves, and uploaded models are stored in your browser. Nothing is uploaded to a server.

- Projects are stored in IndexedDB.
- Uploaded models are stored in the browser's private file storage (OPFS).
- The **Library** shows how much space you have used.

If you use a private window, your work lasts only until you close the tab. The editor shows a banner when this applies.

## Screen size

| Window width    | Layout                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| 1280 px or more | All panels docked. Recommended size: 1440 by 900 px.                    |
| 1024 to 1279 px | The part library becomes a drawer you open from the top bar.            |
| 768 to 1023 px  | Library and inspector become drawers. The bottom dock starts collapsed. |
| Under 768 px    | View only. Editing is not available on small screens.                   |

> [!NOTE]
> **Planned.** The view-only layout for small screens and the offline mode are not in the first release. The editor will load once, then work without a connection.

<!-- spec: REQ-UX-006 -->
<!-- spec: REQ-GEN-001 -->
