import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSettingsStore } from '../../src/stores/settingsStore';

export default function SettingsScreen() {
  const unit = useSettingsStore((s) => s.unit);
  const setUnit = useSettingsStore((s) => s.setUnit);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>거리 단위</Text>
      <View style={styles.row}>
        {(['km', 'mi'] as const).map((u) => (
          <Pressable
            key={u}
            style={[styles.option, unit === u && styles.selected]}
            onPress={() => setUnit(u)}
          >
            <Text style={unit === u ? styles.selectedText : undefined}>{u}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  label: { fontSize: 16, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8 },
  option: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  selected: { backgroundColor: '#3b82f6', borderColor: '#3b82f6' },
  selectedText: { color: 'white', fontWeight: '600' },
});
