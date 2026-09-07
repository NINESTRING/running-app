# 런닝앱

React Native + Expo 기반 GPS 러닝 트래커.

## 스택

Expo (TypeScript) · Expo Router · expo-location + expo-task-manager ·
react-native-maps · Zustand · victory-native · Supabase (PostGIS) · EAS Build

## 시작하기

```bash
npm install
npx expo start
npx expo run:ios
npx expo run:ios --device
npx expo run:ios --device --configuration Release
```

- 기본 UI 확인은 Expo Go로 가능.
- **백그라운드 위치 추적은 dev build 필요**: `eas build --profile development --platform ios` (또는 android) 후 설치.
- Android에서 지도를 보려면 Google Maps API 키가 필요 (`app.json` → `android.config.googleMaps.apiKey`).

## 실기기 빌드 문제 해결

### 프로비저닝 프로필 만료일 확인 · 미리 갱신

무료 계정 프로필은 **발급일**로부터 7일이다. 빌드를 다시 한다고 7일이 새로 시작되지 않는다 —
디스크에 프로필이 남아 있으면 그대로 재사용되고 만료일도 원래 날짜 그대로다.

방금 빌드한 앱에 들어간 프로필의 만료일:

```bash
security cms -D -i ~/Library/Developer/Xcode/DerivedData/runningapp-*/Build/Products/Release-iphoneos/runningapp.app/embedded.mobileprovision \
  | plutil -extract ExpirationDate raw -
```

디스크에 있는 프로필 전체의 이름·만료일 (파일명은 UUID라 이름으로 골라야 한다):

```bash
cd ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles
for f in *.mobileprovision; do
  security cms -D -i "$f" > /tmp/p.plist
  echo "$f $(/usr/libexec/PlistBuddy -c 'Print :Name' -c 'Print :ExpirationDate' /tmp/p.plist | tr '\n' ' ')"
done
```

만료 전에 7일을 새로 확보하려면 **runningapp 프로필만** 지우고 다시 빌드한다
(다른 앱 프로필까지 지우면 그쪽도 재발급해야 하므로 UUID를 확인하고 지울 것):

```bash
rm ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/<runningapp-UUID>.mobileprovision
npx expo run:ios --device --configuration Release
```

빌드 후 위 첫 명령으로 만료일이 `오늘+7일`인지 확인한다. 날짜가 그대로면 아래 error 65 항목의
xcodebuild 경로로 재발급한다.

> 프로필 디렉터리는 Xcode 16부터 `~/Library/Developer/Xcode/UserData/Provisioning Profiles`다.
> 그 이전 버전은 `~/Library/MobileDevice/Provisioning Profiles`.

### `No profiles for 'com.ninestring.runningapp' were found` (error 65)

무료 Apple 계정이라 프로비저닝 프로필이 7일마다 만료되고, 만료되면 디스크에서 사라진다
(`~/Library/Developer/Xcode/UserData/Provisioning Profiles`가 빈 상태인지로 확인).

`npx expo run:ios --device`로는 재발급이 안 된다. expo CLI는 pbxproj에 `DEVELOPMENT_TEAM`이
이미 설정돼 있으면 코드사이닝 설정 단계를 건너뛰면서 `-allowProvisioningUpdates`도 같이 빼기
때문이다. 프로필이 있을 때만 통하는 경로다.

xcodebuild를 직접 불러 재발급받는다 (`id=`는 `xcrun devicectl list devices`로 확인):

```bash
xcodebuild -workspace ios/runningapp.xcworkspace -scheme runningapp \
  -configuration Release -destination "id=<DEVICE_UDID>" \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM=R7NARLC828 build
```

한 번 성공하면 프로필이 다시 생기므로 이후 7일간은 `npx expo run:ios --device`가 정상 동작한다.

### Release 빌드 후 시뮬레이터가 즉시 죽을 때

React Native·Expo 프리빌트 바이너리는 Debug/Release 변종이 따로 있다. Release 빌드를 한 뒤
Debug 빌드를 하면 정렬이 깨져 링크 에러나 실행 즉시 `EXC_BAD_ACCESS`가 난다. 마커 파일
(`.last_build_configuration`)은 실제 바이너리와 어긋날 수 있으니 믿지 말고, 설치된 바이너리
크기를 `ios/Pods/*/artifacts/*-debug.tar.gz` 안의 크기와 대조해 판단한다.

## Supabase 연결

1. [supabase.com](https://supabase.com)에서 프로젝트 생성
2. SQL Editor에서 `supabase/migrations/0001_init.sql` 실행
3. `.env.example`을 `.env`로 복사하고 URL/anon key 입력
4. 재시작: `npx expo start --clear`

주의: `runs` 테이블은 RLS로 보호되므로 실제 저장은 로그인(추후 구현) 후 가능.

## 테스트

```bash
npm test           # jest 유닛 테스트
npx tsc --noEmit   # 타입 체크
```

## 구조

- `app/` — Expo Router 화면 (탭: 홈/기록/통계/설정, `run/[id]` 상세)
- `src/lib/` — 순수 로직 (거리·페이스·주간 통계)
- `src/stores/` — Zustand 스토어
- `src/services/` — 위치 추적, Supabase
- `supabase/migrations/` — DB 스키마

## 릴리스 절차

새 버전을 낼 때마다:

1. `app.json`의 `expo.version`을 올린다.
2. `app_versions` 테이블에 새 행을 추가한다 (마이그레이션 파일 또는 Supabase 대시보드).
   - `version`: app.json과 동일한 semver 문자열
   - `notes`: 변경 사항 (줄바꿈으로 항목 구분)
   - 새 행의 `released_at`이 항상 최신이 되도록 버전 순서대로 등록한다 (배지 로직이 이 순서에 의존)
