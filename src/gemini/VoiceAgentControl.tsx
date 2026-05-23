import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Mic, Radio, Square, Volume2 } from 'lucide-react';

type VoicePhase = 'idle' | 'connecting' | 'listening' | 'speaking';

interface VoiceAgentControlProps {
  instructions: string;
  conversationContext?: string;
  onUserTranscript: (text: string) => void;
  onAssistantDelta: (delta: string) => void;
  onAssistantDone: (text: string) => void;
  onError?: (message: string) => void;
  buttonClassName: string;
  iconClassName?: string;
  disabled?: boolean;
}

interface RealtimeServerEvent {
  type?: string;
  item_id?: string;
  response_id?: string;
  delta?: string;
  transcript?: string;
  text?: string;
  error?: {
    message?: string;
  };
}

interface ClientSecretResponse {
  value?: string;
  client_secret?: {
    value?: string;
  };
  session?: {
    client_secret?: {
      value?: string;
    };
  };
  error?: {
    message?: string;
  };
}

const REALTIME_CALL_URL = 'https://api.openai.com/v1/realtime/calls';

function extractClientSecret(data: ClientSecretResponse): string {
  const value =
    data.value ??
    data.client_secret?.value ??
    data.session?.client_secret?.value;

  if (!value) {
    throw new Error(data.error?.message || 'Voice session did not return a client secret.');
  }

  return value;
}

