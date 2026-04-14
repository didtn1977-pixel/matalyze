/**
 * 재질별 물리적 특성 및 가격 정보 (Material Properties and Pricing)
 */
export interface MaterialInfo {
  name: string;
  density: number; // g/cm^3
  pricePerKg: number; // KRW/kg
}

export const MATERIALS: Record<string, MaterialInfo> = {
  STEEL: {
    name: '탄소강 (STEEL)',
    density: 7.85,
    pricePerKg: 1200,
  },
  STAINLESS: {
    name: '스테인리스 (SUS304)',
    density: 7.93,
    pricePerKg: 4500,
  },
  ALUMINUM: {
    name: '알루미늄 (AL6061)',
    density: 2.7,
    pricePerKg: 5500,
  },
};

/**
 * 공정별 단위 비용 상무 (Process Unit Costs)
 */
export const PROCESS_COSTS = {
  SETUP: 50000, // 기본 가공 준비비 (KRW)
  LASER_PER_MM: 5, // mm당 커팅 비용 (KRW)
  PIERCING: 500, // 점당 피어싱 비용 (KRW)
  BENDING: 2000, // 회당 절곡 비용 (KRW)
  MCT_HOURLY_RATE: 80000, // MCT 시간당 임률 (KRW)
  MCT_COMPLEXITY_FACTOR: 100, // 복잡도 가중치
  CNC_LATHE_HOURLY_RATE: 60000, // 선반 시간당 임률 (KRW)
};
