import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  StatusBar,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

const prompts = [
  'Make the hero title say "Sofa mode works".',
  'Change the button color and add a tiny celebratory subtitle.',
  'Add a new card that says the phone loop is alive.',
];

export default function App() {
  const [count, setCount] = useState(0);
  const { width } = useWindowDimensions();
  const isNarrow = width < 380;

  const activePrompt = useMemo(() => prompts[count % prompts.length], [count]);

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <StatusBar barStyle="light-content" />

      <View style={styles.hero}>
        <Text selectable style={styles.eyebrow}>
          Slouch Demo
        </Text>
        <Text selectable style={[styles.title, isNarrow && styles.titleNarrow]}>
          Prompt from the sofa. Watch Expo reload.
        </Text>
        <Text selectable style={styles.body}>
          This app is deliberately simple: no auth, no APIs, no native rebuilds.
          It exists so Slouch changes are obvious in your hand.
        </Text>

        <Pressable style={styles.button} onPress={() => setCount((value) => value + 1)}>
          <Text style={styles.buttonText}>Change demo state</Text>
        </Pressable>
      </View>

      <View style={styles.card}>
        <Text selectable style={styles.cardLabel}>
          Current test prompt
        </Text>
        <Text selectable style={styles.prompt}>
          {activePrompt}
        </Text>
      </View>

      <View style={styles.row}>
        <View style={styles.stat}>
          <Text selectable style={styles.statValue}>
            {count}
          </Text>
          <Text selectable style={styles.statLabel}>
            local taps
          </Text>
        </View>
        <View style={styles.stat}>
          <Text selectable style={styles.statValue}>
            JS
          </Text>
          <Text selectable style={styles.statLabel}>
            only
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0b1220',
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 18,
    padding: 22,
  },
  hero: {
    gap: 18,
    padding: 22,
    borderRadius: 28,
    backgroundColor: '#f8fafc',
  },
  eyebrow: {
    color: '#2563eb',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: '#0f172a',
    fontSize: 38,
    fontWeight: '900',
    lineHeight: 42,
  },
  titleNarrow: {
    fontSize: 32,
    lineHeight: 36,
  },
  body: {
    color: '#475569',
    fontSize: 17,
    lineHeight: 24,
  },
  button: {
    alignItems: 'center',
    borderRadius: 999,
    backgroundColor: '#111827',
    paddingVertical: 15,
    paddingHorizontal: 18,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  card: {
    gap: 8,
    borderRadius: 22,
    backgroundColor: '#1d4ed8',
    padding: 20,
  },
  cardLabel: {
    color: '#bfdbfe',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  prompt: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 26,
  },
  row: {
    flexDirection: 'row',
    gap: 14,
  },
  stat: {
    flex: 1,
    gap: 4,
    borderRadius: 20,
    backgroundColor: '#172554',
    padding: 18,
  },
  statValue: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: '#bfdbfe',
    fontSize: 14,
    fontWeight: '700',
  },
});