function cleanVoiceError(message: string) {
  return message
    .replace(/OPENAI_API_KEY/g, 'voice API key')
    .replace(/OpenAI Realtime/gi, 'voice')
    .replace(/\bOpenAI\b/gi, 'voice')
    .replace(/\bRealtime\b/gi, 'voice')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildInstructions(base: string, context?: string) {
  const voiceRules = [
    'You are running as The Oracle active voice agent.',
    'Speak naturally and concisely. Keep replies short unless the user asks for detail.',
    'Preserve the same safety rules: disclose that you are an AI agent, never finalize a deal without human approval, and never share private contact info.',
    'When useful, mention the Pricing Agent, Seller Agent, Buyer Agent, Research Agent, or Trust Agent as specialist agents you can route work to.',
    'Never mention the voice provider, audio infrastructure, realtime transport, API names, or implementation details.',
  ].join('\n');

  return [base, voiceRules, context ? `Recent visible chat context:\n${context}` : '']
    .filter(Boolean)
    .join('\n\n');
}

export default function VoiceAgentControl({
  instructions,
  conversationContext,
  onUserTranscript,
  onAssistantDelta,
  onAssistantDone,
  onError,
  buttonClassName,
  iconClassName = 'w-4 h-4',
  disabled = false,
}: VoiceAgentControlProps) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [error, setError] = useState<string | null>(null);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const assistantTranscriptRef = useRef('');
  const assistantModeRef = useRef<'audio' | 'text' | null>(null);
  const completedInputItemsRef = useRef<Set<string>>(new Set());
  const completedResponsesRef = useRef<Set<string>>(new Set());

  const sessionInstructions = useMemo(
    () => buildInstructions(instructions, conversationContext),
    [conversationContext, instructions],
  );

  const reportError = useCallback(
    (message: string) => {
      const cleanMessage = cleanVoiceError(message);
      setError(cleanMessage);
      onError?.(cleanMessage);
    },
    [onError],
  );

  const stopVoice = useCallback(() => {
    dataChannelRef.current?.close();
    dataChannelRef.current = null;

    peerRef.current?.close();
    peerRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }

    assistantTranscriptRef.current = '';
    assistantModeRef.current = null;
    completedInputItemsRef.current.clear();
    completedResponsesRef.current.clear();
    setEnabled(false);
    setPhase('idle');
  }, []);

  const handleRealtimeEvent = useCallback(
    (event: RealtimeServerEvent) => {
      switch (event.type) {
        case 'conversation.item.input_audio_transcription.completed':
          if (event.transcript?.trim()) {
            if (event.item_id) {
              if (completedInputItemsRef.current.has(event.item_id)) break;
              completedInputItemsRef.current.add(event.item_id);
            }
            onUserTranscript(event.transcript.trim());
          }
          break;
        case 'response.created':
          assistantTranscriptRef.current = '';
          assistantModeRef.current = null;
          setPhase('speaking');
          break;
        case 'response.output_audio_transcript.delta':
          if (event.response_id && completedResponsesRef.current.has(event.response_id)) break;
          if (event.delta) {
            assistantModeRef.current = 'audio';
            assistantTranscriptRef.current += event.delta;
            onAssistantDelta(event.delta);
          }
          break;
        case 'response.output_audio_transcript.done': {
          if (event.response_id && completedResponsesRef.current.has(event.response_id)) break;
          const finalText = event.transcript || assistantTranscriptRef.current;
          if (finalText.trim()) {
            onAssistantDone(finalText.trim());
          }
          assistantTranscriptRef.current = '';
          assistantModeRef.current = null;
          if (event.response_id) completedResponsesRef.current.add(event.response_id);
          setPhase('listening');
          break;
        }
        case 'response.output_text.delta':
          if (assistantModeRef.current === 'audio') break;
          if (event.response_id && completedResponsesRef.current.has(event.response_id)) break;
          if (event.delta) {
            assistantModeRef.current = 'text';
            assistantTranscriptRef.current += event.delta;
            onAssistantDelta(event.delta);
          }
          break;
        case 'response.output_text.done': {
          if (assistantModeRef.current === 'audio') break;
          if (event.response_id && completedResponsesRef.current.has(event.response_id)) break;
          const finalText = event.text || assistantTranscriptRef.current;
          if (finalText.trim()) {
            onAssistantDone(finalText.trim());
          }
          assistantTranscriptRef.current = '';
          assistantModeRef.current = null;
          if (event.response_id) completedResponsesRef.current.add(event.response_id);
          setPhase('listening');
          break;
        }
        case 'input_audio_buffer.speech_started':
          setPhase('listening');
          break;
        case 'error':
          reportError(event.error?.message || 'Voice session error.');
          break;
        default:
          break;
      }
    },
    [onAssistantDelta, onAssistantDone, onUserTranscript, reportError],
  );

  const startVoice = useCallback(async () => {
    if (disabled || enabled) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      reportError('Voice mode needs microphone access in this browser.');
      return;
    }

    if (typeof RTCPeerConnection === 'undefined') {
      reportError('Voice mode needs browser audio support.');
      return;
    }

    setError(null);
    setEnabled(true);
    setPhase('connecting');

    try {
      const tokenResponse = await fetch('/api/openai/realtime/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ instructions: sessionInstructions }),
      });

      const tokenData = (await tokenResponse.json()) as ClientSecretResponse;
      if (!tokenResponse.ok) {
        throw new Error(tokenData.error?.message || 'Could not create voice session.');
      }
      const clientSecret = extractClientSecret(tokenData);

      const peer = new RTCPeerConnection();
      peerRef.current = peer;

      const audio = new Audio();
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      audioRef.current = audio;
      document.body.appendChild(audio);

      peer.ontrack = (trackEvent) => {
        audio.srcObject = trackEvent.streams[0];
        void audio.play().catch(() => undefined);
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') {
          setPhase('listening');
        } else if (
          peer.connectionState === 'failed' ||
          peer.connectionState === 'closed' ||
          peer.connectionState === 'disconnected'
        ) {
          stopVoice();
        }
      };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      streamRef.current = stream;
      stream.getAudioTracks().forEach((track) => peer.addTrack(track, stream));

      const dataChannel = peer.createDataChannel('oai-events');
      dataChannelRef.current = dataChannel;
      dataChannel.onmessage = (messageEvent) => {
        try {
          handleRealtimeEvent(JSON.parse(messageEvent.data) as RealtimeServerEvent);
        } catch {
          // Ignore malformed diagnostics from the data channel.
        }
      };
      dataChannel.onerror = () => reportError('Voice data channel failed.');

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch(REALTIME_CALL_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          'Content-Type': 'application/sdp',
        },
        body: offer.sdp,
      });

      if (!sdpResponse.ok) {
        throw new Error((await sdpResponse.text()) || 'Voice call failed.');
      }

      await peer.setRemoteDescription({
        type: 'answer',
        sdp: await sdpResponse.text(),
      });
    } catch (err) {
      stopVoice();
      reportError(err instanceof Error ? err.message : 'Could not start voice mode.');
    }
  }, [disabled, enabled, handleRealtimeEvent, reportError, sessionInstructions, stopVoice]);

  const toggleVoice = () => {
    if (enabled) {
      stopVoice();
      return;
    }

    void startVoice();
  };

  useEffect(() => stopVoice, [stopVoice]);

  const active = enabled || phase !== 'idle';
  const title =
    phase === 'connecting'
      ? 'Connecting voice'
      : phase === 'listening'
        ? 'Voice is listening'
        : phase === 'speaking'
          ? 'Voice is speaking'
          : 'Start voice conversation';

  return (
    <>
      <button
        type="button"
        onClick={toggleVoice}
        disabled={disabled && !active}
        title={active ? 'Stop voice conversation' : title}
        aria-label={active ? 'Stop voice conversation' : title}
        className={`${buttonClassName} ${active ? 'text-google-blue' : ''}`}
      >
        {active ? (
          phase === 'speaking' ? (
            <Volume2 className={iconClassName} />
          ) : phase === 'connecting' ? (
            <Radio className={`${iconClassName} animate-pulse`} />
          ) : (
            <Square className={iconClassName} />
          )
        ) : (
          <Mic className={iconClassName} />
        )}
      </button>

      {(enabled || error) && (
        <div className="fixed bottom-6 left-1/2 z-[70] max-w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 rounded-full border border-black/10 bg-white/95 px-4 py-2 text-xs font-medium text-text-secondary shadow-lg backdrop-blur">
          {error ??
            (phase === 'connecting'
              ? 'Connecting voice...'
              : phase === 'speaking'
                ? 'Oracle is speaking...'
                : 'Listening...')}
        </div>
      )}
    </>
  );
}
