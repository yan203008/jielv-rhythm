-- Run this entire file once in Supabase Dashboard → SQL Editor.

create table if not exists public.routine_documents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.routine_documents enable row level security;
alter table public.routine_documents force row level security;
alter table public.routine_documents replica identity full;

revoke all on table public.routine_documents from anon;
grant select, insert, update, delete on table public.routine_documents to authenticated;

drop policy if exists "Users can read their own document" on public.routine_documents;
create policy "Users can read their own document"
on public.routine_documents
for select
to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own document" on public.routine_documents;
create policy "Users can create their own document"
on public.routine_documents
for insert
to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own document" on public.routine_documents;
create policy "Users can update their own document"
on public.routine_documents
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own document" on public.routine_documents;
create policy "Users can delete their own document"
on public.routine_documents
for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.set_routine_document_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_routine_document_updated_at on public.routine_documents;
create trigger set_routine_document_updated_at
before update on public.routine_documents
for each row execute function public.set_routine_document_updated_at();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'routine_documents'
  ) then
    alter publication supabase_realtime add table public.routine_documents;
  end if;
end
$$;
