import {
  Color,
  DataTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  BoxGeometry,
  BufferAttribute,
  LinearMipmapLinearFilter,
  LinearMipmapNearestFilter,
  NearestFilter,
} from 'three';
import type {Material, Texture} from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {TINT_SLOTS, defaultRenderSettings} from '@csg/parts-schema';
import type {HexColor, PartEntry, TintSlot} from '@csg/parts-schema';
import {describe, expect, it} from 'vitest';
import type {LoadedPartInternal} from '../contracts/registry';
import {attachSkinnedPart} from './attach-skinned-part';
import {createBodySkeleton} from './body-skeleton';
import {
  createRegionMask,
  REGION_ID_ATTRIBUTE,
  setRegionMask,
} from './region-mask';
import {
  fixtureEntry,
  loadFixtureManifest,
  loadFixturePart,
  loadFixtureRig,
} from './test-fixtures';
import {SettingsBinder} from '../pipeline/settings-binder';
import {TOON_MATERIAL_USER_DATA} from '../pipeline/toon-material';
import {
  applyTintMaterial,
  createTintUniforms,
  ensureMipmapped,
  mipmappedTexture,
  releaseMipmappedTexture,
  restoreMaterials,
  setTint,
} from './tint-material';
import type {TintMaterialOptions} from './tint-material';

const rig = loadFixtureRig();
const manifest = loadFixtureManifest();

const INITIAL = Object.fromEntries(
  TINT_SLOTS.map(slot => [slot, '#ffffff']),
) as Record<TintSlot, HexColor>;

interface Traversable {
  traverse(cb: (n: unknown) => void): void;
}

function nodesOf(material: Material): unknown[] {
  const out: unknown[] = [];
  const m = material as MeshBasicNodeMaterial;
  for (const root of [m.colorNode, m.maskNode] as Array<Traversable | null>) {
    root?.traverse(n => out.push(n));
  }
  return out;
}

/** Samples `map`: the texture itself or its mipmapped clone (same image source, review L7). */
function samples(value: unknown, map: Texture): boolean {
  return (
    value === map ||
    ((value as {isTexture?: boolean} | null)?.isTexture === true &&
      (value as Texture).source === map.source)
  );
}

function isTextureOf(node: unknown, map: Texture): boolean {
  return (
    (node as {isTextureNode?: boolean}).isTextureNode === true &&
    samples((node as {value?: unknown}).value, map)
  );
}

function syntheticPart(
  materials: Material[],
  withRegion: boolean,
): LoadedPartInternal {
  const scene = new Group();
  for (const material of materials) {
    const geometry = new BoxGeometry();
    if (withRegion) {
      geometry.setAttribute(
        REGION_ID_ATTRIBUTE,
        new BufferAttribute(
          new Float32Array(geometry.getAttribute('position').count),
          1,
        ),
      );
    }
    scene.add(new Mesh(geometry, material));
  }
  return {
    ref: 'builtin:test/part',
    entry: fixtureEntry(manifest, 'fixture-shirt'),
    rig,
    scene,
  };
}

function material(part: LoadedPartInternal, index = 0): MeshBasicNodeMaterial {
  const mesh = part.scene.children[index] as Mesh;
  return mesh.material as MeshBasicNodeMaterial;
}

const WHITE = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);

