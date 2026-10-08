---
title: Glossary
description: Plain-language definitions of the terms used across the editor and this guide, from anatomy and budgets to slots, sockets and toon shading.
---

# Glossary

Terms are listed alphabetically. A term that appears elsewhere in the editor is defined here in plain language.

| Term            | Meaning                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| Alpha cutoff    | The opacity a pixel needs to be kept in the export. Pixels below it become transparent.          |
| Anatomy         | The nine sliders that change a character's proportions, such as head size and leg length.        |
| Attribution     | Credit that a license requires you to give, such as the author's name and a link.                |
| Blackboard      | The panel of a shader graph that lists its parameters, and that can show them in the Look panel. |
| Bone            | One joint of a skeleton. Clothing and skin follow the bones they are attached to.                |
| Bone map        | The matching between your model's bones and the base skeleton's bones.                           |
| Body            | The base character. Every character has one body, and it cannot be removed.                      |
| Budget          | A limit on the size or complexity of an uploaded model, such as its triangle count.              |
| Camera          | The viewpoint that renders your character: side, three-quarter or isometric.                     |
| Character file  | A `.character.json` file that stores one character: its parts, tints, proportions and seed.      |
| Clip            | A named animation, such as `idle` or `walk`.                                                     |
| CREDITS.txt     | The text file in every export that lists each asset, its license and its author.                 |
| Direction       | One facing of the character, such as east or south-west.                                         |
| Dither          | A pattern of palette colors that suggests a shade between two colors.                            |
| Export          | The process that turns your character into a ZIP with sprite sheets and metadata.                |
| Fit to clip     | The default timing mode. The frames are spread evenly across the whole clip.                     |
| Frame           | One picture of the character, taken at one moment of one animation and direction.                |
| Framing         | How large the character appears in each frame: automatic, or a fixed scale.                      |
| Graph           | A shader graph. Either the material graph or the post graph.                                     |
| Hides           | The body regions that a part covers, so they are not drawn underneath it.                        |
| Look panel      | A simple panel with a preset picker and a few sliders, for changing the look without nodes.      |
| Look preset     | A ready-made look that sets lighting, outline, palette and dithering in one step.                |
| Manifest        | The JSON file that records exactly how an export was made.                                       |
| Material graph  | The shader graph that decides how each surface of the character is lit and colored.              |
| Node            | A box in a shader graph that does one job, such as adding two values.                            |
| OPFS            | The browser's private file storage, where uploaded models are kept on your device.               |
| Outline         | A dark border drawn around a character, or between two parts.                                    |
| Palette         | A fixed list of colors that every pixel of a sprite must use.                                    |
| Part            | One item that fills a slot, such as a hat, a shirt or a sword.                                   |
| Pivot           | The point where a character stands. The feet sit on the same pixel row in every frame.           |
| Pixel view      | The viewport mode that shows the low-resolution frame the export will contain.                   |
| Post graph      | The shader graph that runs on the finished frame, for outlines, palettes and dithering.          |
| Preset          | A ready-made character or look that you can apply in one step.                                   |
| Project file    | A `.csgproj.json` file that stores everything in the editor.                                     |
| Render settings | The settings in the Render tab: camera, directions, size, lighting, outline and palette.         |
| Rest pose       | The pose a model is rigged in, such as a T-pose or an A-pose.                                    |
| Rim light       | A bright edge on the side of a surface that faces the light.                                     |
| Seed            | A number that makes randomization repeatable. The same seed gives the same result.               |
| Shader graph    | A set of connected nodes that defines the look of your sprites.                                  |
| Skeleton        | The set of bones that a character's parts and animations use.                                    |
| Slot            | A named place on the body, such as hair or torso. A slot holds at most one part.                 |
| Socket          | A named input or output on a node. In a prop, a socket is also a bone where the item attaches.   |
| Sprite sheet    | One image that holds all the frames, arranged in rows and columns.                               |
| Tint            | A color for one channel of the character, such as skin or primary.                               |
| Toon shading    | Shading that uses a few flat bands of color instead of a smooth gradient.                        |
| Upload          | A model you bring into the editor from your own files.                                           |
| WebGL2          | A graphics system that the editor uses when WebGPU is not available.                             |
| WebGPU          | The modern graphics system the editor prefers.                                                   |
| Wire            | A line that carries a value from one node's output to another node's input.                      |
