alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists main_photo_id uuid;

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  position smallint not null default 0,
  mime varchar(30) not null,
  bytes int not null,
  data bytea not null,
  created_at timestamptz not null default now(),
  unique (user_id, position)
);

create index if not exists photos_user_idx on public.photos (user_id, position);

create or replace function app.replace_photo() returns trigger language plpgsql as $fn$
begin
  delete from public.photos where user_id = new.user_id and position = new.position and id <> new.id;
  return new;
end;
$fn$;

drop trigger if exists photos_replace on public.photos;
create trigger photos_replace before insert on public.photos for each row execute function app.replace_photo();

create table if not exists public.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
insert into public.schema_migrations (version) values ('v3.1-comptes-photos') on conflict (version) do nothing;
