import { compareSemver } from '../version';

describe('compareSemver', () => {
  it('낮은 버전이면 -1', () => {
    expect(compareSemver('1.0.0', '1.1.0')).toBe(-1);
    expect(compareSemver('1.9.0', '2.0.0')).toBe(-1);
  });

  it('같은 버전이면 0', () => {
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0);
  });

  it('높은 버전이면 1', () => {
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
  });

  it('두 자리 숫자를 문자열이 아닌 숫자로 비교', () => {
    expect(compareSemver('1.10.0', '1.9.0')).toBe(1);
  });

  it('자릿수가 달라도 비교 가능', () => {
    expect(compareSemver('1.0', '1.0.0')).toBe(0);
    expect(compareSemver('1.0', '1.0.1')).toBe(-1);
  });
});
