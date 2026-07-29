export function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  const len = Math.max(ea.length, eb.length, 32); // 32 = plancher, évite toute variation sur des secrets courts
  const pa = new Uint8Array(len);
  const pb = new Uint8Array(len);
  pa.set(ea);
  pb.set(eb);
  let diff = ea.length ^ eb.length; // la différence de longueur participe au résultat sans early-return
  for (let i = 0; i < len; i++) diff |= pa[i] ^ pb[i];
  return diff === 0;
}