import DxfParser from 'dxf-parser';

/**
 * 정밀 DXF 엔티티 명세
 */
export interface PrecisionEntity {
  id: number;
  type: string;
  length: number;
  bounds: {
    minX: number; minY: number;
    maxX: number; maxY: number;
  };
  raw: any; // DXF-Parser 원본 데이터
}

/**
 * Metalyze 정밀 DXF 분석 엔진
 * 수학적 명세 100% 준수 (ARC 보정, Ramanujan 타원 공식 등)
 */
export class DxfAnalyzer {
  private parser: DxfParser;

  constructor() {
    this.parser = new DxfParser();
  }

  public parse(dxfContent: string): PrecisionEntity[] {
    const dxf = this.parser.parseSync(dxfContent);
    if (!dxf || !dxf.entities) return [];

    return dxf.entities.map((entity: any, index: number) => {
      return {
        id: index,
        type: entity.type,
        length: this.calculateLength(entity),
        bounds: this.calculateBounds(entity),
        raw: entity
      };
    });
  }

  /**
   * 수학적 명세를 반영한 정밀 길이 계산
   */
  private calculateLength(e: any): number {
    try {
      if (e.type === 'LINE') {
        return Math.sqrt(Math.pow(e.vertices[1].x - e.vertices[0].x, 2) + Math.pow(e.vertices[1].y - e.vertices[0].y, 2));
      }
      
      if (e.type === 'ARC') {
        const r = e.radius;
        const start = e.startAngle;
        const end = e.endAngle;
        
        // [절대 공식]: endAngle < startAngle 인 경우 360도 보정
        const delta = end < start ? (end + 360 - start) : (end - start);
        return r * delta * (Math.PI / 180);
      }

      if (e.type === 'CIRCLE') {
        return 2 * Math.PI * e.radius;
      }

      if (e.type === 'ELLIPSE') {
        const majorX = e.majorAxisEndPoint.x;
        const majorY = e.majorAxisEndPoint.y;
        const A = Math.sqrt(majorX**2 + majorY**2);
        const B = A * e.ratio;
        
        // Ramanujan Approximation for Ellipse Perimeter (고정밀도)
        const h = Math.pow(A - B, 2) / Math.pow(A + B, 2);
        const perimeter = Math.PI * (A + B) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
        
        // 부분 타원(Arc)인 경우 각도 비례 적용 (라디안 기준)
        if (e.startAngle !== undefined && e.endAngle !== undefined) {
          let s = e.startAngle;
          let e_ = e.endAngle;
          if (e_ < s) e_ += Math.PI * 2;
          return perimeter * ((e_ - s) / (Math.PI * 2));
        }
        return perimeter;
      }

      if (e.type === 'LWPOLYLINE' || e.type === 'POLYLINE') {
        let len = 0;
        const v = e.vertices || [];
        for (let i = 0; i < v.length - 1; i++) {
          len += this.getSegmentLength(v[i], v[i+1], v[i].bulge || 0);
        }
        if (e.shape) {
          len += this.getSegmentLength(v[v.length-1], v[0], v[v.length-1].bulge || 0);
        }
        return len;
      }
    } catch (err) {
      console.error('Length Calc Error:', err);
    }
    return 0;
  }

  private getSegmentLength(p1: any, p2: any, bulge: number): number {
    if (bulge === 0) {
      return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    }
    const L = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    const theta = 4 * Math.atan(Math.abs(bulge));
    const radius = (L / 2) * (1 + bulge**2) / (2 * Math.abs(bulge));
    return radius * theta;
  }

  private calculateBounds(e: any) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const update = (x: number, y: number) => {
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    };

    if (e.vertices) {
      const v = e.vertices || [];
      v.forEach((vert: any) => update(vert.x, vert.y));
      // Bulge가 있는 세그먼트의 곡선 극점 계산
      for (let i = 0; i < v.length - 1; i++) {
        if (v[i].bulge) this.addBulgeExtremes(v[i], v[i+1], v[i].bulge, update);
      }
      if (e.shape && v.length > 0 && v[v.length-1].bulge) {
        this.addBulgeExtremes(v[v.length-1], v[0], v[v.length-1].bulge, update);
      }
    } else if (e.type === 'ARC') {
      const { center, radius, startAngle, endAngle } = e;
      this.addArcExtremes(center, radius, startAngle, endAngle, update);
    } else if (e.center) {
      const r = e.radius || Math.sqrt(e.majorAxisEndPoint?.x**2 + e.majorAxisEndPoint?.y**2 || 0);
      update(e.center.x - r, e.center.y - r);
      update(e.center.x + r, e.center.y + r);
    }
    
    return { 
      minX: minX === Infinity ? 0 : minX, minY: minY === Infinity ? 0 : minY, 
      maxX: maxX === -Infinity ? 0 : maxX, maxY: maxY === -Infinity ? 0 : maxY 
    };
  }

  private addArcExtremes(center: any, radius: number, s: number, en: number, update: (x: number, y: number) => void) {
    const isAngleBetween = (a: number, start: number, end: number) => {
      a = (a % 360 + 360) % 360; start = (start % 360 + 360) % 360; end = (end % 360 + 360) % 360;
      return start <= end ? (a >= start && a <= end) : (a >= start || a <= end);
    };
    // 사방 극점
    if (isAngleBetween(0, s, en)) update(center.x + radius, center.y);
    if (isAngleBetween(90, s, en)) update(center.x, center.y + radius);
    if (isAngleBetween(180, s, en)) update(center.x - radius, center.y);
    if (isAngleBetween(270, s, en)) update(center.x, center.y - radius);
  }

  private addBulgeExtremes(p1: any, p2: any, bulge: number, update: (x: number, y: number) => void) {
    const L = Math.sqrt((p2.x-p1.x)**2 + (p2.y-p1.y)**2);
    if (L === 0) return;
    const r = (L/2) * (1+bulge**2) / (2*Math.abs(bulge));
    const d = (L/2) * (1-bulge**2) / (2*bulge);
    const mx = (p1.x+p2.x)/2, my = (p1.y+p2.y)/2;
    const vx = p2.x-p1.x, vy = p2.y-p1.y;
    const cx = mx - (vy/L)*d, cy = my + (vx/L)*d;
    const sA = Math.atan2(p1.y - cy, p1.x - cx) * 180 / Math.PI;
    const eA = Math.atan2(p2.y - cy, p2.x - cx) * 180 / Math.PI;
    // Bulge < 0 인 경우 방향이 반대(CW)이므로 start/end 교체하여 로직 재사용
    this.addArcExtremes({ x: cx, y: cy }, r, bulge > 0 ? sA : eA, bulge > 0 ? eA : sA, update);
  }
}
