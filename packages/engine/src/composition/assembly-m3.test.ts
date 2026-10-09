/**
 * M3-05 assembly behaviour: per-assembly materials (two renderers on one registry keep their
 * own tints, registry scenes never re-materialed), per-part tint overrides (REQ-CMP-015),
 * `alsoOccupies` (REQ-CMP-007), hair hides (REQ-CMP-012) and the rendered (style, species) pair
 * (REQ-CMP-043, REQ-CMP-048 rules (d)/(e)).
 */
import {describe, expect, it} from 'vitest';
import {Color} from 'three';
import type {Material, Mesh, Object3D} from 'three';
import {defaultRenderSettings} from '@csg/parts-schema';
import type {CharacterSpec} from '@csg/parts-schema';
import {SettingsBinder} from '../pipeline/settings-binder';
import {TOON_MATERIAL_USER_DATA} from '../pipeline/toon-material';
import {createCharacterAssembly} from './character-assembly';
import type {CharacterAssembly} from './character-assembly';
import {
  createTestRegistry,
  fixtureSpec,
  ref,
  testStyle,
} from './assembly-test-env';
import type {TestRegistry} from './assembly-test-env';

function meshes(object: Object3D): Mesh[] {
  const out: Mesh[] = [];
  object.traverse(o => {
    if ((o as Partial<Mesh>).isMesh === true) out.push(o as Mesh);
  });
  return out;
}

function materialsOf(object: Object3D): Material[] {
  return meshes(object).flatMap(m =>
    Array.isArray(m.material) ? m.material : [m.material],
  );
}

/** Color uniforms (`UniformNode` holding a `Color`) reachable from a material's color node. */
function colorUniforms(material: Material): Array<{value: Color}> {
  const out: Array<{value: Color}> = [];
  const root = (
    material as {colorNode?: {traverse(cb: (n: unknown) => void): void}}
  ).colorNode;
  root?.traverse(n => {
    const node = n as {isUniformNode?: boolean; value?: {isColor?: boolean}};
    if (node.isUniformNode === true && node.value?.isColor === true) {
      out.push(n as {value: Color});
    }
  });
  return out;
}

function withParts(
  spec: CharacterSpec,
  parts: CharacterSpec['parts'],
): CharacterSpec {
  return {...spec, parts};
}

async function assemble(
  registry: TestRegistry,
  spec: CharacterSpec,
): Promise<CharacterAssembly> {
  const assembly = createCharacterAssembly({registry});
  const result = await assembly.setCharacter(spec);
  expect(result).toEqual({ok: true, value: undefined});
  return assembly;
}

function attachedObject(assembly: CharacterAssembly, slot: string): Object3D {
  const part = assembly.parts.get(slot);
  if (part === undefined) throw new Error(`no part in ${slot}`);
  return part.attached.object;
}

describe('M3-05: materials are owned per assembly', () => {
  it('REQ-CMP-013: two renderers (assemblies) on one registry keep their own tints; the registry scenes are never re-materialed', async () => {
    const registry = createTestRegistry();
    const loaded = await registry.inner.resolve(ref('fixture-shirt'));
    if (!loaded.ok) throw new Error('shirt');
    const registryMaterials = meshes(loaded.value.scene).map(m => m.material);

    const red = fixtureSpec();
    red.tints = {...red.tints, primary: '#ff0000'};
    const blue = fixtureSpec();
    blue.tints = {...blue.tints, primary: '#0000ff'};
    const a = await assemble(registry, red);
    const b = await assemble(registry, blue);

    // The registry scene keeps its original materials, untinted.
    expect(meshes(loaded.value.scene).map(m => m.material)).toEqual(
      registryMaterials,
    );
    const shirtA = materialsOf(attachedObject(a, 'torso'));
    const shirtB = materialsOf(attachedObject(b, 'torso'));
    for (const m of shirtA) expect(shirtB).not.toContain(m);
    for (const m of [...shirtA, ...shirtB]) {
      expect(registryMaterials).not.toContain(m);
    }
    // Each shirt reads its own assembly's primary uniform.
    const hexOf = (ms: Material[]) =>
      ms.flatMap(m => colorUniforms(m)).map(u => u.value.getHexString());
    expect(hexOf(shirtA)).toEqual(['ff0000']);
    expect(hexOf(shirtB)).toEqual(['0000ff']);

    // Disposing one assembly leaves the other's materials in place.
    a.dispose();
    expect(materialsOf(attachedObject(b, 'torso'))).toEqual(shirtB);
    expect(hexOf(materialsOf(attachedObject(b, 'torso')))).toEqual(['0000ff']);
    expect(meshes(loaded.value.scene).map(m => m.material)).toEqual(
      registryMaterials,
    );
    b.dispose();
  });

  it('REQ-PIX-011: toon bindings are per assembly too; switching one back to unlit leaves the other toon', async () => {
    const registry = createTestRegistry();
    const binderA = new SettingsBinder(defaultRenderSettings());
    const binderB = new SettingsBinder(defaultRenderSettings());
    const mk = (binder: SettingsBinder) =>
      createCharacterAssembly({
        registry,
        material: {binder, backend: 'webgl2', mode: 'export'},
      });
    const a = mk(binderA);
    const b = mk(binderB);
    expect((await a.setCharacter(fixtureSpec())).ok).toBe(true);
    expect((await b.setCharacter(fixtureSpec())).ok).toBe(true);
    a.setMaterialOptions(undefined);
    for (const m of materialsOf(a.root)) {
      expect(m.userData[TOON_MATERIAL_USER_DATA]).toBeUndefined();
    }
    for (const m of materialsOf(b.root)) {
      expect(m.userData[TOON_MATERIAL_USER_DATA]).toBe('toon');
    }
    a.dispose();
    b.dispose();
    binderA.dispose();
    binderB.dispose();
  });

  it('REQ-CMP-033: a body rebuild keeps the materials of parts that stay (no rebuild of unchanged parts)', async () => {
    const registry = createTestRegistry();
    const assembly = await assemble(registry, fixtureSpec());
    const before = materialsOf(attachedObject(assembly, 'torso'));
    const spec = {...fixtureSpec(), body: {ref: ref('fixture-body-b')}};
    expect((await assembly.setCharacter(spec)).ok).toBe(true);
    expect(materialsOf(attachedObject(assembly, 'torso'))).toEqual(before);
    assembly.dispose();
  });
});

