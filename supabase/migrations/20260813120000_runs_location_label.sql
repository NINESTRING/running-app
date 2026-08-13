-- 러닝 시작 지점 행정구역 라벨 (예: '서울 강남구 서초동').
-- null = 미조회·조회 실패·구버전 기록. 기록 탭에서 lazy 백필된다.
alter table public.runs add column location_label text;

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
  weather_code,
  temperature_c,
  location_label,
  created_at
from public.runs;
