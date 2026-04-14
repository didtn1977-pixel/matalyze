import DxfParser from 'dxf-parser';

export interface DxfAnalysis {
  totalLength: number;
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
    width: number;
    height: number;
  };
  entityCounts: {
    line: number;
    arc: number;
    circle: number;
    other: number;
  };
  recommendedProcess: string;
}

/**
 * DXF 파일 분석 및 공정 추천 클래스 (DXF Processor & AI Recommender)
 */
export class DxfProcessor {
  private parser: DxfParser;

  constructor() {
    this.parser = new DxfParser();
  }

  public analyze(dxfContent: string): DxfAnalysis {
    const dxf = this.parser.parseSync(dxfContent);
    
    if (!dxf || !dxf.entities) {
      throw new Error('DXF 파일을 파싱할 수 없습니다.');
    }

    const entities = dxf.entities;
    if (entities.length === 0) return this.emptyResult();

    // 1. 모든 엔티티의 개별 정보 추출
    const entityInfos = entities.map(entity => {
      let min = { x: Infinity, y: Infinity, z: Infinity };
      let max = { x: -Infinity, y: -Infinity, z: -Infinity };
      let length = 0;

      if (entity.type === 'LINE') {
        const pts = entity.vertices || [];
        if (pts.length >= 2) {
          pts.forEach((v: any) => this.updateBounds(v, min, max));
          length = Math.sqrt(Math.pow(pts[1].x-pts[0].x, 2) + Math.pow(pts[1].y-pts[0].y, 2));
        }
      } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        const pts = entity.vertices || [];
        if (pts.length > 0) {
          for (let i = 0; i < pts.length; i++) {
            const p1 = pts[i];
            this.updateBounds(p1, min, max);
            
            if (i < pts.length - 1) {
              const p2 = pts[i + 1];
              const bulge = p1.bulge || 0;
              
              if (bulge === 0) {
                // 직선 구간
                length += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
              } else {
                // 벌지가 있는 호 구간 (Bulge Arc Segment)
                const arcData = this.calculateBulgeArc(p1, p2, bulge);
                length += arcData.length;
                this.updateArcBounds(arcData, min, max);
              }
            } else if (entity.shape && pts.length > 2) {
              // 닫힌 폴리라인의 마지막 연결
              const p2 = pts[0];
              const bulge = p1.bulge || 0;
              if (bulge === 0) {
                length += Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
              } else {
                const arcData = this.calculateBulgeArc(p1, p2, bulge);
                length += arcData.length;
                this.updateArcBounds(arcData, min, max);
              }
            }
          }
        }
      } else if (entity.type === 'ARC' || entity.type === 'CIRCLE') {
        if (entity.type === 'CIRCLE') {
          length = 2 * Math.PI * entity.radius;
          this.updateBounds(entity.center, min, max, entity.radius);
        } else {
          const startAngle = entity.startAngle;
          const endAngle = entity.endAngle;
          const angleDiff = endAngle > startAngle ? endAngle - startAngle : (360 - startAngle) + endAngle;
          length = (2 * Math.PI * entity.radius * (angleDiff / 360));
          this.updateArcBounds({
            center: entity.center,
            radius: entity.radius,
            startAngle: startAngle * Math.PI / 180,
            endAngle: endAngle * Math.PI / 180
          }, min, max);
        }
      }

      // 안전 장치: 모든 계산 실패 시 0mm로 처리
      if (length === Infinity || isNaN(length)) length = 0;
      if (min.x === Infinity) { min = {x:0, y:0, z:0}; max = {x:0, y:0, z:0}; }

      return {
        entity,
        bounds: { min, max },
        length,
        center: entity.center || (entity.vertices ? entity.vertices[0] : {x:0, y:0})
      };
    });

    // 2. 가벼운 거리 기반 그룹화 (복잡한 클러스터링 대신 단순화)
    // 정면도와 측면도를 분리하기 위한 X축 클러스터링
    const validInfos = entityInfos.filter(info => info.length > 0);
    if (validInfos.length === 0) return this.emptyResult();

    const sortedInfos = [...validInfos].sort((a, b) => (a.bounds.min.x) - (b.bounds.min.x));
    const groups: any[][] = [];
    let currentGroup = [sortedInfos[0]];
    
    for (let i = 1; i < sortedInfos.length; i++) {
        const lastMaxX = currentGroup.reduce((max, info) => Math.max(max, info.bounds.max.x), -Infinity);
        // 그룹 간 거리가 80mm 이상이거나, 현재 도면 전체 폭의 20% 이상이면 분리
        const gap = sortedInfos[i].bounds.min.x - lastMaxX;
        if (gap > 80) {
          groups.push(currentGroup);
          currentGroup = [sortedInfos[i]];
        } else {
          currentGroup.push(sortedInfos[i]);
        }
    }
    groups.push(currentGroup);

    // 3. 가장 '적절한' 정면도(Main View) 찾기
    // 단순히 면적이 큰 그룹만 찾기보다, 엔티티 개수와 밀도가 높은 곳을 우선함
    let mainGroup: any[] = [];
    let maxScore = -1;
    let finalBounds = { min: {x:0,y:0,z:0}, max: {x:0,y:0,z:0} };

