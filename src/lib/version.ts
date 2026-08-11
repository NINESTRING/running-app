import * as Application from 'expo-application';
import Constants from 'expo-constants';

// "1.2.3" 형태의 semver 문자열 비교: a<b → -1, a===b → 0, a>b → 1
export function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// 설치된 앱 버전 — 네이티브는 실제 바이너리 버전(웹에서는 null이라 app.json 버전으로 폴백)
export function getInstalledVersion(): string | null {
  return (
    Application.nativeApplicationVersion ??
    Constants.expoConfig?.version ??
    null
  );
}
