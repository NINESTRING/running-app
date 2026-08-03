-- PostGIS 확장 (Supabase 대시보드 Extensions에서도 활성화 가능)
create extension if not exists postgis;

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id),
  started_at timestamptz not null,
  duration_sec integer not null check (duration_sec >= 0),
  distance_m double precision not null check (distance_m >= 0),
  route geography (linestring, 4326),
  created_at timestamptz not null default now()
);

alter table public.runs enable row level security;

create policy "본인 기록 조회" on public.runs
  for select using (auth.uid() = user_id);

create policy "본인 기록 생성" on public.runs
  for insert with check (auth.uid() = user_id);

create policy "본인 기록 수정" on public.runs
  for update using (auth.uid() = user_id);

create policy "본인 기록 삭제" on public.runs
  for delete using (auth.uid() = user_id);

-- 앱 조회용: route를 GeoJSON 문자열로 변환해 반환
create view public.runs_with_geojson
  with (security_invoker = on) as
select
  id,
  user_id,
  started_at,
  duration_sec,
  distance_m,
  st_asgeojson(route) as route_geojson,
  created_at
from public.runs;
