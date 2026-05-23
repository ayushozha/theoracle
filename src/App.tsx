import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Laptop,
  Upload,
  CheckCircle,
  ShieldAlert,
  ShieldCheck,
  Play,
  ArrowRight,
  DollarSign,
  Terminal,
  MapPin,
  User,
  Send,
  Check,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Lock,
  ChevronRight,
  ChevronLeft,
  Info,
  Clock,
  ThumbsUp,
  X
} from 'lucide-react';

import sellerAgent from './managed-agents/seller-agent.json';
import pricingAgent from './managed-agents/pricing-agent.json';
import buyerAgent from './managed-agents/buyer-agent.json';
import trustAgent from './managed-agents/trust-agent.json';
import listingAgent from './managed-agents/listing-agent.json';
import researchAgent from './managed-agents/research-agent.json';
import { runResearchAgent } from './managed-agents/researchAgent';

import FloatingChatLauncher from './gemini/FloatingChatLauncher';
import OracleLanding from './gemini/OracleLanding';

// Pricing comps come from the Pricing Agent managed-agent JSON spec.
const DEMO_COMPS = pricingAgent.comps;
const PRICING_LOGS = pricingAgent.logs;
const PRICING_REPORT = pricingAgent.pricing_report;
const SELLER_ALLOWED = sellerAgent.allowed_actions;
const SELLER_BLOCKED = sellerAgent.blocked_actions;
const BUYER_MATCH_SIGNALS = buyerAgent.match_signals;
const TRUST_INCIDENT = trustAgent.incident;
const MANAGED_AGENTS = [sellerAgent, pricingAgent, buyerAgent, trustAgent, listingAgent, researchAgent];

type AgentStatus = 'idle' | 'thinking' | 'active' | 'complete' | 'blocked';

interface AgentStatuses {
  sellerStatus: AgentStatus;
  pricingStatus: AgentStatus;
  buyerStatus: AgentStatus;
  trustStatus: AgentStatus;
}

function getAgentStatuses(step: number): AgentStatuses {
  if (step === 2) {
    return { sellerStatus: 'thinking', pricingStatus: 'idle', buyerStatus: 'idle', trustStatus: 'idle' };
  }
  if (step === 3) {
    return { sellerStatus: 'active', pricingStatus: 'idle', buyerStatus: 'idle', trustStatus: 'idle' };
  }
  if (step === 4) {
    return { sellerStatus: 'active', pricingStatus: 'thinking', buyerStatus: 'idle', trustStatus: 'idle' };
  }
  if (step === 5) {
    return { sellerStatus: 'active', pricingStatus: 'complete', buyerStatus: 'thinking', trustStatus: 'idle' };
  }
  if (step === 6) {
    return { sellerStatus: 'active', pricingStatus: 'complete', buyerStatus: 'active', trustStatus: 'active' };
  }
  if (step === 7) {
    return { sellerStatus: 'active', pricingStatus: 'complete', buyerStatus: 'active', trustStatus: 'blocked' };
  }
  if (step === 8) {
    return { sellerStatus: 'active', pricingStatus: 'complete', buyerStatus: 'complete', trustStatus: 'complete' };
  }
  if (step === 9) {
    return { sellerStatus: 'complete', pricingStatus: 'complete', buyerStatus: 'complete', trustStatus: 'complete' };
  }
  return { sellerStatus: 'idle', pricingStatus: 'idle', buyerStatus: 'idle', trustStatus: 'idle' };
}

