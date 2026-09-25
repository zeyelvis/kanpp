/** Playback outcomes of one line over the ranking window. */
export interface LineStats {
  ok: number;
  fail: number;
}

const PRIOR_WEIGHT = 40; // pseudo-loads: a few failed loads (or one viewer retrying) barely move a line
const DEFAULT_RATE = 0.8;
const AD_PENALTY = 0.15; // lines with burned-in sponsor overlays only lead when clearly more reliable
const MARGIN = 0.05; // a line overtakes the registry order only when clearly better

function smoothedRate(local: LineStats | undefined, global: LineStats | undefined): number {
  const prior = (s: LineStats | undefined, base: number) => (s ? (s.ok + PRIOR_WEIGHT * base) / (s.ok + s.fail + PRIOR_WEIGHT) : base);
  return prior(local, prior(global, DEFAULT_RATE));
}

/**
 * Orders lines by how often they actually play for viewers in this country (falling back to
 * all countries, then to the registry order). `lines` must be in registry order: a line only
 * moves ahead of an earlier one when its success rate is higher by at least MARGIN.
 */
export function rankLines<T extends { sourceId: string; adIntro: boolean }>(
  lines: T[],
  local: Record<string, LineStats>,
  global: Record<string, LineStats>,
): T[] {
  const scored = lines.map((line) => ({
    line,
    score: smoothedRate(local[line.sourceId], global[line.sourceId]) - (line.adIntro ? AD_PENALTY : 0),
  }));
  const ranked: T[] = [];
  while (scored.length > 0) {
    let pick = 0;
    for (let i = 1; i < scored.length; i++) if (scored[i].score - scored[pick].score >= MARGIN) pick = i;
    ranked.push(scored.splice(pick, 1)[0].line);
  }
  return ranked;
}
