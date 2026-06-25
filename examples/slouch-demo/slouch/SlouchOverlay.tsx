// Slouch overlay — the in-app prompt bar that talks to the Metro bridge.
//
// This file is Slouch *infrastructure*, not app code. It is mounted at the root
// (see index.js) as a sibling of your app, so it floats on top and survives any
// edit the agent makes to App.tsx. Don't move the prompt bar back into your app —
// keeping it here is what makes it unbreakable.
import Constants from 'expo-constants';
import { BlurView } from 'expo-blur';
import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import {
  documentDirectory,
  EncodingType,
  readAsStringAsync,
  writeAsStringAsync,
} from 'expo-file-system/legacy';
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
type Tab = 'agent' | 'git';
type GitFile = { status: string; path: string };

// Persist the in-progress prompt to disk so a full reload (the kind Fast Refresh
// can't patch) doesn't wipe what you were typing. Survives reloads, but not a
// syntax-error red-screen (recover from the agent window in that case).
const STATE_FILE = `${documentDirectory ?? ''}slouch-overlay-state.json`;

// Returns "host:port" (port omitted only when it's the protocol default), so we
// keep Metro's port — the bridge lives inside Metro on the same origin.
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

  // Tunnels (xxx.exp.direct) serve over HTTPS on 443 and proxy straight to Metro,
  // so the /slouch route rides the same tunnel — no extra port to expose.
  const hostname = authority.split(':')[0];
  if (hostname.endsWith('.exp.direct')) {
    return `https://${hostname}/slouch`;
  }

  return `http://${authority}/slouch`;
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
  const [prompt, setPrompt] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState(defaultBridgeUrl);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [message, setMessage] = useState('Ready for sofa prompts.');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [recording, setRecording] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // Panel state (agent output mirror + git).
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('agent');
  const [agentOutput, setAgentOutput] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [gitFiles, setGitFiles] = useState<GitFile[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [branchName, setBranchName] = useState('');
  const [gitMsg, setGitMsg] = useState('');
  const outputRef = useRef<ScrollView>(null);

  const { height } = useWindowDimensions();
  const base = bridgeUrl.trim().replace(/\/$/, '');

  // Rehydrate the in-progress prompt once on mount.
  useEffect(() => {
    (async () => {
      try {
        const raw = await readAsStringAsync(STATE_FILE);
        const saved = JSON.parse(raw) as { prompt?: string };
        if (typeof saved.prompt === 'string' && saved.prompt) {
          setPrompt(saved.prompt);
          setMessage('Restored your draft.');
        }
      } catch {
        // No saved state yet — fine.
      }
      setHydrated(true);
    })();
  }, []);

  // Persist the prompt (debounced) so it survives reloads.
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      writeAsStringAsync(STATE_FILE, JSON.stringify({ prompt })).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [prompt, hydrated]);

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, (event) => {
      setKeyboardHeight(event.endCoordinates.height);
    });
    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  // Poll the agent's terminal output while the Agent tab is open.
  useEffect(() => {
    if (!panelOpen || tab !== 'agent' || !base) return;

    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`${base}/output`);
        const body = (await res.json()) as { text?: string };
        if (active && typeof body.text === 'string') setAgentOutput(body.text);
      } catch {
        // ignore transient errors while polling
      }
    };

    tick();
    const id = setInterval(tick, 1500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [panelOpen, tab, base]);

  async function refreshGit() {
    if (!base) {
      setGitMsg('Set the bridge URL first.');
      return;
    }
    try {
      const res = await fetch(`${base}/git/status`);
      const body = (await res.json()) as { branch?: string; files?: GitFile[]; error?: string };
      if (!res.ok) throw new Error(body.error || `Bridge returned ${res.status}`);
      setGitBranch(body.branch ?? '');
      setGitFiles(body.files ?? []);
      setGitMsg(`${body.files?.length ?? 0} changed file(s)`);
    } catch (error) {
      setGitMsg(error instanceof Error ? error.message : 'git status failed');
    }
  }

  // Load git status when the Git tab opens.
  useEffect(() => {
    if (panelOpen && tab === 'git' && base) refreshGit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, tab, base]);

  async function sendPrompt() {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      setMessage('Type a prompt first.');
      setSendState('error');
      return;
    }
    if (!base) {
      setMessage('Set the bridge URL from the Mac first.');
      setSendState('error');
      return;
    }

    setSendState('sending');
    setMessage('Sending to the agent...');

    try {
      const response = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Bridge returned ${response.status}`);

      setPrompt('');
      setSendState('sent');
      setMessage('Sent. Watch Metro reload.');
      if (!panelOpen) {
        setPanelOpen(true);
        setTab('agent');
      }
    } catch (error) {
      setSendState('error');
      setMessage(error instanceof Error ? error.message : 'Could not reach bridge.');
    }
  }

  async function startRecording() {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setSendState('error');
        setMessage('Microphone permission denied.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setSendState('idle');
      setMessage('Listening… tap to stop.');
    } catch (error) {
      setRecording(false);
      setSendState('error');
      setMessage(error instanceof Error ? error.message : 'Could not start recording.');
    }
  }

  async function stopAndTranscribe() {
    try {
      await recorder.stop();
      setRecording(false);

      const uri = recorder.uri;
      if (!uri) throw new Error('No audio captured.');
      if (!base) {
        setSendState('error');
        setMessage('Set the bridge URL first.');
        return;
      }

      setSendState('sending');
      setMessage('Transcribing…');

      const audio = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
      const response = await fetch(`${base}/transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio, format: 'm4a' }),
      });
      const body = (await response.json()) as { text?: string; error?: string };
      if (!response.ok) throw new Error(body.error || `Bridge returned ${response.status}`);

      const text = (body.text ?? '').trim();
      if (!text) {
        setSendState('idle');
        setMessage('Heard nothing — try again.');
        return;
      }

      setPrompt((prev) => (prev ? `${prev} ${text}` : text));
      setSendState('idle');
      setMessage('Transcribed. Edit or hit Send.');
    } catch (error) {
      setRecording(false);
      setSendState('error');
      setMessage(error instanceof Error ? error.message : 'Transcription failed.');
    }
  }

  function toggleMic() {
    if (recording) stopAndTranscribe();
    else startRecording();
  }

  async function gitCommit() {
    const msg = commitMsg.trim();
    if (!msg) {
      setGitMsg('Type a commit message.');
      return;
    }
    setGitMsg('Committing…');
    try {
      const res = await fetch(`${base}/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      });
      const body = (await res.json()) as { result?: string; error?: string };
      if (!res.ok) throw new Error(body.error || `Bridge returned ${res.status}`);
      setCommitMsg('');
      setGitMsg('Committed.');
      refreshGit();
    } catch (error) {
      setGitMsg(error instanceof Error ? error.message : 'Commit failed.');
    }
  }

  async function gitSwitch(create: boolean) {
    const name = branchName.trim();
    if (!name) {
      setGitMsg('Type a branch name.');
      return;
    }
    setGitMsg(create ? 'Creating branch…' : 'Switching…');
    try {
      const res = await fetch(`${base}/git/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, create }),
      });
      const body = (await res.json()) as { result?: string; error?: string };
      if (!res.ok) throw new Error(body.error || `Bridge returned ${res.status}`);
      setBranchName('');
      setGitMsg(body.result ?? 'Done.');
      refreshGit();
    } catch (error) {
      setGitMsg(error instanceof Error ? error.message : 'Switch failed.');
    }
  }

  function openTab(next: Tab) {
    setTab(next);
    setPanelOpen(true);
  }

  const panelMaxHeight = Math.min(height * 0.4, 320);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlayWrap, keyboardHeight > 0 && { bottom: keyboardHeight }]}
    >
      <AdaptiveGlass style={styles.overlay}>
        {/* Tab / expand row */}
        <View style={styles.tabRow}>
          <Pressable onPress={() => setPanelOpen((v) => !v)} style={styles.chevron}>
            <Text style={styles.chevronText}>{panelOpen ? '▾' : '▸'}</Text>
          </Pressable>
          <Pressable onPress={() => openTab('agent')} style={styles.tabBtn}>
            <Text style={[styles.tabText, panelOpen && tab === 'agent' && styles.tabTextActive]}>
              Agent
            </Text>
          </Pressable>
          <Pressable onPress={() => openTab('git')} style={styles.tabBtn}>
            <Text style={[styles.tabText, panelOpen && tab === 'git' && styles.tabTextActive]}>
              Git{gitFiles.length ? ` (${gitFiles.length})` : ''}
            </Text>
          </Pressable>
        </View>

        {panelOpen ? (
          <View style={[styles.panel, { maxHeight: panelMaxHeight }]}>
            {tab === 'agent' ? (
              <ScrollView
                ref={outputRef}
                style={styles.panelScroll}
                onContentSizeChange={() => outputRef.current?.scrollToEnd({ animated: false })}
              >
                <Text selectable style={styles.mono}>
                  {agentOutput || 'Waiting for agent output…'}
                </Text>
              </ScrollView>
            ) : (
              <ScrollView style={styles.panelScroll} keyboardShouldPersistTaps="handled">
                <Text style={styles.gitBranch}>⎇ {gitBranch || '—'}</Text>

                <View style={styles.gitInputRow}>
                  <TextInput
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={branchName}
                    onChangeText={setBranchName}
                    placeholder="branch name"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    style={styles.gitInput}
                  />
                  <Pressable onPress={() => gitSwitch(false)} style={styles.gitBtn}>
                    <Text style={styles.gitBtnText}>Switch</Text>
                  </Pressable>
                  <Pressable onPress={() => gitSwitch(true)} style={styles.gitBtn}>
                    <Text style={styles.gitBtnText}>New</Text>
                  </Pressable>
                </View>

                {gitFiles.length === 0 ? (
                  <Text style={styles.gitClean}>Working tree clean</Text>
                ) : (
                  gitFiles.map((f) => (
                    <Text key={f.path} selectable style={styles.gitFile}>
                      <Text style={styles.gitFileStatus}>{f.status || '•'}</Text> {f.path}
                    </Text>
                  ))
                )}

                <View style={styles.gitInputRow}>
                  <TextInput
                    value={commitMsg}
                    onChangeText={setCommitMsg}
                    placeholder="commit message"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    style={styles.gitInput}
                  />
                  <Pressable onPress={gitCommit} style={styles.gitBtn}>
                    <Text style={styles.gitBtnText}>Commit all</Text>
                  </Pressable>
                </View>

                <Pressable onPress={refreshGit} style={styles.gitRefresh}>
                  <Text style={styles.gitRefreshText}>↻ Refresh</Text>
                </Pressable>

                {gitMsg ? <Text style={styles.gitStatusMsg}>{gitMsg}</Text> : null}
              </ScrollView>
            )}
          </View>
        ) : null}

        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              sendState === 'sent' && styles.statusDotSent,
              sendState === 'error' && styles.statusDotError,
            ]}
          />
          <Text selectable numberOfLines={1} style={styles.statusText}>
            {message}
          </Text>
        </View>

        <TextInput
          multiline
          value={prompt}
          onChangeText={(value) => {
            setPrompt(value);
            if (sendState !== 'sending') setSendState('idle');
          }}
          placeholder="Ask the agent to change this app..."
          placeholderTextColor="rgba(255,255,255,0.52)"
          returnKeyType="default"
          style={styles.promptInput}
        />

        <View style={styles.bridgeRow}>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            value={bridgeUrl}
            onChangeText={setBridgeUrl}
            placeholder="http://your-mac-ip:8081/slouch"
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={styles.bridgeInput}
          />
          <AdaptiveGlass
            interactive
            style={[styles.micGlass, recording && styles.micGlassActive]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recording ? 'Stop dictation' : 'Dictate a prompt'}
              onPress={toggleMic}
              style={styles.micButton}
            >
              <Text style={styles.micText}>{recording ? '■' : '🎤'}</Text>
            </Pressable>
          </AdaptiveGlass>
          <AdaptiveGlass interactive style={styles.sendGlass}>
            <Pressable
              accessibilityRole="button"
              disabled={sendState === 'sending'}
              onPress={sendPrompt}
              style={styles.sendButton}
            >
              {sendState === 'sending' ? (
                <ActivityIndicator color="#07111f" />
              ) : (
                <Text style={styles.sendText}>Send</Text>
              )}
            </Pressable>
          </AdaptiveGlass>
        </View>
      </AdaptiveGlass>
    </View>
  );
}

