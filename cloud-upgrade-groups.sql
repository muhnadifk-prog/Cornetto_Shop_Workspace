begin;
create or replace function public.cornetto_save_workspace_v1(
  p_expected_revision bigint, p_operation uuid, p_data jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  current_row public.cornetto_workspace_v1%rowtype;
begin
  if uid is null then raise exception 'LOGIN_REQUIRED' using errcode='42501'; end if;
  if p_operation is null or p_expected_revision is null or p_expected_revision < 0
    or p_data is null or p_data->>'app' is distinct from 'cornetto-workspace'
    or coalesce(p_data->>'version','') not in ('1','2')
    or (p_data->>'version' = '2' and jsonb_typeof(p_data->'cardGroups') is distinct from 'array')
    or jsonb_typeof(p_data->'inventory') is distinct from 'array'
    or jsonb_typeof(p_data->'sales') is distinct from 'array'
    or octet_length(p_data::text) > 41943040 then
    raise exception 'INVALID_WORKSPACE' using errcode='22023';
  end if;
  if p_expected_revision = 0 then
    insert into public.cornetto_workspace_v1(user_id, revision, data, last_operation)
    values(uid, 1, p_data, p_operation) on conflict (user_id) do nothing;
  end if;
  select * into current_row from public.cornetto_workspace_v1 where user_id=uid for update;
  if not found then raise exception 'CLOUD_CONFLICT' using errcode='40001'; end if;
  if current_row.last_operation = p_operation then
    return jsonb_build_object('revision', current_row.revision, 'updated_at', current_row.updated_at);
  end if;
  if current_row.data->>'version' = '2' and p_data->>'version' = '1' then
    raise exception 'UPGRADE_REQUIRED' using errcode='22023';
  end if;
  if current_row.revision <> p_expected_revision then
    raise exception 'CLOUD_CONFLICT' using errcode='40001';
  end if;
  update public.cornetto_workspace_v1
    set previous_data=data, data=p_data, revision=revision+1,
        last_operation=p_operation, updated_at=now()
    where user_id=uid returning * into current_row;
  return jsonb_build_object('revision',current_row.revision,'updated_at',current_row.updated_at);
end;
$$;

commit;

