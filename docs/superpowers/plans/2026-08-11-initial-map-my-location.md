# 앱 시작 시 첫 지도 화면 내 위치 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면 지도가 기본 지역(서울시청) 대신 처음부터 내 위치로 그려지게 한다.

**Architecture:** `src/services/location.ts`에 프롬프트 없이 캐시 위치를 즉시 반환하는 `getInitialCoords()`를 추가하고(단위 테스트), 홈 화면이 이 좌표를 확정한 뒤에만 `RouteMap`을 렌더하며 새 `initialCoords` prop으로 `initialRegion`을 지정한다. 기존 `getCurrentPositionAsync` → `animateTo` 보정 로직은 그대로 유지한다.

**Tech Stack:** Expo SDK 57 (`expo-location` ~57.0.7), `react-native-maps` 1.27.2, jest-expo.

## Global Constraints

- Expo v57 문서 확인 완료(AGENTS.md 지침): `getForegroundPermissionsAsync(): Promise<LocationPermissionResponse>`(프롬프트 없이 상태만 확인), `getLastKnownPositionAsync(options?): Promise<LocationObject | null>`(캐시 위치 즉시 반환, 없으면 null). 이 태스크들에서 새로 쓰는 API는 이 둘뿐이다.
- `getInitialCoords`는 절대 권한 프롬프트를 띄우지 않는다. 권한 요청은 기존 `getMyLocation`(마운트 보정)이 담당한다.
- 기존 마운트 보정 로직(`goToMyLocation(false)`)과 러닝 중 지도 동작, `app/run/[id].tsx` 사용처는 변경하지 않는다.
- 웹: `RouteMap.web.tsx`는 placeholder — 좌표 확정 없이 즉시 렌더(마운트 조회 생략 유지).
- 테스트 실행은 `npm test` (`TZ=Asia/Seoul jest`). 알려진 기존 예외: `app/_layout.tsx`의 `../src/global.css` tsc 에러, `src/stores/__tests__/authStore.test.ts`의 lint 경고 1건 — 이 둘은 건드리지 않는다.

---

### Task 1: `getInitialCoords()` 서비스 함수

**Files:**
- Modify: `src/services/location.ts` (85줄, 끝에 추가)
- Test: `src/services/__tests__/location.test.ts` (105줄, mock 확장 + describe 추가)

**Interfaces:**
- Consumes: `expo-location` (`getForegroundPermissionsAsync`, `getLastKnownPositionAsync`)
- Produces: Task 2가 사용하는 아래 시그니처

```ts
export async function getInitialCoords(): Promise<{ latitude: number; longitude: number } | null>;
```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/__tests__/location.test.ts` 수정 — ① import에 `getInitialCoords` 추가:

```ts
import {
  getInitialCoords,
  getMyLocation,
  myLocationAction,
  type MyLocationResult,
} from '../location';
```

② `jest.mock('expo-location', ...)`의 팩토리 객체에 두 줄 추가 (기존 항목 유지):

```ts
  getForegroundPermissionsAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn(),
