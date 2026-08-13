import * as Location from 'expo-location';
import { fetchLocationLabel } from '../geocoding';

jest.mock('expo-location', () => ({
  reverseGeocodeAsync: jest.fn(),
}));

const mockReverse = Location.reverseGeocodeAsync as jest.MockedFunction<
  typeof Location.reverseGeocodeAsync
>;

const address = (over: Record<string, unknown>) =>
  ({
    region: null,
    city: null,
    subregion: null,
    district: null,
    country: null,
    isoCountryCode: null,
    name: null,
    postalCode: null,
    street: null,
    streetNumber: null,
    timezone: null,
    formattedAddress: null,
    ...over,
  }) as Location.LocationGeocodedAddress;

describe('fetchLocationLabel', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  it('첫 결과를 라벨로 조합한다', async () => {
    mockReverse.mockResolvedValue([
      address({ region: '서울특별시', subregion: '강남구', district: '서초동' }),
    ]);
    await expect(fetchLocationLabel(37.49, 127.01)).resolves.toBe('서울 강남구 서초동');
    expect(mockReverse).toHaveBeenCalledWith({ latitude: 37.49, longitude: 127.01 });
  });

  it('결과가 비어 있으면 null', async () => {
    mockReverse.mockResolvedValue([]);
    await expect(fetchLocationLabel(37.49, 127.01)).resolves.toBeNull();
  });

  it('주소 필드가 전부 비어 있으면 null', async () => {
    mockReverse.mockResolvedValue([address({})]);
    await expect(fetchLocationLabel(37.49, 127.01)).resolves.toBeNull();
  });

  it('지오코더가 throw하면 null', async () => {
    mockReverse.mockRejectedValue(new Error('geocoder unavailable'));
    await expect(fetchLocationLabel(37.49, 127.01)).resolves.toBeNull();
  });

  it('5초 내 응답이 없으면 null', async () => {
    jest.useFakeTimers();
    mockReverse.mockReturnValue(new Promise(() => {}));
    const promise = fetchLocationLabel(37.49, 127.01);
    jest.advanceTimersByTime(5000);
    await expect(promise).resolves.toBeNull();
  });
});
