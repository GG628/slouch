// This is "your app" — plain Expo/React Native, no Slouch plumbing.
// Edit it freely (or prompt the agent to). The prompt bar lives in slouch/ and
// floats on top no matter what you do in here.
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

export default function App() {
  const [taps, setTaps] = useState(0);
  const { width } = useWindowDimensions();
  const isNarrow = width < 380;

  return (
    <View style={styles.screen}>
      <StatusBar barStyle="light-content" />

      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={styles.scroll}
        contentContainerStyle={styles.content}
      >
        <View style={styles.hero}>
          <Text selectable style={styles.eyebrow}>
            Slouch Demo
          </Text>
          <Text selectable style={[styles.title, isNarrow && styles.titleNarrow]}>
            Edit me from the sofa.
          </Text>
          <Text selectable style={styles.body}>
            Everything on this screen is plain app code. Use the prompt bar at the
            bottom to ask the agent to change it — and watch it reload in your hand.
          </Text>
        </View>

        <Pressable style={styles.button} onPress={() => setTaps((n) => n + 1)}>
          <Text style={styles.buttonText}>
            Tapped {taps} {taps === 1 ? 'time' : 'times'}
          </Text>
        </Pressable>

        <View style={styles.row}>
          <View style={styles.stat}>
            <Text selectable style={styles.statValue}>
              SDK 55
            </Text>
            <Text selectable style={styles.statLabel}>
              Expo Go target
            </Text>
          </View>
          <View style={styles.stat}>
            <Text selectable style={styles.statValue}>
              JS/TS
            </Text>
            <Text selectable style={styles.statLabel}>
              hot reload only
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#ec4899',
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 16,
    padding: 22,
    paddingBottom: 220,
  },
  hero: {
    gap: 18,
    padding: 24,
    borderRadius: 26,
    borderCurve: 'continuous',
    backgroundColor: '#f8fafc',
  },
  eyebrow: {
    color: '#2563eb',
    fontSize: 13,
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
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: '#9333ea',
    paddingVertical: 20,
    alignItems: 'center',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    gap: 14,
  },
  stat: {
    flex: 1,
    gap: 4,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: '#102a56',
    padding: 18,
  },
  statValue: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    color: '#bfdbfe',
    fontSize: 14,
    fontWeight: '700',
  },
});
