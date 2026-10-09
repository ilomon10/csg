import type {CommandDef} from './types';

function score(query: string, text: string): number {
  const t = text.toLowerCase();
  if (t === query) return 1000;
  if (t.startsWith(query)) return 800 - t.length;
  const word = t.split(/[\s._-]+/).findIndex(w => w.startsWith(query));
  if (word >= 0) return 600 - word * 10 - t.length;
  const at = t.indexOf(query);
  if (at >= 0) return 400 - at;
  // Subsequence match.
  let pos = 0;
  for (const ch of query) {
    pos = t.indexOf(ch, pos);
    if (pos < 0) return 0;
    pos += 1;
  }
  return 100 - t.length;
}

/**
 * Ranks commands for the palette by title, then synonyms and category (AC-UX-019.1). An empty
 * query keeps the input order. Linear in the command count.
 */
export function fuzzyRank(
  query: string,
  commands: readonly CommandDef[],
  titles: (id: string) => string,
): CommandDef[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...commands];
  const scored: Array<{command: CommandDef; score: number; index: number}> = [];
  commands.forEach((command, index) => {
    const best = Math.max(
      score(q, titles(command.id)) * 3,
      ...(command.synonyms ?? []).map(s => score(q, s) * 2),
      score(q, command.category),
    );
    if (best > 0) scored.push({command, score: best, index});
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map(entry => entry.command);
}
