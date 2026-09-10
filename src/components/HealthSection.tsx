import { useState } from 'react';
import { Switch, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { isHeartRateSourceAvailable, requestHeartRateAccess } from '@/services/heartRate';
import { useSettingsStore } from '@/stores/settingsStore';

const DENIED_HINT =
  '건강 앱 접근을 허용하지 못했습니다. 설정 > 건강 > 데이터 접근 및 기기에서 허용해 주세요.';

/** 건강 앱(HealthKit) 연동 설정. HealthKit이 없는 기기(Android·웹·일부 iPad)에서는 렌더하지 않는다. */
export function HealthSection() {
  const on = useSettingsStore((s) => s.healthHeartRateOn);
  const setOn = useSettingsStore((s) => s.setHealthHeartRateOn);
  const [hint, setHint] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  if (!isHeartRateSourceAvailable()) return null;

  const onChange = async (next: boolean) => {
    if (!next) {
      // 끄기는 즉시. 이미 저장된 심박은 지우지 않는다.
      setOn(false);
      setHint(null);
      return;
    }
    setRequesting(true);
    const ok = await requestHeartRateAccess();
    setRequesting(false);
    if (ok) {
      setOn(true);
      setHint(null);
    } else {
      // HealthKit은 읽기 거부를 알려주지 않으므로 여기 오는 건 시트를 못 띄운 오류 경로다
      setOn(false);
      setHint(DENIED_HINT);
    }
  };

  return (
    <View className="gap-3">
      <Text className="text-base font-semibold">건강 앱 연동</Text>
      <View className="flex-row items-center justify-between">
        <Text>심박 가져오기</Text>
        <Switch
          value={on}
          onValueChange={onChange}
          disabled={requesting}
          accessibilityLabel="건강 앱에서 심박 가져오기"
        />
      </View>
      <Text className="text-sm text-muted-foreground">
        미밴드·애플워치 등이 건강 앱에 기록한 심박을 러닝 기록에 붙입니다. 러닝 저장 뒤 동기화가
        끝나면 기록에 표시됩니다. 동기화 후에도 심박이 보이지 않으면 설정 &gt; 건강 &gt; 데이터
        접근 및 기기에서 접근을 확인해 주세요.
      </Text>
      {hint !== null && <Text className="text-sm text-destructive">{hint}</Text>}
    </View>
  );
}
