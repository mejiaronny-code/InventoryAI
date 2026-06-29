-- ============================================================
-- 010_realtime_publication.sql
-- Asegura que las tablas que el frontend escucha por Supabase Realtime
-- estén en la publicación `supabase_realtime`. Sin esto, los cambios
-- nunca llegan en vivo (hay que recargar para verlos).
--
-- Re-ejecutable: solo agrega la tabla si aún no está en la publicación.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'bookings'
  ) then
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;
