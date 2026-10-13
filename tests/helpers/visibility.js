const { expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

function parseRgb(value) {
  const m = String(value).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] === undefined ? 1 : parts[3] };
}

function relativeLuminance(c) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

function contrastRatio(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

async function measure(page, selector) {
  return page.locator(selector).evaluate((el) => {
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    const hit = document.elementFromPoint(cx, cy);

    let background = cs.backgroundColor;
    let node = el;
    while (node) {
      const bg = getComputedStyle(node).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(',').map(parseFloat);
        const a = parts[3] === undefined ? 1 : parts[3];
        if (a >= 0.5) {
          background = bg;
          break;
        }
      }
      node = node.parentElement;
    }

    return {
      text: (el.textContent || '').trim(),
      offsetWidth: el.offsetWidth,
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      offsetHeight: el.offsetHeight,
      color: cs.color,
      background,
      visibility: cs.visibility,
      opacity: cs.opacity,
      display: cs.display,
      inViewport:
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth,
      topElementIsSelf: !!hit && (el === hit || el.contains(hit)),
    };
  });
}

async function assertVisiblyRendered(page, selector, label, options = {}) {
  const minContrast = options.minContrast === undefined ? 3 : options.minContrast;
  const m = await measure(page, selector);

  expect(m.display, `${label} 不应为 display:none`).not.toBe('none');
  expect(m.visibility, `${label} 不应为 visibility:hidden`).not.toBe('hidden');
  expect(Number(m.opacity), `${label} 不应对用户透明`).toBeGreaterThan(0.1);
  expect(m.offsetWidth, `${label} 应有可见宽度`).toBeGreaterThan(0);
  expect(m.offsetHeight, `${label} 应有可见高度`).toBeGreaterThan(0);
  expect(m.scrollWidth, `${label} 文字不应被 CSS 截断`).toBeLessThanOrEqual(m.clientWidth + 1);
  expect(m.inViewport, `${label} 应完整落在视口内`).toBe(true);
  expect(m.topElementIsSelf, `${label} 中心点被其它元素遮挡`).toBe(true);

  const fg = parseRgb(m.color);
  const bg = parseRgb(m.background);
  if (!options.skipContrast && fg && bg) {
    const ratio = contrastRatio(fg, bg);
    expect(
      ratio,
      `${label} 文字/背景对比度应 >= ${minContrast}，实际 ${ratio.toFixed(2)}（${m.color} on ${m.background}）`
    ).toBeGreaterThanOrEqual(minContrast);
  }
  return m;
}

async function captureForReview(page, name) {
  const dir = process.env.E2E_SCREENSHOT_DIR || 'test-results/screenshots';
  fs.mkdirSync(dir, { recursive: true });
  const safe = String(name).replace(/[^\w一-龥]+/g, '_');
  const file = path.join(dir, safe + '.png');
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

module.exports = {
  parseRgb,
  relativeLuminance,
  contrastRatio,
  measure,
  assertVisiblyRendered,
  captureForReview,
};
