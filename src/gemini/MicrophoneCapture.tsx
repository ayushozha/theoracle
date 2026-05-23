import { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';

interface MicrophoneCaptureProps {
  onCapture: (file: File) => void;
  buttonClassName: string;
  iconClassName?: string;
}

const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

function getSupportedMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

function extensionForMimeType(mimeType: string) {
  if (mimeType.includes('mp4')) return 'm4a';
  if (mimeType.includes('ogg')) return 'ogg';
  return 'webm';
}

export default function MicrophoneCapture({
  onCapture,
  buttonClassName,
  iconClassName = 'w-4 h-4',
}: MicrophoneCaptureProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }, []);

  const startRecording = async () => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Microphone recording is not available in this browser.');
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
        setIsRecording(false);

        if (blob.size > 0) {
          onCapture(
            new File([blob], `oracle-mic-${Date.now()}.${extensionForMimeType(type)}`, {
              type,
            }),
          );
        }
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      stopStream();
      setIsRecording(false);
      setError('Microphone permission was blocked or no microphone was found.');
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
      return;
    }
    void startRecording();
  };

  useEffect(() => {
    return () => {
      stopRecording();
      stopStream();
    };
  }, [stopRecording, stopStream]);

  return (
    <>
      <button
        type="button"
        onClick={toggleRecording}
        title={isRecording ? 'Stop recording' : 'Record voice'}
        aria-label={isRecording ? 'Stop recording' : 'Record voice'}
        className={`${buttonClassName} ${isRecording ? 'text-google-red animate-pulse' : ''}`}
      >
        {isRecording ? (
          <Square className={iconClassName} />
        ) : (
          <Mic className={iconClassName} />
        )}
      </button>

      {error && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-medium text-google-red shadow-lg">
          {error}
        </div>
      )}
    </>
  );
}
