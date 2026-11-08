export const QUALITY_LEVELS = [
  { name: 'High', particleScale: 1, connectionStride: 5, connectionLimit: 12000, resolutionScale: 1 },
  { name: 'Balanced', particleScale: 0.75, connectionStride: 6, connectionLimit: 8000, resolutionScale: 1 },
  { name: 'Performance', particleScale: 0.55, connectionStride: 8, connectionLimit: 5000, resolutionScale: 0.85 },
  { name: 'Low', particleScale: 0.4, connectionStride: 10, connectionLimit: 3000, resolutionScale: 0.7 },
];

export const getInitialQualityIndex = ({ isMobile, hardwareConcurrency, deviceMemory }) => {
  if (isMobile) return 2;
  if ((hardwareConcurrency > 0 && hardwareConcurrency <= 4) || (deviceMemory > 0 && deviceMemory <= 4)) return 1;
  return 0;
};

export const createAdaptiveQualityController = (initialIndex = 0) => {
  let index = Math.max(0, Math.min(QUALITY_LEVELS.length - 1, initialIndex));
  let slowReports = 0;
  let smoothReports = 0;

  return {
    get index() { return index; },
    get level() { return QUALITY_LEVELS[index]; },
    observe(p95FrameMs) {
      if (p95FrameMs > 22) {
        slowReports++;
        smoothReports = 0;
        if (slowReports >= 3 && index < QUALITY_LEVELS.length - 1) {
          index++;
          slowReports = 0;
          return true;
        }
      } else if (p95FrameMs > 0 && p95FrameMs < 18) {
        smoothReports++;
        slowReports = 0;
        if (smoothReports >= 12 && index > 0) {
          index--;
          smoothReports = 0;
          return true;
        }
      } else {
        slowReports = 0;
        smoothReports = 0;
      }
      return false;
    },
  };
};
