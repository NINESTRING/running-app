import { fetchCurrentWeather, resolveRunWeather } from '../weather';

const okResponse = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

describe('fetchCurrentWeather', () => {
  const originalFetch = (globalThis as any).fetch as typeof fetch;

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    jest.useRealTimers();
  });

  it('현재 날씨 코드·기온을 파싱한다', async () => {
    (globalThis as any).fetch = jest.fn(async () =>
      okResponse({ current: { temperature_2m: 21.4, weather_code: 3 } })
    );
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toEqual({
      weatherCode: 3,
      temperatureC: 21.4,
    });
  });

  it('요청 URL에 좌표와 current 파라미터를 포함한다', async () => {
    const spy = jest.fn(async () =>
      okResponse({ current: { temperature_2m: 0, weather_code: 0 } })
    );
    (globalThis as any).fetch = spy;
    await fetchCurrentWeather(37.5, 127.0);
    const url = ((spy as any).mock.calls[0]?.[0] ?? '') as string;
    expect(url).toContain('latitude=37.5');
    expect(url).toContain('longitude=127');
    expect(url).toContain('current=temperature_2m,weather_code');
  });

  it('HTTP 오류면 null', async () => {
    (globalThis as any).fetch = jest.fn(async () => ({ ok: false }) as Response);
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();
  });

  it('네트워크 오류면 null', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new Error('network');
    });
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();
  });

  it('응답 필드가 없거나 형식이 어긋나면 null', async () => {
    (globalThis as any).fetch = jest.fn(async () => okResponse({}));
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();

    (globalThis as any).fetch = jest.fn(async () =>
      okResponse({ current: { temperature_2m: '21', weather_code: 3 } })
    );
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();
  });

  it('5초 내 응답이 없으면 abort되어 null', async () => {
    jest.useFakeTimers();
    (globalThis as any).fetch = jest.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('Aborted'))
          );
        })
    ) as jest.MockedFunction<typeof fetch>;
    const promise = fetchCurrentWeather(37.5, 127.0);
    jest.advanceTimersByTime(5000);
    await expect(promise).resolves.toBeNull();
  });

  it('weather_code가 DB check 제약(0~99) 범위 밖이면 null', async () => {
    (globalThis as any).fetch = jest.fn(async () =>
      okResponse({ current: { temperature_2m: 20, weather_code: 100 } })
    );
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();

    (globalThis as any).fetch = jest.fn(async () =>
      okResponse({ current: { temperature_2m: 20, weather_code: -1 } })
    );
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();
  });

  it('temperature_c가 DB check 제약(-90~60) 범위 밖이면 null', async () => {
    (globalThis as any).fetch = jest.fn(async () =>
      okResponse({ current: { temperature_2m: 61, weather_code: 3 } })
    );
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();

    (globalThis as any).fetch = jest.fn(async () =>
      okResponse({ current: { temperature_2m: -91, weather_code: 3 } })
    );
    await expect(fetchCurrentWeather(37.5, 127.0)).resolves.toBeNull();
  });
});

describe('resolveRunWeather', () => {
  const originalFetch = (globalThis as any).fetch as typeof fetch;

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
  });

  it('저장값이 있으면 fetch 없이 그대로 반환한다', async () => {
    const spy = jest.fn();
    (globalThis as any).fetch = spy;
    const result = await resolveRunWeather(
      { weatherCode: 3, temperatureC: 21.4 },
      { latitude: 37.5, longitude: 127.0 }
    );
    expect(result).toEqual({ weatherCode: 3, temperatureC: 21.4 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('저장값이 없고 좌표도 없으면 fetch 없이 null 쌍을 반환한다', async () => {
    const spy = jest.fn();
    (globalThis as any).fetch = spy;
    const result = await resolveRunWeather(
      { weatherCode: null, temperatureC: null },
      undefined
    );
    expect(result).toEqual({ weatherCode: null, temperatureC: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it('재시도가 실패하면 null 쌍을 반환한다', async () => {
    (globalThis as any).fetch = jest.fn(async () => {
      throw new Error('network');
    });
    const result = await resolveRunWeather(
      { weatherCode: null, temperatureC: null },
      { latitude: 37.5, longitude: 127.0 }
    );
    expect(result).toEqual({ weatherCode: null, temperatureC: null });
  });

  it('재시도가 성공하면 값 쌍을 반환한다', async () => {
    (globalThis as any).fetch = jest.fn(async () =>
      okResponse({ current: { temperature_2m: 18.2, weather_code: 1 } })
    );
    const result = await resolveRunWeather(
      { weatherCode: null, temperatureC: null },
      { latitude: 37.5, longitude: 127.0 }
    );
    expect(result).toEqual({ weatherCode: 1, temperatureC: 18.2 });
  });
});
