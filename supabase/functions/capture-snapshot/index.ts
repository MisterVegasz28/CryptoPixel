import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CANVAS_W = 32000;
const CANVAS_H = 31250;
// Taille max de la grille de sortie (largeur ou hauteur) — 256 donne un
// aperçu largement suffisant pour un timelapse, tout en gardant le JSON
// stocké petit (~65k cellules max).
const GRID_MAX_DIM = 256;
const PAGE_SIZE = 5000;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const blockSize = Math.ceil(Math.max(CANVAS_W, CANVAS_H) / GRID_MAX_DIM);
    const gridW = Math.ceil(CANVAS_W / blockSize);
    const gridH = Math.ceil(CANVAS_H / blockSize);
    const grid: (string | null)[] = new Array(gridW * gridH).fill(null);

   // On capture les DEUX couches pour un timelapse plus vivant :
    // - offchain_canvas (painté, éphémère) donne le mouvement/changement
    // - frozen_tiles (permanent) est appliqué EN DERNIER pour écraser
    //   les blocs déjà freezés, cohérent avec le rendu du canvas live
    //   dans PixelCanvas.tsx où le frozen prime toujours sur le painted.
    // Les deux tables partagent les mêmes noms de colonnes (x, y, color),
    // donc on fixe la chaîne .select() en dur plutôt que de la construire
    // dynamiquement — ça permet à supabase-js de typer correctement le
    // retour (une string interpolée casse son parsing au niveau des types).
    const paintTables = ['offchain_canvas', 'frozen_tiles'] as const;

    for (const table of paintTables) {
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from(table)
          .select('x, y, color')
          .range(from, from + PAGE_SIZE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;

        for (const row of data) {
          const bx = Math.floor(row.x / blockSize);
          const by = Math.floor(row.y / blockSize);
          // Dernière couleur vue dans le bloc — approximation simple et
          // rapide, suffisante pour un aperçu low-res (pas besoin d'une
          // vraie moyenne pondérée pour un timelapse).
          grid[by * gridW + bx] = row.color;
        }

        if (data.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
    }

    const { error: insertError } = await supabase
      .from('canvas_snapshots')
      .insert({ grid_w: gridW, grid_h: gridH, block_size: blockSize, data: grid });
    if (insertError) throw insertError;

    return new Response(
      JSON.stringify({ success: true, gridW, gridH, blockSize }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('capture-snapshot error', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});