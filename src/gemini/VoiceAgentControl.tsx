import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square, Volume2, Waves } from 'lucide-react';

type VoicePhase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface VoiceAgentControlProps {
  onTranscript: (text: string) => Promise<string | void>;
  onAudioCapture?: (file: File) => Promise<string | void>;
  buttonClassName: string;
  iconClassName?: string;
  disabled?: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function getSpeechRecognition() {
  if (typeof window === 'undefined') return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

function speak(text: string) {
  return new Promise<void>((resolve) => {
    if (!('speechSynthesis' in window) || !text.trim()) {
      resolve();
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export default function VoiceAgentControl({
  onTranscript,
  onAudioCapture,
  buttonClassName,
  iconClassName = 'w-4 h-4',
  disabled = false,
}: VoiceAgentControlProps) {
  const [enabled, setEnabled] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startListeningRef = useRef<() => void>(() => undefined);
  const enabledRef = useRef(false);
  const processingRef = useRef(false);
  const transcriptRef = useRef('');

  const stopListening = useCallback(() => {
    recognitionRef.current?.abort();
    recognitionRef.current = null;
    setInterim('');
  }, []);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const runTurn = useCallback(
    async (text: string) => {
      const clean = text.trim();
      if (!clean) return;

      processingRef.current = true;
      setInterim('');
      setPhase('thinking');

      try {
        const reply = await onTranscript(clean);
        if (enabledRef.current && reply?.trim()) {
          setPhase('speaking');
          await speak(reply);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Voice request failed.');
      } finally {
        processingRef.current = false;
        if (!enabledRef.current) {
          setPhase('idle');
        }
      }
    },
    [onTranscript],
  );

  const runAudioTurn = useCallback(
    async (file: File) => {
      if (!onAudioCapture) return;

      processingRef.current = true;
      setInterim('');
      setPhase('thinking');

      try {
        const reply = await onAudioCapture(file);
        if (reply?.trim()) {
          setPhase('speaking');
          await speak(reply);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Voice request failed.');
      } finally {
        processingRef.current = false;
        enabledRef.current = false;
        setEnabled(false);
        setPhase('idle');
      }
    },
    [onAudioCapture],
  );

  const startAudioFallback = useCallback(async () => {
    if (!onAudioCapture) {
      setError('Voice mode needs Chrome or another browser with speech recognition.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice mode needs microphone recording support in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      const mimeType = getSupportedMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      enabledRef.current = true;
      setEnabled(true);
      setPhase('listening');
      setInterim('Recording... tap again to send.');

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        chunksRef.current = [];
        recorderRef.current = null;
        stopStream();

        if (blob.size > 0) {
          void runAudioTurn(
            new File([blob], `oracle-voice-${Date.now()}.${extensionForMimeType(type)}`, {
              type,
            }),
          );
        } else {
          enabledRef.current = false;
          setEnabled(false);
          setPhase('idle');
        }
      };

      recorder.start();
    } catch {
      stopStream();
      enabledRef.current = false;
      setEnabled(false);
      setPhase('idle');
      setError('Microphone permission was blocked or no microphone was found.');
    }
  }, [onAudioCapture, runAudioTurn, stopStream]);

  const startListening = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition) {
      void startAudioFallback();
      return;
    }

    if (!enabledRef.current || processingRef.current || recognitionRef.current) return;

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    transcriptRef.current = '';
    recognitionRef.current = recognition;

    recognition.onstart = () => {
      setError(null);
      setPhase('listening');
    };

    recognition.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = Array.from({ length: result.length }, (_, idx) => result[idx]?.transcript ?? '').join('');
        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interimTranscript += transcript;
        }
      }

      if (interimTranscript.trim()) {
        setInterim(interimTranscript.trim());
      }

      if (finalTranscript.trim()) {
        transcriptRef.current = finalTranscript.trim();
        recognition.stop();
      }
    };

    recognition.onerror = (event) => {
      if (event.error !== 'aborted' && event.error !== 'no-speech') {
        setError(`Voice input stopped: ${event.error}`);
      }
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      const finalText = transcriptRef.current;
      transcriptRef.current = '';

      if (finalText) {
        void runTurn(finalText).then(() => {
          if (enabledRef.current) {
            window.setTimeout(() => startListeningRef.current(), 250);
          }
        });
        return;
      }

      if (enabledRef.current && !processingRef.current) {
        window.setTimeout(() => startListeningRef.current(), 350);
      }
    };

    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
    }
  }, [runTurn, startAudioFallback]);

  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const stopVoice = useCallback(() => {
    enabledRef.current = false;
    setEnabled(false);
    setPhase('idle');
    setInterim('');
    stopListening();
    const recorder = recorderRef.current;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    stopStream();
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, [stopListening, stopStream]);

  const toggleVoice = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
      return;
    }

    if (enabled) {
      stopVoice();
      return;
    }

    if (disabled) return;
    enabledRef.current = true;
    setEnabled(true);
    setError(null);
    startListening();
  };

  useEffect(() => {
    if (enabled && phase === 'idle' && !processingRef.current) {
      startListening();
    }
  }, [enabled, phase, startListening]);

  useEffect(() => stopVoice, [stopVoice]);

  const active = enabled || phase !== 'idle';
  const title =
    phase === 'listening'
      ? 'Listening'
      : phase === 'thinking'
        ? 'Gemini is thinking'
        : phase === 'speaking'
          ? 'Speaking'
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
          ) : phase === 'thinking' ? (
            <Waves className={`${iconClassName} animate-pulse`} />
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
            (phase === 'listening'
              ? interim || 'Listening...'
              : phase === 'thinking'
                ? 'Gemini is thinking...'
                : phase === 'speaking'
                  ? 'Speaking...'
                  : 'Voice mode ready')}
        </div>
      )}
    </>
  );
}
