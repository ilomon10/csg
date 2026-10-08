# Security Policy

## Supported versions

The project is pre-release. Only the `main` branch receives security fixes.

## Reporting a vulnerability

Do not open a public issue or pull request for a security problem.

Report it privately through GitHub private vulnerability reporting:
<https://github.com/ilomon10/csg/security/advisories/new>

Include the affected version or commit, the steps to reproduce, the impact you
expect, and a sample file if the problem depends on one. Keep the sample private
until a fix is released.

This is a volunteer project. We aim to acknowledge a report within 7 days and to agree a disclosure date with you once a fix is ready (best effort, no guaranteed timeline).

## Scope

In scope:

- Malicious or malformed model files (GLB, glTF, VRM, FBX, OBJ) that crash the editor, hang the upload worker past its timeout, exhaust memory, bypass the budgets, trigger a network request, or run script.
- Name handling, including path or markup injection from model, preset or shader graph names.
- Shader graph JSON, preset and share-by-URL decoding.
- Export files (sprite sheets, metadata, `CREDITS.txt`) that leak user data or embed unexpected content.
- The Content Security Policy and any way to make user data leave the browser (see constitution P-03).
- The website and this repository's CI workflows and build scripts.

Out of scope:

- Problems in third-party dependencies that this project does not exercise. Report them upstream, and tell us as well.
- Attacks that need a malicious browser extension, physical access, or a compromised machine.
- Social engineering, and reports that describe a best practice without a demonstrated impact.
- Ordinary bugs with no security impact. Use the bug report form.

## Assets and licenses

Asset license problems are not security issues. Report them through the asset submission form, or describe them in a public issue.
