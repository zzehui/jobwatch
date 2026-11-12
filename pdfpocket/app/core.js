// PDF 的核心操作。浏览器和 Node 共用：只依赖 pdf-lib，不碰 DOM。
// 所有处理都在本地完成——不上传、不落第三方服务器。
import { PDFDocument, degrees } from "./pdf-lib.esm.min.js";

export const LIMITS = { free: { files: 3, pages: 50, batch: false }, pro: { files: 999, pages: 99999, batch: true } };

export function parseRanges(spec, max) {
  // "1-3,5,8-10" → [0,1,2,4,7,8,9]（返回 0 基下标，去重保序）
  const out = [];
  const seen = new Set();
  for (const part of String(spec || "").split(/[,，\s]+/)) {
    if (!part) continue;
    const m = part.match(/^(\d+)\s*(?:[-–~]\s*(\d+))?$/);
    if (!m) continue;
    const a = Math.max(1, parseInt(m[1], 10));
    const b = m[2] ? Math.max(a, parseInt(m[2], 10)) : a;
    for (let p = a; p <= Math.min(b, max); p++) {
      if (!seen.has(p - 1)) { seen.add(p - 1); out.push(p - 1); }
    }
  }
  return out;
}

export async function merge(buffers) {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  out.setProducer("PDFPocket");
  out.setCreator("PDFPocket");
  return out.save({ useObjectStreams: true });
}

export async function extract(buf, spec) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const idx = parseRanges(spec, src.getPageCount());
  if (!idx.length) throw new Error("empty-range");
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, idx);
  pages.forEach(p => out.addPage(p));
  return out.save({ useObjectStreams: true });
}

export async function splitEvery(buf, n) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const total = src.getPageCount();
  const step = Math.max(1, Math.min(n, total));
  const parts = [];
  for (let start = 0; start < total; start += step) {
    const out = await PDFDocument.create();
    const idx = [];
    for (let i = start; i < Math.min(start + step, total); i++) idx.push(i);
    const pages = await out.copyPages(src, idx);
    pages.forEach(p => out.addPage(p));
    parts.push({ name: `part-${String(parts.length + 1).padStart(2, "0")}.pdf`, bytes: await out.save() });
  }
  return parts;
}

export async function rotate(buf, spec, deg) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const idx = spec ? parseRanges(spec, src.getPageCount()) : src.getPageIndices();
  idx.forEach(i => {
    const page = src.getPage(i);
    page.setRotation(degrees(((page.getRotation().angle || 0) + deg) % 360));
  });
  return src.save({ useObjectStreams: true });
}

export async function info(buf) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  return { pages: doc.getPageCount(), title: doc.getTitle() || "" };
}

/* ---------------- Pro 功能（0.2.0 新增） ---------------- */

// 水印：把文字先在 canvas 里画成倾斜的透明 PNG，再平铺到每页。
// 用图片而不是 PDF 字体，是为了支持中文（Helvetica 不能编码汉字）。
async function watermarkPng(text, size) {
  const FONT = `bold ${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
  const probe = document.createElement("canvas").getContext("2d");
  probe.font = FONT;
  const tw = probe.measureText(text).width;
  const th = size * 1.15;
  const ang = (-30 * Math.PI) / 180;
  // 旋转后的外接矩形，保证字不被画布裁掉
  const w = Math.ceil(Math.abs(tw * Math.cos(ang)) + Math.abs(th * Math.sin(ang))) + size;
  const h = Math.ceil(Math.abs(tw * Math.sin(ang)) + Math.abs(th * Math.cos(ang))) + size;
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const c = cv.getContext("2d");
  c.translate(w / 2, h / 2);
  c.rotate(ang);
  c.font = FONT;
  c.fillStyle = "rgba(90,90,90,0.6)";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(text, 0, 0);
  const b64 = cv.toDataURL("image/png").split(",")[1];
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function watermark(buf, text, opts = {}) {
  const { PDFDocument } = await import("./pdf-lib.esm.min.js");
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const size = opts.size || 34;
  const png = await watermarkPng(text, size * 2);
  const img = await doc.embedPng(png);
  const iw = img.width, ih = img.height;
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const stepX = iw * 0.58, stepY = ih * 0.62;
    for (let y = 0; y + ih <= height; y += stepY) {
      for (let x = 0; x + iw <= width; x += stepX) {
        // 只画完整落在页面内的，避免边缘把字切掉
        page.drawImage(img, { x, y, width: iw, height: ih, opacity: opts.opacity == null ? 0.42 : opts.opacity });
      }
    }
  }
  return doc.save({ useObjectStreams: true });
}

// 发票拼版：多份单页 PDF → A4 每页 2 张，带裁切虚线与序号。
export async function invoiceSheet(buffers, opts = {}) {
  const { PDFDocument, StandardFonts, rgb } = await import("./pdf-lib.esm.min.js");
  const out = await PDFDocument.create();
  const font = await doc0Font(out);
  const A4 = [595.28, 841.89];
  const margin = 22, gap = 14;
  const cellH = (A4[1] - margin * 2 - gap) / 2;
  const cellW = A4[0] - margin * 2;

  const items = [];
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    src.getPages().forEach((_, i) => items.push({ buf, page: i, src }));
  }

  for (let i = 0; i < items.length; i += 2) {
    const page = out.addPage(A4);
    for (let j = 0; j < 2 && i + j < items.length; j++) {
      const it = items[i + j];
      const [embedded] = await out.embedPdf(it.buf, [it.page]);
      const { width, height } = embedded;
      const scale = Math.min(cellW / width, cellH / height);
      const x = margin + (cellW - width * scale) / 2;
      const y = A4[1] - margin - cellH * (j + 1) - gap * j + (cellH - height * scale) / 2;
      page.drawPage(embedded, { x, y, xScale: scale, yScale: scale });
      page.drawText(String(i + j + 1), { x: margin + 2, y: y + cellH * scale + 4, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    }
    // 中间裁切线
    page.drawLine({
      start: { x: margin - 6, y: A4[1] / 2 },
      end: { x: A4[0] - margin + 6, y: A4[1] / 2 },
      thickness: 0.4, dashArray: [3, 3], color: rgb(0.75, 0.75, 0.75),
    });
  }
  out.setProducer("PDFPocket");
  return out.save({ useObjectStreams: true });
}

async function doc0Font(doc) {
  const { StandardFonts } = await import("./pdf-lib.esm.min.js");
  return doc.embedFont(StandardFonts.Helvetica);
}

// 图片 → PDF：每张图一页 A4，等比缩放居中，留 24pt 边距。支持 JPG / PNG。
export async function imagesToPdf(items, opts = {}) {
  const { PDFDocument } = await import("./pdf-lib.esm.min.js");
  const out = await PDFDocument.create();
  const A4 = [595.28, 841.89];
  const margin = opts.margin == null ? 24 : opts.margin;
  for (const it of items) {
    const isPng = /png$/i.test(it.type || "") || /\.png$/i.test(it.name || "");
    const img = isPng ? await out.embedPng(it.bytes) : await out.embedJpg(it.bytes);
    const page = out.addPage(A4);
    const maxW = A4[0] - margin * 2, maxH = A4[1] - margin * 2;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1) || 1;
    const w = img.width * scale, h = img.height * scale;
    page.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
  }
  out.setProducer("PDFPocket");
  return out.save({ useObjectStreams: true });
}