```

③ 기존 mock 참조 선언부(19–20행 근처)에 추가:

```ts
const getForeground = Location.getForegroundPermissionsAsync as jest.Mock;
const getLastKnown = Location.getLastKnownPositionAsync as jest.Mock;
```

④ 파일 끝에 describe 추가:

```ts
describe('getInitialCoords', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('권한이 있고 캐시 위치가 있으면 좌표를 반환한다', async () => {
    getForeground.mockResolvedValue({ status: 'granted' });
    getLastKnown.mockResolvedValue({
      coords: { latitude: 37.5663, longitude: 126.9779 },
    });

    const result = await getInitialCoords();

    expect(result).toEqual({ latitude: 37.5663, longitude: 126.9779 });
  });

  it('권한이 없으면 null을 반환하고 캐시 위치를 조회하지 않는다', async () => {
    getForeground.mockResolvedValue({ status: 'denied' });

    const result = await getInitialCoords();

    expect(result).toBeNull();
    expect(getLastKnown).not.toHaveBeenCalled();
  });

  it('캐시 위치가 없으면 null을 반환한다', async () => {
    getForeground.mockResolvedValue({ status: 'granted' });
    getLastKnown.mockResolvedValue(null);

    const result = await getInitialCoords();

    expect(result).toBeNull();
  });

  it('조회가 실패하면 null을 반환한다', async () => {
    getForeground.mockResolvedValue({ status: 'granted' });
    getLastKnown.mockRejectedValue(new Error('location unavailable'));

    const result = await getInitialCoords();

    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- src/services/__tests__/location.test.ts`
Expected: FAIL — `getInitialCoords`가 export되지 않음

- [ ] **Step 3: 최소 구현**

`src/services/location.ts` 끝에 추가:

```ts
/**
 * 지도 첫 렌더용 초기 좌표. 프롬프트 없이, 권한이 이미 있을 때만
 * 캐시된 마지막 위치를 즉시 반환한다. 실패는 모두 null (기본 지역 폴백).
 */
export async function getInitialCoords(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync();
    if (!pos) return null;
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch (e) {
    console.warn('[location] getInitialCoords 실패', e);
    return null;
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/services/__tests__/location.test.ts`
Expected: PASS (13개)

- [ ] **Step 5: 전체 테스트 + 커밋**

Run: `npm test`
Expected: 전체 PASS, 콘솔 노이즈 없음

```bash
git add src/services/location.ts src/services/__tests__/location.test.ts
git commit -m "feat(location): 첫 렌더용 캐시 위치 getInitialCoords 추가"
```

---

### Task 2: RouteMap `initialCoords` prop + 홈 화면 렌더 게이팅

**Files:**
- Modify: `src/components/RouteMap.tsx`
- Modify: `src/components/RouteMap.web.tsx`
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: Task 1의 `getInitialCoords(): Promise<{ latitude: number; longitude: number } | null>`
- Produces: 없음 (최종 소비자). `RouteMap`의 새 prop: `initialCoords?: { latitude: number; longitude: number }`

단위 테스트 없음(react-native-maps는 jest-expo에서 렌더 불가). 검증 = `npx tsc --noEmit && npm run lint && npm test` + 수동 확인.

- [ ] **Step 1: RouteMap에 initialCoords prop 추가**

`src/components/RouteMap.tsx` — Props에 한 줄 추가:

```ts
interface Props {
  points: RoutePoint[];
  showsUserLocation?: boolean;
  initialCoords?: { latitude: number; longitude: number };
  ref?: Ref<RouteMapHandle>;
}
```

함수 시그니처와 `initialRegion` 변경 (그 외 로직·`DEFAULT_REGION` 상수는 그대로):

```tsx
export function RouteMap({ points, showsUserLocation = false, initialCoords, ref }: Props) {
```

```tsx
      initialRegion={
        initialCoords
          ? { ...initialCoords, latitudeDelta: 0.01, longitudeDelta: 0.01 }
          : DEFAULT_REGION
      }
```

`src/components/RouteMap.web.tsx` — Props에 동일하게 한 줄 추가 (사용하지 않음):

```ts
interface Props {
  points: RoutePoint[];
  showsUserLocation?: boolean;
  initialCoords?: { latitude: number; longitude: number };
  ref?: Ref<RouteMapHandle>;
}
```

- [ ] **Step 2: 홈 화면 렌더 게이팅**

`app/(tabs)/index.tsx` 수정 — ① `@/services/location` import에 `getInitialCoords` 추가:

```ts
import {
  getInitialCoords,
  getMyLocation,
  myLocationAction,
  requestPermissions,
  startTracking,
  stopTracking,
} from '@/services/location';
```

② 기존 state 선언들 아래에 추가 (`undefined` = 확정 전, 웹은 즉시 확정):

```tsx
// undefined: 초기 좌표 확정 전(지도 미렌더). null: 좌표 없음 → 기본 지역
const [initialCoords, setInitialCoords] = useState<
  { latitude: number; longitude: number } | null | undefined
>(Platform.OS === 'web' ? null : undefined);
```

③ 기존 마운트 효과를 다음으로 교체 (초기 좌표 확정 → 기존 보정 순서):

```tsx
useEffect(() => {
  if (Platform.OS === 'web') return;
  void (async () => {
    setInitialCoords(await getInitialCoords());
    await goToMyLocation(false);
  })();
}, []);
```

④ 렌더에서 `RouteMap`을 확정 후에만 그린다 — 기존
`<RouteMap points={points} showsUserLocation ref={mapRef} />` 를 다음으로 교체:

```tsx
{initialCoords !== undefined && (
  <RouteMap
    points={points}
    showsUserLocation
    ref={mapRef}
    initialCoords={initialCoords ?? undefined}
  />
)}
```

- [ ] **Step 3: 타입·린트·테스트**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 알려진 기존 예외(global.css tsc 에러, authStore.test.ts lint 경고 1건) 외 모두 통과

- [ ] **Step 4: 커밋**

```bash
git add src/components/RouteMap.tsx src/components/RouteMap.web.tsx "app/(tabs)/index.tsx"
git commit -m "feat(home): 첫 지도 화면을 캐시된 내 위치로 렌더"
```

- [ ] **Step 5: 수동 확인 (컨트롤러/사용자)**

1. 권한 허용 상태에서 앱 재시작 → 시청 화면 없이 처음부터 내 위치
2. 최초 설치(권한 없음) → 기본 지역 렌더 → 권한 허용 → 내 위치로 이동 (기존 동작)
3. 복귀 버튼·러닝 추적 정상
