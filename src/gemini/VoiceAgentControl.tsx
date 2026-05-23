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
    throw new Error(data.error?.message || 'OpenAI Realtime session did not return a client secret.');
  }

  return value;
}

function buildInstructions(base: string, context?: string) {
  const voiceRules = [
    'You are running as The Oracle active voice agent.',
    'Speak naturally and concisely. Keep replies short unless the user asks for detail.',
    'Preserve the same safety rules: disclose that you are an AI agent, never finalize a deal without human approval, and never share private contact info.',
    'When useful, mention the Pricing Agent, Seller Agent, Buyer Agent, Research Agent, or Trust Agent as specialist agents you can route work to.',
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

  const sessionInstructions = useMemo(
    () => buildInstructions(instructions, conversationContext),
    [conversationContext, instructions],
  );

  const reportError = useCallback(
    (message: string) => {
      setError(message);
      onError?.(message);
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
    setEnabled(false);
    setPhase('idle');
  }, []);

  const handleRealtimeEvent = useCallback(
    (event: RealtimeServerEvent) => {
      switch (event.type) {
        case 'conversation.item.input_audio_transcription.completed':
          if (event.transcript?.trim()) {
            onUserTranscript(event.transcript.trim());
          }
          break;
        case 'response.created':
          assistantTranscriptRef.current = '';
          setPhase('speaking');
          break;
        case 'response.output_audio_transcript.delta':
          if (event.delta) {
            assistantTranscriptRef.current += event.delta;
            onAssistantDelta(event.delta);
          }
          break;
        case 'response.output_audio_transcript.done': {
          const finalText = event.transcript || assistantTranscriptRef.current;
          if (finalText.trim()) {
            onAssistantDone(finalText.trim());
          }
          assistantTranscriptRef.current = '';
          setPhase('listening');
          break;
        }
        case 'response.output_text.delta':
          if (event.delta) {
            assistantTranscriptRef.current += event.delta;
            onAssistantDelta(event.delta);
          }
          break;
        case 'response.output_text.done': {
          const finalText = event.text || assistantTranscriptRef.current;
          if (finalText.trim()) {
            onAssistantDone(finalText.trim());
          }
          assistantTranscriptRef.current = '';
          setPhase('listening');
          break;
        }
        case 'input_audio_buffer.speech_started':
          setPhase('listening');
          break;
        case 'error':
          reportError(event.error?.message || 'OpenAI Realtime voice error.');
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
      reportError('Realtime voice needs microphone access in this browser.');
      return;
    }

    if (typeof RTCPeerConnection === 'undefined') {
      reportError('Realtime voice needs WebRTC support in this browser.');
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
        throw new Error(tokenData.error?.message || 'Could not create OpenAI Realtime session.');
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
      dataChannel.onerror = () => reportError('OpenAI Realtime data channel failed.');

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
        throw new Error((await sdpResponse.text()) || 'OpenAI Realtime call failed.');
      }

      await peer.setRemoteDescription({
        type: 'answer',
        sdp: await sdpResponse.text(),
      });
    } catch (err) {
      stopVoice();
      reportError(err instanceof Error ? err.message : 'Could not start OpenAI Realtime voice.');
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
      ? 'Connecting OpenAI Realtime voice'
      : phase === 'listening'
        ? 'OpenAI Realtime voice is listening'
        : phase === 'speaking'
          ? 'OpenAI Realtime voice is speaking'
          : 'Start OpenAI Realtime voice';

  return (
    <>
      <button
        type="button"
        onClick={toggleVoice}
        disabled={disabled && !active}
        title={active ? 'Stop OpenAI Realtime voice' : title}
        aria-label={active ? 'Stop OpenAI Realtime voice' : title}
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
              ? 'Connecting OpenAI Realtime voice...'
              : phase === 'speaking'
                ? 'Oracle is speaking...'
                : 'Listening through OpenAI Realtime...')}
        </div>
      )}
    </>
  );
}
