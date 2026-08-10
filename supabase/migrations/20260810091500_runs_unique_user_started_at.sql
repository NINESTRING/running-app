-- 같은 러닝(동일 사용자·시작 시각)의 중복 저장을 DB 차원에서 차단
alter table public.runs
  add constraint runs_user_id_started_at_key unique (user_id, started_at);
