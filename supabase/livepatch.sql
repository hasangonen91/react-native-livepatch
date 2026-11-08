-- react-native-livepatch: Supabase backend
-- Run once (SQL editor or as a migration). Safe to run again.
--
-- Tables are not readable by clients (RLS on, no policies). Apps only call the
-- two SECURITY DEFINER functions below with the anon key. The CLI writes with
-- the service role key.

create table if not exists public.livepatch_releases (
  id            uuid primary key,
  created_at    timestamptz not null default now(),
  platform      text not null check (platform in ('ios', 'android')),
  app_version   text not null,                 -- native version the bundle was built for, e.g. 3.1.1
  channel       text not null default 'production',
  bundle_path   text not null,                 -- e.g. main.jsbundle
  files         jsonb not null,                -- [{ "path": "...", "sha256": "...", "size": 123 }]
  total_size    bigint not null default 0,
  mandatory     boolean not null default false,
  rollout       smallint not null default 100 check (rollout between 0 and 100),
  enabled       boolean not null default true,
  message       text,
  git_commit    text,
  created_by    text
);

create index if not exists livepatch_releases_lookup
  on public.livepatch_releases (platform, app_version, channel, created_at desc);

create table if not exists public.livepatch_events (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  release_id  uuid not null,
  event       text not null check (event in ('installed', 'rolled_back', 'download_failed')),
  platform    text,
  app_version text,
  channel     text,
  device_id   text,
  message     text
);

create index if not exists livepatch_events_release on public.livepatch_events (release_id, event);

alter table public.livepatch_releases enable row level security;
alter table public.livepatch_events enable row level security;

-- Which release should this device run?
-- Returns {"status":"up_to_date"} | {"status":"rollback"} | {"status":"update","release":{...}}
create or replace function public.livepatch_check(
  p_platform    text,
  p_app_version text,
  p_channel     text,
  p_bundle_id   uuid,
  p_device_id   text
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  r            public.livepatch_releases;
  current_at   timestamptz;
  is_mandatory boolean;
begin
  -- Newest enabled release for this binary that includes this device in its rollout.
  select * into r
    from public.livepatch_releases rel
   where rel.platform = p_platform
     and rel.app_version = p_app_version
     and rel.channel = coalesce(p_channel, 'production')
     and rel.enabled
     and (
       rel.rollout >= 100
       or ((hashtext(rel.id::text || coalesce(p_device_id, ''))::bigint % 100 + 100) % 100) < rel.rollout
       or rel.id = p_bundle_id
     )
   order by rel.created_at desc
   limit 1;

  if r.id is null then
    if p_bundle_id is not null then
      -- Device runs an OTA bundle that is no longer enabled: back to the store bundle.
      return jsonb_build_object('status', 'rollback');
    end if;
    return jsonb_build_object('status', 'up_to_date');
  end if;

  if r.id = p_bundle_id then
    return jsonb_build_object('status', 'up_to_date');
  end if;

  -- Mandatory if any enabled mandatory release was published after the running one.
  select created_at into current_at from public.livepatch_releases where id = p_bundle_id;
  select r.mandatory or exists (
           select 1 from public.livepatch_releases m
            where m.platform = r.platform
              and m.app_version = r.app_version
              and m.channel = r.channel
              and m.enabled
              and m.mandatory
              and m.created_at > coalesce(current_at, '-infinity'::timestamptz)
              and m.created_at <= r.created_at
         )
    into is_mandatory;

  return jsonb_build_object(
    'status', 'update',
    'release', jsonb_build_object(
      'id', r.id,
      'bundlePath', r.bundle_path,
      'files', r.files,
      'mandatory', is_mandatory,
      'message', r.message,
      'size', r.total_size,
      'createdAt', r.created_at
    )
  );
end;
$$;

-- Install / rollback / download failure statistics.
create or replace function public.livepatch_report(
  p_release_id  uuid,
  p_event       text,
  p_platform    text default null,
  p_app_version text default null,
  p_channel     text default null,
  p_device_id   text default null,
  p_message     text default null
) returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  if p_event not in ('installed', 'rolled_back', 'download_failed') then
    return;
  end if;
  if not exists (select 1 from public.livepatch_releases where id = p_release_id) then
    return;
  end if;
  insert into public.livepatch_events (release_id, event, platform, app_version, channel, device_id, message)
  values (p_release_id, p_event, left(p_platform, 16), left(p_app_version, 32), left(p_channel, 64),
          left(p_device_id, 64), left(p_message, 500));
end;
$$;

revoke all on function public.livepatch_check(text, text, text, uuid, text) from public;
revoke all on function public.livepatch_report(uuid, text, text, text, text, text, text) from public;
grant execute on function public.livepatch_check(text, text, text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.livepatch_report(uuid, text, text, text, text, text, text) to anon, authenticated, service_role;

-- Per-release statistics for the CLI (`livepatch list`).
create or replace view public.livepatch_release_stats
with (security_invoker = true) as
select r.id, r.created_at, r.platform, r.app_version, r.channel, r.enabled, r.mandatory, r.rollout,
       r.message, r.total_size, r.git_commit,
       count(*) filter (where e.event = 'installed')       as installs,
       count(*) filter (where e.event = 'rolled_back')     as rollbacks,
       count(*) filter (where e.event = 'download_failed') as download_failures
  from public.livepatch_releases r
  left join public.livepatch_events e on e.release_id = r.id
 group by r.id;

revoke all on public.livepatch_release_stats from anon, authenticated;

-- Public bucket for release files. Files are stored by sha256 (files/<sha256>),
-- so identical assets are uploaded once and can be cached forever.
insert into storage.buckets (id, name, public)
values ('livepatch', 'livepatch', true)
on conflict (id) do update set public = true;
