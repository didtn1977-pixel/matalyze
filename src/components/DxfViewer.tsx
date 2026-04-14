'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import DxfParser from 'dxf-parser';
import { MousePointer2, BoxSelect, Eraser, ZoomIn, ZoomOut } from 'lucide-react';

interface DxfViewerProps {
  dxfContent: string | null;
  selectedEntityIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

// 각도 정규화 (0 ~ 2PI)
const normalizeAngle = (angle: number) => {
  while (angle < 0) angle += Math.PI * 2;
  while (angle >= Math.PI * 2) angle -= Math.PI * 2;
  return angle;
};

// 각도가 특정 범위 내에 있는지 확인 (CCW 기준)
const isAngleBetween = (angle: number, start: number, end: number) => {
  const normA = normalizeAngle(angle);
  const normS = normalizeAngle(start);
  const normE = normalizeAngle(end);

  if (normS < normE) {
    return normA >= normS && normA <= normE;
  } else {
    // 0도 경계 통과 케이스
    return normA >= normS || normA <= normE;
  }
};

// 벌지(Bulge) 기하학 계산 도우미 함수
const getBulgeArcData = (p1: any, p2: any, bulge: number) => {
  const L = Math.sqrt((p2.x - p1.x)**2 + (p2.y - p1.y)**2);
  const radius = (L / 2) * (1 + bulge**2) / (2 * Math.abs(bulge));
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const d = (L / 2) * (1 - bulge**2) / (2 * bulge);
  const vx = p2.x - p1.x;
  const vy = p2.y - p1.y;
  const center = { x: mx - (vy / L) * d, y: my + (vx / L) * d };
  const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
  const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);
  return { center, radius, startAngle, endAngle, isCCW: bulge > 0 };
};

