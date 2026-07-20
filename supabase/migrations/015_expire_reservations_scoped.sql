-- 015_expire_reservations_scoped.sql
-- expire_reservations() expiraba reservas de TODAS las empresas sin filtro —
-- cualquier staff de cualquier empresa que llamara POST /reservations/expire-all
-- expiraba (y disparaba notificaciones falsas) reservas de otras empresas.
-- Se agrega el parámetro obligatorio p_company_id para acotar el efecto.

-- Postgres trata distinta firma de parámetros como función distinta (overload)
-- — se elimina la versión vieja sin parámetros para no dejarla huérfana.
drop function if exists expire_reservations();

create or replace function expire_reservations(p_company_id uuid)
returns void
language plpgsql
as $$
begin
  update reservations
  set status = 'expired', updated_at = now()
  where company_id = p_company_id
    and status in ('pending', 'confirmed')
    and expires_at < now();
end;
$$;
