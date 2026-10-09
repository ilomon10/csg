import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {buildTrace, checkSpecs, parseRegistry, renderTrace} from './spec-ids';
import {ROOT, readSpecs, readTests} from './spec-files';

const overview = readFileSync(join(ROOT, 'specs/000-overview.md'), 'utf8');
const spec = checkSpecs(readSpecs(), parseRegistry(overview));
if (spec.errors.length > 0) {
  console.warn(
    `warning: ${spec.errors.length} spec problem(s); run pnpm spec:check`,
  );
}
const rows = buildTrace(spec, readTests());
const markdown = renderTrace(rows);
writeFileSync(join(ROOT, 'specs/traceability.md'), markdown);
const acs = rows.flatMap(r => r.acs).filter(a => !a.deprecated);
console.log(
  `spec:trace wrote specs/traceability.md: ${acs.filter(a => a.tests.length).length}/${acs.length} ACs covered.`,
);
