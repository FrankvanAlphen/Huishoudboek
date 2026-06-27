import type { Cents } from "./types";

/**
 * Deduplicatie — businessregel:
 * Een transactie krijgt een inhoud-hash over (boekdatum + bedrag + tegenrekening +
 * omschrijving + mutatiesoort), BEWUST zonder volgnummer-in-bestand (dat verschilt
 * tussen overlappende exports). Twee échte identieke boekingen op één dag zijn legitiem;
 * daarom telt een occurrence-index per (hash, dag): de import vergelijkt het aantal
 * voorkomens in het bestand met het al opgeslagen aantal en voegt alleen het verschil toe.
 */

export interface DedupSource {
  /** ISO-datum 'YYYY-MM-DD'. */
  bookingDate: string;
  amountCents: Cents;
  counterpartyIban: string;
  description: string;
  mutationType: string;
}

/** Stabiele, dependency-vrije 32-bit FNV-1a hash → hex string. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime vermenigvuldiging
    hash = Math.imul(hash, 0x01000193);
  }
  // forceer naar unsigned 32-bit en formatteer als 8 hex-tekens
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** Genormaliseerde inhoudssleutel (whitespace genormaliseerd, lowercase). */
export function contentKey(tx: DedupSource): string {
  const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  return [
    tx.bookingDate,
    String(tx.amountCents),
    norm(tx.counterpartyIban),
    norm(tx.description),
    norm(tx.mutationType),
  ].join("|");
}

/** De opgeslagen dedup-hash voor een transactie. */
export function dedupHash(tx: DedupSource): string {
  return fnv1a(contentKey(tx));
}

export interface ReconciledItem<T extends DedupSource> {
  item: T;
  hash: string;
  /** 1-gebaseerde volgorde van dit voorkomen binnen (hash) in dit bestand. */
  occurrence: number;
  /** True wanneer dit voorkomen nog niet in de opslag bestond. */
  isNew: boolean;
}

/**
 * Bepaal per bestand-item de occurrence en of het nieuw is, gegeven het reeds
 * opgeslagen aantal voorkomens per hash. Overlappend importeren telt niet dubbel,
 * en échte duplicaten binnen één bestand blijven behouden.
 */
export function reconcileImport<T extends DedupSource>(
  fileItems: readonly T[],
  existingCountByHash: ReadonlyMap<string, number>,
): ReconciledItem<T>[] {
  const seenInFile = new Map<string, number>();
  const out: ReconciledItem<T>[] = [];
  for (const item of fileItems) {
    const hash = dedupHash(item);
    const occurrence = (seenInFile.get(hash) ?? 0) + 1;
    seenInFile.set(hash, occurrence);
    const existing = existingCountByHash.get(hash) ?? 0;
    out.push({ item, hash, occurrence, isNew: occurrence > existing });
  }
  return out;
}
