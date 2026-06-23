alter table offchain_canvas enable row level security;

-- Lecture publique pour tout le monde
create policy "Public read access"
on offchain_canvas
for select
to anon, authenticated
using (true);

-- Pas de policy INSERT/UPDATE/DELETE pour anon/authenticated
-- → seule la service_role key (Edge Function) peut écrire, car elle bypass RLS