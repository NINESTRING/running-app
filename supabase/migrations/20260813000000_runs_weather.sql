-- 러닝 시작 시점 날씨. null = 조회 실패·구버전 기록.
-- 두 컬럼은 항상 함께 기록되거나 함께 null (원자적 기록).
alter table public.runs add column weather_code smallint
  check (weather_code between 0 and 99);
alter table public.runs add column temperature_c real
  check (temperature_c between -90 and 60);
alter table public.runs add constraint runs_weather_atomic
  check ((weather_code is null) = (temperature_c is null));

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
  created_at
from public.runs;
