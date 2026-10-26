create table public.fitness_records (
 user_id uuid not null references auth.users(id) on delete cascade,
 key text not null check (length(key) between 1 and 240),
 value jsonb not null check (jsonb_typeof(value) = 'object'),
 version integer not null default 1,
 updated_at timestamptz not null default now(),
 primary key (user_id,key)
);
alter table public.fitness_records enable row level security;
revoke all on public.fitness_records from anon;
grant select,insert,update,delete on public.fitness_records to authenticated;
create policy records_select on public.fitness_records for select to authenticated using ((select auth.uid()) = user_id);
create policy records_insert on public.fitness_records for insert to authenticated with check ((select auth.uid()) = user_id);
create policy records_update on public.fitness_records for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy records_delete on public.fitness_records for delete to authenticated using ((select auth.uid()) = user_id);
create function public.save_fitness_record(record_key text, record_value jsonb, expected_version integer)
returns public.fitness_records language plpgsql security invoker set search_path = '' as $$
declare result public.fitness_records;
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
 if expected_version = 0 then
  insert into public.fitness_records(user_id,key,value) values(auth.uid(),record_key,record_value)
  on conflict do nothing returning * into result;
 else
  update public.fitness_records set value=record_value, version=version+1, updated_at=now()
  where user_id=auth.uid() and key=record_key and version=expected_version returning * into result;
 end if;
 if result.user_id is null then raise exception 'VERSION_CONFLICT'; end if;
 return result;
end;
$$;
revoke execute on function public.save_fitness_record(text,jsonb,integer) from public, anon;
grant execute on function public.save_fitness_record(text,jsonb,integer) to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fitness-private','fitness-private',false,20971520,array['image/jpeg','image/png','image/webp','video/mp4','video/webm']);
create policy fitness_files_select on storage.objects for select to authenticated using(bucket_id='fitness-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy fitness_files_insert on storage.objects for insert to authenticated with check(bucket_id='fitness-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy fitness_files_update on storage.objects for update to authenticated using(bucket_id='fitness-private' and (storage.foldername(name))[1]=(select auth.uid())::text) with check(bucket_id='fitness-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy fitness_files_delete on storage.objects for delete to authenticated using(bucket_id='fitness-private' and (storage.foldername(name))[1]=(select auth.uid())::text);
