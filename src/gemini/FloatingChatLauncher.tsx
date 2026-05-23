import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import GeminiChat from './GeminiChat';

export default function FloatingChatLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating bubble */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Chat with The Oracle concierge"
        className="fixed bottom-28 right-6 z-50 w-14 h-14 rounded-full gemini-gradient text-white shadow-xl flex items-center justify-center hover:scale-105 transition-transform animate-pulse-glow"
      >
        {open ? <X className="w-5 h-5" /> : <Sparkles className="w-5 h-5" />}
      </button>

      {/* Slide-in panel */}
      {open && (
        <div className="fixed bottom-44 right-6 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[560px] max-h-[70vh] glass-panel overflow-hidden flex flex-col animate-slide-up">
          <GeminiChat mode="floating" onClose={() => setOpen(false)} />
        </div>
      )}
    </>
  );
}