const DxfViewer: React.FC<DxfViewerProps> = ({ dxfContent, selectedEntityIds, onSelectionChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>({ x: 0, y: 0, scale: 1 });
  const [entities, setEntities] = useState<any[]>([]);
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  // DXF 파싱 및 초기 설정
  useEffect(() => {
    if (!dxfContent) return;
    try {
      const parser = new DxfParser();
      const dxf: any = parser.parseSync(dxfContent);
      if (!dxf || !dxf.entities) return;
      
      const entitiesWithId = dxf.entities.map((e: any, idx: number) => ({ ...e, __id: idx }));
      setEntities(entitiesWithId);

      // 자동 맞춤 계산 (Bounding Box)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      const updateBounds = (x: number, y: number) => {
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      };

      entitiesWithId.forEach((e: any) => {
        if (e.type === 'LINE' || e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
          e.vertices.forEach((v: any) => updateBounds(v.x, v.y));
        } else if (e.type === 'CIRCLE' || e.type === 'ARC' || e.type === 'ELLIPSE') {
          const c = e.center;
          const r = e.radius || Math.sqrt(e.majorAxisEndPoint.x**2 + e.majorAxisEndPoint.y**2);
          updateBounds(c.x - r, c.y - r);
          updateBounds(c.x + r, c.y + r);
        }
      });

      const container = containerRef.current;
      if (container && minX !== Infinity) {
        const padding = 80;
        const w = container.clientWidth - padding * 2;
        const h = container.clientHeight - padding * 2;
        const dxfW = maxX - minX;
        const dxfH = maxY - minY;
        const scale = Math.min(w / (dxfW || 1), h / (dxfH || 1));
        transformRef.current = {
          scale,
          x: (container.clientWidth - dxfW * scale) / 2 - minX * scale,
          y: (container.clientHeight + dxfH * scale) / 2 + minY * scale
        };
        draw();
      }
    } catch (err) {
      console.error('DXF Parse Error:', err);
    }
  }, [dxfContent]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const container = containerRef.current;
    if (!canvas || !ctx || !container) return;

    if (canvas.width !== container.clientWidth || canvas.height !== container.clientHeight) {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    }

    const { x, y, scale } = transformRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, -scale); 

    entities.forEach((entity: any) => {
      const isSelected = selectedEntityIds.has(entity.__id);
      ctx.beginPath();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      
      if (isSelected) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 3.0 / scale;
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(56, 189, 248, 0.9)';
      } else {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1.2 / scale;
        ctx.shadowBlur = 0;
      }

      if (entity.type === 'LINE') {
        ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
        ctx.lineTo(entity.vertices[1].x, entity.vertices[1].y);
      } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        const pts = entity.vertices || [];
        if (pts.length > 0) {
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let i = 0; i < pts.length - 1; i++) {
            const p1 = pts[i], p2 = pts[i+1];
            if (p1.bulge) {
              const { center, radius, startAngle, endAngle, isCCW } = getBulgeArcData(p1, p2, p1.bulge);
              ctx.arc(center.x, center.y, radius, startAngle, endAngle, !isCCW);
            } else ctx.lineTo(p2.x, p2.y);
          }
          if (entity.shape) {
            const pLast = pts[pts.length - 1];
            const pFirst = pts[0];
            if (pLast.bulge) {
              const { center, radius, startAngle, endAngle, isCCW } = getBulgeArcData(pLast, pFirst, pLast.bulge);
              ctx.arc(center.x, center.y, radius, startAngle, endAngle, !isCCW);
            } else ctx.lineTo(pFirst.x, pFirst.y);
          }
        }
      } else if (entity.type === 'CIRCLE') {
        ctx.arc(entity.center.x, entity.center.y, entity.radius, 0, 2 * Math.PI);
      } else if (entity.type === 'ARC') {
        const startRad = (entity.startAngle * Math.PI) / 180;
        const endRad = (entity.endAngle * Math.PI) / 180;
        // DXF는 항상 반시계 방향. Y축 반전 상태이므로 Canvas에서는 시계방향(false)이 CCW로 보임.
        ctx.arc(entity.center.x, entity.center.y, entity.radius, startRad, endRad, false);
      } else if (entity.type === 'ELLIPSE') {
        const majorX = entity.majorAxisEndPoint.x;
        const majorY = entity.majorAxisEndPoint.y;
        const radiusX = Math.sqrt(majorX**2 + majorY**2);
        const radiusY = radiusX * entity.ratio;
        const rotation = Math.atan2(majorY, majorX);
        const startRad = entity.startAngle; // Ellipse startAngle은 보통 Radian
        const endRad = entity.endAngle;
        ctx.ellipse(entity.center.x, entity.center.y, radiusX, radiusY, rotation, startRad, endRad, false);
      }
      ctx.stroke();
    });

    ctx.restore();
  }, [entities, selectedEntityIds]);

  useEffect(() => { draw(); }, [draw]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && !e.ctrlKey && !e.shiftKey)) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }

    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { x, y, scale } = transformRef.current;
    const worldX = (mx - x) / scale;
    const worldY = (my - y) / -scale;

    let closest = null;
    let minDist = 12 / scale;

    entities.forEach((entity: any) => {
      let d = Infinity;
      if (entity.type === 'LINE') {
        d = distToSegment(worldX, worldY, entity.vertices[0], entity.vertices[1]);
      } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        const pts = entity.vertices || [];
        for(let i=0; i<pts.length-1; i++) d = Math.min(d, distToSegment(worldX, worldY, pts[i], pts[i+1]));
        if (entity.shape) d = Math.min(d, distToSegment(worldX, worldY, pts[pts.length-1], pts[0]));
      } else if (entity.type === 'CIRCLE' || entity.type === 'ARC' || entity.type === 'ELLIPSE') {
        const dx = worldX - entity.center.x;
        const dy = worldY - entity.center.y;
        const distToCenter = Math.sqrt(dx**2 + dy**2);
        
        if (entity.type === 'CIRCLE') {
          d = Math.abs(distToCenter - entity.radius);
        } else if (entity.type === 'ARC') {
          const angle = Math.atan2(dy, dx);
          const startRad = (entity.startAngle * Math.PI) / 180;
          const endRad = (entity.endAngle * Math.PI) / 180;
          if (isAngleBetween(angle, startRad, endRad)) d = Math.abs(distToCenter - entity.radius);
        } else if (entity.type === 'ELLIPSE') {
          const majorX = entity.majorAxisEndPoint.x;
          const majorY = entity.majorAxisEndPoint.y;
          const radiusX = Math.sqrt(majorX**2 + majorY**2);
          const radiusY = radiusX * entity.ratio;
          const rotation = Math.atan2(majorY, majorX);
          // 타원 내부 각도는 극좌표 변환이 복잡하므로 단순화된 체크
          d = Math.abs(distToCenter - radiusX); 
        }
      }

      if (d < minDist) { minDist = d; closest = entity; }
    });

    if (closest !== null && e.button === 0) {
      const newSelection = new Set(selectedEntityIds);
      if (e.ctrlKey || e.shiftKey) {
        if (newSelection.has(closest.__id)) newSelection.delete(closest.__id);
        else newSelection.add(closest.__id);
      } else {
        newSelection.clear();
        newSelection.add(closest.__id);
      }
      onSelectionChange(newSelection);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      transformRef.current.x += dx;
      transformRef.current.y += dy;
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      draw();
    }
  };

  const distToSegment = (px: number, py: number, v: any, w: any) => {
    const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
    if (l2 === 0) return Math.sqrt((px - v.x)**2 + (py - v.y)**2);
    let t = ((px - v.x) * (w.x - v.x) + (py - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.sqrt((px - (v.x + t * (w.x - v.x)))**2 + (py - (v.y + t * (w.y - v.y)))**2);
  };

  return (
    <div ref={containerRef} className="w-full h-full relative bg-[#0b0f19] overflow-hidden group">
      <canvas 
        ref={canvasRef} 
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={() => setIsPanning(false)}
        onMouseLeave={() => setIsPanning(false)}
        onWheel={(e) => {
          e.preventDefault();
          const factor = Math.pow(1.1, -e.deltaY / 100);
          const rect = canvasRef.current?.getBoundingClientRect();
          if (!rect) return;
          const mx = e.clientX - rect.left;
          const my = e.clientY - rect.top;
          const { x, y, scale } = transformRef.current;
          const newScale = Math.max(0.01, Math.min(100, scale * factor));
          const dx = (mx - x) / scale;
          const dy = (my - y) / scale;
          transformRef.current = { scale: newScale, x: mx - dx * newScale, y: my - dy * newScale };
          draw();
        }}
        className="cursor-crosshair"
      />
      
      <div className="absolute top-6 left-6 flex gap-2">
        <div className="bg-black/60 backdrop-blur-xl border border-white/10 p-1.5 rounded-2xl flex gap-1 shadow-2xl">
          <ToolbarBtn icon={<BoxSelect size={16}/>} label="전체 선택" onClick={() => onSelectionChange(new Set(entities.map(e => e.__id)))} />
          <ToolbarBtn icon={<Eraser size={16}/>} label="선택 해제" onClick={() => onSelectionChange(new Set())} />
          <div className="w-[1px] h-4 bg-white/10 self-center mx-1" />
          <ToolbarBtn icon={<ZoomIn size={16}/>} label="확대" onClick={() => { transformRef.current.scale *= 1.2; draw(); }} />
          <ToolbarBtn icon={<ZoomOut size={16}/>} label="축소" onClick={() => { transformRef.current.scale /= 1.2; draw(); }} />
        </div>
      </div>

      <div className="absolute bottom-6 left-6 pointer-events-none">
        <div className="bg-blue-500/10 border border-blue-500/20 px-4 py-2 rounded-xl backdrop-blur-md">
          <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest flex items-center gap-2">
            <MousePointer2 size={12} /> {selectedEntityIds.size} Entities Selected
          </p>
        </div>
      </div>
    </div>
  );
};

function ToolbarBtn({ icon, label, onClick }: any) {
  return (
    <button 
      onClick={onClick}
      className="p-2 hover:bg-white/10 rounded-xl text-slate-400 hover:text-blue-400 transition-all flex items-center gap-2 group/btn relative"
    >
      {icon}
      <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-slate-800 text-white text-[9px] font-bold rounded opacity-0 group-hover/btn:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-white/5">
        {label}
      </span>
    </button>
  );
}

export default DxfViewer;
