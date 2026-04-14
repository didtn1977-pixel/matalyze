'use client';

import { useState, useMemo, useCallback } from 'react';
import { DxfAnalyzer, PrecisionEntity } from '@/lib/dxfAnalyzer';
import { 
  LaserEngine, SheetMetalEngine, MCTEngine, CNCLatheEngine, CostResult 
} from '@/lib/engines';
import { MATERIALS } from '@/lib/constants/materials';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export type ProcessType = 'LASER' | 'SHEET_METAL' | 'MCT' | 'CNC_LATHE';

export const useDxfEstimator = () => {
  const [selectedProcess, setSelectedProcess] = useState<ProcessType>('LASER');
  const [entities, setEntities] = useState<PrecisionEntity[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [options, setOptions] = useState({
    material: 'STEEL', 
    thickness: 2.0, 
    customSetupCost: 50000,
    customMaterialPrice: 2500,
    customProcessPrice: 15,
  });

  // 파일 업로드 처리
  const handleFileUpload = useCallback((content: string) => {
    const analyzer = new DxfAnalyzer();
    const results = analyzer.parse(content);
    setEntities(results);
    setSelectedIds(new Set(results.map(r => r.id)));
  }, []);

  // 통계 계산 (선택된 엔티티 기준)
  const currentStats = useMemo(() => {
    let len = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    entities.forEach(e => {
      if (selectedIds.has(e.id)) {
        len += e.length;
        minX = Math.min(minX, e.bounds.minX); minY = Math.min(minY, e.bounds.minY);
        maxX = Math.max(maxX, e.bounds.maxX); maxY = Math.max(maxY, e.bounds.maxY);
      }
    });
    return {
      totalLength: len,
      width: minX === Infinity ? 0 : maxX - minX,
      height: minY === Infinity ? 0 : maxY - minY
    };
  }, [entities, selectedIds]);

  // 원가 엔진 연동
  const costResult = useMemo(() => {
    let engine;
    switch (selectedProcess) {
      case 'LASER': engine = new LaserEngine(options.material, options.thickness); break;
      case 'SHEET_METAL': engine = new SheetMetalEngine(options.material, options.thickness); break;
      case 'MCT': engine = new MCTEngine(options.material, options.thickness); break;
      case 'CNC_LATHE': engine = new CNCLatheEngine(options.material, options.thickness); break;
      default: engine = new LaserEngine(options.material, options.thickness);
    }
    
    return engine.calculateCost(currentStats.totalLength, { width: currentStats.width, height: currentStats.height }, {
      ...options,
      customSetupCost: options.customSetupCost,
      customMaterialPrice: options.customMaterialPrice,
      customProcessPrice: options.customProcessPrice
    });
  }, [selectedProcess, options, currentStats]);

  // PDF 내보내기
  const exportPDF = async (ref: React.RefObject<HTMLDivElement>) => {
    if (!ref.current) return;
    const canvas = await html2canvas(ref.current, { backgroundColor: '#0b1120', scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    const pdf = new jsPDF('p', 'mm', 'a4');
    pdf.addImage(imgData, 'PNG', 0, 0, 210, (canvas.height * 210) / canvas.width);
    pdf.save(`Metalyze_Quote.pdf`);
  };

  return {
    selectedProcess, setSelectedProcess,
    entities, setEntities,
    selectedIds, setSelectedIds,
    options, setOptions,
    currentStats,
    costResult,
    handleFileUpload,
    exportPDF,
    materials: MATERIALS
  };
};
