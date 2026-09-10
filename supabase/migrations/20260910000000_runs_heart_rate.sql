-- 러닝 구간 심박. null = 미조회·데이터 없음·구버전 기록. 기록 탭·상세에서 lazy 백필된다.
-- heart_rate_samples: [[started_at 기준 벽시계 경과초, bpm], ...] — 10초 버킷 평균, 시간 오름차순.
-- avg_hr·max_hr는 버킷 평균이 아닌 원본 샘플 기준 정수.
alter table public.runs add column heart_rate_samples jsonb;
alter table public.runs add column avg_hr smallint
  check (avg_hr between 30 and 250);
alter table public.runs add column max_hr smallint
  check (max_hr between 30 and 250);
-- 세 컬럼은 함께 기록되거나 함께 null (원자적 기록)
alter table public.runs add constraint runs_heart_rate_atomic
  check ((heart_rate_samples is null) = (avg_hr is null)
     and (avg_hr is null) = (max_hr is null));

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
  heart_rate_samples,
  avg_hr,
  max_hr,
  created_at
from public.runs;
