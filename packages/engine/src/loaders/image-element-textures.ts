/**
 * Decodes glTF textures through `<img>` instead of `fetch` + `createImageBitmap`
 * (spec 000 REQ-GEN-010, architecture 4.10).
 *
 * three r186 `GLTFParser` picks an `ImageBitmapLoader` whenever `createImageBitmap` exists.
 * That loader calls `fetch()` on the `blob:` URL the parser makes for an image embedded in a
 * GLB `bufferView`, which the app's CSP (`connect-src 'self'`) blocks, so textures silently go
 * missing. An `<img>` load of the same `blob:` URL falls under `img-src 'self' blob: data:`
 * and is allowed. The plugin swaps the parser's loader for a `TextureLoader` (the parser's own
 * fallback path) right after the parser is constructed, before any texture loads.
 *
 * Unchanged by the swap: `GLTFParser.loadTextureImage` still sets `flipY = false`, sampler
 * filters and wrapping, and `assignTexture` still sets `SRGBColorSpace` on base color and
 * emissive maps. URL policy checks still run through the parser's `LoadingManager`.
 */
import {TextureLoader} from 'three';
import type {
  GLTFLoader,
  GLTFLoaderPlugin,
  GLTFParser,
} from 'three/addons/loaders/GLTFLoader.js';

/** Name of the plugin (not a glTF extension; only used as the parser's plugin key). */
export const IMAGE_ELEMENT_TEXTURES_PLUGIN = 'CSG_image_element_textures';

/**
 * `GLTFLoader.register` callback: replaces `parser.textureLoader` with a `TextureLoader`
 * (`<img>` decode, no `fetch`) on the parser's own manager, keeping its cross-origin mode and
 * request headers.
 *
 * @param parser The parser `GLTFLoader.parse` just created.
 * @returns A no-op plugin carrying {@link IMAGE_ELEMENT_TEXTURES_PLUGIN} as its name.
 */
export function imageElementTexturesPlugin(
  parser: GLTFParser,
): GLTFLoaderPlugin {
  const loader = new TextureLoader(parser.options.manager);
  loader.setCrossOrigin(parser.options.crossOrigin);
  loader.setRequestHeader(parser.options.requestHeader);
  parser.textureLoader = loader;
  return {name: IMAGE_ELEMENT_TEXTURES_PLUGIN};
}

/**
 * Registers {@link imageElementTexturesPlugin} on a loader.
 *
 * @param loader A `GLTFLoader`.
 * @returns The same loader.
 */
export function registerImageElementTextures(loader: GLTFLoader): GLTFLoader {
  return loader.register(imageElementTexturesPlugin);
}
