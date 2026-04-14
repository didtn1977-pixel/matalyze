'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { MousePointer2, BoxSelect, Eraser, ZoomIn, ZoomOut, Move, Maximize } from 'lucide-react';
import { PrecisionEntity } from '@/lib/dxfAnalyzer';

interface CanvasViewerProps {
  entities: PrecisionEntity[];
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

/**
 * [수학적 핵심 유틸리티]
 */
const distToSegment = (px: number, py: number, v: {x: number, y: number}, w: {x: number, y: number}) => {
  const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
  if (l2 === 0) return Math.sqrt((px-v.x)**2 + (py-v.y)**2);
  let t = ((px-v.x)*(w.x-v.x) + (py-v.y)*(w.y-v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - (v.x + t*(w.x-v.x)))**2 + (py - (v.y + t*(w.y-v.y)))**2);
};

// [절대 공식] 전용 Arc 렌더링 함수
function drawPrecisionArc(ctx: CanvasRenderingContext2D, entity: any, originX: number, originY: number, zoom: number) {
  const { center, radius, startAngle, endAngle } = entity;
  
  // 1. 라디안 변환 (부호 없이 우선 변환)
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;

  // 180도 반원 및 호/원 판별 로직 추가 (사용자 명세 반영)
  if (Math.abs(startAngle - endAngle) < 0.01) {
    ctx.beginPath();
    ctx.arc(center.x * zoom + originX, -center.y * zoom + originY, radius * zoom, 0, 2 * Math.PI);
    ctx.stroke();
  } else {
    ctx.beginPath();
    // 2. [절대 공식] 적용 (Y축 반전 및 방향성 강제)
    ctx.arc(
      center.x * zoom + originX,
      -center.y * zoom + originY,
      radius * zoom,
      -startRad,
      -endRad,
      true // 실무 표준 반시계 방향 강제
    );
    ctx.stroke();
  }
}

const CanvasViewer: React.FC<CanvasViewerProps> = ({ entities, selectedIds, onSelectionChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  
  const [mode, setMode] = useState<'PAN' | 'SELECT'>('SELECT');
  const [isInteracting, setIsInteracting] = useState(false);
  const [boxStart, setBoxStart] = useState<{x: number, y: number} | null>(null);
  const [boxEnd, setBoxEnd] = useState<{x: number, y: number} | null>(null);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const container = containerRef.current;
    if (!canvas || !ctx || !container) return;

    if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    const { x: originX, y: originY, scale: zoom } = transformRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // [시스템 강제]: 개별 엔티티 beginPath 독립 실행 및 고정 lineWidth 적용
    entities.forEach((entity) => {
      const isSelected = selectedIds.has(entity.id);
      const e = entity.raw;
      
      ctx.globalAlpha = (isSelected || selectedIds.size === 0) ? 1.0 : 0.15;
      ctx.lineWidth = 2 / zoom; // 가독성 최적화 고정 두께

      if (isSelected) {
        ctx.strokeStyle = '#38bdf8';
        ctx.shadowBlur = 10; ctx.shadowColor = 'rgba(56, 189, 248, 0.9)';
      } else {
        ctx.strokeStyle = '#334155';
        ctx.shadowBlur = 0;
      }

      if (entity.type === 'ARC') {
        drawPrecisionArc(ctx, e, originX, originY, zoom);
      } 
      else {
        ctx.beginPath();
        if (entity.type === 'LINE') {
          ctx.moveTo(e.vertices[0].x * zoom + originX, -e.vertices[0].y * zoom + originY);
          ctx.lineTo(e.vertices[1].x * zoom + originX, -e.vertices[1].y * zoom + originY);
        } else if (entity.type === 'CIRCLE') {
          ctx.arc(e.center.x * zoom + originX, -e.center.y * zoom + originY, e.radius * zoom, 0, 2 * Math.PI);
        } else if (entity.type === 'ELLIPSE') {
          const rX = Math.sqrt(e.majorAxisEndPoint.x**2 + e.majorAxisEndPoint.y**2) * zoom;
          const rY = rX * e.ratio;
          const rot = -Math.atan2(e.majorAxisEndPoint.y, e.majorAxisEndPoint.x);
          ctx.ellipse(e.center.x * zoom + originX, -e.center.y * zoom + originY, rX, rY, rot, -(e.startAngle || 0), -(e.endAngle || 2*Math.PI), true);
        } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
          const v = e.vertices || [];
          if (v.length > 0) {
            ctx.moveTo(v[0].x * zoom + originX, -v[0].y * zoom + originY);
            for (let i = 0; i < v.length - 1; i++) {
              const p1 = v[i], p2 = v[i+1];
                if (Math.abs(p1.bulge) > 0.0001) {
                  const L = Math.sqrt((p2.x-p1.x)**2 + (p2.y-p1.y)**2);
                  const r = (L/2) * (1+p1.bulge**2) / (2*Math.abs(p1.bulge));
                  const d = (L/2) * (1-p1.bulge**2) / (2*p1.bulge);
                  const mx = (p1.x+p2.x)/2, my = (p1.y+p2.y)/2;
                  const vx = p2.x-p1.x, vy = p2.y-p1.y;
                  const cx = mx - (vy/L)*d, cy = my + (vx/L)*d;
                  // [절대 공식]에 따른 Y축 및 각도 반전 보정
                  const sa = -Math.atan2(p1.y - cy, p1.x - cx);
                  const ea = -Math.atan2(p2.y - cy, p2.x - cx);
                  ctx.arc(cx * zoom + originX, -cy * zoom + originY, r * zoom, sa, ea, p1.bulge > 0);
                } else {
                  ctx.lineTo(p2.x * zoom + originX, -p2.y * zoom + originY);
                }
            }
          }
        }
        ctx.stroke();
      }
    });

    // 선택 박스 오버레이
    if (boxStart && boxEnd) {
      const isCrossing = boxEnd.x < boxStart.x;
      ctx.setLineDash(isCrossing ? [5, 5] : []);
      ctx.strokeStyle = isCrossing ? '#4ade80' : '#3b82f6';
      ctx.fillStyle = isCrossing ? 'rgba(74, 222, 128, 0.2)' : 'rgba(59, 130, 246, 0.2)';
      const bx = Math.min(boxStart.x, boxEnd.x), by = Math.min(boxStart.y, boxEnd.y);
      const bw = Math.abs(boxStart.x - boxEnd.x), bh = Math.abs(boxStart.y - boxEnd.y);
      ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx, by, bw, bh);
      ctx.setLineDash([]);
    }
  }, [entities, selectedIds, boxStart, boxEnd]);

  const fitToScreen = useCallback(() => {
    if (entities.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    entities.forEach(e => {
      minX = Math.min(minX, e.bounds.minX); minY = Math.min(minY, e.bounds.minY);
      maxX = Math.max(maxX, e.bounds.maxX); maxY = Math.max(maxY, e.bounds.maxY);
    });
    const c = containerRef.current;
    if (c && minX !== Infinity) {
      const p = 120, w = c.clientWidth - p, h = c.clientHeight - p;
      const dX = maxX - minX, dY = maxY - minY;
      const s = Math.min(w / (dX || 1), h / (dY || 1));
      transformRef.current = { scale: s, x: (c.clientWidth - dX * s) / 2 - minX * s, y: (c.clientHeight + dY * s) / 2 + minY * s };
      draw();
    }
  }, [entities, draw]);

  useEffect(() => { fitToScreen(); }, [entities, fitToScreen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    setIsInteracting(true); lastMousePos.current = { x: e.clientX, y: e.clientY };
    if (mode === 'SELECT' && !e.shiftKey && e.button === 0) {
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setBoxStart({ x: mx, y: my }); setBoxEnd({ x: mx, y: my });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isInteracting) return;
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    if (mode === 'PAN' || e.shiftKey || e.button === 1) {
      transformRef.current.x += e.clientX - lastMousePos.current.x;
      transformRef.current.y += e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    } else if (boxStart) { setBoxEnd({ x: e.clientX - r.left, y: e.clientY - r.top }); }
    draw();
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (boxStart && boxEnd) {
      const isCrossing = boxEnd.x < boxStart.x;
      const { x: cx, y: cy, scale: s } = transformRef.current;
      const wMinX = (Math.min(boxStart.x, boxEnd.x) - cx) / s;
      const wMaxX = (Math.max(boxStart.x, boxEnd.x) - cx) / s;
      const wMinY = (cy - Math.max(boxStart.y, boxEnd.y)) / s;
      const wMaxY = (cy - Math.min(boxStart.y, boxEnd.y)) / s;

      const newlySelected = new Set<number>();
      entities.forEach(ent => {
        const eb = ent.bounds;
        let isInc = isCrossing ? !(eb.maxX < wMinX || eb.minX > wMaxX || eb.maxY < wMinY || eb.minY > wMaxY) : (eb.minX >= wMinX && eb.maxX <= wMaxX && eb.minY >= wMinY && eb.maxY <= wMaxY);
        if (isInc) newlySelected.add(ent.id);
      });

      if (Math.abs(boxStart.x - boxEnd.x) < 5) {
        const mx = (boxStart.x - cx) / s, my = (cy - boxStart.y) / s;
        let best: PrecisionEntity | null = null, dM = 15 / s;
        entities.forEach(ent => {
          const e_ = ent.raw;
          let d = Infinity;
          if (ent.type === 'LINE') d = distToSegment(mx, my, e_.vertices[0], e_.vertices[1]);
          else if (ent.type === 'CIRCLE' || ent.type === 'ARC') d = Math.abs(Math.sqrt((mx-e_.center.x)**2 + (my-e_.center.y)**2) - e_.radius);
          if (d < dM) { dM = d; best = ent; }
        });
        if (best) newlySelected.add((best as PrecisionEntity).id);
      }

      if (e.ctrlKey) {
        onSelectionChange(new Set([...Array.from(selectedIds), ...Array.from(newlySelected)]));
      } else {
        onSelectionChange(newlySelected);
      }
    }
    setIsInteracting(false); setBoxStart(null); setBoxEnd(null); draw();
  };

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#0b0f19] overflow-hidden group">
      <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onWheel={(e) => {
        const f = Math.pow(1.1, -e.deltaY / 100); transformRef.current.scale *= f; draw();
      }} className={`cursor-${mode === 'PAN' ? 'grab' : 'crosshair'}`} />
      
      <div className="absolute top-6 left-6 p-1.5 bg-black/60 backdrop-blur-xl border border-white/10 rounded-2xl flex gap-1 shadow-2xl">
        <ToolbarBtn active={mode === 'SELECT'} icon={<BoxSelect size={16}/>} label="영역 선택" onClick={() => setMode('SELECT')} />
        <ToolbarBtn active={mode === 'PAN'} icon={<Move size={16}/>} label="화면 이동" onClick={() => setMode('PAN')} />
        <div className="w-[1px] h-4 bg-white/10 self-center mx-1" />
        <ToolbarBtn icon={<Eraser size={16}/>} label="전체 해제" onClick={() => onSelectionChange(new Set())} />
        <ToolbarBtn icon={<Maximize size={16}/>} label="화면 맞춤" onClick={fitToScreen} />
        <ToolbarBtn icon={<ZoomIn size={16}/>} label="확대" onClick={() => { transformRef.current.scale *= 1.2; draw(); }} />
        <ToolbarBtn icon={<ZoomOut size={16}/>} label="축소" onClick={() => { transformRef.current.scale /= 1.2; draw(); }} />
      </div>

      <div className="absolute bottom-6 left-6 pointer-events-none flex flex-col gap-2">
        <div className="flex gap-2">
          <StatusBadge icon={<MousePointer2 size={12} />} label={`${selectedIds.size} Paths Selected`} color="blue" />
          <StatusBadge label="R→L Crossing (+)" color="green" />
          <StatusBadge label="L→R Window (Full)" color="blue" />
        </div>
      </div>
    </div>
  );
};

interface ToolbarBtnProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}

function ToolbarBtn({ icon, label, onClick, active }: ToolbarBtnProps) {
  return (
    <button onClick={onClick} className={`p-2 rounded-xl transition-all flex items-center gap-2 group/btn relative ${active ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20' : 'text-slate-400 hover:bg-white/10 hover:text-blue-400'}`}>
      {icon} <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-[9px] font-bold rounded opacity-0 group-hover/btn:opacity-100 transition-opacity whitespace-nowrap border border-white/5">{label}</span>
    </button>
  );
}

interface StatusBadgeProps {
  icon?: React.ReactNode;
  label: string;
  color: 'blue' | 'green';
}

function StatusBadge({ icon, label, color }: StatusBadgeProps) {
  const colors: Record<string, string> = { blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20', green: 'text-green-400 bg-green-500/10 border-green-500/20' };
  return (<div className={`px-4 py-2 rounded-xl backdrop-blur-md border flex items-center gap-2 text-[10px] font-black uppercase tracking-widest ${colors[color]}`}> {icon} {label}</div>);
}

export default CanvasViewer;
