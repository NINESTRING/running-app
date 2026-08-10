# 홈 화면 내 위치 표시 + 복귀 버튼 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 홈 화면 진입 시 위치 권한을 요청해 지도에 내 위치를 표시하고, 내 위치로 복귀하는 버튼을 추가한다.

**Architecture:** `src/services/location.ts`에 권한 요청 + 현재 위치 조회를 묶은 `getMyLocation()`을 추가하고(단위 테스트 대상), `RouteMap`에 `ref`로 `animateTo()`를 노출한 뒤, 홈 화면이 마운트 시와 복귀 버튼 탭 시 이 둘을 연결한다.

**Tech Stack:** Expo SDK 57 (`expo-location` ~57.0.7), `react-native-maps` 1.27.2, React 19 (ref-as-prop), nativewind, lucide-react-native, jest-expo.

## Global Constraints

- Expo v57 문서 확인 완료(AGENTS.md 지침): `requestForegroundPermissionsAsync(): Promise<LocationPermissionResponse>`, `getCurrentPositionAsync(options?): Promise<LocationObject>`, `Accuracy.Balanced`(~100m, 기본값). 이 API만 사용한다.
- UI 문구는 한국어. 기존 코드처럼 nativewind `className` + `@/components/ui/*` 컴포넌트를 사용한다.
- 테스트 실행은 `npm test` (`TZ=Asia/Seoul jest`).
- 러닝 중(시작 후) 지도 동작은 변경하지 않는다. `app/run/[id].tsx`의 `RouteMap` 사용처를 깨지 않는다.
- 웹(`RouteMap.web.tsx`는 placeholder): 복귀 버튼 숨김, 마운트 시 위치 조회도 하지 않는다.

---

### Task 1: `getMyLocation()` 서비스 함수

**Files:**
- Modify: `src/services/location.ts`
- Test: `src/services/__tests__/location.test.ts` (신규)

**Interfaces:**
- Consumes: `expo-location` (`requestForegroundPermissionsAsync`, `getCurrentPositionAsync`, `Accuracy.Balanced`)
- Produces: Task 3이 사용하는 아래 시그니처

```ts
export type MyLocationResult =
  | { status: 'granted'; coords: { latitude: number; longitude: number } }
  | { status: 'denied' }
  | { status: 'unavailable' };

export async function getMyLocation(): Promise<MyLocationResult>;
```

참고: `requestForegroundPermissionsAsync()`는 이미 허용된 상태에서는 프롬프트 없이 granted를 반환하므로, 마운트 시와 버튼 탭 시 반복 호출해도 안전하다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/services/__tests__/location.test.ts` 생성:

```ts
import * as Location from 'expo-location';
import { getMyLocation } from '../location';

// location.ts는 모듈 로드 시 defineTask를 실행하므로 expo-task-manager도 목 처리
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  requestBackgroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  Accuracy: { Balanced: 3, BestForNavigation: 6 },
}));

const requestForeground = Location.requestForegroundPermissionsAsync as jest.Mock;
const getCurrentPosition = Location.getCurrentPositionAsync as jest.Mock;

