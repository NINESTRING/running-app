-- RLS 정책 정비
-- 1) UPDATE 정책에 with check 추가: user_id를 타인 uuid로 바꿔치기하는 것 방지
-- 2) 모든 정책에 to authenticated 지정 + auth.uid()를 select로 감싸 행마다 재호출되지 않게 최적화

drop policy "본인 기록 조회" on public.runs;
drop policy "본인 기록 생성" on public.runs;
drop policy "본인 기록 수정" on public.runs;
drop policy "본인 기록 삭제" on public.runs;

create policy "본인 기록 조회" on public.runs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "본인 기록 생성" on public.runs
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "본인 기록 수정" on public.runs
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "본인 기록 삭제" on public.runs
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- RLS 정책에서 사용하는 user_id 컬럼 인덱스 (FK는 자동 인덱스가 생기지 않음)
create index if not exists runs_user_id_idx on public.runs (user_id);
