// 图片重压缩：只处理 DCTDecode（JPEG）内嵌图，文字与矢量原样保留。
const COMPRESS = { light: { maxPx: 2200, quality: 0.85 }, normal: { maxPx: 1600, quality: 0.72 }, strong: { maxPx: 1100, quality: 0.55 } };

export async function compress(buf, level) {
  const { PDFDocument, PDFName, PDFRawStream } = await import("./pdf-lib.esm.min.js");
  const cfg = COMPRESS[level] || COMPRESS.normal;
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const seen = new Set();
  let touched = 0;

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const dict = obj.dict;
    if ((dict.lookup(PDFName.of("Subtype"))?.toString?.() || "") !== "/Image") continue;
    const f = dict.lookup(PDFName.of("Filter"))?.toString?.() || "";
    if (!/DCTDecode/.test(f)) continue;
    const w = dict.lookup(PDFName.of("Width"))?.asNumber?.() || 0;
    const h = dict.lookup(PDFName.of("Height"))?.asNumber?.() || 0;
    if (!w || !h) continue;
    const key = `${w}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const raw = obj.contents;
    let bmp;
    try { bmp = await createImageBitmap(new Blob([raw], { type: "image/jpeg" })); } catch { continue; }
    const scale = Math.min(1, cfg.maxPx / Math.max(bmp.width, bmp.height));
    const cw = Math.max(1, Math.round(bmp.width * scale));
    const ch = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    canvas.getContext("2d").drawImage(bmp, 0, 0, cw, ch);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", cfg.quality));
    if (!blob) continue;
    const out = new Uint8Array(await blob.arrayBuffer());
    if (out.byteLength >= raw.length) continue;

    dict.set(PDFName.of("Width"), doc.context.obj(cw));
    dict.set(PDFName.of("Height"), doc.context.obj(ch));
    dict.set(PDFName.of("Length"), doc.context.obj(out.byteLength));
    doc.context.assign(ref, PDFRawStream.of(dict, out));
    touched++;
  }
  void touched;
  return doc.save({ useObjectStreams: true });
}
