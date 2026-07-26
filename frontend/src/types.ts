export interface DraftPixel {
  id: string;
  x: number;
  y: number;
  color: string;
}

// Sentinelles : les typed arrays ne supportent que des entiers positifs,
// donc pas de null/undefined direct. 255 est hors de portée de la palette
// (32 couleurs), et 0xFFFFFFFF est la valeur max d'un Uint32.
export const NULL_COLOR = 255;
export const NULL_OWNER = 0xFFFFFFFF;

export interface CanvasData {
  colors: Uint8Array;        // index dans PRESET_COLORS, ou NULL_COLOR si vide
  owners: Uint32Array;       // index dans addressTable, ou NULL_OWNER si vide
  frozen: Uint8Array;        // 0 ou 1
  frozenOwners: Uint32Array;
  // Table d'adresses partagée par interning — chaque adresse distincte n'est
  // stockée qu'une fois, peu importe le nombre de pixels qui la référencent.
  addressTable: string[];
  addressIndex: Map<string, number>;
  startX: number;
  startY: number;
  w: number;
  h: number;
  _v: number;
}

// Retourne l'index de `addr` dans la table partagée, en l'ajoutant si absent.
export function internAddress(
  addressTable: string[],
  addressIndex: Map<string, number>,
  addr: string
): number {
  const existing = addressIndex.get(addr);
  if (existing !== undefined) return existing;
  const idx = addressTable.length;
  addressTable.push(addr);
  addressIndex.set(addr, idx);
  return idx;
}