describe('tint materials', () => {
  it('REQ-CMP-013: one color uniform per tint slot, values from sRGB hex', () => {
    const uniforms = createTintUniforms({
      ...INITIAL,
      primary: '#3a5fcd',
      skin: '#808080',
    });
    expect(Object.keys(uniforms).sort()).toEqual([...TINT_SLOTS].sort());
    expect(uniforms.primary.value.getHexString()).toBe('3a5fcd');
    expect(uniforms.skin.value.getHexString()).toBe('808080');
    expect(new Set(TINT_SLOTS.map(s => uniforms[s])).size).toBe(
      TINT_SLOTS.length,
    );
  });

  it('AC-CMP-013.1: two parts mapped to primary share the uniform; a tint change updates it in place without rebuilding materials', () => {
    const uniforms = createTintUniforms(INITIAL);
    const map: PartEntry['tintSlots'] = [
      {material: 'Cloth', slot: 'primary', mode: 'multiply'},
    ];
    const a = syntheticPart(
      [Object.assign(new MeshStandardMaterial(), {name: 'Cloth'})],
      false,
    );
    const b = syntheticPart(
      [Object.assign(new MeshStandardMaterial(), {name: 'Cloth'})],
      false,
    );
    applyTintMaterial(a, map, uniforms, undefined);
    applyTintMaterial(b, map, uniforms, undefined);
    const ma = material(a);
    const mb = material(b);
    expect(nodesOf(ma)).toContain(uniforms.primary);
    expect(nodesOf(mb)).toContain(uniforms.primary);
    const versions = [ma.version, mb.version];
    setTint(uniforms, 'primary', '#3a5fcd');
    expect(uniforms.primary.value.getHexString()).toBe('3a5fcd');
    expect(material(a)).toBe(ma);
    expect(material(b)).toBe(mb);
    expect([ma.version, mb.version]).toEqual(versions);
  });

  it('AC-CMP-013.2: a material with no tint mapping references no tint uniform and keeps its color when tints change', () => {
    const uniforms = createTintUniforms(INITIAL);
    const source = Object.assign(
      new MeshStandardMaterial({color: 0x336699, map: WHITE}),
      {name: 'Unmapped'},
    );
    const part = syntheticPart([source], false);
    applyTintMaterial(
      part,
      [{material: 'Cloth', slot: 'primary'}],
      uniforms,
      undefined,
    );
    const m = material(part);
    expect(m).toBeInstanceOf(MeshBasicNodeMaterial);
    expect(m.colorNode).toBeNull();
    for (const slot of TINT_SLOTS)
      expect(nodesOf(m)).not.toContain(uniforms[slot]);
    const before = m.color.getHex();
    for (const slot of TINT_SLOTS) setTint(uniforms, slot, '#ff0000');
    expect(m.color.getHex()).toBe(before);
    expect(m.color.getHex()).toBe(0x336699);
    expect(samples(m.map, WHITE)).toBe(true);
  });

  it('AC-CMP-014.1: multiply mode is texel.rgb x tint (texture and tint in the graph, no luminance); without a map the color is the tint', () => {
    const uniforms = createTintUniforms({...INITIAL, primary: '#808080'});
    const textured = syntheticPart(
      [Object.assign(new MeshStandardMaterial({map: WHITE}), {name: 'Cloth'})],
      false,
    );
    applyTintMaterial(
      textured,
      [{material: 'Cloth', slot: 'primary'}],
      uniforms,
      undefined,
    );
    const nodes = nodesOf(material(textured));
    expect(nodes).toContain(uniforms.primary);
    expect(nodes.some(n => isTextureOf(n, WHITE))).toBe(true);

    const plain = syntheticPart(
      [
        Object.assign(new MeshStandardMaterial({color: 0x123456}), {
          name: 'Cloth',
        }),
      ],
      false,
    );
    applyTintMaterial(
      plain,
      [{material: 'Cloth', slot: 'primary', mode: 'multiply'}],
      uniforms,
      undefined,
    );
    expect(material(plain).colorNode).toBe(uniforms.primary);
  });

  it('AC-CMP-014.2: replace mode colors the material with the flat tint and keeps the texel alpha (cut-out cards)', () => {
    const uniforms = createTintUniforms({...INITIAL, metal: '#ff0000'});
    const part = syntheticPart(
      [Object.assign(new MeshStandardMaterial({map: WHITE}), {name: 'Metal'})],
      false,
    );
    applyTintMaterial(
      part,
      [{material: 'Metal', slot: 'metal', mode: 'replace'}],
      uniforms,
      undefined,
    );
    const m = material(part);
    // vec4(tint, texel.a): the color is the flat tint, the alpha the texture's.
    expect(m.colorNode).not.toBe(uniforms.metal);
    const nodes = nodesOf(m);
    expect(nodes).toContain(uniforms.metal);
    expect(nodes.some(n => isTextureOf(n, WHITE))).toBe(true);
    expect(m.userData['tintSlot']).toBe('metal');
    expect(uniforms.metal.value.getHexString()).toBe('ff0000');

    // Without a map there is no alpha to keep: the flat tint itself.
    const flat = syntheticPart(
      [Object.assign(new MeshStandardMaterial(), {name: 'Metal'})],
      false,
    );
    applyTintMaterial(
      flat,
      [{material: 'Metal', slot: 'metal', mode: 'replace'}],
      uniforms,
      undefined,
    );
    expect(material(flat).colorNode).toBe(uniforms.metal);
  });

  it('AC-CMP-011.1: only geometry with regionId gets the region discard, driven by the shared mask uniform', () => {
    const uniforms = createTintUniforms(INITIAL);
    const mask = createRegionMask();
    const bodyPart = syntheticPart(
      [Object.assign(new MeshStandardMaterial(), {name: 'Body'})],
      true,
    );
    const shirt = syntheticPart(
      [Object.assign(new MeshStandardMaterial(), {name: 'Cloth'})],
      false,
    );
    applyTintMaterial(
      bodyPart,
      [{material: 'Body', slot: 'skin'}],
      uniforms,
      mask,
    );
    applyTintMaterial(
      shirt,
      [{material: 'Cloth', slot: 'primary'}],
      uniforms,
      mask,
    );
    expect(material(bodyPart).maskNode).not.toBeNull();
    expect(nodesOf(material(bodyPart))).toContain(mask);
    expect(material(shirt).maskNode).toBeNull();
    // AC-CMP-011.2: the mask changes in place; the material is not rebuilt.
    const m = material(bodyPart);
    setRegionMask(mask, ['torso', 'upper-arms']);
    setRegionMask(mask, []);
    expect(material(bodyPart)).toBe(m);
  });

  it('REQ-CMP-013: a plain {value} ref is wrapped once and read per render', () => {
    const ref = {value: new Color('#00ff00')};
    const uniforms = {...createTintUniforms(INITIAL), hair: ref};
    const a = syntheticPart(
      [Object.assign(new MeshStandardMaterial(), {name: 'Hair'})],
      false,
    );
    applyTintMaterial(
      a,
      [{material: 'Hair', slot: 'hair'}],
      uniforms,
      undefined,
    );
    const node = material(a).colorNode as unknown as {
      value: Color;
      update: (f: unknown) => void;
    };
    node.update({});
    expect(node.value).toBe(ref.value);
  });

  it('re-applying disposes the previous materials; linked attached meshes follow; restore brings the originals back', async () => {
    const part = await loadFixturePart(
      'pack/parts/fixture-body.glb',
      fixtureEntry(manifest, 'fixture-body'),
      rig,
    );
    const original = (() => {
      let found: Material | undefined;
      part.scene.traverse(o => {
        if ((o as Mesh).isMesh) found = (o as Mesh).material as Material;
      });
      return found;
    })();
    const body = createBodySkeleton(rig, 'fixture-a');
    if (!body.ok) throw new Error(body.error.message);
    const attached = attachSkinnedPart(part, body.value);
    if (!attached.ok) throw new Error(attached.error.message);
    const clone = attached.value.object.children[0] as Mesh;
    expect(clone.material).toBe(original);

    const uniforms = createTintUniforms(INITIAL);
    applyTintMaterial(part, part.entry.tintSlots, uniforms, createRegionMask());
    const first = clone.material as MeshBasicNodeMaterial;
    expect(first).toBeInstanceOf(MeshBasicNodeMaterial);
    expect(first.name).toBe('Body');
    expect(nodesOf(first)).toContain(uniforms.skin);
    let disposed = 0;
    first.addEventListener('dispose', () => disposed++);
    applyTintMaterial(part, part.entry.tintSlots, uniforms, undefined);
    expect(disposed).toBe(1);
    expect(clone.material).not.toBe(first);
    restoreMaterials(part.scene);
    expect(clone.material).toBe(original);
    attached.value.dispose();
  });

  describe('toon path (spec 003 pixel pipeline)', () => {
    function options(binder = new SettingsBinder(defaultRenderSettings())) {
      return {
        binder,
        opts: {
          binder,
          backend: 'webgl2',
          mode: 'export',
        } as TintMaterialOptions,
      };
    }

    it('AC-CMP-013.1/014.1: tinted toon materials keep the M1 tint (shared slot uniform, texture in multiply) and are lit by the binder', () => {
      const {binder, opts} = options();
      const uniforms = createTintUniforms(INITIAL);
      const part = syntheticPart(
        [
          Object.assign(new MeshStandardMaterial({map: WHITE}), {
            name: 'Cloth',
          }),
        ],
        false,
      );
      applyTintMaterial(
        part,
        [{material: 'Cloth', slot: 'primary'}],
        uniforms,
        undefined,
        opts,
      );
      const m = material(part);
      expect(m.userData[TOON_MATERIAL_USER_DATA]).toBe('toon');
      expect(m.userData['tintSlot']).toBe('primary');
      const nodes = nodesOf(m);
      expect(nodes).toContain(uniforms.primary);
      expect(nodes).toContain(binder.lightDir);
      expect(nodes).toContain(binder.uniformNode('alpha.cutoff'));
      expect(nodes.some(n => isTextureOf(n, WHITE))).toBe(true);
      const version = m.version;
      setTint(uniforms, 'primary', '#3a5fcd');
      expect(m.version).toBe(version);
    });

    it('AC-CMP-014.2: replace-mode toon materials use the flat tint with the texel alpha (cut-out cards)', () => {
      const {opts} = options();
      const uniforms = createTintUniforms(INITIAL);
      const withMap = syntheticPart(
        [Object.assign(new MeshStandardMaterial({map: WHITE}), {name: 'Hair'})],
        false,
      );
      applyTintMaterial(
        withMap,
        [{material: 'Hair', slot: 'hair', mode: 'replace'}],
        uniforms,
        undefined,
        opts,
      );
      const nodes = nodesOf(material(withMap));
      expect(nodes).toContain(uniforms.hair);
      // The albedo is read only for its alpha in replace mode.
      expect(nodes.some(n => isTextureOf(n, WHITE))).toBe(true);
    });

    it('AC-CMP-013.2: an unmapped toon material references no tint uniform', () => {
      const {opts} = options();
      const uniforms = createTintUniforms(INITIAL);
      const part = syntheticPart(
        [
          Object.assign(new MeshStandardMaterial({color: 0x336699}), {
            name: 'X',
          }),
        ],
        false,
      );
      applyTintMaterial(
        part,
        [{material: 'Cloth', slot: 'primary'}],
        uniforms,
        undefined,
        opts,
      );
      for (const slot of TINT_SLOTS) {
        expect(nodesOf(material(part))).not.toContain(uniforms[slot]);
      }
    });

    it('AC-CMP-011.1 (unit): body toon materials combine the region mask with the alpha cutoff discard; non-body meshes get only the cutoff', () => {
      const {binder, opts} = options();
      const uniforms = createTintUniforms(INITIAL);
      const mask = createRegionMask();
      const body = syntheticPart(
        [Object.assign(new MeshStandardMaterial(), {name: 'Body'})],
        true,
      );
      const shirt = syntheticPart(
        [Object.assign(new MeshStandardMaterial(), {name: 'Cloth'})],
        false,
      );
      applyTintMaterial(
        body,
        [{material: 'Body', slot: 'skin'}],
        uniforms,
        mask,
        opts,
      );
      applyTintMaterial(
        shirt,
        [{material: 'Cloth', slot: 'primary'}],
        uniforms,
        mask,
        opts,
      );
      const bodyMask = nodesOf(material(body));
      expect(bodyMask).toContain(mask);
      expect(bodyMask).toContain(binder.uniformNode('alpha.cutoff'));
      const shirtNodes = nodesOf(material(shirt));
      expect(shirtNodes).not.toContain(mask);
      expect(shirtNodes).toContain(binder.uniformNode('alpha.cutoff'));
    });

    it('AC-PIX-038.1 (unit): part textures get mipmaps; a NEAREST sampler becomes LINEAR_MIPMAP_LINEAR, a mipmapped one is kept', () => {
      const nearest = new DataTexture(new Uint8Array(4), 1, 1);
      nearest.minFilter = NearestFilter;
      nearest.magFilter = NearestFilter;
      nearest.generateMipmaps = false;
      const {opts} = options();
      const part = syntheticPart(
        [
          Object.assign(new MeshStandardMaterial({map: nearest}), {
            name: 'Cloth',
          }),
        ],
        false,
      );
      applyTintMaterial(
        part,
        [{material: 'Cloth', slot: 'primary'}],
        createTintUniforms(INITIAL),
        undefined,
        opts,
      );
      // The material samples a mipmapped clone over the same image source.
      const sampled = nodesOf(material(part))
        .map(n => (n as {value?: Texture}).value)
        .filter((v): v is Texture => v?.isTexture === true);
      expect(sampled.length).toBeGreaterThan(0);
      for (const t of sampled) {
        expect(t).not.toBe(nearest);
        expect(t.source).toBe(nearest.source);
        expect(t.minFilter).toBe(LinearMipmapLinearFilter);
        expect(t.generateMipmaps).toBe(true);
      }
      const kept = new DataTexture(new Uint8Array(4), 1, 1);
      kept.minFilter = LinearMipmapNearestFilter;
      kept.generateMipmaps = true;
      expect(ensureMipmapped(kept)).toBe(false);
      expect(kept.minFilter).toBe(LinearMipmapNearestFilter);
    });

    it('AC-PIX-038.1 / review L7: registry textures are never mutated; clones are shared and disposed with their last user', () => {
      const shared = new DataTexture(new Uint8Array(4), 1, 1);
      shared.minFilter = NearestFilter;
      shared.generateMipmaps = false;
      const versionBefore = shared.version;
      const {opts} = options();
      const parts = [0, 1].map(() =>
        syntheticPart(
          [
            Object.assign(new MeshStandardMaterial({map: shared}), {
              name: 'Cloth',
            }),
          ],
          false,
        ),
      );
      for (const part of parts) {
        applyTintMaterial(
          part,
          [{material: 'Cloth', slot: 'primary'}],
          createTintUniforms(INITIAL),
          undefined,
          opts,
        );
      }
      expect(shared.minFilter).toBe(NearestFilter);
      expect(shared.generateMipmaps).toBe(false);
      expect(shared.version).toBe(versionBefore);
      // One clone for both parts.
      const clone = mipmappedTexture(shared);
      releaseMipmappedTexture(shared, clone);
      let disposed = 0;
      clone.addEventListener('dispose', () => disposed++);
      const [first, second] = parts as [LoadedPartInternal, LoadedPartInternal];
      restoreMaterials(first.scene);
      expect(disposed).toBe(0);
      restoreMaterials(second.scene);
      expect(disposed).toBe(1);
      // Already mipmapped: used as is, never disposed by a release.
      const ready = new DataTexture(new Uint8Array(4), 1, 1);
      ready.minFilter = LinearMipmapLinearFilter;
      ready.generateMipmaps = true;
      expect(mipmappedTexture(ready)).toBe(ready);
      releaseMipmappedTexture(ready, ready);
    });

    it('re-applying the toon path disposes the previous toon materials', () => {
      const {opts} = options();
      const uniforms = createTintUniforms(INITIAL);
      const part = syntheticPart(
        [Object.assign(new MeshStandardMaterial(), {name: 'Cloth'})],
        false,
      );
      applyTintMaterial(part, [], uniforms, undefined, opts);
      let disposed = 0;
      material(part).addEventListener('dispose', () => disposed++);
      applyTintMaterial(part, [], uniforms, undefined, opts);
      expect(disposed).toBe(1);
      restoreMaterials(part.scene);
      expect(material(part)).toBeInstanceOf(MeshStandardMaterial);
    });
  });
});
