-- Ejecutar después de schema.sql en la base Neon dedicada de Turnia.
-- El servidor firma JWT de corta duración. Los visitantes no reciben esos JWT.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'turnia_server') then
    create role turnia_server nologin;
  end if;
end $$;

-- Data API verifica el JWT y adopta su rol con SET ROLE.
grant turnia_server to authenticator;

grant usage on schema public to turnia_server;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'clinics', 'professionals', 'appointment_types', 'schedules', 'patients',
    'appointments', 'conversations', 'tasks', 'waitlist', 'campaigns', 'campaign_recipients'
  ] loop
    execute format('grant select, insert, update, delete on public.%I to turnia_server', table_name);
    if not exists (
      select 1 from pg_policies where schemaname = 'public' and tablename = table_name and policyname = 'turnia_server_access'
    ) then
      execute format('create policy turnia_server_access on public.%I for all to turnia_server using (true) with check (true)', table_name);
    end if;
  end loop;
end $$;
