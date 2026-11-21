export function normalizationPlan({ codec, width, height, fps, constant }) {
  const reasons = [];
  if (codec !== 'avc') reasons.push('非 H.264 編碼');
  if (!constant) reasons.push('可變幀率或缺幀');
  if (fps > 30.5) reasons.push('高幀率');
  if (Math.max(width, height) > 1280) reasons.push('高解析度');
  const scale = Math.min(1, 1280 / Math.max(width, height));
  return {
    reasons,
    width: Math.max(2, Math.floor((width * scale) / 2) * 2),
    height: Math.max(2, Math.floor((height * scale) / 2) * 2),
  };
}
