import { formatLocationLabel } from '../location';

describe('formatLocationLabel', () => {
  it('시·구·동을 공백으로 연결한다 (Android식: subregion에 구)', () => {
    expect(
      formatLocationLabel({
        region: '서울특별시',
        city: null,
        subregion: '강남구',
        district: '서초동',
      })
    ).toBe('서울 강남구 서초동');
  });

  it('city가 있으면 subregion보다 우선한다 (iOS식)', () => {
    expect(
      formatLocationLabel({
        region: '서울특별시',
        city: '강남구',
        subregion: '서울',
        district: '서초동',
      })
    ).toBe('서울 강남구 서초동');
  });

  it('광역시·특별자치시·특별자치도 접미사를 축약한다', () => {
    expect(
      formatLocationLabel({
        region: '부산광역시',
        city: null,
        subregion: '해운대구',
        district: '우동',
      })
    ).toBe('부산 해운대구 우동');
    expect(
      formatLocationLabel({
        region: '세종특별자치시',
        city: null,
        subregion: null,
        district: '보람동',
      })
    ).toBe('세종 보람동');
    expect(
      formatLocationLabel({
        region: '제주특별자치도',
        city: '제주시',
        subregion: null,
        district: '이도이동',
      })
    ).toBe('제주 제주시 이도이동');
  });

  it('도(道)는 축약하지 않는다', () => {
    expect(
      formatLocationLabel({
        region: '경기도',
        city: '성남시',
        subregion: null,
        district: '정자동',
      })
    ).toBe('경기도 성남시 정자동');
  });

  it('null·공백 파트는 생략한다', () => {
    expect(
      formatLocationLabel({
        region: '서울특별시',
        city: null,
        subregion: null,
        district: null,
      })
    ).toBe('서울');
    expect(
      formatLocationLabel({ region: null, city: '강남구', subregion: null, district: ' ' })
    ).toBe('강남구');
  });

  it('인접 중복 파트는 하나만 남긴다', () => {
    expect(
      formatLocationLabel({
        region: '서울특별시',
        city: '서울',
        subregion: null,
        district: '서초동',
      })
    ).toBe('서울 서초동');
  });

  it('모든 파트가 없으면 null', () => {
    expect(
      formatLocationLabel({ region: null, city: null, subregion: null, district: null })
    ).toBeNull();
    expect(
      formatLocationLabel({ region: '', city: null, subregion: '', district: null })
    ).toBeNull();
  });
});
