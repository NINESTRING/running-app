-- 원본 GPS 시계열. 세그먼트(일시정지로 나뉜 러닝 구간)별 [t, lat, lng, alt] 튜플 배열:
-- [[[t,lat,lng,alt], ...], ...]. t = epoch ms, alt = 미터(null 가능). null = 구버전 기록.
alter table public.runs add column route_points jsonb;

-- create or replace는 컬럼 순서 제약이 있어 drop 후 재생성 (의존 객체 없음)
drop view public.runs_with_geojson;
create view public.runs_with_geojson
  with (security_invoker = on) as
select
  id,
  user_id,
  started_at,
  duration_sec,
  distance_m,
  extensions.st_asgeojson(route) as route_geojson,
  route_points,
  steps,
  created_at
from public.runs;
