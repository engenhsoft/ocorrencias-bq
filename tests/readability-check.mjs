import assert from 'node:assert/strict';

// Check rendered text against its composited background, including status chips.
export async function assertReadable(page) {
  const result = await page.evaluate(() => {
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    const blend = (front, back) => front.slice(0, 3).map((v, i) => v * (front[3] ?? 1) + back[i] * (1 - (front[3] ?? 1)));
    const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const failures = []; let checked = 0;
    for (const el of document.querySelectorAll('.record-meta span, .record-meta strong, .record-card__header small, .insight-note, .bar-chart__label, .comparison-key, .status-chip, .field > span, .form-message, .review-data dt, .review-data dd')) {
      if (!el.getClientRects().length || !el.textContent.trim()) continue;
      const layers = []; let parent = el;
      while (parent) { layers.unshift(rgb(getComputedStyle(parent).backgroundColor)); parent = parent.parentElement; }
      const background = layers.reduce((back, front) => blend(front, back), [255, 255, 255]);
      const style = getComputedStyle(el), foreground = blend(rgb(style.color), background);
      const a = luminance(foreground), b = luminance(background), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      checked++;
      if (ratio < (large ? 3 : 4.5)) failures.push({ text: el.textContent.slice(0, 70), ratio: Number(ratio.toFixed(2)) });
    }
    return { checked, failures };
  });
  assert.ok(result.checked > 0, 'rendered operational text checked');
  assert.deepEqual(result.failures, [], 'WCAG AA for rendered operational text');
  return result.checked;
}
