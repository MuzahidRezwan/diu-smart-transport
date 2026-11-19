import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useColorScheme, type ViewStyle } from 'react-native';

const light = { bg: '#f2f5fb', surface: '#ffffff', surface2: '#eaf0f9', ink: '#0e1a33', muted: '#5a6784', line: '#d9e1ee', accent: '#1446a0', accentInk: '#ffffff', ok: '#1d8049', okSoft: '#dff3e7', warn: '#a8690f', crit: '#bf3328', critSoft: '#fbe3e0' };
const dark = { bg: '#0a111e', surface: '#111a2b', surface2: '#18233a', ink: '#e6ecf7', muted: '#96a3bf', line: '#24304a', accent: '#78a3f2', accentInk: '#0a111e', ok: '#4cc283', okSoft: '#12301f', warn: '#e6b553', crit: '#f0766a', critSoft: '#3b1815' };
export type Theme = typeof light;
export const OP_COLORS: Record<string, string> = { H: '#4f46e5', M: '#0b8f83', S: '#d9620c' };
export const OP_NAMES: Record<string, string> = { H: 'Hanif', M: 'Monir', S: 'Surjomukhi' };

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.surface, borderColor: t.line }, style]}>{children}</View>;
}

export function T({ children, muted, bold, size = 14, color, style, numberOfLines }: { children: ReactNode; muted?: boolean; bold?: boolean; size?: number; color?: string; style?: object; numberOfLines?: number }) {
  const t = useTheme();
  return <Text numberOfLines={numberOfLines} style={[{ color: color ?? (muted ? t.muted : t.ink), fontSize: size, fontWeight: bold ? '700' : '500' }, style]}>{children}</Text>;
}

export function Button({ title, onPress, primary, disabled }: { title: string; onPress(): void; primary?: boolean; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}
      style={({ pressed }) => [s.btn, { borderColor: primary ? t.accent : t.line, backgroundColor: primary ? t.accent : t.surface, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}>
      <Text style={{ color: primary ? t.accentInk : t.ink, fontWeight: '700', fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export function BusChip({ code }: { code: string }) {
  const c = OP_COLORS[code[0] ?? ''] ?? '#666';
  return (
    <View style={[s.chip, { backgroundColor: `${c}22` }]}>
      <View style={[s.dot, { backgroundColor: c }]} />
      <Text style={{ fontFamily: 'monospace', fontWeight: '700', fontSize: 12, color: '#0e1a33' }}>{code}</Text>
    </View>
  );
}

export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: [NoInfer<V>, string][]; onChange(v: NoInfer<V>): void }) {
  const t = useTheme();
  return (
    <View style={[s.seg, { backgroundColor: t.surface2, borderColor: t.line }]}>
      {options.map(([v, label]) => (
        <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: v === value }} onPress={() => onChange(v)} style={[s.segBtn, v === value && { backgroundColor: t.surface }]}>
          <Text style={{ fontWeight: '700', color: v === value ? t.ink : t.muted }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  btn: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, alignItems: 'center', minHeight: 44, justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7 },
  dot: { width: 7, height: 7, borderRadius: 2 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, padding: 3 },
  segBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
});
