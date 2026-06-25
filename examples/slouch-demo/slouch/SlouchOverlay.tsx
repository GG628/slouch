// Slouch overlay — a floating status pill that expands into mission control.
//
// This file is Slouch *infrastructure*, not app code. It is mounted at the root
// (see index.js) as a sibling of your app, so it floats on top and survives any
// edit the agent makes to App.tsx. Don't move it back into your app — keeping it
// here is what makes it unbreakable.
//
// Collapsed: a small pill at the bottom with a status light (green = bridge ready).
// Expanded:  a bottom sheet — chat, changes, agents, connection — then collapse
//            and carry on using the app behind it.
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
type Tab = 'chat' | 'changes' | 'agents' | 'connection';
type GitFile = { status: string; path: string };

const STATE_FILE = `${documentDirectory ?? ''}slouch-overlay-state.json`;
const STATUS_BAR = Constants.statusBarHeight ?? 44;
const BOTTOM_GAP = Platform.OS === 'ios' ? 28 : 18;

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
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('chat');
  const [prompt, setPrompt] = useState('');
  const [bridgeUrl, setBridgeUrl] = useState(defaultBridgeUrl);
  const [sendState, setSendState] = useState<SendState>('idle');
  const [message, setMessage] = useState('');
  const [bridgeReady, setBridgeReady] = useState(false);
  const [bridgeTarget, setBridgeTarget] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [recording, setRecording] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const [messages, setMessages] = useState<string[]>([]);
  const [agentOutput, setAgentOutput] = useState('');
  const [gitBranch, setGitBranch] = useState('');
  const [gitFiles, setGitFiles] = useState<GitFile[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [branchName, setBranchName] = useState('');
  const [gitMsg, setGitMsg] = useState('');
  const [pushing, setPushing] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const chatRef = useRef<ScrollView>(null);
  const { height } = useWindowDimensions();
  const base = bridgeUrl.trim().replace(/\/$/, '');

  // ---- persistence: keep the draft prompt across reloads --------------------
  useEffect(() => {
    (async () => {
      try {
        const raw = await readAsStringAsync(STATE_FILE);
        const saved = JSON.parse(raw) as { prompt?: string };
        if (typeof saved.prompt === 'string' && saved.prompt) setPrompt(saved.prompt);
      } catch {
        // none yet
      }
      setHydrated(true);
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      writeAsStringAsync(STATE_FILE, JSON.stringify({ prompt })).catch(() => {});
    }, 300);
    return () => clearTimeout(timer);
  }, [prompt, hydrated]);

  // ---- keyboard height ------------------------------------------------------
  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ---- status light: ping the bridge ----------------------------------------
  useEffect(() => {
    let active = true;
    const ping = async () => {
      if (!base) {
        if (active) setBridgeReady(false);
        return;
      }
      try {
        const r = await fetch(`${base}/health`);
        const body = (await r.json().catch(() => ({}))) as { target?: string };
        if (active) {
          setBridgeReady(r.ok);
          if (typeof body.target === 'string') setBridgeTarget(body.target);
        }
      } catch {
        if (active) {
          setBridgeReady(false);
          setBridgeTarget('');
        }
      }
    };
    ping();
    const id = setInterval(ping, 4000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [base]);

  // ---- poll the agent's output while the Chat tab is open -------------------
  useEffect(() => {
    if (!expanded || tab !== 'chat' || !base) return;
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch(`${base}/output`);
        const body = (await res.json()) as { text?: string };
        if (active && typeof body.text === 'string') setAgentOutput(body.text);
      } catch {
        // transient
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [expanded, tab, base]);

  async function refreshGit() {
    if (!base) {
      setGitMsg('Connect to your Mac first.');
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

  // Load branch name on open (for the header) + changes when the tab opens.
  useEffect(() => {
    if (expanded && base) refreshGit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, tab, base]);

  // Keep chat scrolled to the newest content.
  useEffect(() => {
    if (expanded && tab === 'chat') {
      const t = setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 60);
      return () => clearTimeout(t);
    }
  }, [agentOutput, messages, expanded, tab]);

  async function sendPrompt() {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;
    if (!base) {
      setMessage('Connect to your Mac first.');
      setSendState('error');
      setTab('connection');
      return;
    }

    setSendState('sending');
    setMessage('');
    try {
      const response = await fetch(`${base}/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: trimmedPrompt }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error || `Bridge returned ${response.status}`);

      setMessages((m) => [...m, trimmedPrompt]);
      setPrompt('');
      setSendState('sent');
      setTab('chat');
    } catch (error) {
      setSendState('error');
      setMessage(error instanceof Error ? error.message : 'Could not reach bridge.');
    }
  }

  async function startRecording() {
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setMessage('Microphone permission denied.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setMessage('Listening… tap to stop.');
    } catch (error) {
      setRecording(false);
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
        setMessage('Connect to your Mac first.');
        setTab('connection');
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
      setSendState('idle');
      if (!text) {
        setMessage('Heard nothing — try again.');
        return;
      }
      setPrompt((prev) => (prev ? `${prev} ${text}` : text));
      setMessage('');
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

  function newChat() {
    setMessages([]);
    setAgentOutput('');
    setMessage('');
    setSendState('idle');
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
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || `Bridge returned ${res.status}`);
      setCommitMsg('');
      setGitMsg('Committed.');
      refreshGit();
    } catch (error) {
      setGitMsg(error instanceof Error ? error.message : 'Commit failed.');
    }
  }

  async function gitPush() {
    if (!base) {
      setGitMsg('Connect to your Mac first.');
      setTab('connection');
      return;
    }
    setPushing(true);
    setGitMsg('Pushing…');
    try {
      const res = await fetch(`${base}/git/push`, { method: 'POST' });
      const body = (await res.json()) as { result?: string; error?: string };
      if (!res.ok) throw new Error(body.error || `Bridge returned ${res.status}`);
      setGitMsg(body.result ?? 'Pushed.');
      refreshGit();
    } catch (error) {
      setGitMsg(error instanceof Error ? error.message : 'Push failed.');
    } finally {
      setPushing(false);
    }
  }

  async function gitSwitch(create: boolean) {
    const name = branchName.trim();
    if (!name) {
      setGitMsg('Type a branch name.');
      return;
    }
    setGitMsg(create ? 'Creating…' : 'Switching…');
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

  const dotColor =
    sendState === 'error'
      ? '#fb7185'
      : sendState === 'sending'
        ? '#fbbf24'
        : bridgeReady
          ? '#22c55e'
          : '#64748b';

  // ---- collapsed pill -------------------------------------------------------
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

  // ---- expanded sheet -------------------------------------------------------
  const sheetStyle = keyboardHeight > 0
    ? { top: STATUS_BAR + 4, bottom: keyboardHeight + 8 }
    : { bottom: BOTTOM_GAP, maxHeight: height * 0.68 };

  const trimmedOutput = agentOutput
    ? agentOutput.split('\n').slice(-60).join('\n').trim()
    : '';

  return (
    <View pointerEvents="box-none" style={styles.root}>
      <AdaptiveGlass style={[styles.sheet, sheetStyle]}>
        {/* Header */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => setExpanded(false)}
            style={styles.closeBtn}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <Text numberOfLines={1} style={styles.headerTitle}>
            {gitBranch || 'slouch'}
          </Text>
          <Text style={styles.headerStatus}>{bridgeReady ? 'Connected' : 'Offline'}</Text>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        </View>

        <View style={styles.contentRow}>
          <View style={styles.sideBar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Chat"
              onPress={() => setTab('chat')}
              style={[styles.sideBtn, tab === 'chat' && styles.sideBtnActive]}
            >
              <Text style={styles.sideIcon}>⌁</Text>
              <Text style={styles.sideLabel}>Chat</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Changes"
              onPress={() => setTab('changes')}
              style={[styles.sideBtn, tab === 'changes' && styles.sideBtnActive]}
            >
              <Text style={styles.sideIcon}>∆</Text>
              <Text style={styles.sideLabel}>
                {gitFiles.length ? `Files ${gitFiles.length}` : 'Files'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Agents"
              onPress={() => setTab('agents')}
              style={[styles.sideBtn, tab === 'agents' && styles.sideBtnActive]}
            >
              <Text style={styles.sideIcon}>*</Text>
              <Text style={styles.sideLabel}>Agents</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Connection"
              onPress={() => setTab('connection')}
              style={[styles.sideBtn, tab === 'connection' && styles.sideBtnActive]}
            >
              <Text style={styles.sideIcon}>•</Text>
              <Text style={styles.sideLabel}>Link</Text>
            </Pressable>
          </View>

          <View style={styles.mainPane}>
            <View style={styles.paneHeader}>
              <Text style={styles.paneTitle}>
                {tab === 'chat'
                  ? 'Chat'
                  : tab === 'changes'
                    ? 'Changes'
                    : tab === 'agents'
                      ? 'Agents'
                      : 'Connection'}
              </Text>
              {tab === 'chat' ? (
                <Pressable onPress={newChat} style={styles.newBtn} hitSlop={8}>
                  <Text style={styles.newText}>New</Text>
                </Pressable>
              ) : null}
            </View>

            {tab === 'chat' ? (
              <ScrollView ref={chatRef} style={styles.body} contentContainerStyle={styles.bodyContent}>
                {messages.length === 0 && !trimmedOutput ? (
                  <View style={styles.empty}>
                    <Text style={styles.emptyText}>Send a prompt to start coding</Text>
                  </View>
                ) : (
                  <>
                    {messages.map((m, i) => (
                      <View key={i} style={styles.userBubble}>
                        <Text style={styles.userText} selectable>
                          {m}
                        </Text>
                      </View>
                    ))}
                    {trimmedOutput ? (
                      <Text style={styles.agentText} selectable>
                        {trimmedOutput}
                      </Text>
                    ) : null}
                  </>
                )}
              </ScrollView>
            ) : tab === 'changes' ? (
              <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
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
                    <Text style={styles.gitBtnText}>Commit</Text>
                  </Pressable>
                  <Pressable onPress={gitPush} disabled={pushing} style={styles.gitBtn}>
                    <Text style={styles.gitBtnText}>{pushing ? '...' : 'Push'}</Text>
                  </Pressable>
                </View>

                <View style={styles.gitFooter}>
                  <Pressable onPress={refreshGit} hitSlop={8}>
                    <Text style={styles.refreshText}>↻ Refresh</Text>
                  </Pressable>
                  {gitMsg ? <Text style={styles.gitStatusMsg}>{gitMsg}</Text> : null}
                </View>
              </ScrollView>
            ) : tab === 'agents' ? (
              <View style={styles.statusPane}>
                <View style={styles.healthCard}>
                  <View style={[styles.healthDot, { backgroundColor: bridgeReady ? '#30d158' : '#8e8e93' }]} />
                  <View style={styles.healthCopy}>
                    <Text style={styles.healthTitle}>Coding agent</Text>
                    <Text style={styles.healthBody}>
                      {bridgeReady
                        ? `Ready on ${bridgeTarget || 'your Mac'}`
                        : 'Not reachable from this preview.'}
                    </Text>
                  </View>
                </View>
                <View style={styles.healthCard}>
                  <View style={[styles.healthDot, { backgroundColor: sendState === 'sending' ? '#ffcc00' : '#30d158' }]} />
                  <View style={styles.healthCopy}>
                    <Text style={styles.healthTitle}>Current task</Text>
                    <Text style={styles.healthBody}>
                      {sendState === 'sending' ? 'Working on your prompt.' : 'No active prompt.'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.panelHint}>
                  Next this becomes usage, weekly spend, agent availability, and which app each agent is attached to.
                </Text>
              </View>
            ) : (
              <View style={styles.statusPane}>
                <View style={styles.healthCard}>
                  <View style={[styles.healthDot, { backgroundColor: bridgeReady ? '#30d158' : '#ff453a' }]} />
                  <View style={styles.healthCopy}>
                    <Text style={styles.healthTitle}>Mac link</Text>
                    <Text style={styles.healthBody}>
                      {bridgeReady ? 'Your phone can reach the Slouch bridge.' : 'Your phone cannot reach the Slouch bridge yet.'}
                    </Text>
                  </View>
                </View>
                <View style={styles.healthCard}>
                  <View style={[styles.healthDot, { backgroundColor: base ? '#30d158' : '#8e8e93' }]} />
                  <View style={styles.healthCopy}>
                    <Text style={styles.healthTitle}>Preview route</Text>
                    <Text style={styles.healthBody}>
                      {base ? 'Auto-detected from the preview connection.' : 'Waiting for a preview connection.'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.fieldLabel}>Advanced address</Text>
                <TextInput
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={bridgeUrl}
                  onChangeText={setBridgeUrl}
                  placeholder="http://your-mac-ip:8081/slouch"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  style={styles.settingsInput}
                />
                <Text selectable style={styles.panelHint}>
                  Slouch normally fills this in for you. Change it only if the app says the Mac link is offline.
                </Text>
              </View>
            )}
          </View>
        </View>

        {message ? <Text style={styles.statusMsg}>{message}</Text> : null}

        {/* Composer */}
        <View style={styles.composer}>
          <Pressable onPress={() => setTab('connection')} style={styles.plusBtn} hitSlop={6}>
            <Text style={styles.plusText}>＋</Text>
          </Pressable>
          <TextInput
            multiline
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Ask the agent…"
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={styles.composerInput}
          />
          <Pressable onPress={toggleMic} style={styles.iconBtn} hitSlop={6}>
            <Text style={styles.iconText}>{recording ? '■' : '🎤'}</Text>
          </Pressable>
          <Pressable
            onPress={sendPrompt}
            disabled={sendState === 'sending'}
            style={styles.sendBtn}
            hitSlop={6}
          >
            {sendState === 'sending' ? (
              <ActivityIndicator color="#07111f" />
            ) : (
              <Text style={styles.sendArrow}>↑</Text>
            )}
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
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  collapsedRoot: {
    justifyContent: 'flex-end',
    paddingBottom: BOTTOM_GAP,
  },
  // Collapsed pill
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
    paddingVertical: 8,
  },
  pillText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  // Expanded sheet
  sheet: {
    position: 'absolute',
    left: 8,
    right: 8,
    overflow: 'hidden',
    borderRadius: 28,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: '#05070a',
    padding: 14,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  closeText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  headerTitle: {
    flex: 1,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  headerStatus: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 12,
    fontWeight: '800',
  },
  contentRow: {
    flexDirection: 'row',
    gap: 10,
    minHeight: 210,
  },
  sideBar: {
    width: 66,
    gap: 8,
  },
  sideBtn: {
    minHeight: 50,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sideBtnActive: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  sideIcon: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '900',
  },
  sideLabel: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 10,
    fontWeight: '800',
  },
  mainPane: {
    flex: 1,
    minWidth: 0,
    gap: 8,
  },
  paneHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  paneTitle: {
    flex: 1,
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  newBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  newText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  body: {
    flex: 1,
    minHeight: 120,
  },
  bodyContent: {
    paddingVertical: 8,
    gap: 10,
  },
  empty: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 15,
    fontWeight: '600',
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: '#1e3a5f',
    borderRadius: 18,
    borderCurve: 'continuous',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userText: {
    color: '#ffffff',
    fontSize: 15,
    lineHeight: 20,
  },
  agentText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  // Changes tab
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
    color: 'rgba(255,255,255,0.5)',
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
  gitFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  refreshText: {
    color: '#7dd3fc',
    fontSize: 13,
    fontWeight: '800',
  },
  gitStatusMsg: {
    flex: 1,
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
  },
  settingsInput: {
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    paddingHorizontal: 12,
  },
  statusPane: {
    gap: 9,
    paddingTop: 4,
  },
  healthCard: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 12,
  },
  healthDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  healthCopy: {
    flex: 1,
    gap: 3,
  },
  healthTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  healthBody: {
    color: 'rgba(255,255,255,0.62)',
    fontSize: 12,
    lineHeight: 17,
  },
  fieldLabel: {
    color: 'rgba(255,255,255,0.64)',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  panelHint: {
    color: 'rgba(255,255,255,0.56)',
    fontSize: 12,
    lineHeight: 17,
  },
  statusMsg: {
    color: '#fca5a5',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 4,
  },
  // Composer
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  plusBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  plusText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '500',
    marginTop: -2,
  },
  composerInput: {
    flex: 1,
    minHeight: 44,
    maxHeight: 110,
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.1)',
    color: '#ffffff',
    fontSize: 16,
    lineHeight: 21,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  iconText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  sendArrow: {
    color: '#07111f',
    fontSize: 20,
    fontWeight: '900',
    marginTop: -1,
  },
});