describe('getMyLocation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('권한이 허용되면 현재 좌표를 반환한다', async () => {
    requestForeground.mockResolvedValue({ status: 'granted' });
    getCurrentPosition.mockResolvedValue({
      coords: { latitude: 37.5663, longitude: 126.9779 },
    });

    const result = await getMyLocation();

    expect(result).toEqual({
      status: 'granted',
      coords: { latitude: 37.5663, longitude: 126.9779 },
    });
    expect(getCurrentPosition).toHaveBeenCalledWith({
      accuracy: Location.Accuracy.Balanced,
    });
  });

  it('권한이 거부되면 denied를 반환하고 위치를 조회하지 않는다', async () => {
    requestForeground.mockResolvedValue({ status: 'denied' });

    const result = await getMyLocation();

    expect(result).toEqual({ status: 'denied' });
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('위치 조회가 실패하면 unavailable을 반환한다', async () => {
    requestForeground.mockResolvedValue({ status: 'granted' });
    getCurrentPosition.mockRejectedValue(new Error('location services disabled'));

    const result = await getMyLocation();

    expect(result).toEqual({ status: 'unavailable' });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- src/services/__tests__/location.test.ts`
Expected: FAIL — `getMyLocation`이 export되지 않음 (`is not a function`)

- [ ] **Step 3: 최소 구현**

`src/services/location.ts` 끝에 추가:

```ts
export type MyLocationResult =
  | { status: 'granted'; coords: { latitude: number; longitude: number } }
  | { status: 'denied' }
  | { status: 'unavailable' };

/** 포그라운드 권한을 확보한 뒤 현재 좌표를 1회 조회한다. */
export async function getMyLocation(): Promise<MyLocationResult> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return { status: 'denied' };
  try {
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      status: 'granted',
      coords: {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      },
    };
  } catch {
    // 위치 서비스 꺼짐 등 — 호출부에서 기본 지역을 유지한다
    return { status: 'unavailable' };
  }
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/services/__tests__/location.test.ts`
Expected: PASS (3개)

- [ ] **Step 5: 전체 테스트 + 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add src/services/location.ts src/services/__tests__/location.test.ts
git commit -m "feat(location): 권한 요청 + 현재 위치 조회 getMyLocation 추가"
```

---

### Task 2: `RouteMap`에 `animateTo` ref 노출

**Files:**
- Modify: `src/components/RouteMap.tsx`
- Modify: `src/components/RouteMap.web.tsx`

**Interfaces:**
- Consumes: 없음 (독립)
- Produces: Task 3이 사용하는 아래 시그니처

```ts
export interface RouteMapHandle {
  animateTo(coord: { latitude: number; longitude: number }): void;
}
// <RouteMap points={...} showsUserLocation ref={mapRef} />  // ref: Ref<RouteMapHandle>
```

react-native-maps는 jest-expo에서 네이티브 모듈이 없어 렌더 테스트가 불가하므로 이 태스크는 단위 테스트 없이 타입 검사 + 기존 테스트 + 수동 확인(Task 3)으로 검증한다.

- [ ] **Step 1: 네이티브 구현**

`src/components/RouteMap.tsx` 전체를 다음으로 교체 (React 19 ref-as-prop 사용, 기존 렌더링 로직은 그대로):

```tsx
import { useImperativeHandle, useRef, type Ref } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import type { RoutePoint } from '../types/run';

export interface RouteMapHandle {
  animateTo(coord: { latitude: number; longitude: number }): void;
}

interface Props {
  points: RoutePoint[];
  showsUserLocation?: boolean;
  ref?: Ref<RouteMapHandle>;
}

const DEFAULT_REGION = {
  latitude: 37.5663, // 서울시청
  longitude: 126.9779,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

export function RouteMap({ points, showsUserLocation = false, ref }: Props) {
  const mapRef = useRef<MapView>(null);
  const last = points[points.length - 1];

  useImperativeHandle(ref, () => ({
    animateTo: (coord) =>
      mapRef.current?.animateToRegion(
        { ...coord, latitudeDelta: 0.01, longitudeDelta: 0.01 },
        500,
      ),
  }));

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      showsUserLocation={showsUserLocation}
      initialRegion={DEFAULT_REGION}
      region={
        last
          ? {
              latitude: last.latitude,
              longitude: last.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }
          : undefined
      }
    >
      {points.length >= 2 && (
        <Polyline
          coordinates={points.map((p) => ({
            latitude: p.latitude,
            longitude: p.longitude,
          }))}
          strokeWidth={4}
          strokeColor="#3b82f6"
        />
      )}
    </MapView>
  );
}
```

- [ ] **Step 2: 웹 placeholder 시그니처 일치**

`src/components/RouteMap.web.tsx`의 Props를 맞춘다 (ref는 받되 무시 — 웹에서는 `mapRef.current`가 null로 남아 호출부의 옵셔널 체이닝으로 안전):

```tsx
import type { Ref } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RoutePoint } from '../types/run';
import type { RouteMapHandle } from './RouteMap';

interface Props {
  points: RoutePoint[];
  showsUserLocation?: boolean;
  ref?: Ref<RouteMapHandle>;
}

// react-native-maps는 웹을 지원하지 않으므로(codegenNativeComponent 없음)
// 웹 번들에서는 이 플레이스홀더가 대신 사용된다. ref는 연결하지 않는다.
export function RouteMap({ points }: Props) {
  return (
    <View style={[StyleSheet.absoluteFill, styles.container]}>
      <Text style={styles.title}>지도는 모바일 앱에서 확인할 수 있어요</Text>
      {points.length >= 2 && (
        <Text style={styles.subtitle}>경로 좌표 {points.length}개 기록됨</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e5e7eb',
  },
  title: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 4,
    color: '#6b7280',
    fontSize: 13,
  },
});
```

(`import type { RouteMapHandle } from './RouteMap'`는 타입 전용이라 웹 번들에 react-native-maps가 포함되지 않는다.)

- [ ] **Step 3: 타입 검사 + 기존 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 에러 없음, 전체 PASS

- [ ] **Step 4: 커밋**

```bash
git add src/components/RouteMap.tsx src/components/RouteMap.web.tsx
git commit -m "feat(map): RouteMap에 animateTo ref 핸들 노출"
```

---

### Task 3: 홈 화면 — 마운트 시 내 위치 이동 + 복귀 버튼

**Files:**
- Modify: `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: Task 1의 `getMyLocation(): Promise<MyLocationResult>`, Task 2의 `RouteMapHandle` / `ref` prop
- Produces: 없음 (최종 소비자)

동작 규칙(스펙):
- 마운트 시: 권한 요청 → 허용이면 `animateTo`. 거부/실패는 **조용히** 기본 지역 유지 (`permissionDenied`를 켜지 않음 — 기존 안내는 '시작'/버튼 탭 시에만).
- 버튼 탭: 권한 재요청 포함. 거부면 `permissionDenied` 켜서 기존 "설정 열기" 안내 재사용, 허용이면 안내를 끄고 `animateTo`. `unavailable`은 무시.
- 위치 조회 중 중복 탭 무시 (in-flight 가드).
- 웹: 버튼 숨김 + 마운트 조회 생략 (`Platform.OS === 'web'`).

- [ ] **Step 1: 홈 화면 수정**

`app/(tabs)/index.tsx`에 다음 변경을 적용:

임포트 추가/변경:

```tsx
import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, Pressable, View } from 'react-native';
import { LocateFixed } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { RouteMap, type RouteMapHandle } from '@/components/RouteMap';
import { getMyLocation, requestPermissions, startTracking, stopTracking } from '@/services/location';
```

`HomeScreen` 컴포넌트 상단(기존 state 선언 아래)에 추가:

```tsx
const mapRef = useRef<RouteMapHandle>(null);
const locatingRef = useRef(false);

// fromButton: 버튼 탭이면 거부 시 설정 안내를 띄운다 (마운트 시에는 조용히 무시)
const goToMyLocation = async (fromButton: boolean) => {
  if (locatingRef.current) return;
  locatingRef.current = true;
  try {
    const result = await getMyLocation();
    if (result.status === 'granted') {
      setPermissionDenied(false);
      mapRef.current?.animateTo(result.coords);
    } else if (result.status === 'denied' && fromButton) {
      setPermissionDenied(true);
    }
  } finally {
    locatingRef.current = false;
  }
};

useEffect(() => {
  if (Platform.OS === 'web') return;
  void goToMyLocation(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

렌더링 변경 — `<RouteMap points={points} showsUserLocation />`에 ref 연결:

```tsx
<RouteMap points={points} showsUserLocation ref={mapRef} />
```

하단 카드를 래퍼 View로 감싸고 복귀 버튼을 카드 바로 위 우측에 배치
(카드의 `className="absolute inset-x-4 bottom-6"`을 래퍼로 이동 — 카드 높이가
변해도 버튼이 항상 카드 위에 붙는다):

```tsx
<View className="absolute inset-x-4 bottom-6 gap-3">
  {Platform.OS !== 'web' && (
    <View className="items-end">
      <Pressable
        accessibilityLabel="내 위치로 이동"
        onPress={() => goToMyLocation(true)}
        className="h-11 w-11 items-center justify-center rounded-full bg-card shadow-lg active:opacity-70"
      >
        <Icon as={LocateFixed} size={20} />
      </Pressable>
    </View>
  )}
  <Card>
    <CardContent className="gap-3 p-4">
      ...기존 내용 그대로...
    </CardContent>
  </Card>
</View>
```

- [ ] **Step 2: 타입·린트·테스트**

Run: `npx tsc --noEmit && npm run lint && npm test`
Expected: 모두 통과

- [ ] **Step 3: 시뮬레이터 수동 확인**

Run: `npx expo run:ios` (또는 실행 중인 dev client 리로드)
확인 항목:
1. 첫 진입 시 위치 권한 프롬프트 표시
2. 허용 → 파란 점 표시 + 지도가 내 위치로 이동 (시뮬레이터: Features > Location > Apple 등으로 위치 설정)
3. 지도를 다른 곳으로 드래그 → 복귀 버튼 탭 → 내 위치로 애니메이션 복귀
4. 권한 거부 상태(설정에서 끄기) → 버튼 탭 → "위치 권한이 필요합니다" 안내 표시
5. '시작' → 기존 러닝 추적 동작 정상

- [ ] **Step 4: 커밋**

```bash
git add "app/(tabs)/index.tsx"
git commit -m "feat(home): 마운트 시 내 위치 표시 + 내 위치 복귀 버튼 추가"
```
