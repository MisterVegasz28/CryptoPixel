const TILE_SIZE = 256;
const CANVAS_W = Number(process.env.CANVAS_WIDTH ?? 32000);
const CANVAS_H = 31250;
const TILES_X = Math.ceil(CANVAS_W / TILE_SIZE);
const TILES_Y = Math.ceil(CANVAS_H / TILE_SIZE);

// Un octet par pixel : bit 6 = painted, bit 5 = frozen, bits 0-4 = index couleur (0-31)
const PAINTED_FLAG = 1 << 6; // 0x40
const FROZEN_FLAG = 1 << 5;  // 0x20
const COLOR_MASK = 0x1f;

// tiles: clé = tx * TILES_Y + ty -> Uint8Array(TILE_SIZE*TILE_SIZE), allouée à la 1ère écriture
const tiles = new Map<number, Uint8Array>();

// owners: clé numérique x * CANVAS_H + y -> adresse. Évite l'allocation de string
// `${x}-${y}` à chaque lookup, coûteuse quand on itère des centaines de milliers
// de pixels dans sliceRegion.
const owners = new Map<number, string>();

// dans canvaCache.ts
export function clearCache() {
  tiles.clear();
  owners.clear();
}

function tileKey(tx: number, ty: number): number {
  return tx * TILES_Y + ty;
}

function ownerKey(x: number, y: number): number {
  return x * CANVAS_H + y;
}

function getOrCreateTile(tx: number, ty: number): Uint8Array {
  const key = tileKey(tx, ty);
  let tile = tiles.get(key);
  if (!tile) {
    tile = new Uint8Array(TILE_SIZE * TILE_SIZE);
    tiles.set(key, tile);
  }
  return tile;
}

export function setPixel(x: number, y: number, colorIndex: number, isFrozen: boolean, owner: string) {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  const tile = getOrCreateTile(tx, ty);
  const localX = x % TILE_SIZE;
  const localY = y % TILE_SIZE;
  const offset = localY * TILE_SIZE + localX;

  const existing = tile[offset];
  // Un pixel déjà frozen ne doit jamais être écrasé par un paint non-frozen
  if ((existing & PAINTED_FLAG) && (existing & FROZEN_FLAG) && !isFrozen) {
    return;
  }

  tile[offset] = PAINTED_FLAG | (isFrozen ? FROZEN_FLAG : 0) | (colorIndex & COLOR_MASK);
  owners.set(ownerKey(x, y), (owner ?? '').toLowerCase());
}

// Vide une case (purge offchain_canvas). Ne touche jamais un pixel frozen.
export function clearPixel(x: number, y: number) {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  const tile = tiles.get(tileKey(tx, ty));
  if (!tile) return;
  const localX = x % TILE_SIZE;
  const localY = y % TILE_SIZE;
  const offset = localY * TILE_SIZE + localX;

  if (tile[offset] & FROZEN_FLAG) return;

  tile[offset] = 0;
  owners.delete(ownerKey(x, y));
}

export function getPixel(x: number, y: number): { colorIndex: number; isFrozen: boolean; owner: string } | null {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  const tile = tiles.get(tileKey(tx, ty));
  if (!tile) return null;
  const localX = x % TILE_SIZE;
  const localY = y % TILE_SIZE;
  const byte = tile[localY * TILE_SIZE + localX];
  if (!(byte & PAINTED_FLAG)) return null;
  return {
    colorIndex: byte & COLOR_MASK,
    isFrozen: !!(byte & FROZEN_FLAG),
    owner: owners.get(ownerKey(x, y)) ?? '',
  };
}

export function sliceRegion(startX: number, startY: number, w: number, h: number, account: string): Buffer {
  const accountLower = (account ?? '').toLowerCase();

  const tileStartX = Math.floor(startX / TILE_SIZE);
  const tileEndX = Math.floor((startX + w - 1) / TILE_SIZE);
  const tileStartY = Math.floor(startY / TILE_SIZE);
  const tileEndY = Math.floor((startY + h - 1) / TILE_SIZE);

  // Allocation large (max théorique = tous les pixels de la région),
  // on tronquera avec .subarray() à la fin en fonction de l'offset réel écrit.
  const buffer = Buffer.alloc(w * h * 5);
  let offset = 0;

  for (let tx = tileStartX; tx <= tileEndX; tx++) {
    for (let ty = tileStartY; ty <= tileEndY; ty++) {
      const tile = tiles.get(tileKey(tx, ty));
      if (!tile) continue;

      const baseX = tx * TILE_SIZE;
      const baseY = ty * TILE_SIZE;
      const loX = Math.max(startX, baseX);
      const hiX = Math.min(startX + w, baseX + TILE_SIZE);
      const loY = Math.max(startY, baseY);
      const hiY = Math.min(startY + h, baseY + TILE_SIZE);

      for (let y = loY; y < hiY; y++) {
        const rowOffset = (y - baseY) * TILE_SIZE;
        for (let x = loX; x < hiX; x++) {
          const byte = tile[rowOffset + (x - baseX)];
          if (!(byte & PAINTED_FLAG)) continue;

          const isFrozen = !!(byte & FROZEN_FLAG);
          const colorIndex = byte & COLOR_MASK;
          let isOwner = false;
          if (accountLower) {
            const owner = owners.get(ownerKey(x, y));
            isOwner = owner === accountLower;
          }

          buffer.writeUInt16LE(x, offset);
          buffer.writeUInt16LE(y, offset + 2);
          buffer.writeUInt8(colorIndex | (isFrozen ? 1 << 5 : 0) | (isOwner ? 1 << 6 : 0), offset + 4);
          offset += 5;
        }
      }
    }
  }

  return buffer.subarray(0, offset);
}

export function tileStats() {
  return { activeTiles: tiles.size, maxTiles: TILES_X * TILES_Y, ownersTracked: owners.size };
}