describe('REQ-CMP-015: per-part tint overrides', () => {
  it('AC-CMP-015.1: character primary #ff0000 and a cape override primary #0000ff: the cape is blue, other primary parts red', async () => {
    const registry = createTestRegistry();
    const base = fixtureSpec();
    const spec: CharacterSpec = {
      ...withParts(base, {
        ...base.parts,
        back: {ref: ref('fixture-cape'), tints: {primary: '#0000ff'}},
      }),
      tints: {...base.tints, primary: '#ff0000'},
    };
    const assembly = await assemble(registry, spec);
    const hexes = (slot: string) =>
      materialsOf(attachedObject(assembly, slot))
        .flatMap(m => colorUniforms(m))
        .map(u => u.value.getHexString());
    expect(hexes('back')).toEqual(['0000ff']);
    expect(hexes('torso')).toEqual(['ff0000']);
    // The shirt shares the character uniform; the cape has its own.
    const shirtUniform = materialsOf(attachedObject(assembly, 'torso')).flatMap(
      m => colorUniforms(m),
    )[0];
    expect(shirtUniform).toBe(assembly.tints.primary);

    // Changing the override value is a uniform write (no new materials).
    const capeMaterials = materialsOf(attachedObject(assembly, 'back'));
    const recolored: CharacterSpec = {
      ...spec,
      parts: {
        ...spec.parts,
        back: {ref: ref('fixture-cape'), tints: {primary: '#00ff00'}},
      },
    };
    expect((await assembly.setCharacter(recolored)).ok).toBe(true);
    expect(materialsOf(attachedObject(assembly, 'back'))).toEqual(
      capeMaterials,
    );
    expect(hexes('back')).toEqual(['00ff00']);
    expect(assembly.log).toContain('tint-override:back:primary');

    // Removing the override rebuilds that part only, back onto the character tint.
    const torsoMaterials = materialsOf(attachedObject(assembly, 'torso'));
    expect(
      (
        await assembly.setCharacter({
          ...spec,
          parts: {...spec.parts, back: {ref: ref('fixture-cape')}},
        })
      ).ok,
    ).toBe(true);
    expect(hexes('back')).toEqual(['ff0000']);
    expect(materialsOf(attachedObject(assembly, 'torso'))).toEqual(
      torsoMaterials,
    );
    // A character tint change still reaches every part without an override.
    expect(
      (
        await assembly.setCharacter({
          ...spec,
          parts: {...spec.parts, back: {ref: ref('fixture-cape')}},
          tints: {...spec.tints, primary: '#123456'},
        })
      ).ok,
    ).toBe(true);
    expect(hexes('back')).toEqual(['123456']);
    expect(hexes('torso')).toEqual(['123456']);
    assembly.dispose();
  });

  it('REQ-CMP-015: an override for a tint slot the part does not use is ignored and kept in the spec', async () => {
    const registry = createTestRegistry();
    const base = fixtureSpec();
    const spec = withParts(base, {
      ...base.parts,
      torso: {ref: ref('fixture-shirt'), tints: {leather: '#000000'}},
    });
    const assembly = await assemble(registry, spec);
    expect(
      materialsOf(attachedObject(assembly, 'torso'))
        .flatMap(m => colorUniforms(m))
        .map(u => u.value.getHexString()),
    ).toEqual([new Color().set(base.tints.primary).getHexString()]);
    expect(assembly.spec?.parts['torso']?.tints).toEqual({leather: '#000000'});
    assembly.dispose();
  });
});

