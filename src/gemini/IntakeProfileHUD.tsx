import { Cpu, Layers, DollarSign, Activity, MapPin, Sparkles, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ItemIntakeProfile } from './intakeProfile';

interface Props {
  profile: ItemIntakeProfile;
  loading: boolean;
  onSpecClick?: (specName: string) => void;
}

export default function IntakeProfileHUD({ profile, loading, onSpecClick }: Props) {
  // Check completeness based on 8 key specs
  const keySpecs = [
    { label: 'Model', value: profile.modelName || profile.itemName, key: 'modelName', desc: 'Brand, year & model size' },
    { label: 'Chip', value: profile.chip, key: 'chip', desc: 'Processor architecture' },
    { label: 'RAM', value: profile.ramGb ? `${profile.ramGb}GB` : null, key: 'ram', desc: 'System memory capacity' },
    { label: 'Storage', value: profile.storageGb ? `${profile.storageGb}GB` : null, key: 'storage', desc: 'Solid-state drive space' },
    { label: 'Condition', value: profile.condition, key: 'condition', desc: 'Physical wear assessment' },
    { label: 'Battery', value: profile.batteryCycleCount ? `${profile.batteryCycleCount} cycles` : null, key: 'battery', desc: 'Battery cycle health' },
    { label: 'Asking Price', value: profile.desiredPriceUsd ? `$${profile.desiredPriceUsd}` : null, key: 'price', desc: 'Your target valuation' },
    { label: 'Fulfillment', value: profile.pickupLocation || profile.shippingPreference, key: 'fulfillment', desc: 'Handover location or method' },
  ];

  const filledCount = keySpecs.filter(s => Boolean(s.value)).length;
  const totalCount = keySpecs.length;
  const percentage = Math.round((filledCount / totalCount) * 100);

  // Circular progress SVG values
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="w-full max-w-3xl mb-4 rounded-3xl border border-violet-500/10 bg-white/70 dark:bg-slate-900/60 p-4 md:p-5 shadow-lg backdrop-blur-xl relative overflow-hidden transition-all animate-fade-in">
      {/* Decorative backing grid */}
      <div className="absolute inset-0 bg-radial-gradient from-violet-500/5 via-transparent to-transparent pointer-events-none" />

      <div className="flex flex-col md:flex-row items-center gap-5 relative z-10">

        {/* Circular Completeness Dial */}
        <div className="flex-shrink-0 flex flex-col items-center justify-center bg-slate-50/50 dark:bg-black/25 rounded-2xl p-3 border border-black/5 dark:border-white/5 w-28 h-28 relative">
          <svg className="w-20 h-20 transform -rotate-90">
            {/* Background circle */}
            <circle
              cx="40"
              cy="40"
              r={radius}
              className="stroke-black/5 dark:stroke-white/5 fill-none"
              strokeWidth="5"
            />
            {/* Progress circle */}
            <circle
              cx="40"
              cy="40"
              r={radius}
              className="stroke-violet-500 dark:stroke-violet-400 fill-none transition-all duration-500 ease-out"
              strokeWidth="5"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
            />
          </svg>

          <div className="absolute flex flex-col items-center justify-center inset-0 mt-2">
            <span className="text-lg font-black text-text-primary leading-none font-heading">{percentage}%</span>
            <span className="text-[8px] uppercase tracking-wider text-text-muted mt-0.5">Complete</span>
          </div>
        </div>

        {/* HUD Content Area */}
        <div className="flex-1 w-full">
          <div className="flex items-center justify-between gap-3 mb-3 border-b border-black/5 dark:border-white/5 pb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-400 animate-pulse" />
              <h2 className="text-xs font-black uppercase tracking-widest text-text-primary">
                Item Specification Registry
              </h2>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className={`w-2 h-2 rounded-full ${loading ? 'bg-google-blue animate-pulse' : 'bg-google-green'}`} />
              <span className="text-text-secondary font-medium">
                {loading ? 'Orchestrating Vision Extractor...' : `Confidence: ${Math.round((profile.confidence || 0) * 100)}%`}
              </span>
            </div>
          </div>

          {/* Specs grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {keySpecs.map((spec) => {
              const Icon =
                spec.key === 'modelName' ? Layers :
                spec.key === 'chip' ? Cpu :
                spec.key === 'price' ? DollarSign :
                spec.key === 'fulfillment' ? MapPin : Activity;

              const isFilled = Boolean(spec.value);

              return (
                <button
                  key={spec.label}
                  disabled={isFilled || !onSpecClick}
                  onClick={() => onSpecClick?.(spec.label)}
                  title={isFilled ? spec.desc : `Click to enter ${spec.label}`}
                  className={`flex flex-col items-start text-left p-2 rounded-xl border text-[11px] transition-all group relative overflow-hidden ${
                    isFilled
                      ? 'bg-emerald-500/5 dark:bg-emerald-500/[0.02] border-emerald-500/20 text-text-primary hover:border-emerald-500/35'
                      : 'bg-amber-500/5 dark:bg-amber-500/[0.02] border-amber-500/20 text-text-secondary hover:border-amber-500/40 hover:bg-amber-500/10 cursor-pointer active:scale-98'
                  }`}
                >
                  <div className="flex items-center justify-between w-full gap-1 mb-1">
                    <span className="text-text-muted font-semibold text-[9px] uppercase tracking-wider">{spec.label}</span>
                    {isFilled ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-amber-500 animate-pulse" />
                    )}
                  </div>
                  <div className="font-bold truncate max-w-full leading-tight flex items-center gap-1.5">
                    <Icon className={`w-3.5 h-3.5 ${isFilled ? 'text-emerald-500' : 'text-amber-500/70'}`} />
                    {isFilled ? (
                      <span className="truncate">{spec.value}</span>
                    ) : (
                      <span className="text-amber-500/80 font-medium">Missing</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Source tracker banner */}
          <div className="mt-3 flex items-center justify-between text-[9px] text-text-muted bg-slate-100/50 dark:bg-black/20 rounded-lg px-2.5 py-1">
            <span className="truncate max-w-[80%]" title={profile.sourceSummary || 'No data imported yet.'}>
              <strong>Registry State:</strong> {profile.sourceSummary || 'Awaiting primary multi-modal image scan or text description.'}
            </span>
            <span className="font-semibold text-violet-400">
              Verified by Concierge Agent
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