const styles = StyleSheet.create({
  overlayWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    paddingBottom: 18,
  },
  overlay: {
    gap: 10,
    overflow: 'hidden',
    borderRadius: 28,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(9,18,32,0.72)',
    padding: 12,
  },
  tabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  chevron: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronText: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    fontWeight: '900',
  },
  tabBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tabText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '800',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  panel: {
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(0,0,0,0.35)',
    padding: 10,
  },
  panelScroll: {
    flexGrow: 0,
  },
  mono: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    lineHeight: 15,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  gitBranch: {
    color: '#7dd3fc',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 8,
  },
  gitInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginVertical: 6,
  },
  gitInput: {
    flex: 1,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#ffffff',
    fontSize: 13,
    paddingHorizontal: 10,
  },
  gitBtn: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  gitBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  gitClean: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 13,
    paddingVertical: 6,
  },
  gitFile: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  gitFileStatus: {
    color: '#fbbf24',
    fontWeight: '900',
  },
  gitRefresh: {
    paddingVertical: 6,
  },
  gitRefreshText: {
    color: '#7dd3fc',
    fontSize: 13,
    fontWeight: '800',
  },
  gitStatusMsg: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 12,
    fontWeight: '600',
  },
  statusRow: {
    minHeight: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 4,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94a3b8',
  },
  statusDotSent: {
    backgroundColor: '#22c55e',
  },
  statusDotError: {
    backgroundColor: '#fb7185',
  },
  statusText: {
    flex: 1,
    color: 'rgba(255,255,255,0.74)',
    fontSize: 13,
    fontWeight: '700',
  },
  promptInput: {
    minHeight: 58,
    maxHeight: 122,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.11)',
    color: '#ffffff',
    fontSize: 17,
    lineHeight: 22,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  bridgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bridgeInput: {
    flex: 1,
    height: 46,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.09)',
    color: 'rgba(255,255,255,0.82)',
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 14,
  },
  micGlass: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  micGlassActive: {
    backgroundColor: '#fb7185',
  },
  micButton: {
    width: 46,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micText: {
    fontSize: 18,
    color: '#ffffff',
    fontWeight: '900',
  },
  sendGlass: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  sendButton: {
    minWidth: 78,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  sendText: {
    color: '#07111f',
    fontSize: 16,
    fontWeight: '900',
  },
});
