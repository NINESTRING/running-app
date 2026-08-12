-- 러닝 총 걸음 수. null = 측정 안 됨 (권한 거부·미지원 기기), 0과 구분.
alter table public.runs add column steps integer check (steps >= 0);

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
  steps,
  created_at
from public.runs;
