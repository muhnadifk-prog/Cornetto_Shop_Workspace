begin;

create extension if not exists pg_cron with schema pg_catalog;

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
    or coalesce(p_data->>'version','') not in ('1','2','3','4')
    or (p_data->>'version' in ('2','3','4') and jsonb_typeof(p_data->'cardGroups') is distinct from 'array')
    or (p_data->>'version' = '4' and p_data->'migration' ? 'installmentImport'
        and jsonb_typeof(p_data#>'{migration,installmentImport,rows}') is distinct from 'array')
    or jsonb_typeof(p_data->'inventory') is distinct from 'array'
    or jsonb_typeof(p_data->'sales') is distinct from 'array'
    or jsonb_typeof(p_data->'cardCharges') is distinct from 'array'
    or jsonb_typeof(p_data->'cardPayments') is distinct from 'array'
    or jsonb_typeof(p_data->'ledger') is distinct from 'array'
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
  if (current_row.data->>'version')::integer > (p_data->>'version')::integer then
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

create or replace function public.cornetto_apply_due_installments_v4(
  p_data jsonb, p_as_of date
) returns jsonb language plpgsql set search_path = '' as $$
declare
  result_data jsonb := p_data;
  charges jsonb := coalesce(p_data->'cardCharges','[]'::jsonb);
  payments jsonb := coalesce(p_data->'cardPayments','[]'::jsonb);
  book jsonb := coalesce(p_data->'ledger','[]'::jsonb);
  charge_item jsonb;
  row_item jsonb;
  skipped boolean;
  charge_id text;
  card_id text;
  row_number integer;
  row_total numeric;
  paid_total numeric;
  remaining numeric;
  payment_id text;
  added integer := 0;
begin
  if p_data->>'app' is distinct from 'cornetto-workspace' or p_data->>'version' is distinct from '4'
     or jsonb_typeof(charges) is distinct from 'array' or jsonb_typeof(payments) is distinct from 'array'
     or jsonb_typeof(book) is distinct from 'array' then
    return jsonb_build_object('data',p_data,'added',0);
  end if;
  for charge_item in select value from pg_catalog.jsonb_array_elements(charges) loop
    if coalesce(charge_item->>'autoPost','false') <> 'true'
       or jsonb_typeof(charge_item#>'{installment,schedule}') is distinct from 'array' then continue; end if;
    charge_id := charge_item->>'id'; card_id := charge_item->>'cardId';
    if charge_id is null or card_id is null then continue; end if;
    for row_item in select value from pg_catalog.jsonb_array_elements(charge_item#>'{installment,schedule}') loop
      if jsonb_typeof(row_item->'number') is distinct from 'number'
         or jsonb_typeof(row_item->'principal') is distinct from 'number'
         or jsonb_typeof(row_item->'interest') is distinct from 'number'
         or jsonb_typeof(row_item->'admin') is distinct from 'number'
         or coalesce(row_item->>'dueDate','') !~ '^\d{4}-\d{2}-\d{2}$'
         or (row_item->>'dueDate')::date > p_as_of then continue; end if;
      row_number := (row_item->>'number')::integer;
      select exists(select 1 from pg_catalog.jsonb_array_elements_text(coalesce(charge_item->'autoSkip','[]'::jsonb)) x where x ~ '^\d+$' and x::integer=row_number) into skipped;
      if skipped then continue; end if;
      row_total := round(((row_item->>'principal')::numeric+(row_item->>'interest')::numeric+(row_item->>'admin')::numeric),2);
      select coalesce(sum((x->>'amount')::numeric),0) into paid_total
        from pg_catalog.jsonb_array_elements(payments) x
        where x->>'installmentChargeId'=charge_id and coalesce(x->>'installmentNumber','') ~ '^\d+$'
          and (x->>'installmentNumber')::integer=row_number and jsonb_typeof(x->'amount')='number';
      remaining := round(row_total-paid_total,2);
      if remaining <= 0 then continue; end if;
      payment_id := 'auto-'||charge_id||'-'||row_number;
      if exists(select 1 from pg_catalog.jsonb_array_elements(payments) x where x->>'id'=payment_id) then continue; end if;
      payments := payments || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id',payment_id,'cardId',card_id,'installmentChargeId',charge_id,'installmentNumber',row_number,
        'amount',remaining,'date',row_item->>'dueDate',
        'note','Catatan otomatis berdasarkan asumsi pemilik; bukan konfirmasi bank.',
        'source','auto-installment','assumption',true
      ));
      book := book || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id','ledger-'||payment_id,'date',row_item->>'dueDate','type','bayar','amount',remaining,
        'note','Pembayaran cicilan otomatis / asumsi pemilik','cardId',card_id,'chargeId',charge_id,
        'paymentId',payment_id,'source','auto-installment','assumption',true
      ));
      added := added+1;
    end loop;
  end loop;
  result_data := pg_catalog.jsonb_set(result_data,'{cardPayments}',payments,false);
  result_data := pg_catalog.jsonb_set(result_data,'{ledger}',book,false);
  return pg_catalog.jsonb_build_object('data',result_data,'added',added);
end;
$$;

create or replace function public.cornetto_process_due_installments_v4()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  workspace_row public.cornetto_workspace_v1%rowtype;
  processed jsonb;
  changed integer := 0;
begin
  for workspace_row in
    select * from public.cornetto_workspace_v1
    where data->>'version'='4'
    for update skip locked
  loop
    processed := public.cornetto_apply_due_installments_v4(workspace_row.data,(pg_catalog.now() at time zone 'Asia/Jakarta')::date);
    if (processed->>'added')::integer > 0 then
      update public.cornetto_workspace_v1
      set previous_data=data, data=processed->'data', revision=revision+1,
          last_operation=pg_catalog.gen_random_uuid(), updated_at=pg_catalog.now()
      where user_id=workspace_row.user_id;
      changed := changed+(processed->>'added')::integer;
    end if;
  end loop;
  return changed;
end;
$$;

revoke all on function public.cornetto_apply_due_installments_v4(jsonb,date) from public, anon, authenticated;
revoke all on function public.cornetto_process_due_installments_v4() from public, anon, authenticated;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='cornetto-installments-hourly';
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
end;
$$;

select cron.schedule(
  'cornetto-installments-hourly',
  '5 * * * *',
  'select public.cornetto_process_due_installments_v4();'
);

commit;

