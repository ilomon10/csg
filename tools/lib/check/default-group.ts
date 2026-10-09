/**
 * Overlay validation for `assets:verify-rig --write-canonical` (spec 011
 * AC-AST-005.3). Pure: no file I/O.
 */
import {safeName} from '../rig-verify.js';

/**
 * Checks that an overlay's `defaultSkeletonGroup` is declared in its
 * `skeletonGroups` and that the group's representative file is the verify-rig
 * reference file.
 *
 * @param defaultGroup the overlay's `defaultSkeletonGroup` (any JSON value).
 * @param declared declared group id to its representative file (relative path).
 * @param referenceFile the reference file (relative path).
 * @returns an error message naming `defaultSkeletonGroup`, or null when valid.
 */
export function checkDefaultSkeletonGroup(
  defaultGroup: unknown,
  declared: ReadonlyMap<string, string>,
  referenceFile: string,
): string | null {
  if (typeof defaultGroup !== 'string' || defaultGroup === '') {
    return 'defaultSkeletonGroup is missing in the overlay; it must name one of its skeletonGroups.';
  }
  const file = declared.get(defaultGroup);
  if (file === undefined) {
    return `defaultSkeletonGroup ${safeName(defaultGroup)} is not one of the overlay skeletonGroups (${[...declared.keys()].map(safeName).join(', ') || 'none'}).`;
  }
  if (file !== referenceFile) {
    return `defaultSkeletonGroup ${safeName(defaultGroup)} must use the reference file ${safeName(referenceFile)}, but its representative is ${safeName(file)}.`;
  }
  return null;
}
