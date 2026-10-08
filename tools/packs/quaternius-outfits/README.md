# quaternius-outfits: unmapped sources

Edit `pack.config.json`, then `pnpm assets:build`. Free source files not mapped, with reasons:

- `Exports/glTF (Godot-Unreal)/Outfits/*.gltf`: combined outfits; the modular parts under `Modular Parts/` are mapped instead (one part per slot).
- `Exports/FBX (Unity)/**`: FBX (REQ-AST-002) and duplicates of the glTF exports.
- `Female_Peasant_Body.gltf` contains one stray animation; it is not used as a clip (parts only).
- Multi-mesh files (`*_Ranger_Body` with belts, `*_Ranger_Arms` with bracer) are mapped without `match.node`, meaning every mesh in the file belongs to the part.
- Regular-proportion bodies exist only inside the combined outfit files and are deferred (M1 D4).