export default function App() {
  // Screen active states (0 = Gemini chat landing, 1-9 = agent flow screens)
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(4000); // 4 seconds per step
  
  // App state variables
  const [floorPrice, setFloorPrice] = useState<number>(725);
  const [pickupLocation, setPickupLocation] = useState<string>("Ferry Building / Shack15");
  const [batteryCycles, setBatteryCycles] = useState<string>("");
  const [ownerFactSubmitted, setOwnerFactSubmitted] = useState<boolean>(false);
  const [uploadedImage, setUploadedImage] = useState<string | null>(null);
  const [isIntaking, setIsIntaking] = useState<boolean>(false);
  const [intakeProgress, setIntakeProgress] = useState<number>(0);
  
  // Pricing Sandbox Logs
  const [sandboxLogs, setSandboxLogs] = useState<string[]>([]);
  const [pricingCalculated, setPricingCalculated] = useState<boolean>(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logTimeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  
  // Theme toggle (light is default per Gemini-style brief)
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const { sellerStatus, pricingStatus, buyerStatus, trustStatus } = getAgentStatuses(currentStep);

  // Research Agent: live Gemini Deep Research stream.
  const [researchOutput, setResearchOutput] = useState<string>('');
  const [researchRunning, setResearchRunning] = useState<boolean>(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const researchAbortRef = useRef<AbortController | null>(null);

  const runLiveResearch = useCallback(async () => {
    researchAbortRef.current?.abort();
    const controller = new AbortController();
    researchAbortRef.current = controller;
    setResearchOutput('');
    setResearchError(null);
    setResearchRunning(true);
    try {
      for await (const delta of runResearchAgent({ signal: controller.signal })) {
        setResearchOutput((prev) => prev + delta);
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setResearchError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setResearchRunning(false);
    }
  }, []);

  const stopLiveResearch = useCallback(() => {
    researchAbortRef.current?.abort();
    setResearchRunning(false);
  }, []);

  // Terminal log simulator
  const triggerSandboxLogs = useCallback(() => {
    logTimeoutsRef.current.forEach(clearTimeout);
    logTimeoutsRef.current = [];
    setSandboxLogs([]);
    setPricingCalculated(false);
    PRICING_LOGS.forEach((msg, idx) => {
      const timeout = setTimeout(() => {
        setSandboxLogs((prev) => [...prev, msg]);
        if (idx === PRICING_LOGS.length - 1) {
          setPricingCalculated(true);
        }
      }, idx * 250);
      logTimeoutsRef.current.push(timeout);
    });
  }, []);

  const startAgentFlow = useCallback(() => {
    logTimeoutsRef.current.forEach(clearTimeout);
    logTimeoutsRef.current = [];
    setSandboxLogs([]);
    setPricingCalculated(false);
    setUploadedImage(null);
    setOwnerFactSubmitted(false);
    setBatteryCycles("");
    setCurrentStep(1);
  }, []);

  const goToStep = useCallback((step: number) => {
    if (step === 1) {
      startAgentFlow();
      return;
    }
    if (step === 4) {
      triggerSandboxLogs();
    }
    setCurrentStep(step);
  }, [startAgentFlow, triggerSandboxLogs]);

  // Auto-play control loop
  useEffect(() => {
    if (!isPlaying) return;

    const interval = setInterval(() => {
      if (currentStep >= 9) {
        setIsPlaying(false);
        return;
      }
      goToStep(Math.min(9, currentStep + 1));
    }, playbackSpeed);

    return () => clearInterval(interval);
  }, [currentStep, goToStep, isPlaying, playbackSpeed]);

  useEffect(() => {
    return () => {
      logTimeoutsRef.current.forEach(clearTimeout);
    };
  }, []);

  // Scroll to bottom of terminal
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [sandboxLogs]);

  // Handle demo photo click intake
  const handleIntakeSimulation = () => {
    setIsIntaking(true);
    setIntakeProgress(0);
    const interval = setInterval(() => {
      setIntakeProgress((p) => {
        if (p >= 100) {
          clearInterval(interval);
          setUploadedImage("https://images.unsplash.com/photo-1517336714731-489689fd1ca8?auto=format&fit=crop&w=600&q=80");
          setIsIntaking(false);
          setCurrentStep(3); // Auto advance to Seller Agent page
          return 100;
        }
        return p + 20;
      });
    }, 150);
  };

  const handleToggleTheme = () => {
    setIsDarkMode((v) => !v);
    document.body.classList.toggle('dark-theme');
  };

  return (
    <div className={`flex flex-col min-h-screen relative ${currentStep > 0 ? 'pb-28' : ''}`}>
      {/* Header — hidden on the Gemini-style landing (step 0) */}
      {currentStep > 0 && (
      <header className="glass-panel flex items-center justify-between px-6 py-4 mx-4 mt-4 mb-6 relative z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shadow-lg shadow-purple-900/30">
            <img src="/logo.png" alt="The Oracle Logo" className="w-full h-full object-cover" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight m-0 flex items-center gap-2">
              The <span className="text-gradient">Oracle</span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-400">
                I/O Demo
              </span>
            </h1>
            <p className="text-xs text-secondary leading-none">Universal Cart for secondhand goods</p>
          </div>
        </div>

        {/* Live Agent Dashboard Indicators */}
        <div className="hidden md:flex items-center gap-4">
          <div className="flex items-center gap-1.5 bg-white/70 dark:bg-slate-50 border border-black/5 rounded-full px-3 py-1 text-xs">
            <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
            <span className="text-secondary font-medium">Seller:</span>
            <span className={`capitalize font-bold ${
              sellerStatus === 'active' ? 'text-violet-400' :
              sellerStatus === 'thinking' ? 'text-cyan-400' :
              sellerStatus === 'complete' ? 'text-emerald-400' : 'text-gray-500'
            }`}>{sellerStatus}</span>
          </div>

          <div className="flex items-center gap-1.5 bg-white/70 dark:bg-slate-50 border border-black/5 rounded-full px-3 py-1 text-xs">
            <span className="w-2 h-2 rounded-full bg-cyan-500"></span>
            <span className="text-secondary font-medium">Pricing:</span>
            <span className={`capitalize font-bold ${
              pricingStatus === 'active' ? 'text-cyan-400' :
              pricingStatus === 'thinking' ? 'text-yellow-400' :
              pricingStatus === 'complete' ? 'text-emerald-400' : 'text-gray-500'
            }`}>{pricingStatus}</span>
          </div>

          <div className="flex items-center gap-1.5 bg-white/70 dark:bg-slate-50 border border-black/5 rounded-full px-3 py-1 text-xs">
            <span className="w-2 h-2 rounded-full bg-pink-500"></span>
            <span className="text-secondary font-medium">Buyer:</span>
            <span className={`capitalize font-bold ${
              buyerStatus === 'active' ? 'text-pink-400' :
              buyerStatus === 'thinking' ? 'text-yellow-400' :
              buyerStatus === 'complete' ? 'text-emerald-400' : 'text-gray-500'
            }`}>{buyerStatus}</span>
          </div>

          <div className="flex items-center gap-1.5 bg-white/70 dark:bg-slate-50 border border-black/5 rounded-full px-3 py-1 text-xs">
            <span className="w-2 h-2 rounded-full bg-red-500"></span>
            <span className="text-secondary font-medium">Trust:</span>
            <span className={`capitalize font-bold ${
              trustStatus === 'active' ? 'text-pink-400' :
              trustStatus === 'blocked' ? 'text-rose-500 font-extrabold animate-pulse' :
              trustStatus === 'complete' ? 'text-emerald-400' : 'text-gray-500'
            }`}>{trustStatus}</span>
          </div>
        </div>

        {/* Global Controls */}
        <div className="flex items-center gap-3">
          <button 
            onClick={handleToggleTheme}
            className="p-2 rounded-lg border border-black/10 hover:bg-slate-50 text-text-secondary hover:text-text-primary transition-all text-xs flex items-center gap-1.5"
            title="Toggle Theme"
          >
            {isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
          </button>
          <button
            onClick={() => setCurrentStep(0)}
            className="px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-red-500 hover:bg-red-500/20 text-xs font-semibold flex items-center gap-1 transition-all"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Reset
          </button>
        </div>
      </header>
      )}

      {/* STEP 0: full-screen Gemini-app-style landing for The Oracle */}
      {currentStep === 0 && (
        <OracleLanding
          userName="Ayush"
          onStartAgentFlow={startAgentFlow}
        />
      )}

      {/* STEPS 1-9: existing agent dashboard, with floating chat overlay */}
      {currentStep > 0 && (
      <main className="dashboard-grid flex-1">

        {/* LEFT COLUMN: Intake Profile Facts (State Tracker) */}
        <section className="glass-panel p-5 flex flex-col gap-4 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-black/5 pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gradient flex items-center gap-2">
              <Laptop className="w-4 h-4 text-violet-400" /> Item Blueprint
            </h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-50 text-secondary">
              ID: mb_001
            </span>
          </div>

          {/* intake preview status */}
          {uploadedImage ? (
            <div className="relative group rounded-xl overflow-hidden border border-black/10 aspect-video bg-black">
              <img src={uploadedImage} alt="MacBook intake" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
              <div className="absolute top-2 right-2 px-2 py-0.5 text-[10px] font-semibold bg-emerald-500 text-black rounded-md flex items-center gap-1">
                <Check className="w-2.5 h-2.5" /> Scanned
              </div>
            </div>
          ) : (
            <div className="border-2 border-dashed border-black/10 rounded-xl p-6 text-center bg-slate-50/60 flex flex-col items-center justify-center gap-2 aspect-video">
              <Laptop className="w-8 h-8 text-text-muted animate-pulse" />
              <p className="text-xs text-text-muted">No active item uploaded</p>
            </div>
          )}

          {/* Item details */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold text-secondary uppercase tracking-widest mt-2">Specifications</h3>
            
            <div className="flex justify-between items-center text-xs py-1 border-b border-black/5">
              <span className="text-text-muted">Product Class</span>
              <span className="font-semibold text-text-primary">{uploadedImage ? "MacBook Pro 14\"" : "Pending..."}</span>
            </div>

            <div className="flex justify-between items-center text-xs py-1 border-b border-black/5">
              <span className="text-text-muted">Architecture</span>
              <span className="font-semibold text-text-primary">{uploadedImage ? "Apple Silicon M3 Pro" : "Pending..."}</span>
            </div>

            <div className="flex justify-between items-center text-xs py-1 border-b border-black/5">
              <span className="text-text-muted">Memory Capacity</span>
              <span className="font-semibold text-text-primary">{uploadedImage ? "18GB Unified RAM" : "Pending..."}</span>
            </div>

            <div className="flex justify-between items-center text-xs py-1 border-b border-black/5">
              <span className="text-text-muted">Solid-State Drive</span>
              <span className="font-semibold text-text-primary">{uploadedImage ? "512GB SSD" : "Pending..."}</span>
            </div>

            <div className="flex justify-between items-center text-xs py-1 border-b border-black/5">
              <span className="text-text-muted">Owner's Floor</span>
              <span className="font-bold text-emerald-400">${floorPrice}</span>
            </div>

            <div className="flex justify-between items-center text-xs py-1">
              <span className="text-text-muted">Safe Handover</span>
              <span className="font-semibold text-text-primary max-w-[120px] truncate" title={pickupLocation}>{pickupLocation}</span>
            </div>
          </div>

          {/* Missing fields alert */}
          {uploadedImage && (
            <div className="mt-auto glass-card border-violet-500/20 bg-violet-500/5 p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-violet-400" />
                <span className="text-xs font-bold text-violet-300">Gemini Active Insights</span>
              </div>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                Prerecorded facts extraction complete. Negotiating agent has verified local comps and mapped specifications automatically.
              </p>
            </div>
          )}
        </section>

        {/* MIDDLE COLUMN: Interactive Demo Screen View (9 Steps) */}
        <section className="flex flex-col gap-4 overflow-y-auto">
          {/* Active Screen Container */}
          <div className="glass-panel flex-1 p-6 relative overflow-hidden flex flex-col justify-between min-h-[480px]">
            
            {/* SCREEN 1: LANDING SCREEN */}
            {currentStep === 1 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-6 px-4 animate-fade-in">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-gradient-to-tr from-violet-600 to-cyan-500 rounded-full blur-3xl opacity-30 animate-pulse-glow"></div>
                  <div className="relative w-28 h-28 rounded-2xl bg-slate-50 border border-black/10 flex items-center justify-center shadow-2xl">
                    <Laptop className="w-16 h-16 text-violet-400" />
                    <Sparkles className="absolute -top-2 -right-2 w-6 h-6 text-cyan-400 animate-bounce" />
                  </div>
                </div>

                <h1 className="text-4xl md:text-5xl font-extrabold leading-tight tracking-tight max-w-xl mb-4">
                  This MacBook is about to <br />
                  <span className="text-gradient">sell itself.</span>
                </h1>
                
                <p className="text-base text-secondary max-w-lg mb-8 leading-relaxed">
                  Welcome to <strong>The Oracle</strong>. Resale is manual; The Oracle is autonomous. Give your item its own AI agent that inspects specs, checks market comps, negotiates with buyers, and blocks scams.
                </p>

                <button 
                  onClick={() => setCurrentStep(2)}
                  className="btn-premium flex items-center gap-2 text-sm shadow-xl"
                >
                  Create AI Seller Agent <ArrowRight className="w-4 h-4" />
                </button>

                <div className="mt-8 flex gap-6 text-xs text-text-muted justify-center border-t border-black/5 pt-6 w-full max-w-md">
                  <span className="flex items-center gap-1.5"><ShieldCheck className="w-4 h-4 text-emerald-500" /> Sandbox Secure</span>
                  <span className="flex items-center gap-1.5"><User className="w-4 h-4 text-violet-400" /> Human in the Loop</span>
                </div>
              </div>
            )}

            {/* SCREEN 2: ITEM INTAKE */}
            {currentStep === 2 && (
              <div className="flex-1 flex flex-col justify-between animate-fade-in">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">Step 2 of 9</span>
                    <h2 className="text-lg font-bold">Multimodal Item Intake</h2>
                  </div>
                  <p className="text-xs text-secondary mb-4">Upload item photos. Gemini will run multi-modal analysis to extract precise metadata.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-5 my-2">
                  {/* Photo Dropzone Container */}
                  <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-secondary uppercase tracking-wider">Upload laptop photos</h3>
                    
                    {isIntaking ? (
                      <div className="border border-violet-500/30 rounded-xl p-8 bg-violet-950/10 flex flex-col items-center justify-center gap-3 aspect-video">
                        <RefreshCw className="w-8 h-8 text-violet-400 animate-spin" />
                        <span className="text-xs font-semibold text-violet-300">Gemini analyzing item specs ({intakeProgress}%)</span>
                        <div className="w-32 h-1.5 bg-slate-50 rounded-full overflow-hidden">
                          <div className="h-full gemini-gradient" style={{ width: `${intakeProgress}%` }}></div>
                        </div>
                      </div>
                    ) : uploadedImage ? (
                      <div className="relative rounded-xl overflow-hidden border border-black/10 bg-black aspect-video">
                        <img src={uploadedImage} alt="Uploaded" className="w-full h-full object-cover" />
                        <button 
                          onClick={() => setUploadedImage(null)}
                          className="absolute top-2 right-2 p-1.5 rounded-full bg-black/70 border border-black/10 hover:bg-black/90 text-white"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div 
                        onClick={handleIntakeSimulation}
                        className="border-2 border-dashed border-black/10 hover:border-violet-500/40 rounded-xl p-6 text-center bg-slate-50/60 hover:bg-slate-50 cursor-pointer flex flex-col items-center justify-center gap-3 aspect-video transition-all"
                      >
                        <Upload className="w-8 h-8 text-violet-400 animate-bounce" />
                        <div>
                          <p className="text-xs font-bold text-text-primary">Click to select demo MacBook photo</p>
                          <p className="text-[10px] text-text-muted mt-1">Simulates camera capture intake</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Form constraints */}
                  <div className="flex flex-col gap-3">
                    <h3 className="text-xs font-bold text-secondary uppercase tracking-wider">Set Seller Constraints</h3>
                    
                    <div className="glass-card flex flex-col gap-4">
                      <div>
                        <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Floor Price (Minimum Acceptable)</label>
                        <div className="relative rounded-lg overflow-hidden border border-black/10 bg-slate-50">
                          <DollarSign className="absolute left-3 top-2.5 w-4 h-4 text-emerald-400" />
                          <input 
                            type="number" 
                            value={floorPrice} 
                            onChange={(e) => setFloorPrice(Number(e.target.value))}
                            className="w-full pl-8 pr-3 py-2 bg-transparent text-sm text-text-primary font-bold focus:outline-none focus:border-violet-500" 
                          />
                        </div>
                        <p className="text-[9px] text-text-muted mt-1">The agent will strictly decline any negotiated deals below this limit.</p>
                      </div>

                      <div>
                        <label className="block text-[10px] uppercase font-bold text-text-muted mb-1">Handover Preference</label>
                        <div className="relative rounded-lg overflow-hidden border border-black/10 bg-slate-50">
                          <MapPin className="absolute left-3 top-2.5 w-4 h-4 text-violet-400" />
                          <input 
                            type="text" 
                            value={pickupLocation} 
                            onChange={(e) => setPickupLocation(e.target.value)}
                            className="w-full pl-8 pr-3 py-2 bg-transparent text-sm text-text-primary font-medium focus:outline-none focus:border-violet-500" 
                          />
                        </div>
                        <p className="text-[9px] text-text-muted mt-1">Preferred meeting spots (e.g. Ferry Building public lobby).</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end mt-4 border-t border-black/5 pt-4">
                  <button 
                    disabled={!uploadedImage}
                    onClick={() => setCurrentStep(3)}
                    className="btn-premium text-xs"
                  >
                    Generate AI Seller Agent <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            )}

            {/* SCREEN 3: SELLER AGENT CARDS */}
            {currentStep === 3 && (
              <div className="flex-1 flex flex-col justify-between animate-fade-in">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">Step 3 of 9</span>
                      <h2 className="text-lg font-bold">Seller Agent Registered</h2>
                    </div>
                    <span className="text-xs px-2.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400 font-bold flex items-center gap-1.5 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span> Online
                    </span>
                  </div>
                  <p className="text-xs text-secondary mb-4">Meet your dedicated seller agent, spawned securely to represent your item. It has loaded constraints and goal alignments.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-2">
                  <div className="md:col-span-1 glass-card border-violet-500/20 bg-violet-500/[0.02] p-4 flex flex-col items-center justify-center text-center">
                    <div className="relative w-16 h-16 rounded-full bg-violet-500/10 border border-violet-500/30 flex items-center justify-center mb-3">
                      <Laptop className="w-8 h-8 text-violet-400" />
                      <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 border-2 border-bg-primary flex items-center justify-center text-[10px] text-black font-extrabold">✓</div>
                    </div>
                    <h3 className="text-sm font-bold">MacBookSeller_001</h3>
                    <p className="text-[10px] text-text-muted mt-1 leading-none">Managed Seller Agent</p>
                    
                    <div className="mt-4 w-full bg-slate-50 border border-black/5 rounded-lg p-2 text-left">
                      <div className="text-[9px] uppercase font-bold text-text-muted">Target Objective</div>
                      <p className="text-xs font-semibold text-text-primary mt-0.5">Secure max deal value starting from $850 down to $725 floor.</p>
                    </div>
                  </div>

                  <div className="md:col-span-2 flex flex-col gap-3">
                    <div className="glass-card">
                      <h4 className="text-xs font-bold text-violet-300 uppercase tracking-wider mb-2">Allowed Capabilities</h4>
                      <ul className="text-xs space-y-1.5 text-text-secondary list-disc pl-4">
                        {SELLER_ALLOWED.map((action, idx) => (
                          <li key={idx}>{action}</li>
                        ))}
                      </ul>
                    </div>

                    <div className="glass-card border-rose-500/10 bg-rose-500/[0.01]">
                      <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-2">Hard-Coded Constraints (Blocked)</h4>
                      <ul className="text-xs space-y-1.5 text-text-secondary list-disc pl-4">
                        {SELLER_BLOCKED.map((action, idx) => (
                          <li key={idx}>
                            <strong className="text-rose-400">Never</strong>{' '}
                            {idx === 0
                              ? `sell below the set floor (${'$'}${floorPrice}).`
                              : action.replace(/^[A-Z]/, (c) => c.toLowerCase())}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end mt-4 border-t border-black/5 pt-4">
                  <button 
                    onClick={() => setCurrentStep(4)}
                    className="btn-premium text-xs"
                  >
                    Activate Pricing Agent <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            )}

            {/* SCREEN 4: PRICING AGENT SANDBOX */}
            {currentStep === 4 && (
              <div className="flex-1 flex flex-col justify-between animate-fade-in">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">Step 4 of 9</span>
                      <h2 className="text-lg font-bold">Pricing Agent Sandbox Run</h2>
                    </div>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full border font-bold flex items-center gap-1.5 transition-all ${
                      pricingCalculated ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400 animate-pulse'
                    }`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${pricingCalculated ? 'bg-emerald-500' : 'bg-yellow-500'}`}></span>
                      {pricingCalculated ? 'Analysis Complete' : 'Scraping Market Comps...'}
                    </span>
                  </div>
                  <p className="text-xs text-secondary mb-3">The pricing agent spins up a isolated sandbox environment to scour verified resale markets, compile comps, and produce a defensible band.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-2 flex-1 items-stretch">
                  {/* Left Column: Sandbox Shell */}
                  <div className="md:col-span-2 flex flex-col glass-card border-black/5 bg-black/60 p-3 rounded-xl min-h-[180px] font-mono text-[10px] text-cyan-400 overflow-hidden relative">
                    <div className="flex items-center justify-between border-b border-black/5 pb-2 mb-2">
                      <div className="flex items-center gap-1.5">
                        <Terminal className="w-3.5 h-3.5 text-secondary" />
                        <span className="text-secondary font-bold text-[9px] uppercase tracking-wider">pricing_agent_sandbox_v1.0.sh</span>
                      </div>
                      <span className="text-text-muted text-[8px]">bash (python3)</span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-1 pr-1 max-h-[140px] leading-relaxed">
                      {sandboxLogs.map((log, index) => (
                        <div key={index} className="flex gap-2">
                          <span className="text-text-muted select-none">$&gt;</span>
                          <span className={log.includes("✅") ? "text-emerald-400 font-bold" : log.includes("⚡") ? "text-violet-400" : "text-cyan-300"}>
                            {log}
                          </span>
                        </div>
                      ))}
                      <div ref={logsEndRef}></div>
                    </div>
                  </div>

                  {/* Right Column: Pricing Band Outcome */}
                  <div className="md:col-span-1 flex flex-col justify-center glass-card border-cyan-500/20 bg-cyan-500/[0.01] p-4 text-center">
                    <div className="text-xs uppercase font-bold text-text-muted mb-3">Defensible Price Band</div>
                    
                    {pricingCalculated ? (
                      <div className="space-y-4 animate-fade-in">
                        <div className="bg-slate-50 border border-black/5 rounded-xl p-3">
                          <div className="text-[10px] text-text-muted uppercase font-bold">Recommended Listing Price</div>
                          <div className="text-2xl font-extrabold text-text-primary mt-1">${PRICING_REPORT.list_price}</div>
                          <div className="text-[9px] text-cyan-300 mt-1">High listing start</div>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-white/70 border border-black/5 rounded-lg p-1.5">
                            <div className="text-[8px] text-text-muted uppercase">Fair Value</div>
                            <div className="text-sm font-bold text-emerald-400 mt-0.5">${PRICING_REPORT.fair_price}</div>
                          </div>
                          <div className="bg-white/70 border border-black/5 rounded-lg p-1.5">
                            <div className="text-[8px] text-text-muted uppercase">Fast Sale</div>
                            <div className="text-sm font-bold text-amber-400 mt-0.5">${PRICING_REPORT.fast_sale_price}</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] text-text-secondary px-1 mt-2">
                          <span>Confidence Score</span>
                          <span className="text-cyan-400 font-bold">{Math.round(PRICING_REPORT.confidence * 100)}% Match</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center gap-2 py-6 text-text-muted">
                        <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
                        <span className="text-[10px]">Processing comps data...</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Comps List Display */}
                {pricingCalculated && (
                  <div className="mt-3 animate-fade-in">
                    <h3 className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-2">Comps Collected (/workspace/comps.json)</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      {DEMO_COMPS.map((c, i) => (
                        <div key={i} className="bg-slate-50/60 border border-black/5 rounded-lg p-2 text-left flex justify-between items-center text-[10px]">
                          <div>
                            <div className="font-bold text-text-primary truncate max-w-[100px]" title={c.title}>{c.title}</div>
                            <div className="text-[8px] text-text-muted mt-0.5">{c.source} ({c.condition})</div>
                          </div>
                          <span className="font-bold text-emerald-400">${c.price}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end mt-4 border-t border-black/5 pt-4">
                  <button 
                    disabled={!pricingCalculated}
                    onClick={() => setCurrentStep(5)}
                    className="btn-premium text-xs"
                  >
                    Match with Live Buyers <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            )}

            {/* SCREEN 5: BUYER MATCH */}
            {currentStep === 5 && (
              <div className="flex-1 flex flex-col justify-between animate-fade-in">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-pink-500/10 text-pink-400 border border-pink-500/20">Step 5 of 9</span>
                      <h2 className="text-lg font-bold">Buyer Persona Matched</h2>
                    </div>
                    <span className="text-xs px-2.5 py-0.5 rounded-full border border-pink-500/30 bg-pink-500/10 text-pink-400 font-bold flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5" /> Sarah Online
                    </span>
                  </div>
                  <p className="text-xs text-secondary mb-4">A compatible buyer agent has connected representing Sarah. Their priorities have been matched with your item specs.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-5 my-2">
                  {/* Buyer details card */}
                  <div className="md:col-span-1 glass-card border-pink-500/20 bg-pink-500/[0.01] p-4 text-center flex flex-col justify-between">
                    <div>
                      <div className="w-16 h-16 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center mx-auto mb-3">
                        <User className="w-8 h-8 text-pink-400" />
                      </div>
                      <h3 className="text-sm font-bold">Sarah</h3>
                      <p className="text-[9px] text-text-muted mt-0.5 uppercase tracking-wider font-semibold">ML Engineer / Buyer</p>
                      
                      <div className="mt-4 bg-slate-50 border border-black/5 rounded-xl p-3 text-left space-y-2">
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-text-muted">Total Budget</span>
                          <span className="font-bold text-emerald-400">$800 max</span>
                        </div>
                        <div className="flex justify-between items-center text-[10px]">
                          <span className="text-text-muted">Safe Location</span>
                          <span className="font-semibold text-text-primary">Ferry Building SF</span>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-black/5 pt-3 mt-3">
                      <div className="text-[9px] uppercase font-bold text-text-muted">Opening Proposal Recommendation</div>
                      <span className="text-lg font-extrabold text-cyan-400 mt-1 inline-block">$760</span>
                    </div>
                  </div>

                  {/* Matching score card */}
                  <div className="md:col-span-2 flex flex-col gap-4">
                    <div className="glass-card flex-1 flex flex-col justify-between p-4">
                      <div>
                        <h4 className="text-xs font-bold text-violet-300 uppercase tracking-wider mb-3">Intelligent Requirements Alignment</h4>
                        
                        <div className="space-y-2.5">
                          {BUYER_MATCH_SIGNALS.map((signal, idx) => (
                            <div key={idx} className="flex items-center justify-between text-xs bg-white/70 px-3 py-1.5 rounded-lg border border-black/5">
                              <span className="text-text-secondary">{signal.label}</span>
                              <span className="px-2 py-0.5 text-[9px] font-bold bg-emerald-500/10 text-emerald-400 rounded border border-emerald-500/20">{signal.result}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-black/5 pt-3">
                        <div className="flex items-center gap-2">
                          <div className="w-10 h-10 rounded-full bg-violet-500/10 flex items-center justify-center font-black text-violet-400 text-xs">{Math.round(buyerAgent.match_score * 100)}%</div>
                          <div>
                            <div className="text-[10px] font-bold text-text-primary">High-Affinity Lead</div>
                            <div className="text-[8px] text-text-muted">High intent same-day deal potential</div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end mt-4 border-t border-black/5 pt-4">
                  <button 
                    onClick={() => setCurrentStep(6)}
                    className="btn-premium text-xs"
                  >
                    Enter Negotiation Arena <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            )}

            {/* SCREEN 6: NEGOTIATION ARENA */}
            {currentStep === 6 && (
              <div className="flex-1 flex flex-col justify-between animate-fade-in">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">Step 6 of 9</span>
                      <h2 className="text-lg font-bold">Negotiation Arena</h2>
                    </div>
                    <span className="text-xs px-2.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400 font-bold flex items-center gap-1.5 animate-pulse">
                      <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span> Live Agent Handshake
                    </span>
                  </div>
                  <p className="text-xs text-secondary mb-3">Watch the live agent-to-agent negotiation dialog. The Seller Agent safeguards constraints while answering questions.</p>
                </div>

                {/* Central Chat Feed */}
                <div className="bg-slate-50 border border-black/5 rounded-xl p-4 flex flex-col gap-3 min-h-[220px] max-h-[260px] overflow-y-auto mb-2 relative">
                  
                  {/* Message 1: Buyer Agent */}
                  <div className="flex gap-3 text-left">
                    <div className="w-7 h-7 rounded-full bg-pink-500/10 border border-pink-500/20 flex items-center justify-center flex-shrink-0 text-pink-400 text-xs font-bold">B</div>
                    <div className="bg-slate-50 rounded-xl p-2.5 text-xs max-w-[80%] border border-black/5">
                      <div className="font-bold text-pink-300 text-[9px] uppercase tracking-wider mb-0.5">Buyer Agent (Sarah)</div>
                      <p className="text-text-primary leading-normal">
                        Hi there! Sarah is looking for an Apple Silicon machine for coding and local LLM work. Can Sarah do $760 today and pick up at the Ferry Building public area?
                      </p>
                    </div>
                  </div>

                  {/* Message 2: Seller Agent */}
                  <div className="flex gap-3 text-right justify-end">
                    <div className="bg-violet-950/20 rounded-xl p-2.5 text-xs max-w-[80%] border border-violet-500/10 text-left">
                      <div className="font-bold text-violet-400 text-[9px] uppercase tracking-wider mb-0.5">Seller Agent (MacBookSeller_001)</div>
                      <p className="text-text-primary leading-normal">
                        Hello! Yes, Sarah is in luck. This is the MacBook Pro 14" with M3 Pro and 18GB memory, which is exceptional for running models and code suites. Since it is in mint condition, I can counter at $825. Let me verify the battery cycles.
                      </p>
                    </div>
                    <div className="w-7 h-7 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0 text-violet-400 text-xs font-bold">S</div>
                  </div>

                  {/* Owner prompt block */}
                  <div className="glass-card border-violet-500/35 bg-violet-500/5 p-3 text-left flex flex-col gap-2 rounded-lg relative overflow-hidden animate-pulse">
                    <div className="flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-violet-400" />
                      <span className="text-[10px] uppercase font-extrabold tracking-wider text-violet-300">Human Interaction Requested</span>
                    </div>
                    <p className="text-[10px] text-text-secondary">
                      Seller Agent: <em>"Ayush, the buyer has requested verified battery cycle count info before finalizing. What are the cycles?"</em>
                    </p>
                    
                    {ownerFactSubmitted ? (
                      <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 mt-1">
                        <CheckCircle className="w-4 h-4" /> Fact injected: Battery cycles set to {batteryCycles}!
                      </div>
                    ) : (
                      <div className="flex gap-2 mt-1">
                        <input 
                          type="text" 
                          placeholder="e.g. 142" 
                          value={batteryCycles}
                          onChange={(e) => setBatteryCycles(e.target.value)}
                          className="px-3 py-1.5 bg-white border border-violet-500/30 text-xs text-text-primary rounded focus:outline-none focus:border-violet-400 w-28"
                        />
                        <button 
                          onClick={() => {
                            if (batteryCycles) {
                              setOwnerFactSubmitted(true);
                              setTimeout(() => {
                                // Simulate deal progression
                              }, 1000);
                            }
                          }}
                          className="bg-violet-500 hover:bg-violet-600 text-white px-3 py-1.5 rounded text-[10px] font-semibold flex items-center gap-1 transition-all"
                        >
                          Submit Fact <Send className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Live offer card */}
                {ownerFactSubmitted && (
                  <div className="glass-card border-emerald-500/20 bg-emerald-500/[0.01] p-3 text-left flex items-center justify-between text-xs animate-fade-in mt-1">
                    <div className="flex items-center gap-2">
                      <ThumbsUp className="w-4 h-4 text-emerald-400" />
                      <div>
                        <span className="font-bold text-emerald-400">Owner Fact Injected Successfully</span>
                        <p className="text-[10px] text-text-muted mt-0.5">Negotiating deal progress: Seller Agent countered $800.</p>
                      </div>
                    </div>
                    <span className="font-extrabold text-base text-text-primary">$800 Counter</span>
                  </div>
                )}

                <div className="flex justify-end mt-4 border-t border-black/5 pt-4">
                  <button 
                    onClick={() => setCurrentStep(7)}
                    className="btn-premium text-xs"
                  >
                    Expose Trust Protection <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            )}

            {/* SCREEN 7: TRUST AGENT WARNING */}
            {currentStep === 7 && (
              <div className="flex-1 flex flex-col justify-between animate-fade-in">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">Step 7 of 9</span>
                      <h2 className="text-lg font-bold text-rose-400">Trust Shield Activated</h2>
                    </div>
                    <span className="text-xs px-2.5 py-0.5 rounded-full border border-rose-500/30 bg-rose-500/10 text-rose-400 font-bold flex items-center gap-1.5 animate-pulse">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-500" /> Pattern Scanned
                    </span>
                  </div>
                  <p className="text-xs text-secondary mb-4">The Trust Agent runs background heuristics on all dialogue streams, actively shielding the deal from external vulnerabilities and scam methods.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-2 flex-1 items-stretch">
                  
                  {/* Left panel: Intercepted Chat */}
                  <div className="md:col-span-2 glass-card border-rose-500/20 bg-black/60 p-4 flex flex-col justify-between">
                    <div>
                      <div className="text-[9px] uppercase font-bold text-rose-400 mb-2">DIALOGUE STREAM UNDER REVIEW</div>
                      
                      <div className="space-y-3">
                        <div className="flex gap-2 text-left opacity-60">
                          <div className="w-5 h-5 rounded-full bg-violet-500/10 flex items-center justify-center flex-shrink-0 text-[8px] font-bold text-violet-400">S</div>
                          <p className="text-[10px] bg-slate-50 rounded-lg p-2">Seller: "Priscilla confirms the battery health has 142 cycles. I can do $800 for public cash swap."</p>
                        </div>

                        <div className="flex gap-2 text-left bg-rose-950/20 border border-rose-500/20 rounded-lg p-2.5 relative">
                          <div className="w-5 h-5 rounded-full bg-rose-500/10 flex items-center justify-center flex-shrink-0 text-[8px] font-bold text-rose-400">B</div>
                          <div>
                            <div className="font-extrabold text-[9px] text-rose-400 uppercase tracking-widest flex items-center gap-1">
                              Risky Input <AlertTriangle className="w-3 h-3 text-rose-500 animate-bounce" />
                            </div>
                            <p className="text-[10px] text-text-primary mt-1">
                              Buyer Agent: "{TRUST_INCIDENT.trigger_message}"
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-black/5 pt-3 mt-3 text-[10px] text-text-muted">
                      Status: Dialog stream flagged by heuristic pattern (payment-code verification swap).
                    </div>
                  </div>

                  {/* Right panel: Trust Report */}
                  <div className="md:col-span-1 glass-card border-rose-500/30 bg-rose-950/15 p-4 flex flex-col justify-between text-center relative overflow-hidden">
                    <div className="absolute inset-0 bg-radial-gradient from-rose-500/10 to-transparent pointer-events-none"></div>
                    <div>
                      <ShieldAlert className="w-10 h-10 text-rose-500 mx-auto mb-2 animate-pulse" />
                      <h3 className="text-xs uppercase font-extrabold tracking-wider text-rose-400">Threat Isolated</h3>
                      
                      <div className="mt-3 bg-slate-50 border border-rose-500/25 rounded-lg p-2.5 text-left text-[9px] space-y-1.5 text-rose-300">
                        <div>
                          <strong>Scam Blueprint:</strong> {TRUST_INCIDENT.scam_blueprint}
                        </div>
                        <div>
                          <strong>Action Taken:</strong> {TRUST_INCIDENT.action_taken}
                        </div>
                      </div>
                    </div>

                    <div className="text-[10px] text-emerald-400 border border-emerald-500/20 bg-emerald-500/5 rounded-md py-1 mt-3 font-semibold">
                      ✓ Deal Re-routed to Local Swap
                    </div>
                  </div>
                </div>

                <div className="flex justify-end mt-4 border-t border-black/5 pt-4">
                  <button 
                    onClick={() => setCurrentStep(8)}
                    className="btn-premium text-xs bg-rose-600 hover:bg-rose-700"
                  >
                    View Final Deal Summary <ArrowRight className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            )}

            {/* SCREEN 8: HUMAN APPROVAL */}
            {currentStep === 8 && (
              <div className="flex-1 flex flex-col justify-between animate-fade-in">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">Step 8 of 9</span>
                      <h2 className="text-lg font-bold">Human in the Loop</h2>
                    </div>
                    <span className="text-xs px-2.5 py-0.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-400 font-bold flex items-center gap-1.5 animate-pulse">
                      <User className="w-3.5 h-3.5 text-violet-400" /> Pending Owner Handshake
                    </span>
                  </div>
                  <p className="text-xs text-secondary mb-4">No transactions occur without your strict permission. Review the final terms isolated safely by your Trust Agent.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-2">
                  
                  {/* Deal overview */}
                  <div className="md:col-span-2 glass-card p-4 space-y-3">
                    <h3 className="text-xs font-bold text-violet-300 uppercase tracking-wider mb-2">Proposed Agreement Blueprint</h3>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 border border-black/5 rounded-xl p-3">
                        <div className="text-[9px] text-text-muted uppercase">Final Deal Value</div>
                        <div className="text-xl font-black text-emerald-400 mt-0.5">$800</div>
                      </div>

                      <div className="bg-slate-50 border border-black/5 rounded-xl p-3">
                        <div className="text-[9px] text-text-muted uppercase">Secure Location</div>
                        <div className="text-xs font-semibold text-text-primary mt-1 flex items-center gap-1 truncate" title={pickupLocation}>
                          <MapPin className="w-3 h-3 text-violet-400" /> Ferry Building public area
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs bg-white p-2 rounded-lg border border-black/5 text-[10px] text-text-secondary">
                      <div className="flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-secondary" /> Hands-off pickup before 7:00 PM
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-emerald-400" /> Verified in-person cash swap
                      </div>
                    </div>
                  </div>

                  {/* Trust Rating */}
                  <div className="md:col-span-1 glass-card border-emerald-500/20 bg-emerald-500/[0.01] p-4 text-center flex flex-col justify-between">
                    <div>
                      <ShieldCheck className="w-10 h-10 text-emerald-400 mx-auto mb-2 animate-bounce" />
                      <h3 className="text-xs uppercase font-extrabold tracking-wider text-emerald-400">Risk Assessment</h3>
                      
                      <div className="text-2xl font-black text-text-primary mt-1">LOW RISK</div>
                      <p className="text-[9px] text-text-muted mt-1 leading-normal">
                        Trust Agent re-aligned deal to in-person swap. External fraud vectors isolated.
                      </p>
                    </div>

                    {/* CTAs */}
                    <div className="space-y-2 mt-4">
                      <button 
                        onClick={() => setCurrentStep(9)}
                        className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-extrabold text-xs py-2 rounded-lg flex items-center justify-center gap-1.5 shadow-lg shadow-emerald-950/20 transition-all"
                      >
                        Approve Deal
                      </button>
                      <button 
                        onClick={() => setCurrentStep(6)}
                        className="w-full bg-slate-50 border border-black/10 hover:bg-slate-100 text-text-primary text-xs py-2 rounded-lg font-semibold transition-all"
                      >
                        Counter Terms
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* SCREEN 9: FINAL SUCCESS */}
            {currentStep === 9 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center py-6 px-4 animate-fade-in">
                <div className="relative mb-6">
                  <div className="absolute inset-0 bg-gradient-to-tr from-emerald-500 to-cyan-500 rounded-full blur-3xl opacity-20 animate-pulse-glow"></div>
                  <div className="relative w-20 h-20 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center shadow-2xl">
                    <Check className="w-10 h-10 text-emerald-400 animate-bounce" />
                  </div>
                </div>

                <h1 className="text-3xl md:text-4xl font-extrabold leading-tight tracking-tight mb-2">
                  Deal Finalized!
                </h1>
                
                <p className="text-xs text-secondary max-w-md mb-6 leading-relaxed">
                  Your MacBook has sold itself successfully. Under the hood, 6 Gemini Managed Agents collaborated to research channels, price, negotiate, verify facts, secure, and route approval.
                </p>

                {/* Slogan and managed badges */}
                <div className="glass-card max-w-md w-full border-black/10 bg-slate-50 p-4 mb-6">
                  <span className="text-[9px] uppercase tracking-widest font-extrabold text-violet-300">DEMO SUCCESS OVERVIEW</span>
                  <div className="text-sm font-bold text-text-primary mt-1 mb-3">“Universal Cart for secondhand goods.”</div>
                  
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    {MANAGED_AGENTS.map((agent) => {
                      const dot =
                        agent.color_token === 'violet' ? 'bg-violet-500' :
                        agent.color_token === 'cyan'   ? 'bg-cyan-500'   :
                        agent.color_token === 'pink'   ? 'bg-pink-500'   :
                        agent.color_token === 'rose'   ? 'bg-rose-500'   :
                        agent.color_token === 'amber'  ? 'bg-amber-500'  :
                        'bg-emerald-500';
                      const outcome =
                        agent.role === 'seller'   ? 'Goal Hit' :
                        agent.role === 'pricing'  ? 'Comps Scraped' :
                        agent.role === 'buyer'    ? 'Aligned' :
                        agent.role === 'trust'    ? 'Secured' :
                        agent.role === 'research' ? 'Channel Ranked' :
                        'Listings Drafted';
                      return (
                        <div key={agent.agent_id} className="bg-slate-50 border border-black/5 rounded-lg py-1 px-2 text-left flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full ${dot}`}></span>
                          {agent.display_name}: {outcome}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <button 
                  onClick={startAgentFlow}
                  className="px-5 py-2 rounded-lg border border-violet-500/20 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20 text-xs font-semibold flex items-center gap-1 transition-all"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Restart Presentation
                </button>
              </div>
            )}

            {/* Floating indicator */}
            <div className="absolute top-2 right-2 flex items-center gap-2">
              <span className="text-[9px] font-bold text-text-muted bg-slate-50 px-2 py-0.5 rounded border border-black/5">
                THE ORACLE ENGINE LIVE
              </span>
            </div>

          </div>
        </section>

        {/* RIGHT COLUMN: Managed Agent Definitions Card Panel */}
        <section className="dashboard-right-panel glass-panel p-5 flex flex-col gap-4 overflow-y-auto">
          <div className="border-b border-black/5 pb-3">
            <h2 className="text-sm font-bold uppercase tracking-wider text-gradient flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-cyan-400" /> Managed Agents (5)
            </h2>
            <p className="text-[10px] text-text-muted mt-1 leading-normal">
              Running inside isolated secure sandbox contexts with specific limits.
            </p>
          </div>

          <div className="space-y-4 flex-1">
            {/* Agent 1: Seller */}
            <div className={`glass-card border-l-4 transition-all duration-300 p-3 rounded-lg ${
              currentStep === 3 ? 'border-l-violet-500 bg-violet-500/5 glow-active' : 'border-l-violet-500/30'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${currentStep >= 3 ? 'bg-violet-400' : 'bg-gray-600'}`}></span>
                  Seller Agent
                </span>
                <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                  currentStep === 3 ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30' : 'bg-slate-50 text-text-muted'
                }`}>
                  {currentStep === 3 ? 'Thinking' : currentStep > 3 ? 'Idle' : 'Locked'}
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1 leading-normal">
                Goal: Maximize deal price above minimum constraints. Represents item specifications.
              </p>
            </div>

            {/* Agent 2: Pricing */}
            <div className={`glass-card border-l-4 transition-all duration-300 p-3 rounded-lg ${
              currentStep === 4 ? 'border-l-cyan-500 bg-cyan-500/5 glow-active' : 'border-l-cyan-500/30'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${currentStep >= 4 ? 'bg-cyan-400' : 'bg-gray-600'}`}></span>
                  Pricing Agent
                </span>
                <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                  currentStep === 4 ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30' : 'bg-slate-50 text-text-muted'
                }`}>
                  {currentStep === 4 ? 'Scraping' : currentStep > 4 ? 'Complete' : 'Locked'}
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1 leading-normal">
                Goal: Scrape verified eBay/Swappa indexes and compile a defensible market price band.
              </p>
            </div>

            {/* Agent 3: Buyer */}
            <div className={`glass-card border-l-4 transition-all duration-300 p-3 rounded-lg ${
              currentStep === 5 || currentStep === 6 ? 'border-l-pink-500 bg-pink-500/5 glow-active' : 'border-l-pink-500/30'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${currentStep >= 5 ? 'bg-pink-400' : 'bg-gray-600'}`}></span>
                  Buyer Agent
                </span>
                <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                  currentStep === 6 ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30' : 'bg-slate-50 text-text-muted'
                }`}>
                  {currentStep === 6 ? 'Negotiating' : currentStep > 6 ? 'Complete' : 'Locked'}
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1 leading-normal">
                Goal: Match buyer budget constraint ($800) and preference profiles locally.
              </p>
            </div>

            {/* Agent 4: Trust */}
            <div className={`glass-card border-l-4 transition-all duration-300 p-3 rounded-lg ${
              currentStep === 7 ? 'border-l-rose-500 bg-rose-500/5 glow-active' : 'border-l-rose-500/30'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${currentStep >= 7 ? 'bg-rose-500' : 'bg-gray-600'}`}></span>
                  Trust Agent
                </span>
                <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                  currentStep === 7 ? 'bg-rose-500/20 text-rose-500 border border-rose-500/30 animate-pulse' : 'bg-slate-50 text-text-muted'
                }`}>
                  {currentStep === 7 ? 'Threat Intercepted' : currentStep > 7 ? 'Secured' : 'Locked'}
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1 leading-normal">
                Goal: Scan dialogue for payment codes, external checkout urgency, or shipping scams.
              </p>
            </div>

            {/* Agent 5: Research (Gemini Deep Research-style channel survey) */}
            <div className="glass-card border-l-4 border-l-emerald-500/40 p-3 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                  <span className={`w-1.5 h-1.5 rounded-full ${researchRunning ? 'bg-emerald-400 animate-pulse' : researchOutput ? 'bg-emerald-500' : 'bg-gray-600'}`}></span>
                  Research Agent
                </span>
                <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                  researchRunning
                    ? 'bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 animate-pulse'
                    : researchOutput
                      ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                      : 'bg-slate-50 text-text-muted'
                }`}>
                  {researchRunning ? 'Researching' : researchOutput ? 'Complete' : 'Idle'}
                </span>
              </div>
              <p className="text-[10px] text-text-muted mt-1 leading-normal">
                Goal: Deep-research secondhand marketplaces and rank channels by net payout, sell-through time, and scam surface.
              </p>

              <div className="mt-2 flex items-center gap-1.5">
                {!researchRunning ? (
                  <button
                    onClick={runLiveResearch}
                    className="px-2 py-1 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 text-[10px] font-semibold flex items-center gap-1 transition-all"
                  >
                    <Sparkles className="w-3 h-3" />
                    {researchOutput ? 'Re-run live research' : 'Run live research'}
                  </button>
                ) : (
                  <button
                    onClick={stopLiveResearch}
                    className="px-2 py-1 rounded border border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 text-[10px] font-semibold flex items-center gap-1 transition-all"
                  >
                    <X className="w-3 h-3" /> Stop
                  </button>
                )}
                <span className="text-[9px] text-text-muted">
                  model: {researchAgent.model}
                </span>
              </div>

              {researchError && (
                <div className="mt-2 text-[10px] text-rose-500 bg-rose-500/10 border border-rose-500/20 rounded px-2 py-1 leading-relaxed">
                  {researchError}
                </div>
              )}

              {(researchOutput || researchRunning) && (
                <pre className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-[10px] leading-relaxed text-text-secondary bg-slate-50 border border-black/5 rounded p-2 font-mono">
                  {researchOutput || 'Spawning sandbox…'}
                  {researchRunning && <span className="animate-pulse">▌</span>}
                </pre>
              )}
            </div>
          </div>

          {/* Slogan details */}
          <div className="glass-card border-violet-500/10 bg-violet-500/[0.01] p-3 text-[10px] space-y-1.5 text-text-secondary leading-relaxed mt-auto">
            <div className="flex items-center gap-1 font-bold text-text-primary">
              <Info className="w-3.5 h-3.5 text-violet-400" />
              <span>Live presentation tip</span>
            </div>
            <p>
              Use the Interactive Tour dashboard at the bottom of the viewport to jump screens instantly. Ideal for seamless pacing under high pressure judges' panel.
            </p>
          </div>
        </section>

      </main>
      )}

      {currentStep > 0 && <FloatingChatLauncher />}

      {/* FLOATING DEMO CONTROLLER BAR — hidden on the landing */}
      {currentStep > 0 && (
      <footer className="fixed bottom-4 left-4 right-4 z-50 glass-panel px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-2xl">
        <div className="flex items-center gap-4 w-full md:w-auto">
          {/* Autoplay controllers */}
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsPlaying(!isPlaying)}
              className={`p-2.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all ${
                isPlaying 
                ? 'bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 shadow-md shadow-amber-950/20' 
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 shadow-md shadow-emerald-950/20'
              }`}
              title={isPlaying ? "Pause Presentation Tour" : "Auto Play 3-Min Tour"}
            >
              <Play className={`w-4 h-4 ${isPlaying ? 'animate-spin' : ''}`} />
              <span className="font-extrabold uppercase tracking-widest text-[9px]">{isPlaying ? 'PAUSE TOUR' : 'AUTO TOUR'}</span>
            </button>

            <select
              value={playbackSpeed}
              onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
              className="bg-white border border-black/10 rounded-lg px-2 py-1 text-[10px] text-text-primary focus:outline-none focus:border-google-blue font-bold"
            >
              <option value={5000}>5s / Screen</option>
              <option value={4000}>4s / Screen</option>
              <option value={3000}>3s / Screen</option>
              <option value={2000}>2s / Screen</option>
            </select>
          </div>

          {/* Stepper buttons */}
          <div className="flex items-center gap-1 bg-white border border-black/5 rounded-xl p-1">
            <button
              disabled={currentStep === 0}
              onClick={() => goToStep(Math.max(0, currentStep - 1))}
              className="p-1.5 rounded-lg hover:bg-black/5 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
              title="Previous Screen"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <span className="text-[10px] font-bold text-text-primary px-2 font-mono">
              {currentStep === 0 ? 'Chat' : `Screen ${currentStep} / 9`}
            </span>

            <button
              disabled={currentStep === 9}
              onClick={() => goToStep(Math.min(9, currentStep + 1))}
              className="p-1.5 rounded-lg hover:bg-black/5 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:bg-transparent"
              title="Next Screen"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Dynamic Presentation Progress Timeline Bar */}
        <div className="flex-1 max-w-xl hidden xl:flex items-center gap-1">
          {[
            { id: 0, label: "Chat" },
            { id: 1, label: "Hero" },
            { id: 2, label: "Intake" },
            { id: 3, label: "Seller" },
            { id: 4, label: "Pricing" },
            { id: 5, label: "Match" },
            { id: 6, label: "Negotiate" },
            { id: 7, label: "Trust Alert" },
            { id: 8, label: "Approval" },
            { id: 9, label: "Success" }
          ].map((s) => (
            <div 
              key={s.id}
              onClick={() => goToStep(s.id)}
              className="flex-1 flex flex-col items-center cursor-pointer group"
            >
              <div className={`h-1.5 w-full rounded-full transition-all duration-300 ${
                currentStep === s.id
                ? 'bg-google-blue scale-y-125'
                : currentStep > s.id
                ? 'bg-google-green/80'
                : 'bg-black/10 group-hover:bg-white/70'
              }`}></div>
              <span className={`text-[8px] mt-1.5 uppercase font-bold tracking-tighter transition-colors duration-200 select-none ${
                currentStep === s.id
                ? 'text-google-blue'
                : currentStep > s.id
                ? 'text-google-green'
                : 'text-text-muted group-hover:text-text-secondary'
              }`}>
                {s.label}
              </span>
            </div>
          ))}
        </div>

        <div className="text-[10px] text-text-secondary leading-tight hidden lg:block text-right">
          <span className="font-bold text-text-primary block">Google I/O Resale Platform Hackathon</span>
          <span>4 Managed Sandbox Agents Live Demonstration Tour</span>
        </div>
      </footer>
      )}
    </div>
  );
}
