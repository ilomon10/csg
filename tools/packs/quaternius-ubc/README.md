# quaternius-ubc: unmapped sources

Edit `pack.config.json`, then `pnpm assets:build`. Free source files not mapped, with reasons:

- `Base Characters/Unity/*.fbx`, `Hairstyles/**/FBX (*)/*.fbx`: FBX (REQ-AST-002) and duplicates of the glTF files.
- `Hairstyles/Origin at 0/**` (glTF, FBX): static variants with the origin at 0, not rigged to the head bone; duplicates of the mapped `Rigged to Head Bone` set.
- `.bin`, textures, licence and readme files: companions of mapped glTF files or documentation.
