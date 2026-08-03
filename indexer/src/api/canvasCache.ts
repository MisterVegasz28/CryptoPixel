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

// FIX (audit RAM) — ownerTiles/addressBook/addressList retirés. L'ancien
// design stockait un Uint32Array (4 octets/pixel) par tuile ACTIVE pour
// répondre à UNE seule question : "ce pixel m'appartient-il, à MOI qui
// fais la requête ?" (bit isOwner du binaire /canvas-slice-binary).
// Coût : jusqu'à ~4 Go rien que pour ce poste si les ~15 375 tuiles du
// canvas finissent toutes touchées (ce qui arrive vite : la dispersion
// normale des joueurs sature la quasi-totalité des tuiles bien avant que
// le canvas soit rempli — cf. "collectionneur de coupons", pas besoin
// d'un remplissage à 50%). Sur un plan à RAM fixe (Railway hobby, 8 Go),
// c'était le principal risque d'OOM du projet.
//
// Nouveau design : "qui possède quoi" n'est plus dérivé du cache global —
// il est recalculé par requête, borné par CE QUE POSSÈDE le compte
// demandeur (quelques dizaines à quelques milliers d'ids), jamais par la
// taille du canvas. Voir getOwnedIds() dans index.ts (cache TTL 5s par
// adresse, un aller-retour DB au pire par utilisateur actif toutes les 5s,
// pas par pixel).
//
// Gain : ~5 octets/pixel touché -> ~1 octet/pixel touché, soit ~80% de RAM
// en moins sur le pire cas (canvas entièrement touché : ~5 Go -> ~1 Go).

export function clearCache() {
  tiles.clear();
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

export function setPixel(x: number, y: number, colorIndex: number, isFrozen: boolean) {
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
}

export function getPixel(x: number, y: number): { colorIndex: number; isFrozen: boolean } | null {
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  const tile = tiles.get(tileKey(tx, ty));
  if (!tile) return null;
  const localX = x % TILE_SIZE;
  const localY = y % TILE_SIZE;
  const offset = localY * TILE_SIZE + localX;
  const byte = tile[offset];
  if (!(byte & PAINTED_FLAG)) return null;

  return {
    colorIndex: byte & COLOR_MASK,
    isFrozen: !!(byte & FROZEN_FLAG),
  };
}

// `ownedIds` : ensemble des ids ("x-y") possédés par le compte demandeur,
// calculé et mis en cache à l'appelant (voir getOwnedIds() dans index.ts) —
// sliceRegion reste synchrone et pure, aucun accès DB ici.
export function sliceRegion(startX: number, startY: number, w: number, h: number, ownedIds: Set<string> | null): Buffer {
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
          const isOwner = !!ownedIds && ownedIds.has(`${x}-${y}`);

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
  return { activeTiles: tiles.size, maxTiles: TILES_X * TILES_Y };
}