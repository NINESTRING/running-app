import { MoveUpRight, Timer } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import Svg, { Path, Text as SvgText } from 'react-native-svg';

import { Text } from '@/components/ui/text';

export interface RecordBadgeProps {
  /** 쉴드 중앙 텍스트 (1K, 5K, 21.1K …). icon과 둘 중 하나만 */
  label?: string;
  icon?: 'distance' | 'duration';
  achieved: boolean;
  /** 표시용으로 이미 포맷된 문자열 */
  date?: string;
  name: string;
  /** 표시용으로 이미 포맷된 문자열 */
  value?: string;
  onPress?: () => void;
}

const ACCENT = '#3b82f6';
const SHIELD_DARK = '#1f2937';
const GRAY = '#9ca3af';
const GRAY_BG = '#e5e7eb';

export function RecordBadge({
  label,
  icon,
  achieved,
  date,
  name,
  value,
  onPress,
}: RecordBadgeProps) {
  const IconCmp = icon === 'distance' ? MoveUpRight : Timer;
  const fg = achieved ? ACCENT : GRAY;
  const body = (
    <View className="items-center gap-0.5">
      <View className="h-24 w-20 items-center justify-center">
        <Svg width={72} height={86} viewBox="0 0 100 118">
          <Path
            d="M8 4 H92 V84 L50 112 L8 84 Z"
            fill={achieved ? SHIELD_DARK : GRAY_BG}
            stroke={fg}
            strokeWidth={5}
            strokeLinejoin="round"
          />
          {label ? (
            <SvgText
              x="50"
              y="66"
              textAnchor="middle"
              fontSize="26"
              fontWeight="bold"
              fill={fg}
            >
              {label}
            </SvgText>
          ) : null}
        </Svg>
        {icon ? (
          <View className="absolute inset-0 items-center justify-center pb-2">
            <IconCmp size={28} color={fg} />
          </View>
        ) : null}
      </View>
      {achieved && date ? (
        <Text className="text-xs text-muted-foreground">{date}</Text>
      ) : null}
      <Text className="text-center text-sm">{name}</Text>
      {achieved && value ? (
        <Text className="text-xs text-muted-foreground">{value}</Text>
      ) : null}
    </View>
  );
  if (achieved && onPress) {
    return (
      <Pressable onPress={onPress} className="active:opacity-70">
        {body}
      </Pressable>
    );
  }
  return body;
}