describe('REQ-CMP-007 / REQ-CMP-012: parts that are equipped but not drawn', () => {
  it('AC-CMP-007.1 (engine part): a robe with alsoOccupies [legs] occupies the legs slot: the trousers are not drawn while the robe is equipped', async () => {
    const registry = createTestRegistry();
    const base = fixtureSpec();
    const spec = withParts(base, {
      ...base.parts,
      torso: {ref: ref('fixture-robe')},
      legs: {ref: ref('fixture-trousers')},
    });
    const assembly = await assemble(registry, spec);
    expect(assembly.hidden.get('legs')).toEqual({
      reason: 'occupied',
      by: 'torso',
    });
    expect(attachedObject(assembly, 'legs').visible).toBe(false);
    expect(attachedObject(assembly, 'torso').visible).toBe(true);
    expect(assembly.spec?.parts['legs']?.ref).toBe(ref('fixture-trousers'));

    // AC-CMP-007.2: the latest choice is the command's job; once the robe is gone the trousers draw.
    expect(
      (
        await assembly.setCharacter(
          withParts(base, {
            ...base.parts,
            legs: {ref: ref('fixture-trousers')},
          }),
        )
      ).ok,
    ).toBe(true);
    expect(assembly.hidden.has('legs')).toBe(false);
    expect(attachedObject(assembly, 'legs').visible).toBe(true);
    assembly.dispose();
  });

  it('AC-CMP-012.1 (engine part): a helmet hiding hair leaves the hair in the spec but undrawn; removing the helmet draws it again', async () => {
    const registry = createTestRegistry();
    const base = fixtureSpec();
    const withHair = withParts(base, {
      ...base.parts,
      hair: {ref: ref('fixture-hair')},
    });
    const helmet = withParts(base, {
      ...withHair.parts,
      headwear: {ref: ref('fixture-helmet')},
    });
    const assembly = await assemble(registry, helmet);
    expect(assembly.hidden.get('hair')).toEqual({
      reason: 'hair',
      by: 'headwear',
    });
    expect(attachedObject(assembly, 'hair').visible).toBe(false);
    expect(assembly.spec?.parts['hair']).toBeDefined();
    expect((await assembly.setCharacter(withHair)).ok).toBe(true);
    expect(assembly.hidden.has('hair')).toBe(false);
    expect(attachedObject(assembly, 'hair').visible).toBe(true);
    assembly.dispose();
  });
});

describe('REQ-CMP-043 / REQ-CMP-048: the rendered (style, species) pair', () => {
  it('AC-CMP-043.1 (engine part): a stickman spec renders as realistic, keeps its stored style, and hides parts that fit stickman only', async () => {
    const registry = createTestRegistry({
      styles: [testStyle('realistic'), testStyle('chibi')],
    });
    const base = fixtureSpec();
    const spec: CharacterSpec = {
      ...withParts(base, {
        ...base.parts,
        hair: {ref: ref('fixture-hair')},
        headwear: {ref: ref('fixture-stick-hat')},
      }),
      style: 'stickman',
    };
    const assembly = await assemble(registry, spec);
    expect(assembly.renderPair).toEqual({
      style: 'realistic',
      species: 'human',
      fallback: true,
    });
    expect(assembly.spec?.style).toBe('stickman');
    expect(assembly.hidden.get('headwear')).toEqual({reason: 'style'});
    // The hidden hat's `hides: ['hair']` does not apply.
    expect(assembly.hidden.has('hair')).toBe(false);
    expect(attachedObject(assembly, 'hair').visible).toBe(true);
    assembly.dispose();
  });

  it('AC-CMP-043.2 (engine part): chibi/monster renders chibi/human; a species-restricted part is not drawn', async () => {
    const registry = createTestRegistry();
    const base = fixtureSpec();
    const assembly = await assemble(registry, {
      ...withParts(base, {
        ...base.parts,
        headwear: {ref: ref('fixture-animal-ears')},
      }),
      style: 'chibi',
      species: 'monster',
    });
    expect(assembly.renderPair).toEqual({
      style: 'chibi',
      species: 'human',
      fallback: true,
    });
    expect(assembly.hidden.get('headwear')).toEqual({reason: 'species'});
    assembly.dispose();
  });

  it('AC-CMP-043.3 (engine part): selecting a supported pair clears the fallback in the same setCharacter', async () => {
    const registry = createTestRegistry();
    const base = fixtureSpec();
    const assembly = await assemble(registry, {...base, style: 'voxel'});
    expect(assembly.renderPair?.fallback).toBe(true);
    expect((await assembly.setCharacter({...base, style: 'chibi'})).ok).toBe(
      true,
    );
    expect(assembly.renderPair).toEqual({
      style: 'chibi',
      species: 'human',
      fallback: false,
    });
    assembly.dispose();
  });
});
