-- 앱 버전 이력: 설정 페이지의 버전 비교·변경 사항 표시에 사용
create table public.app_versions (
  version text primary key,
  notes text not null,
  released_at timestamptz not null default now()
);

alter table public.app_versions enable row level security;

-- 버전 정보는 공개 데이터 — 로그인 전(anon)에도 조회 가능해야 배지 표시가 로그인 완료를 기다리지 않음
create policy "누구나 버전 조회" on public.app_versions
  for select to anon, authenticated using (true);

-- insert/update/delete 정책 없음: 버전 등록은 마이그레이션 또는 대시보드(service role)에서만

-- E'...' 문자열이라야 \n이 실제 줄바꿈으로 저장됨 (일반 '...'에서는 문자 그대로 저장)
insert into public.app_versions (version, notes) values
  ('1.0.0', E'첫 릴리스\n- 러닝 기록·지도·통계\n- 익명/구글 로그인');