    groups.forEach(group => {
      const min = { x: Infinity, y: Infinity, z: Infinity };
      const max = { x: -Infinity, y: -Infinity, z: -Infinity };
      let groupLen = 0;
      
      group.forEach(info => {
        min.x = Math.min(min.x, info.bounds.min.x);
        min.y = Math.min(min.y, info.bounds.min.y);
        max.x = Math.max(max.x, info.bounds.max.x);
        max.y = Math.max(max.y, info.bounds.max.y);
        groupLen += info.length;
      });

      const width = max.x - min.x;
      const height = max.y - min.y;
      const area = (width || 1) * (height || 1);
      
      // 스코어링: 길이 * (장단비 페널티). 측면도는 보통 한쪽으로 매우 긺.
      const aspectRatio = width > height ? width / height : height / width;
      const score = groupLen * (area > 100 ? 1 : 0.1) / (aspectRatio > 10 ? 5 : 1);
      
      if (score > maxScore) {
        maxScore = score;
        mainGroup = group;
        finalBounds = { min, max };
      }
    });

    // 4. 최종 결과 집계
    let totalLength = 0;
    let lineCount = 0;
    let arcCount = 0;
    let circleCount = 0;

    mainGroup.forEach(info => {
      totalLength += info.length;
      if (info.entity.type === 'LINE' || info.entity.type === 'LWPOLYLINE' || info.entity.type === 'POLYLINE') lineCount++;
      else if (info.entity.type === 'ARC') arcCount++;
      else if (info.entity.type === 'CIRCLE') circleCount++;
    });

    const width = finalBounds.max.x - finalBounds.min.x;
    const height = finalBounds.max.y - finalBounds.min.y;

    return {
      totalLength,
      boundingBox: { min: finalBounds.min, max: finalBounds.max, width, height },
      entityCounts: {
        line: lineCount,
        arc: arcCount,
        circle: circleCount,
        other: 0,
      },
      recommendedProcess: circleCount > 10 ? 'MCT' : 'LASER',
    };
  }

  private emptyResult(): DxfAnalysis {
    return {
      totalLength: 0,
      boundingBox: { min: {x:0,y:0,z:0}, max: {x:0,y:0,z:0}, width: 0, height: 0 },
      entityCounts: { line: 0, arc: 0, circle: 0, other: 0 },
      recommendedProcess: 'LASER'
    };
  }

  private updateBounds(v: any, min: any, max: any, radius: number = 0) {
    if (!v || isNaN(v.x) || isNaN(v.y)) return;
    min.x = Math.min(min.x, v.x - radius);
    min.y = Math.min(min.y, v.y - radius);
    max.x = Math.max(max.x, v.x + radius);
    max.y = Math.max(max.y, v.y + radius);
  }

  /**
   * 벌지(Bulge) 데이터를 기반으로 호의 기하학적 정보 계산
   */
  private calculateBulgeArc(p1: any, p2: any, bulge: number) {
    const L = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    const theta = 4 * Math.atan(Math.abs(bulge));
    const radius = (L / 2) * (1 + Math.pow(bulge, 2)) / (2 * Math.abs(bulge));
    const arcLength = radius * theta;

    // 중심점 계산
    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;
    const d = (L / 2) * (1 - Math.pow(bulge, 2)) / (2 * bulge);
    
    // 수직 벡터 활용
    const vx = p2.x - p1.x;
    const vy = p2.y - p1.y;
    const ux = -vy / L;
    const uy = vx / L;

    const center = {
      x: mx + ux * d,
      y: my + uy * d
    };

    const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x);
    const endAngle = Math.atan2(p2.y - center.y, p2.x - center.x);

    return { center, radius, startAngle, endAngle, length: arcLength, bulge };
  }

  /**
   * 호의 모든 돌출부를 포함하도록 바운딩 박스 업데이트
   */
  private updateArcBounds(arc: any, min: any, max: any) {
    const { center, radius, startAngle, endAngle, bulge } = arc;
    
    // 시작점과 끝점은 기본 포함
    this.updateBounds({ x: center.x + radius * Math.cos(startAngle), y: center.y + radius * Math.sin(startAngle) }, min, max);
    this.updateBounds({ x: center.x + radius * Math.cos(endAngle), y: center.y + radius * Math.sin(endAngle) }, min, max);

    // 0, 90, 180, 270도 방항의 극점Check
    const angles = [0, Math.PI/2, Math.PI, 3*Math.PI/2];
    angles.forEach(a => {
      if (this.isAngleBetween(a, startAngle, endAngle, bulge > 0)) {
        this.updateBounds({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) }, min, max);
      }
    });
  }

  private isAngleBetween(angle: number, start: number, end: number, isCCW: boolean): boolean {
    let s = start, e = end, a = angle;
    // Normalize to [0, 2PI]
    const normalize = (val: number) => {
      while (val < 0) val += Math.PI * 2;
      while (val >= Math.PI * 2) val -= Math.PI * 2;
      return val;
    };
    s = normalize(s); e = normalize(e); a = normalize(a);

    if (isCCW) {
      return s < e ? (a >= s && a <= e) : (a >= s || a <= e);
    } else {
      return s > e ? (a <= s && a >= e) : (a <= s || a >= e);
    }
  }
}
