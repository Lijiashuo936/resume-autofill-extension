// 纯 Node 生成 PNG — 不依赖 sharp/canvas 等外部库
// 用 zlib deflate 压缩,手写 IHDR/IDAT/IEND chunk

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICON_DIR = path.join(__dirname, '..', 'icons');

// CRC32 表(PNG 用)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// 生成"圆角矩形渐变 + 字母 F"图标
function makeIcon(size) {
  const w = size, h = size;
  // raw scanline data (RGBA)
  const stride = 1 + w * 4;
  const raw = Buffer.alloc(h * stride);
  const radius = Math.max(2, Math.round(size * 0.18));

  function lerp(a, b, t) { return Math.round(a + (b - a) * t); }
  // 渐变颜色(蓝→紫)
  const C1 = [37, 99, 235];   // #2563eb
  const C2 = [124, 58, 237];  // #7c3aed

  function inRoundedRect(x, y) {
    // 0=外,1=内
    if (x < 0 || y < 0 || x >= w || y >= h) return 0;
    // 圆角检测
    const dx = Math.max(0, radius - x, x - (w - 1 - radius));
    const dy = Math.max(0, radius - y, y - (h - 1 - radius));
    if (dx > 0 && dy > 0) {
      const d = Math.sqrt(dx * dx + dy * dy);
      return d <= radius ? 1 : 0;
    }
    return 1;
  }

  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const off = y * stride + 1 + x * 4;
      const inside = inRoundedRect(x, y);

      if (!inside) {
        raw[off] = 0; raw[off+1] = 0; raw[off+2] = 0; raw[off+3] = 0;
        continue;
      }

      // 渐变
      const t = (x + y) / (w + h - 2);
      const r = lerp(C1[0], C2[0], t);
      const g = lerp(C1[1], C2[1], t);
      const b = lerp(C1[2], C2[2], t);

      // 字母 F 区域(简单的笔画定义)
      // F = 左竖 + 上横 + 中横
      // 把字母放在中央 60% 区域
      const m = 0.20, M = 0.80;
      const mx0 = Math.round(w * m), mx1 = Math.round(w * M);
      const my0 = Math.round(h * m), my1 = Math.round(h * M);
      const fontW = mx1 - mx0, fontH = my1 - my0;
      const stroke = Math.max(1, Math.round(size * 0.12));
      const padX = Math.round(fontW * 0.10);
      // 左竖
      const isStrokeLeft = x >= mx0 + padX && x <= mx0 + padX + stroke && y >= my0 && y <= my1;
      // 上横(全长)
      const isTopBar = y >= my0 && y <= my0 + stroke && x >= mx0 + padX && x <= mx1 - padX;
      // 中横(短)
      const midY = Math.round((my0 + my1) / 2);
      const isMidBar = y >= midY && y <= midY + stroke && x >= mx0 + padX && x <= mx0 + padX + Math.round((mx1 - mx0 - padX) * 0.7);

      if (isStrokeLeft || isTopBar || isMidBar) {
        raw[off] = 255; raw[off+1] = 255; raw[off+2] = 255; raw[off+3] = 255;
      } else {
        raw[off] = r; raw[off+1] = g; raw[off+2] = b; raw[off+3] = 255;
      }
    }
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type RGBA
  ihdr[10] = 0;   // compression
  ihdr[11] = 0;   // filter
  ihdr[12] = 0;   // interlace

  const idatData = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- 生成 16/48/128 ----------
[16, 48, 128].forEach(size => {
  const png = makeIcon(size);
  const file = path.join(ICON_DIR, `icon${size}.png`);
  fs.writeFileSync(file, png);
  console.log(`生成 ${file}  (${png.length} bytes)`);
});
