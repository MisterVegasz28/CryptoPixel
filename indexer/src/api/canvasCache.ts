const TILE_SIZE = 256;
const CANVAS_W = Number(process.env.CANVAS_WIDTH ?? 32000);
const CANVAS_H = 31250;
const TILES_X = Math.ceil(CANVAS_W / TILE_SIZE);
const TILES_Y = Math.ceil(CANVAS_H / TILE_SIZE);

// Un octet par pixel : bit 6 = painted, bit 5 = frozen, bits 0-4 = index couleur (0-31)
const PAINTED_FLAG = 1 << 6;
const FROZEN_FLAG = 1 << 5;
const COLOR_MASK = 0x1f;

const tiles = new Map<number, Uint8Array>();

const addressBook = new Map<string, number>(); // adresse (lowercase) -> id interne
const addressList: string[] = [];              // id interne -> adresse (index 0 = id 1)

// Uint32Array par tuile (256*256*4 = 256 Ko/tuile, allouée seulement à la
// 1ère écriture) plutôt qu'un Map<number,string> global : le coût mémoire
// réel devient proportionnel au nombre de tuiles *actives*, pas au canvas entier.
const ownerTiles = new Map<number, Uint32Array>();

function getOrCreateOwnerId(owner: string): number {
  const addr = (owner ?? '').toLowerCase();
  if (!addr) return 0;
  const existing = addressBook.get(addr);
  if (existing !== undefined) return existing;
  addressList.push(addr);
  const id = addressList.length; // 1-based
  addressBook.set(addr, id);
  return id;
}

function idToAddress(id: number): string {
  if (id === 0) return '';
  return addressList[id - 1] ?? '';
}

export function clearCache() {
  tiles.clear();
  ownerTiles.clear();
  addressBook.clear();
  addressList.length = 0;
}

function tileKey(tx: number, ty: number): number {
  return tx * TILES_Y + ty;
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

function getOrCreateOwnerTile(tx: number, ty: number): Uint32Array {
  const key = tileKey(tx, ty);
  let tile = ownerTiles.get(key);
  if (!tile) {
    tile = new Uint32Array(TILE_SIZE * TILE_SIZE);
    ownerTiles.set(key, tile);
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
  if ((existing & PAINTED_FLAG) && (existing & FROZEN_FLAG) && !isFrozen) {
    return; // un pixel frozen ne doit jamais être écrasé par un paint non-frozen
  }

  tile[offset] = PAINTED_FLAG | (isFrozen ? FROZEN_FLAG : 0) | (colorIndex & COLOR_MASK);

  const ownerTile = getOrCreateOwnerTile(tx, ty);
  ownerTile[offset] = getOrCreateOwnerId(owner);
}

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
  const ownerTile = ownerTiles.get(tileKey(tx, ty));
  if (ownerTile) ownerTile[offset] = 0;
}

export function getPixel(x: number, y: number): { colorIndex: number; isFrozen: boolean; owner: string } | null {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  const tile = tiles.get(tileKey(tx, ty));
  if (!tile) return null;
  const localX = x % TILE_SIZE;
  const localY = y % TILE_SIZE;
  const offset = localY * TILE_SIZE + localX;
  const byte = tile[offset];
  if (!(byte & PAINTED_FLAG)) return null;

  const ownerTile = ownerTiles.get(tileKey(tx, ty));
  const ownerId = ownerTile ? ownerTile[offset] : 0;

  return {
    colorIndex: byte & COLOR_MASK,
    isFrozen: !!(byte & FROZEN_FLAG),
    owner: idToAddress(ownerId),
  };
}

export function sliceRegion(startX: number, startY: number, w: number, h: number, account: string): Buffer {
  const accountLower = (account ?? '').toLowerCase();
  const accountId = accountLower ? addressBook.get(accountLower) ?? -1 : -1;

  const tileStartX = Math.floor(startX / TILE_SIZE);
  const tileEndX = Math.floor((startX + w - 1) / TILE_SIZE);
  const tileStartY = Math.floor(startY / TILE_SIZE);
  const tileEndY = Math.floor((startY + h - 1) / TILE_SIZE);

  const buffer = Buffer.alloc(w * h * 5);
  let offset = 0;

  for (let tx = tileStartX; tx <= tileEndX; tx++) {
    for (let ty = tileStartY; ty <= tileEndY; ty++) {
      const key = tileKey(tx, ty);
      const tile = tiles.get(key);
      if (!tile) continue;
      const ownerTile = ownerTiles.get(key);

      const baseX = tx * TILE_SIZE;
      const baseY = ty * TILE_SIZE;
      const loX = Math.max(startX, baseX);
      const hiX = Math.min(startX + w, baseX + TILE_SIZE);
      const loY = Math.max(startY, baseY);
      const hiY = Math.min(startY + h, baseY + TILE_SIZE);

      for (let y = loY; y < hiY; y++) {
        const rowOffset = (y - baseY) * TILE_SIZE;
        for (let x = loX; x < hiX; x++) {
          const localOffset = rowOffset + (x - baseX);
          const byte = tile[localOffset];
          if (!(byte & PAINTED_FLAG)) continue;

          const isFrozen = !!(byte & FROZEN_FLAG);
          const colorIndex = byte & COLOR_MASK;
          const ownerId = ownerTile ? ownerTile[localOffset] : 0;
          const isOwner = accountId !== -1 && ownerId === accountId;

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
  return { activeTiles: tiles.size, maxTiles: TILES_X * TILES_Y, ownersTracked: addressList.length };
}