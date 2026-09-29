-- db/tests/test_storage.sql
-- Verification test suite for DB-06: Storage buckets and policies

begin;

do $$
declare
  v_count int;
  v_doc_bucket storage.buckets%rowtype;
  v_page_bucket storage.buckets%rowtype;
  v_model_bucket storage.buckets%rowtype;
  v_failed boolean;
  v_obj_id uuid := 'e0000001-0000-0000-0000-000000000001';
  v_model_obj_id uuid := 'e0000001-0000-0000-0000-000000000002';
  v_read_count int;
begin
  -- 1. Check all three buckets exist
  select * into v_doc_bucket from storage.buckets where id = 'documents';
  if v_doc_bucket.id is null then
    raise exception 'Assertion failed: documents bucket missing';
  end if;
  if v_doc_bucket.public is not false then
    raise exception 'Assertion failed: documents bucket must be private (public=false)';
  end if;
  if v_doc_bucket.file_size_limit <> 26214400 then
    raise exception 'Assertion failed: documents bucket file size limit should be 25MB (26214400), got %', v_doc_bucket.file_size_limit;
  end if;
  if not ('application/pdf' = any(v_doc_bucket.allowed_mime_types)) then
    raise exception 'Assertion failed: documents bucket missing application/pdf in allowed MIME types';
  end if;
  if not ('application/octet-stream' = any(v_doc_bucket.allowed_mime_types)) then
    raise exception 'Assertion failed: documents bucket missing application/octet-stream in allowed MIME types';
  end if;

  select * into v_page_bucket from storage.buckets where id = 'page-images';
  if v_page_bucket.id is null or v_page_bucket.public is not false then
    raise exception 'Assertion failed: page-images bucket missing or not private';
  end if;

  select * into v_model_bucket from storage.buckets where id = 'models';
  if v_model_bucket.id is null or v_model_bucket.public is not false then
    raise exception 'Assertion failed: models bucket missing or not private';
  end if;

  -- 2. Setup mock objects as superuser
  insert into storage.objects (id, bucket_id, name, owner)
  values
    (v_obj_id, 'documents', 'test_doc.pdf', null),
    (v_model_obj_id, 'models', 'l2-stuck_pipe.joblib', null)
  on conflict (id) do nothing;

  -- 3. Simulate authenticated user
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"a0000001-0000-0000-0000-000000000001"}';

  -- Authenticated user can SELECT from 'documents'
  select count(*) into v_read_count from storage.objects where id = v_obj_id;
  if v_read_count <> 1 then
    raise exception 'Assertion failed: authenticated user should be able to select from documents bucket';
  end if;

  -- Authenticated user CANNOT see objects in 'models'
  select count(*) into v_read_count from storage.objects where id = v_model_obj_id;
  if v_read_count <> 0 then
    raise exception 'Assertion failed: authenticated user must not see objects in models bucket';
  end if;

  -- Authenticated user CANNOT insert directly into storage.objects
  v_failed := false;
  begin
    insert into storage.objects (id, bucket_id, name)
    values ('e0000001-0000-0000-0000-000000000003', 'documents', 'unauthorized.pdf');
  exception when others then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'Assertion failed: authenticated user inserting into storage.objects directly must fail RLS';
  end if;
end;
$$;

rollback;
