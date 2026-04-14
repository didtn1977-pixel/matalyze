import { MATERIALS, PROCESS_COSTS } from '../constants/materials';

export interface CostResult {
  totalCost: number;
  materialCost: number;
  laborCost: number;
  setupCost: number;
}

export interface BoundingBox {
  min: { x: number; y: number; z: number };
  max: { x: number; y: number; z: number };
  width: number;
  height: number;
}

/**
 * 기본 가공 엔진 클래스 (Base Processing Engine)
 */
export abstract class BaseEngine {
  protected materialKey: string;
  protected thickness: number;

  constructor(materialKey: string, thickness: number = 0) {
    this.materialKey = materialKey;
    this.thickness = thickness;
  }

  protected getMaterial() {
    return MATERIALS[this.materialKey] || MATERIALS.STEEL;
  }

  abstract calculateCost(
    totalLength: number,
    boundingBox: BoundingBox,
    options: any
  ): CostResult;
}

/**
 * 레이저 커팅 엔진 (Laser Cutting Engine)
 */
export class LaserEngine extends BaseEngine {
  calculateCost(totalLength: number, boundingBox: BoundingBox, options: { 
    gas: string; 
    piercingCount?: number;
    customSetupCost?: number;
    customMaterialPrice?: number;
    customProcessPrice?: number;
  }): CostResult {
    const material = this.getMaterial();
    
    // 사용자 정의 단가 적용 (없을 경우 기본값 사용)
    const setupCost = options.customSetupCost ?? PROCESS_COSTS.SETUP;
    const materialPrice = options.customMaterialPrice ?? material.pricePerKg;
    const laserPerMm = options.customProcessPrice ?? PROCESS_COSTS.LASER_PER_MM;
    
    // 재료비 계산: (가로 * 세로 * 두께 * 밀도) / 1000 (mm^3 -> cm^3 변환) * 단가
    const volumeCm3 = (boundingBox.width * boundingBox.height * this.thickness) / 1000;
    const materialWeightKg = (volumeCm3 * material.density) / 1000;
    const materialCost = Math.round(materialWeightKg * materialPrice);

    // 가공비 계산: (절단 길이 * 단가) + (피어싱 수 * 점당 단가)
    const piercingSubtotal = (options.piercingCount || 1) * PROCESS_COSTS.PIERCING;
    const gasMultiplier = options.gas === 'N2' ? 1.5 : 1.0; // 질소 가공 시 비용 가중치
    const laborCost = Math.round((totalLength * laserPerMm * gasMultiplier) + piercingSubtotal);

    return {
      totalCost: setupCost + materialCost + laborCost,
      materialCost,
      laborCost,
      setupCost,
    };
  }
}

/**
 * 판금(절곡) 엔진 (Sheet Metal Engine)
 */
export class SheetMetalEngine extends LaserEngine {
  calculateCost(totalLength: number, boundingBox: BoundingBox, options: any): CostResult {
    const laserResult = super.calculateCost(totalLength, boundingBox, options);
    
    // 절곡 비용 계산
    let bendingCost = options.bendingCount * PROCESS_COSTS.BENDING;
    
    // 절곡 5회 이상 시 공임 가중치 20% 적용
    if (options.bendingCount >= 5) {
      bendingCost *= 1.2;
    }

    const additionalLabor = Math.round(bendingCost);
    
    return {
      ...laserResult,
      laborCost: laserResult.laborCost + additionalLabor,
      totalCost: laserResult.totalCost + additionalLabor,
    };
  }
}

/**
 * MCT(밀링) 엔진 (MCT Milling Engine)
 */
export class MCTEngine extends BaseEngine {
  calculateCost(totalLength: number, boundingBox: BoundingBox, options: { 
    holeCount: number; 
    stage: 'rough' | 'finish';
    customSetupCost?: number;
    customMaterialPrice?: number;
    customProcessPrice?: number; // 시간당 임률로 사용
  }): CostResult {
    const material = this.getMaterial();
    
    const setupCost = options.customSetupCost ?? PROCESS_COSTS.SETUP;
    const materialPrice = options.customMaterialPrice ?? material.pricePerKg;
    const hourlyRate = options.customProcessPrice ?? PROCESS_COSTS.MCT_HOURLY_RATE;

    // 원소재비: Bounding Box 부피 기준
    const volumeCm3 = (boundingBox.width * boundingBox.height * this.thickness) / 1000;
    const materialWeightKg = (volumeCm3 * material.density) / 1000;
    const materialCost = Math.round(materialWeightKg * materialPrice);

    // 가공비: 가공 면적 비율 및 복잡도 반영
    // (여기서는 단순화를 위해 도면 길이와 홀 개수를 난이도 계수로 활용)
    const complexityFactor = (totalLength / 1000) * (options.holeCount || 1) * 0.1;
    const stageMultiplier = options.stage === 'finish' ? 1.5 : 1.0;
    const laborCost = Math.round(hourlyRate * complexityFactor * stageMultiplier);

    return {
      totalCost: setupCost + materialCost + laborCost,
      materialCost,
      laborCost,
      setupCost,
    };
  }
}

/**
 * CNC 선반 엔진 (CNC Lathe Engine)
 */
export class CNCLatheEngine extends BaseEngine {
  calculateCost(totalLength: number, boundingBox: BoundingBox, options: { 
    isIDMachining: boolean;
    customSetupCost?: number;
    customMaterialPrice?: number;
    customProcessPrice?: number; // 시간당 임률로 사용
  }): CostResult {
    const material = this.getMaterial();
    
    const setupCost = options.customSetupCost ?? PROCESS_COSTS.SETUP;
    const materialPrice = options.customMaterialPrice ?? material.pricePerKg;
    const hourlyRate = options.customProcessPrice ?? PROCESS_COSTS.CNC_LATHE_HOURLY_RATE;

    // 회전체 부피 계산: Max Y를 반지름으로 보고 계산 (PI * R^2 * L)
    const r = Math.max(Math.abs(boundingBox.max.y), Math.abs(boundingBox.min.y));
    const length = boundingBox.width;
    const volumeCm3 = (Math.PI * Math.pow(r, 2) * length) / 1000;
    const materialWeightKg = (volumeCm3 * material.density) / 1000;
    const materialCost = Math.round(materialWeightKg * materialPrice);

    // 가공비: 내경 가공 여부에 따른 가중치
    const idMultiplier = options.isIDMachining ? 1.3 : 1.0;
    return {
      totalCost: setupCost + materialCost + laborCost,
      materialCost,
      laborCost,
      setupCost,
    };
  }
}
