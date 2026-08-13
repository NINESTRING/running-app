import type { RunRecord } from '../../types/run';
import { formatRunDay, groupRunsByMonth, timeOfDay } from '../history';

function run(partial: Partial<RunRecord> & Pick<RunRecord, 'id' | 'startedAt'>): RunRecord {
  return {
    durationSec: 0,
    distanceM: 0,
    steps: null,
    routeGeojson: null,
    routePoints: null,
    weatherCode: null,
    temperatureC: null,
    ...partial,
  };
}

describe('timeOfDay', () => {
  // TZ=Asia/Seoul 전제 (npm test 스크립트가 설정)
  it.each([
    ['2026-08-13T00:00:00+09:00', '새벽'],
    ['2026-08-13T05:59:00+09:00', '새벽'],
    ['2026-08-13T06:00:00+09:00', '오전'],
    ['2026-08-13T11:59:00+09:00', '오전'],
    ['2026-08-13T12:00:00+09:00', '오후'],
    ['2026-08-13T17:59:00+09:00', '오후'],
    ['2026-08-13T18:00:00+09:00', '밤'],
    ['2026-08-13T23:59:00+09:00', '밤'],
  ])('%s → %s', (iso, expected) => {
    expect(timeOfDay(iso)).toBe(expected);
  });
});

describe('formatRunDay', () => {
  it('"월. 일. (요일)" 형식', () => {
    expect(formatRunDay('2026-08-13T04:44:00+09:00')).toBe('8. 13. (목)');
  });
});

describe('groupRunsByMonth', () => {
  it('빈 배열 → 빈 배열', () => {
    expect(groupRunsByMonth([])).toEqual([]);
  });

  it('같은 달 러닝은 순서를 보존해 한 섹션으로 묶는다', () => {
    const runs = [
      run({ id: 'a', startedAt: '2026-08-13T04:44:00+09:00' }),
      run({ id: 'b', startedAt: '2026-08-12T13:00:00+09:00' }),
    ];
    const sections = groupRunsByMonth(runs);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('2026년 8월');
    expect(sections[0].data.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('다른 달은 입력 순서대로 별도 섹션', () => {
    const runs = [
      run({ id: 'a', startedAt: '2026-08-13T04:44:00+09:00' }),
      run({ id: 'b', startedAt: '2026-07-30T21:00:00+09:00' }),
    ];
    const sections = groupRunsByMonth(runs);
    expect(sections.map((s) => s.title)).toEqual(['2026년 8월', '2026년 7월']);
    expect(sections[1].data.map((r) => r.id)).toEqual(['b']);
  });

  it('연도가 다른 같은 월은 별도 섹션', () => {
    const runs = [
      run({ id: 'a', startedAt: '2026-08-13T04:44:00+09:00' }),
      run({ id: 'b', startedAt: '2025-08-13T04:44:00+09:00' }),
    ];
    const sections = groupRunsByMonth(runs);
    expect(sections.map((s) => s.title)).toEqual(['2026년 8월', '2025년 8월']);
  });
});
