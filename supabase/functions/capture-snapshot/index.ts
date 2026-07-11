import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from '../_shared/security.ts';

const CANVAS_W = 32000;
const CANVAS_H = 31250;
const GRID_MAX_DIM = 256;
const PAGE_SIZE = 5000;
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET) {
    console.error("CRON_SECRET is not configured");
    return new Response('Unauthorized', { status: 401 });
  }
  if (!timingSafeEqual(req.headers.get('x-cron-secret') ?? '', CRON_SECRET)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const blockSize = Math.ceil(Math.max(CANVAS_W, CANVAS_H) / GRID_MAX_DIM);
    const gridW = Math.ceil(CANVAS_W / blockSize);
    const gridH = Math.ceil(CANVAS_H / blockSize);
    const grid: (string | null)[] = new Array(gridW * gridH).fill(null);

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