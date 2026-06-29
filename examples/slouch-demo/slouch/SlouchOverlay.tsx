// Slouch overlay — a small prompt surface that stays outside app code.
//
// The primary view is intentionally conversation-first. Terminal output and
// connection diagnostics are available under Activity, but never compete with
// the prompt and the result the user is trying to see in the app.
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { BlurView } from 'expo-blur';
import Constants from 'expo-constants';
import {
  documentDirectory,
  EncodingType,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

type SendState = 'idle' | 'sending' | 'sent' | 'error';
type GitFile = { status: string; path: string };

const STATE_FILE = `${documentDirectory ?? ''}slouch-overlay-state.json`;
const STATUS_BAR = Constants.statusBarHeight ?? 44;
const BOTTOM_GAP = Platform.OS === 'ios' ? 28 : 18;

function cleanTerminalLine(line: string) {
  return line
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/[⏺⎿✻●❯⏵─]/g, '')
    .trim();
}

function shortFileName(value: string) {
  const path = value.trim().replace(/^['"]|['"]$/g, '');
  return path.split('/').filter(Boolean).pop() || path;
}

function latestCompletion(output: string) {
  const lines = output.split('\n').map(cleanTerminalLine).filter(Boolean);
  const index = lines.findLastIndex((line) => /(?:Cogitated|Worked|Finished) for \d+/i.test(line));
  if (index < 0) return null;
  return {
    label: lines[index],
    signature: lines.slice(Math.max(0, index - 2), index + 1).join('|'),
  };
}

function summarizeAgentOutput(output: string) {
  const lines = output.split('\n').map(cleanTerminalLine).filter(Boolean);
  for (const line of [...lines].reverse()) {
    const tool = line.match(/\b(Read|Update|Edit|Write|Bash|Grep|Glob|Search|Task)\(([^)]*)\)/i);
    if (!tool) continue;
    const name = tool[1].toLowerCase();
    const value = shortFileName(tool[2].split(',')[0]);
    if (['update', 'edit', 'write'].includes(name)) return `Editing ${value || 'the app'}`;
    if (name === 'read') return `Reading ${value || 'the project'}`;
    if (['grep', 'glob', 'search'].includes(name)) return 'Searching the project';
    if (name === 'bash') return 'Checking the work';
    if (name === 'task') return 'Working through the task';
  }
  return 'Thinking';
}

function authorityFromUrl(value?: string) {
  if (!value) return '';
  try {
    const normalized = value.includes('://') ? value : `http://${value}`;
    return new URL(normalized).host;
  } catch {
    return '';
  }
}

function defaultBridgeUrl() {
  const override = process.env.EXPO_PUBLIC_SLOUCH_BRIDGE_URL;
  if (override) return override.replace(/\/$/, '');

  const constants = Constants as unknown as {
    expoConfig?: { hostUri?: string };
    manifest?: { debuggerHost?: string };
    manifest2?: { extra?: { expoClient?: { hostUri?: string } } };
  };

  const sourceUrl = NativeModules.SourceCode?.scriptURL as string | undefined;
  const authority =
    authorityFromUrl(sourceUrl) ||
    authorityFromUrl(constants.expoConfig?.hostUri) ||
    authorityFromUrl(constants.manifest2?.extra?.expoClient?.hostUri) ||
    authorityFromUrl(constants.manifest?.debuggerHost);

  if (!authority) return '';
  const hostname = authority.split(':')[0];
  return hostname.endsWith('.exp.direct')
    ? `https://${hostname}/slouch`
    : `http://${authority}/slouch`;
}

function canUseGlass() {
  try {
    return (
      Platform.OS === 'ios' &&
      isLiquidGlassAvailable() &&
      isGlassEffectAPIAvailable()
    );
  } catch {
    return false;
  }
}

function AdaptiveGlass({
  children,
  interactive = false,
  style,
}: {
  children: React.ReactNode;
  interactive?: boolean;
  style?: object;
}) {
  if (canUseGlass()) {
    return (
      <GlassView isInteractive={interactive} style={style} glassEffectStyle="regular">
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView tint="systemMaterial" intensity={90} style={style}>
      {children}
    </BlurView>
  );
}

export function SlouchOverlay() {
  const [expanded, setExpanded] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [rawOutputOpen, setRawOutputOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState(defaultBridgeUrl);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [bridgeReady, setBridgeReady] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [recording, setRecording] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const [agentOutput, setAgentOutput] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [gitFiles, setGitFiles] = useState<GitFile[]>([]);
  const [agentActive, setAgentActive] = useState(false);
  const [currentActivity, setCurrentActivity] = useState('Thinking');
  const [activitySteps, setActivitySteps] = useState<string[]>([]);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const chatRef = useRef<ScrollView>(null);
  const lastOutputRef = useRef('');
  const completionBaselineRef = useRef('');
  const { height } = useWindowDimensions();
  const base = bridgeUrl.trim().replace(/\/$/, '');

  useEffect(() => {
    (async () => {
      try {
        const raw = await readAsStringAsync(STATE_FILE);
        const saved = JSON.parse(raw) as { prompt?: string; bridgeUrl?: string };
        if (typeof saved.prompt === 'string') setPrompt(saved.prompt);
        if (typeof saved.bridgeUrl === 'string' && saved.bridgeUrl) {
          setBridgeUrl(saved.bridgeUrl);
        }
      } catch {
        // First run has no state file.
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      writeAsStringAsync(STATE_FILE, JSON.stringify({ prompt, bridgeUrl })).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [prompt, bridgeUrl, hydrated]);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const ping = async () => {
      if (!base) {
        if (active) setBridgeReady(false);
        return;
      }
      try {
        const response = await fetch(`${base}/health`);
        if (active) setBridgeReady(response.ok);
      } catch {
        if (active) setBridgeReady(false);
      }
    };
    ping();
    const timer = setInterval(ping, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [base]);

  useEffect(() => {
    if (!expanded || !base) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`${base}/git/status`);
        const body = (await response.json()) as { branch?: string; files?: GitFile[] };
        if (active && response.ok) {
          setGitBranch(body.branch ?? '');
          setGitFiles(body.files ?? []);
        }
      } catch {
        // Connection state is already handled by the health check.
      }
    };
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [expanded, base]);

  useEffect(() => {
    if (!expanded || !base) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`${base}/output`);
        const body = (await response.json()) as { text?: string };
        if (active && typeof body.text === 'string') setAgentOutput(body.text);
      } catch {
        // Activity is optional; the prompt path can remain usable.
      }
    };
    refresh();
    const timer = setInterval(refresh, 1500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [expanded, base]);

  useEffect(() => {
    if (!agentOutput || agentOutput === lastOutputRef.current) return;
    lastOutputRef.current = agentOutput;
    if (!agentActive && sendState !== 'sending' && sendState !== 'sent') return;

    const completion = latestCompletion(agentOutput);
    if (completion && completion.signature !== completionBaselineRef.current) {
      completionBaselineRef.current = completion.signature;
      setAgentActive(false);
      setSendState('idle');
      setCurrentActivity(completion.label);
      setStatusMessage('Finished. The app should now be up to date.');
      setActivitySteps((steps) => [
        ...steps.filter((step) => step !== completion.label),
        completion.label,
      ].slice(-4));
      return;
    }

    const summary = summarizeAgentOutput(agentOutput);
    setAgentActive(true);
    setCurrentActivity(summary);
    setActivitySteps((steps) => {
      if (steps[steps.length - 1] === summary) return steps;
      return [...steps, summary].slice(-4);
    });
  }, [agentOutput, agentActive, sendState]);

  useEffect(() => {
    if (!expanded) return;
    const timer = setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(timer);
  }, [messages, sendState, currentActivity, detailsOpen, expanded]);

  async function sendPrompt() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    if (!base || !bridgeReady) {
      setSendState('error');
      setStatusMessage('Cannot reach the Mac. Open Activity to check the connection.');
      setDetailsOpen(true);
      return;
    }

    setSendState('sending');
    setStatusMessage('');
    setAgentActive(true);
    setCurrentActivity('Starting...');
    setActivitySteps([]);
    completionBaselineRef.current = latestCompletion(agentOutput)?.signature ?? '';
    lastOutputRef.current = agentOutput;
    try {
      const response = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Bridge returned ${response.status}`);

      setMessages((current) => [...current, trimmedPrompt]);
      setPrompt('');
      setSendState('sent');
      setCurrentActivity('Thinking');
    } catch (error) {
      setSendState('error');
      setStatusMessage(error instanceof Error ? error.message : 'Could not reach the Mac.');
    }
  }

  async function startRecording() {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setSendState('error');
        setStatusMessage('Microphone permission denied.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setSendState('idle');
      setStatusMessage('Listening...');
    } catch (error) {
      setRecording(false);
      setSendState('error');
      setStatusMessage(error instanceof Error ? error.message : 'Could not start recording.');
    }
  }

  async function stopAndTranscribe() {
    try {
      await recorder.stop();
      setRecording(false);
      const uri = recorder.uri;
      if (!uri) throw new Error('No audio captured.');
      if (!base) throw new Error('Cannot reach the Mac.');

      setSendState('sending');
      setStatusMessage('Transcribing...');
      const audio = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
      const response = await fetch(`${base}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio, format: 'm4a' }),
      });
      const body = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) throw new Error(body.error || `Bridge returned ${response.status}`);

      const text = (body.text ?? '').trim();
      setSendState('idle');
      setStatusMessage(text ? '' : 'Heard nothing. Try again.');
      if (text) setPrompt((current) => (current ? `${current} ${text}` : text));
    } catch (error) {
      setRecording(false);
      setSendState('error');
      setStatusMessage(error instanceof Error ? error.message : 'Transcription failed.');
    }
  }

  const dotColor =
    sendState === 'error'
      ? '#ff453a'
      : sendState === 'sending'
        ? '#ffcc00'
        : bridgeReady
          ? '#30d158'
          : '#8e8e93';

  if (!expanded) {
    return (
      <View pointerEvents="box-none" style={[styles.root, styles.collapsedRoot]}>
        <AdaptiveGlass interactive style={styles.pillGlass}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Slouch"
            onPress={() => setExpanded(true)}
            style={styles.pill}
          >
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text style={styles.pillText}>Slouch</Text>
          </Pressable>
        </AdaptiveGlass>
      </View>
    );
  }

  const sheetStyle =
    keyboardHeight > 0
      ? { top: STATUS_BAR + 4, bottom: keyboardHeight + 8 }
      : { bottom: BOTTOM_GAP, height: Math.min(height * 0.72, 620) };
  const activityOutput = agentOutput
    .split('\n')
    .slice(-18)
    .join('\n')
    .trim();

  return (
    <View pointerEvents="box-none" style={styles.root}>
      <AdaptiveGlass style={[styles.sheet, sheetStyle]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Slouch"
            onPress={() => setExpanded(false)}
            style={styles.closeButton}
          >
            <Text style={styles.closeText}>x</Text>
          </Pressable>
          <View style={styles.titleGroup}>
            <Text style={styles.title}>Slouch</Text>
            <Text numberOfLines={1} style={styles.subtitle}>
              {gitBranch || 'Your app'}
            </Text>
          </View>
          <View style={styles.connection}>
            <View style={[styles.dot, { backgroundColor: dotColor }]} />
            <Text style={styles.connectionText}>{bridgeReady ? 'Connected' : 'Offline'}</Text>
          </View>
        </View>

        <ScrollView
          ref={chatRef}
          style={styles.chat}
          contentContainerStyle={styles.chatContent}
          keyboardShouldPersistTaps="handled"
        >
          {messages.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>What should we change?</Text>
            </View>
          ) : (
            messages.map((item, index) => (
              <View key={`${index}-${item}`} style={styles.userBubble}>
                <Text selectable style={styles.userText}>
                  {item}
                </Text>
              </View>
            ))
          )}

          {agentActive || sendState !== 'idle' || statusMessage ? (
            <View style={styles.statusRow}>
              {agentActive || sendState === 'sending' ? (
                <ActivityIndicator size="small" color="#ffffff" />
              ) : (
                <View style={[styles.statusIcon, { backgroundColor: dotColor }]} />
              )}
              <Text style={[styles.statusText, sendState === 'error' && styles.errorText]}>
                {sendState === 'error'
                  ? statusMessage
                  : sendState === 'sending'
                    ? 'Sending...'
                    : agentActive
                      ? currentActivity
                      : statusMessage}
              </Text>
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={detailsOpen ? 'Hide activity' : 'Show activity'}
            onPress={() => setDetailsOpen((open) => !open)}
            style={styles.activityButton}
          >
            <Text style={styles.activityLabel}>
              {detailsOpen ? 'Hide activity' : 'Activity'}
            </Text>
            <Text style={styles.activityMeta}>
              {activitySteps.length
                ? `${activitySteps.length} ${activitySteps.length === 1 ? 'step' : 'steps'}`
                : gitFiles.length
                  ? `${gitFiles.length} changed`
                  : 'Details'}
            </Text>
          </Pressable>

          {detailsOpen ? (
            <View style={styles.activityPanel}>
              <Text style={styles.activitySummary}>
                {bridgeReady ? 'Mac connected' : 'Mac not reachable'}
                {gitBranch ? `  |  ${gitBranch}` : ''}
              </Text>
              {activitySteps.length ? (
                <View style={styles.stepList}>
                  {activitySteps.map((step, index) => (
                    <View key={`${index}-${step}`} style={styles.stepRow}>
                      <View
                        style={[
                          styles.stepDot,
                          index === activitySteps.length - 1 && agentActive && styles.stepDotActive,
                        ]}
                      />
                      <Text style={styles.stepText}>{step}</Text>
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.activityEmpty}>No agent activity yet.</Text>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={rawOutputOpen ? 'Hide technical details' : 'Show technical details'}
                onPress={() => setRawOutputOpen((open) => !open)}
                style={styles.technicalButton}
              >
                <Text style={styles.technicalLabel}>
                  {rawOutputOpen ? 'Hide technical details' : 'Technical details'}
                </Text>
              </Pressable>
              {rawOutputOpen ? (
                <View style={styles.technicalPanel}>
                  {activityOutput ? (
                    <Text selectable style={styles.terminalText}>
                      {activityOutput}
                    </Text>
                  ) : null}
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={bridgeUrl}
                    onChangeText={setBridgeUrl}
                    placeholder="Bridge address"
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    style={styles.bridgeInput}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.composer}>
          <TextInput
            multiline
            value={prompt}
            onChangeText={(value) => {
              setPrompt(value);
              if (sendState === 'error') {
                setSendState('idle');
                setStatusMessage('');
              }
            }}
            placeholder="Message Slouch"
            placeholderTextColor="rgba(255,255,255,0.42)"
            style={styles.composerInput}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop dictation' : 'Dictate prompt'}
            onPress={() => (recording ? stopAndTranscribe() : startRecording())}
            style={[styles.iconButton, recording && styles.recordingButton]}
          >
            <Text style={styles.micText}>{recording ? '■' : 'mic'}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send prompt"
            disabled={!prompt.trim() || sendState === 'sending'}
            onPress={sendPrompt}
            style={[
              styles.sendButton,
              (!prompt.trim() || sendState === 'sending') && styles.sendButtonDisabled,
            ]}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
        </View>
      </AdaptiveGlass>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
  },
  collapsedRoot: {
    justifyContent: 'flex-end',
    paddingBottom: BOTTOM_GAP,
  },
  pillGlass: {
    overflow: 'hidden',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: '#05070a',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  pillText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  sheet: {
    position: 'absolute',
    right: 8,
    left: 8,
    overflow: 'hidden',
    borderRadius: 24,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: '#090a0c',
    padding: 12,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 2,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.09)',
  },
  closeText: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 15,
    fontWeight: '700',
  },
  titleGroup: {
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
  },
  connection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  connectionText: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 12,
    fontWeight: '600',
  },
  chat: {
    flex: 1,
  },
  chatContent: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 180,
  },
  emptyTitle: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 17,
    fontWeight: '600',
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 20,
  },
  statusRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    maxWidth: '90%',
    paddingVertical: 4,
  },
  statusIcon: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusText: {
    flexShrink: 1,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    lineHeight: 19,
  },
  errorText: {
    color: '#ff8a80',
  },
  activityButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  activityLabel: {
    color: 'rgba(255,255,255,0.66)',
    fontSize: 13,
    fontWeight: '600',
  },
  activityMeta: {
    color: 'rgba(255,255,255,0.34)',
    fontSize: 12,
  },
  activityPanel: {
    gap: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.055)',
    padding: 12,
  },
  activitySummary: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    fontWeight: '600',
  },
  activityEmpty: {
    color: 'rgba(255,255,255,0.38)',
    fontSize: 12,
  },
  stepList: {
    gap: 9,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.32)',
  },
  stepDotActive: {
    backgroundColor: '#ffcc00',
  },
  stepText: {
    flex: 1,
    color: 'rgba(255,255,255,0.68)',
    fontSize: 13,
    lineHeight: 18,
  },
  technicalButton: {
    alignSelf: 'flex-start',
    paddingVertical: 2,
  },
  technicalLabel: {
    color: 'rgba(255,255,255,0.42)',
    fontSize: 11,
    fontWeight: '600',
  },
  technicalPanel: {
    gap: 10,
  },
  terminalText: {
    color: 'rgba(255,255,255,0.58)',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  bridgeInput: {
    height: 36,
    borderRadius: 9,
    backgroundColor: 'rgba(255,255,255,0.07)',
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    paddingHorizontal: 10,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 7,
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.09)',
    padding: 5,
    paddingLeft: 11,
  },
  composerInput: {
    flex: 1,
    minHeight: 38,
    maxHeight: 108,
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 21,
    paddingHorizontal: 3,
    paddingVertical: 8,
  },
  iconButton: {
    minWidth: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingButton: {
    backgroundColor: 'rgba(255,69,58,0.28)',
  },
  micText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: '700',
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  sendButtonDisabled: {
    opacity: 0.28,
  },
  sendText: {
    color: '#090a0c',
    fontSize: 20,
    fontWeight: '800',
    marginTop: -1,
  },
});
