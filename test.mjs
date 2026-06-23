import { ethers } from 'ethers';

const SUPABASE_URL = 'https://rkmmnyppiztrwjnftrzx.supabase.co';
const ANON_KEY = 'sb_publishable_Ol9B-eMW5OzPkTyJmeLfJg_IeJxHypi';
const PRIVATE_KEY = '0xf337479d43573e847370598eb4045d011240a288be40eb1b6dd63db9f15f965e'; // wallet de test sans vrais fonds

const wallet = new ethers.Wallet(PRIVATE_KEY);
const address = wallet.address.toLowerCase();

async function paintPixels(pixels) {
  const timestamp = Math.floor(Date.now() / 1000);
  const pixelHash = pixels.map(p => `${p.x},${p.y}:${p.color}`).sort().join(",");
  const message = `CryptoPixel paint\naddress:${address}\npixels:${pixelHash}\nt:${timestamp}`;
  const signature = await wallet.signMessage(message);
  const res = await fetch(`${SUPABASE_URL}/functions/v1/paint-pixels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ address, pixels, signature, timestamp })
  });
  return res.json();
}

// T5.2 — 501 pixels
const tooMany = Array.from({ length: 501 }, (_, i) => ({ x: i % 32000, y: 0, color: '#ff0000' }));
console.log("T5.2 :", await paintPixels(tooMany));

// T5.3 — Pixel hors limites
console.log("T5.3 :", await paintPixels([{ x: 99999, y: 0, color: '#ff0000' }]));

// T5.5 — Solde à 0
console.log("T5.5 :", await paintPixels([{ x: 1, y: 1, color: '#ff0000' }]));