'use client';

import React, { useRef } from 'react';
import { 
  Scissors, Layers, Cpu, RotateCw, Upload, Settings, 
  FileText, Maximize2, Activity, Zap, Info
} from 'lucide-react';

import CanvasViewer from '@/components/CanvasViewer';
import { useDxfEstimator, ProcessType } from '@/hooks/useDxfEstimator';

/**
 * Metalyze Pro Dashboard
 * .cursorrules 준수: 레이아웃 구조만 정의하며 로직은 useDxfEstimator 훅으로 위임
 */
export default function MetalyzeDashboard() {
  const {
    selectedProcess, setSelectedProcess,
    entities, selectedIds, setSelectedIds,
    options, setOptions,
    currentStats,
    costResult,
    handleFileUpload,
    exportPDF,
    materials
  } = useDxfEstimator();

  const pdfRef = useRef<HTMLDivElement>(null);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => handleFileUpload(event.target?.result as string);
    reader.readAsText(file);
  };

  return (
    <div className="metalyze-app">
      <style dangerouslySetInnerHTML={{ __html: `
        .metalyze-app {
          --bg: #0b1120; --surface: #161f32; --accent: #38bdf8; --border: rgba(255, 255, 255, 0.05);
          --text-main: #f8fafc; --text-dim: #94a3b8;
          background-color: var(--bg); color: var(--text-main); height: 100vh; width: 100vw;
          display: flex; flex-direction: column; font-family: 'Inter', system-ui, sans-serif; overflow: hidden;
        }
        header { height: 70px; display: flex; align-items: center; justify-content: space-between; padding: 0 30px; background: rgba(22, 31, 50, 0.8); backdrop-filter: blur(20px); border-bottom: 1px solid var(--border); z-index: 100; }
        .main-layout { display: grid; grid-template-columns: 320px 1fr 400px; flex: 1; overflow: hidden; }
        .sidebar { padding: 25px; overflow-y: auto; }
        .sidebar-right { border-left: 1px solid var(--border); background: var(--surface); }
        .proc-card { padding: 18px; border-radius: 16px; background: rgba(255,255,255,0.02); border: 1px solid transparent; margin-bottom: 12px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; gap: 15px; }
        .proc-card.active { background: rgba(56, 189, 248, 0.08); border-color: rgba(56, 189, 248, 0.3); }
        .viewer-container { flex: 1; border-radius: 30px; background: #0b0f19; border: 1px solid var(--border); position: relative; overflow: hidden; }
        .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: 18px; padding: 18px; flex: 1; }
        .price-main { font-size: 48px; font-weight: 950; color: white; letter-spacing: -2px; line-height: 1; }
        .pdf-btn { width: 100%; border-radius: 18px; padding: 18px; background: var(--accent); color: white; font-weight: 950; cursor: pointer; border: none; display: flex; align-items: center; justify-content: center; gap: 12px; transition: all 0.2s; }
        .pdf-btn:hover { filter: brightness(1.1); transform: translateY(-2px); }
        input[type="range"] { width: 100%; height: 6px; background: #010409; border-radius: 5px; appearance: none; accent-color: var(--accent); }
        select, input[type="number"] { width: 100%; background: #010409; border: 1px solid var(--border); border-radius: 12px; padding: 12px; color: white; font-weight: 700; outline: none; transition: border-color 0.2s; }
        select:focus { border-color: var(--accent); }
      ` }} />

      <header>
        <div className="flex items-center gap-4">
          <div className="w-11 h-11 bg-blue-500 rounded-2xl flex items-center justify-center shadow-xl shadow-blue-500/20"><Maximize2 className="text-white" size={26} /></div>
          <div><h1 className="text-xl font-black tracking-tight">METALYZE PRO</h1><p className="text-[10px] font-black text-blue-400/80 tracking-[0.3em] uppercase">Enterprise CAD Estimation Gear</p></div>
        </div>
        <label className="pdf-btn !w-fit !py-2.5 !px-7 !mt-0 shadow-lg shadow-blue-500/20 select-none"><Upload size={18} /> IMPORT DXF SOURCE<input type="file" className="hidden" accept=".dxf" onChange={onFileChange} /></label>
      </header>

      <main className="main-layout">
        {/* 좌측 사이드바: 공정 및 재질 설정 */}
        <aside className="sidebar border-r border-white/5">
          <SectionHeader icon={<Activity size={14}/>} title="Manufacturing Context" />
          <div className="space-y-1">
            <ProcessItem id="LASER" title="Precision Laser" sub="Hyper-fine cutting" active={selectedProcess === 'LASER'} onClick={setSelectedProcess} icon={<Scissors size={18}/>} />
            <ProcessItem id="SHEET_METAL" title="Sheet Bending" sub="Forming & CNC Press" active={selectedProcess === 'SHEET_METAL'} onClick={setSelectedProcess} icon={<Layers size={18}/>} />
            <ProcessItem id="MCT" title="MCT Milling" sub="Subtractive Machining" active={selectedProcess === 'MCT'} onClick={setSelectedProcess} icon={<Cpu size={18}/>} />
            <ProcessItem id="CNC_LATHE" title="CNC Turning" sub="Axis-symmetric parts" active={selectedProcess === 'CNC_LATHE'} onClick={setSelectedProcess} icon={<RotateCw size={18}/>} />
          </div>

          <SectionHeader icon={<Settings size={14}/>} title="Material Specification" className="mt-10" />
          <div className="space-y-4">
            <div className="group/field"><label className="text-[10px] text-slate-500 font-black mb-2 block uppercase tracking-widest">Selected Material</label>
              <select value={options.material} onChange={e => setOptions({...options, material: e.target.value})}>
                {Object.keys(materials).map(m => <option key={m} value={m}>{materials[m].name}</option>)}
              </select>
            </div>
            <div className="group/field"><label className="text-[10px] text-slate-500 font-black mb-2 block uppercase tracking-widest">Stock Thickness (mm)</label>
              <input type="number" step="0.1" value={options.thickness} onChange={e => setOptions({...options, thickness: parseFloat(e.target.value)})} />
            </div>
          </div>
          
          <div className="mt-10 p-5 bg-blue-500/5 rounded-2xl border border-blue-500/10 flex gap-4">
            <Info className="text-blue-400 shrink-0" size={20} />
            <p className="text-[11px] font-medium leading-relaxed text-slate-400">Drag your mouse on the viewer to <b>Box Select</b> multiple paths. Hold <b>Ctrl</b> to append to your current selection.</p>
          </div>
        </aside>

        {/* 중앙: 정밀 뷰어 및 통계 */}
        <section className="p-4 flex flex-col gap-4 overflow-hidden">
          <div className="viewer-container"><CanvasViewer entities={entities} selectedIds={selectedIds} onSelectionChange={setSelectedIds} /></div>
          <div className="flex gap-4">
            <StatCard label="Effective Machining Path" value={`${Math.round(currentStats.totalLength).toLocaleString()}mm`} />
            <StatCard label="Component Bounding Box" value={`${Math.round(currentStats.width)}×${Math.round(currentStats.height)}`} />
            <StatCard label="Entity Count" value={`${selectedIds.size} ea`} />
            <StatCard label="Engine Status" value={<span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]"/> Precision v2.1</span>} />
          </div>
        </section>

        {/* 우측 사이드바: 견적서 및 시뮬레이터 */}
        <aside className="sidebar sidebar-right flex flex-col shadow-[-20px_0_40px_rgba(0,0,0,0.2)]" ref={pdfRef}>
          <div className="flex items-center justify-between mb-8 px-1">
             <div className="text-xl font-black flex items-center gap-3"><Zap className="text-blue-400 fill-blue-400" size={22}/> QUOTATION</div>
             <div className="text-[10px] font-bold text-slate-500 px-3 py-1 bg-white/5 rounded-full border border-white/5 uppercase">Draft v1.02</div>
          </div>

          <div className="bg-black/30 p-8 rounded-[32px] border border-white/5 shadow-inner mb-8">
            <div className="price-main tracking-tighter">{(costResult?.totalCost || 0).toLocaleString()}<span className="text-xl text-slate-500 ml-3 font-bold uppercase tracking-tighter">KRW</span></div>
            <div className="h-[2px] w-12 bg-blue-500 my-5 rounded-full" />
            <div className="text-[11px] text-slate-500 font-bold leading-relaxed uppercase tracking-wide">Total Estimated manufacturing cost based on selected paths</div>
          </div>
          
          <div className="space-y-7 bg-white/2 pb-8 px-2">
            <div className="text-[10px] font-black uppercase text-blue-400 tracking-widest flex items-center gap-2 mb-2"><div className="w-1 h-3 bg-blue-400 rounded-full" /> Parametric Overrides</div>
            <SimGroup label="Fix Setup Fee" value={`₩${options.customSetupCost.toLocaleString()}`} val={options.customSetupCost} min={0} max={200000} step={5000} onChange={(v: number) => setOptions({...options, customSetupCost: v})} />
            <SimGroup label="Material Cost / kg" value={`₩${options.customMaterialPrice.toLocaleString()}`} val={options.customMaterialPrice} min={0} max={15000} step={100} onChange={(v: number) => setOptions({...options, customMaterialPrice: v})} />
            <SimGroup label="Machining Cost / mm" value={`₩${options.customProcessPrice}`} val={options.customProcessPrice} min={0} max={100} step={1} onChange={(v: number) => setOptions({...options, customProcessPrice: v})} />
          </div>

          <div className="mt-auto space-y-3.5 pt-8 border-t border-white/10 px-1">
            <PriceLine label="Calculated Material" val={costResult?.materialCost} />
            <PriceLine label="Manufacturing Labor" val={costResult?.laborCost} />
            <PriceLine label="Variable Setup Fee" val={costResult?.setupCost} />
            <button className="pdf-btn mt-8 hover:shadow-[0_0_30px_rgba(56,189,248,0.2)] active:scale-95" onClick={() => exportPDF(pdfRef)}>
              <FileText size={18}/> GENERATE ENTERPRISE REPORT
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}

