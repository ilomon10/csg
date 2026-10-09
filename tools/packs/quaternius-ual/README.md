# quaternius-ual: unmapped sources

Edit `pack.config.json`, then `pnpm assets:build`. Free source files not mapped, with reasons:

- `Unreal-Godot/UAL1_Standard_RM.glb`: root-motion variant, deferred with REQ-ANM-015 (M1 D5); runtime X/Z stripping covers in-place use.
- `Unity/*.fbx`: FBX (REQ-AST-002) and duplicates of the glTF files.
- All 43 clips of `UAL1_Standard.glb` are mapped (`A_TPose` as a one-frame misc clip).
