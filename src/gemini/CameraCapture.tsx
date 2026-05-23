import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, X } from 'lucide-react';

interface CameraCaptureProps {
  onCapture: (file: File) => void;
  buttonClassName: string;
  iconClassName?: string;
  title?: string;
}

export default function CameraCapture({
  onCapture,
  buttonClassName,
  iconClassName = 'w-4 h-4',
  title = 'Capture photo',
}: CameraCaptureProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      void node.play().catch(() => undefined);
    }
  }, []);

  const openCamera = async () => {
    setError(null);
    setIsReady(false);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera is not available in this browser.');
      return;
    }

    setIsStarting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      stopStream();
      streamRef.current = stream;
      setIsOpen(true);
    } catch {
      setError('Camera permission was blocked or no camera was found.');
    } finally {
      setIsStarting(false);
    }
  };

  const closeCamera = useCallback(() => {
    stopStream();
    setIsOpen(false);
    setIsReady(false);
  }, [stopStream]);

  const capturePhoto = async () => {
    const video = videoRef.current;
    if (!video) return;

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')?.drawImage(video, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((nextBlob) => {
        if (nextBlob) {
          resolve(nextBlob);
        } else {
          reject(new Error('Could not capture photo.'));
        }
      }, 'image/jpeg', 0.92);
    });

    onCapture(
      new File([blob], `oracle-camera-${Date.now()}.jpg`, {
        type: 'image/jpeg',
      }),
    );
    closeCamera();
  };

  useEffect(() => {
    return () => stopStream();
  }, [stopStream]);

  return (
    <>
      <button
        type="button"
        onClick={openCamera}
        disabled={isStarting}
        title={title}
        aria-label={title}
        className={buttonClassName}
      >
        <Camera className={iconClassName} />
      </button>

      {error && !isOpen && (
        <div className="fixed bottom-6 left-1/2 z-[70] -translate-x-1/2 rounded-full border border-red-200 bg-white px-4 py-2 text-xs font-medium text-google-red shadow-lg">
          {error}
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
              <div className="text-sm font-semibold text-text-primary">Camera capture</div>
              <button
                type="button"
                onClick={closeCamera}
                title="Close camera"
                aria-label="Close camera"
                className="rounded-full p-2 text-text-secondary hover:bg-black/5 hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="bg-black">
              <video
                ref={attachVideo}
                autoPlay
                muted
                playsInline
                onLoadedMetadata={() => setIsReady(true)}
                className="aspect-video w-full object-cover"
              />
            </div>

            <div className="flex items-center justify-end gap-2 px-4 py-3">
              <button
                type="button"
                onClick={closeCamera}
                className="rounded-full border border-black/10 px-4 py-2 text-sm font-medium text-text-secondary hover:bg-black/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={capturePhoto}
                disabled={!isReady}
                className="inline-flex items-center gap-2 rounded-full bg-text-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
              >
                <Check className="h-4 w-4" />
                Use photo
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
