import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {checkSpecs, parseRegistry} from './spec-ids';
import {ROOT, readSpecs} from './spec-files';

const MAX_SHOWN = 100;
const specs = readSpecs();
const overview = readFileSync(join(ROOT, 'specs/000-overview.md'), 'utf8');
const registry = parseRegistry(overview);
const {errors, reqs, acs} = checkSpecs(specs, registry);

if (errors.length > 0) {
  console.error(`spec:check failed with ${errors.length} problem(s):\n`);
  for (const e of errors.slice(0, MAX_SHOWN)) console.error(`  - ${e}`);
  if (errors.length > MAX_SHOWN) {
    console.error(`  ... and ${errors.length - MAX_SHOWN} more`);
  }
  process.exit(1);
}
console.log(
  `spec:check ok: ${specs.length} specs, ${reqs.size} REQs, ${acs.size} ACs, ${registry.size} prefixes.`,
);