// 서브 컴포넌트 타입 정의
interface SectionHeaderProps {
  icon: React.ReactNode;
  title: string;
  className?: string;
}

interface StatCardProps {
  label: string;
  value: React.ReactNode;
}

interface SimGroupProps {
  label: string;
  value: string;
  val: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

interface PriceLineProps {
  label: string;
  val?: number;
}

function SectionHeader({ icon, title, className = "" }: SectionHeaderProps) {
  return (<div className={`text-[10px] uppercase font-black tracking-widest text-blue-400 mb-5 flex items-center gap-2 ${className}`}>{icon} {title}</div>);
}

function ProcessItem({ id, title, sub, icon, active, onClick }: { id: ProcessType, title: string, sub: string, icon: any, active: boolean, onClick: (id: ProcessType) => void }) {
  return (
    <div className={`proc-card ${active ? 'active shadow-lg shadow-blue-500/10' : 'hover:bg-white/[0.04]'}`} onClick={() => onClick(id)}>
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${active ? 'bg-blue-500 text-white shadow-xl shadow-blue-500/40 translate-x-1 outline outline-4 outline-blue-500/10' : 'bg-black/50 text-slate-500'}`}>{icon}</div>
      <div className="ml-1"><h4 className={`text-sm font-black tracking-tight ${active ? 'text-white' : 'text-slate-400'}`}>{title}</h4><p className="text-[10px] font-bold text-slate-500/80">{sub}</p></div>
    </div>
  );
}

function StatCard({ label, value }: StatCardProps) {
  return (<div className="stat-card ring-1 ring-white/5 hover:ring-white/10 transition-all shadow-xl"><div className="text-[9px] font-black text-slate-500 uppercase mb-2 tracking-widest">{label}</div><div className="text-[19px] font-black text-blue-400 tracking-tighter leading-none">{value}</div></div>);
}

function SimGroup({ label, value, val, min, max, step, onChange }: SimGroupProps) {
  return (<div className="space-y-2.5"><div className="flex justify-between text-[11px] font-bold tracking-tight"><span className="text-slate-400">{label}</span><span className="text-blue-400 font-black">{value}</span></div><input type="range" min={min} max={max} step={step} value={val} onChange={e => onChange(parseInt(e.target.value))} /></div>);
}

function PriceLine({ label, val }: PriceLineProps) {
  return (<div className="flex justify-between text-xs font-bold py-1.5"><span className="text-slate-500 uppercase tracking-wide">{label}</span><span className="text-slate-200">₩{(val || 0).toLocaleString()}</span></div>);
}