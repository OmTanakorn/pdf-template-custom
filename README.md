# pdf-template-custom

รับ **PDF Template (JSON)** + **ข้อมูล (JSON)** → ออกมาเป็น **PDF** และมี Studio สำหรับลากวางออกแบบเทมเพลตเองแบบ Figma

```
Template JSON ─┐
               ├─► resolve (bindings) ─► emit HTML ─► Chromium ─► PDF
Data JSON ─────┘                            ▲
                                            └── Studio ใช้ตัวเดียวกันวาด preview
```

## ทำไมถึงออกแบบแบบนี้

**ปมของโจทย์**: “ลากวางอิสระแบบ Figma” (absolute) กับ “ตารางคุม layout ที่ตัดหน้าอัตโนมัติ” (flow) เข้ากันไม่ได้ตรง ๆ — กล่อง absolute ตัดขึ้นหน้าใหม่ไม่ได้ จึงแยกเป็น 2 เลเยอร์:

| เลเยอร์ | พฤติกรรม | เหมาะกับ |
| --- | --- | --- |
| `header` / `footer` / `overlay` | absolute `x/y/w/h` ลากวางอิสระ ซ้ำทุกหน้า (เลือกได้ว่าหน้าไหน) | โลโก้ เลขที่เอกสาร ลายเซ็น ตราประทับ เลขหน้า |
| `body` | flow ตัดหน้าเอง `thead` ซ้ำทุกหน้า `tfoot` เฉพาะหน้าสุดท้าย | ตารางรายการ ข้อความยาว |

**Pagination ทำเอง ไม่พึ่ง auto page-break ของ Chromium** (`packages/renderer/src/paginator.ts`) แลกมาด้วยสามอย่างที่ template engine ต้องมี:
จำนวนหน้าที่แน่นอนสำหรับ `{page} / {pages}` · overlay รายหน้า · และ preview ใน Studio ที่เป็น DOM เดียวกับที่พิมพ์ออก PDF

**หน่วยเป็นมิลลิเมตร** ทั้งระบบ (ยกเว้น `fontSize`/ความหนาเส้น = pt) ตัวเลขที่ลากใน Studio จึงเป็นตัวเลขเดียวกับที่ลงบนกระดาษ

## เริ่มใช้

```bash
pnpm install
pnpm --filter @pdftc/pdf exec playwright install chromium   # ครั้งแรกครั้งเดียว

pnpm render -t examples/invoice.template.json -d examples/invoice.data.json -o out.pdf
pnpm studio      # Studio http://localhost:5173 + API http://localhost:8787
pnpm test
pnpm typecheck
```

## โครงสร้าง

| แพ็กเกจ | หน้าที่ |
| --- | --- |
| `packages/schema` | Zod schema + type ของ Template (แหล่งความจริงเดียว) |
| `packages/renderer` | ภาษา binding, resolve, emit HTML, paginator — ทำงานได้ทั้ง Node และเบราว์เซอร์ |
| `packages/pdf` | Chromium (Playwright) → PDF + CLI |
| `packages/fonts` | ฟอนต์ไทย 10 ตระกูลจาก Google Fonts (OFL) |
| `apps/api` | บริการเรนเดอร์ ถือ Chromium ค้างไว้ (~150ms/ฉบับ) |
| `apps/studio` | ตัวออกแบบ React ลากวาง + inspector + preview สด |

## Template โดยย่อ

```jsonc
{
  "version": 1,
  "page": { "preset": "A4", "orientation": "portrait", "margin": { "top": 12, "right": 12, "bottom": 12, "left": 12 } },
  "styles": { "th": { "fontWeight": 700, "background": "#1e3a5f", "color": "#fff" } },

  "header": {
    "height": 46,                                  // กันพื้นที่ไว้ทุกหน้า
    "items": [
      { "frame": { "x": 12, "y": 0, "w": 100 },    // มม. ทั้งหมด
        "node": { "id": "seller", "type": "text", "content": "{{ seller.name }}" } }
    ]
  },

  "footer": {
    "height": 24,
    "items": [
      { "frame": { "x": 128, "y": 5, "w": 70 }, "on": "all",
        "node": { "id": "pg", "type": "pageNumber", "format": "หน้า {page} จาก {pages}" } },
      { "frame": { "x": 128, "y": 12, "w": 70 }, "on": "last",
        "node": { "id": "sign", "type": "text", "content": "ผู้มีอำนาจลงนาม" } }
    ]
  },

  "overlay": [                                     // ทับบนเนื้อหา
    { "frame": { "x": 60, "y": 120, "w": 100, "rotate": -30 },
      "node": { "id": "stamp", "type": "text", "visibleIf": "doc.cancelled", "content": "ยกเลิก" } }
  ],

  "body": [
    { "id": "items", "type": "table",
      "columns": [{ "width": 12 }, { "width": "1fr" }, { "width": 30 }],   // มม. | สัดส่วน | "auto"
      "head": [{ "id": "h", "cells": [ /* … */ ] }],                        // ซ้ำทุกหน้า
      "body": [{ "id": "r", "each": { "in": "items", "as": "it", "indexAs": "i" },
                 "cells": [ /* {{ it.name }} */ ] }],
      "foot": [ /* รวมยอด — โผล่หน้าสุดท้าย */ ] }
  ]
}
```

### ชนิดโหนด

`text` · `table` · `stack` (แถว/คอลัมน์ + `each`) · `rect` · `line` · `image` · `pageNumber` · `barcode`

### ภาษา binding

ไม่ใช่ JavaScript และไม่มี `eval` — เทมเพลตเป็นข้อมูลที่เซิร์ฟเวอร์เรนเดอร์ จึงเข้าถึงได้แค่ object ที่ส่งเข้ามา และ `__proto__` / `constructor` ถูกปิด

```
{{ customer.name }}
{{ items[0].qty * items[0].price | number:2 }}
{{ issuedAt | thaidate:'D MMMM YYYY' }}      → 26 กรกฎาคม 2569
{{ totals.grand | bahttext }}                → สองล้านเจ็ดแสน…บาทยี่สิบเจ็ดสตางค์
visibleIf: "total > 0 && !draft"
```

ตัวกรอง: `number` `currency` `int` `round` `date` `thaidate` `bahttext` `upper` `lower` `trim` `default` `truncate` `padStart` `join` `length` `sum`
เพิ่มเองได้ด้วย `registerFilter(name, fn)` — อาร์กิวเมนต์ของตัวกรองเป็น expression ชื่อฟิลด์จึงต้องใส่เครื่องหมายคำพูด (`sum:'qty'`)

## API

```bash
curl -X POST localhost:8787/api/render \
  -H 'content-type: application/json' \
  -d '{"template": {...}, "data": {...}}' -o out.pdf
```

`POST /api/html` คืน HTML กลางไว้ดีบัก · `GET /api/example` คืนเทมเพลตตัวอย่าง · `GET /api/health` คืนตัวนับของ cache/gate/jobs

### แบบ async

เอกสารที่ใช้เวลานานไม่ควรถือ connection ไว้ทั้งใบ — proxy จะตัด แล้วเบราว์เซอร์จะ retry ซึ่งกลายเป็นสั่งเรนเดอร์ซ้ำงานที่ไม่มีใครรอแล้ว

```bash
curl -X POST 'localhost:8787/api/render?async=1' \
  -H 'content-type: application/json' -d '{"template": {...}, "data": {...}}'
# → 202 {"id":"…","state":"running","statusUrl":"/api/jobs/…","resultUrl":"/api/jobs/…/result"}

curl localhost:8787/api/jobs/<id>          # {"state":"done","renderMs":49,"bytes":93908}
curl localhost:8787/api/jobs/<id>/result -o out.pdf   # 202 ถ้ายังไม่เสร็จ · 500 ถ้าพัง
```

ส่งหัว `Prefer: respond-async` แทน query ก็ได้ ผลลัพธ์เก็บไว้ 5 นาที

### คลังเทมเพลต

Studio เป็นเครื่องมือของทีม เทมเพลตจึงต้องอยู่ต่อหลังปิดแท็บ `apps/api/src/templates.ts` เก็บเป็น **ไฟล์ JSON หนึ่งไฟล์ต่อหนึ่งเทมเพลต** ใต้ `TEMPLATE_DIR` (ตั้งต้น `.templates/`) — diff ใน git ได้ อ่านได้โดยไม่ต้องเปิดแอป และวางไฟล์เข้าไปเองก็ได้ ฐานข้อมูลให้ index กับ transaction ที่คลังระดับไม่กี่ร้อยใบยังไม่ต้องใช้

```bash
GET    /api/templates                 # รายการ เรียงตามที่บันทึกล่าสุด
POST   /api/templates                 # { name, template, data } → 201 + record
GET    /api/templates/:id             # ทั้งเทมเพลตและข้อมูลตัวอย่าง
PUT    /api/templates/:id             # { rev, name?, template?, data? }
POST   /api/templates/:id/duplicate   # { name? }
DELETE /api/templates/:id
```

**สองคนเปิดเทมเพลตเดียวกันได้** ทุกครั้งที่บันทึกต้องส่ง `rev` ที่โหลดมาไปด้วย ถ้ามีคนบันทึกแทรกไปก่อน เซิร์ฟเวอร์ตอบ `409` พร้อม `rev` ปัจจุบัน แทนที่จะทับงานคนอื่นเงียบ ๆ — Studio จะถามว่าจะเขียนทับหรือเก็บงานไว้ในแท็บก่อน

การเขียนลงดิสก์เขียนไฟล์ชั่วคราวแล้ว `rename` ทับ ไฟล์เทมเพลตจึงไม่มีสภาพเขียนค้างครึ่งใบ ต่อให้โปรเซสตายกลางคัน

ใน Studio: กล่องเลือกเทมเพลตบนแถบเครื่องมือ · `Ctrl+S` บันทึก · บันทึกเป็น / เปลี่ยนชื่อ / ทำสำเนา / ลบ · ปุ่มบันทึกขึ้นจุดเมื่อมีของยังไม่ได้เซฟ และปิดแท็บทั้งที่ยังไม่เซฟจะโดนเตือน

### การคุมโหลด

การเรนเดอร์หนึ่งครั้งกินหนึ่ง browser context (~50-100MB) ถ้าปล่อยให้ทำพร้อมกันไม่จำกัด ผู้ใช้กด Export รัว ๆ จะทำให้โปรเซสโดน OOM kill ก่อนได้ PDF ใบแรก คำขอทุกใบจึงผ่านสามชั้น ถูกก่อนแพงทีหลัง

1. **cache** (`cache.ts`) — body เหมือนกันเป๊ะที่เพิ่งเรนเดอร์ไป คืนของเดิม (175ms → 1.8ms) LRU จำกัดเป็น MB ไม่ใช่จำนวนใบ
2. **รวมงานซ้ำ** (`gate.ts`) — body เดียวกันที่กำลังเรนเดอร์อยู่ แชร์ผลเดิม และไม่กินช่องคิว กด 40 ครั้งรวดจึงเรนเดอร์จริงครั้งเดียว
3. **เพดาน + คิวจำกัด** — เกินคิวหรือรอนานเกิน ตอบ `503` พร้อม `Retry-After` ทันที ดีกว่าค้าง connection ไว้จนเซิร์ฟเวอร์ตาย

ปลอดภัยที่จะ cache เพราะการเรนเดอร์เป็นฟังก์ชันบริสุทธิ์ของ template + data — ภาษา binding อ่านวันที่จากข้อมูล ไม่ได้อ่านนาฬิกา ถ้าเพิ่ม filter เองด้วย `registerFilter` ที่ไม่ determinstic ต้องลด TTL ลง

| ตัวแปรแวดล้อม | ค่าตั้งต้น | ความหมาย |
| --- | --- | --- |
| `RENDER_CONCURRENCY` | `min(4, max(2, cores))` | เรนเดอร์พร้อมกันได้กี่ฉบับ |
| `RENDER_QUEUE` | `50` | รอคิวได้กี่ฉบับ ก่อนเริ่มตอบ 503 |
| `RENDER_QUEUE_TIMEOUT_MS` | `20000` | รอคิวนานเกินนี้ถือว่าผู้ใช้ไปแล้ว |
| `RENDER_JOB_QUEUE_TIMEOUT_MS` | `120000` | เท่ากันแต่สำหรับงาน async ที่ไม่มีใครถือ socket รอ |
| `RENDER_CACHE_MB` | `64` | ขนาด cache ผลลัพธ์ · `0` = ปิด |
| `RENDER_CACHE_TTL_MS` | `60000` | อายุของผลลัพธ์ใน cache |
| `RENDER_JOB_TTL_MS` | `300000` | งาน async ที่เสร็จแล้ว เก็บผลไว้นานเท่าไร |
| `RENDER_JOB_MAX` | `500` | เพดานจำนวนงานที่เก็บ |
| `RENDER_MAX_PAGE_USES` | `5` | เรนเดอร์กี่ครั้งจึงทิ้ง page แล้วสร้างใหม่ |
| `TEMPLATE_DIR` | `.templates/` | ที่เก็บคลังเทมเพลต |

### page pool

`PdfRenderer` ใช้ page ซ้ำใน context เดียว การสร้าง context ใหม่ทุกใบกิน ~55ms จาก ~125ms และโหลดฟอนต์ใหม่ทุกครั้ง เพราะ HTTP cache ตายไปพร้อม context

แต่ล้าง page แล้ว Chromium ไม่คืนหน่วยความจำ — renderer process ยังอยู่ heap โตอย่างเดียว วัดบน invoice ตัวอย่างที่ concurrency 4:

| | RSS หลังนิ่ง | 60 ใบใช้เวลา |
| --- | --- | --- |
| ไม่มี pool (context ใหม่ทุกใบ) | ~350MB | 1.88s |
| pool ใช้ซ้ำไม่จำกัด | ~2.0GB | 1.04s |
| pool + `RENDER_MAX_PAGE_USES=5` | ~712MB นิ่งตลอด 420 ใบ | 1.09s |

ค่าตั้งต้นจึงเป็นแบบที่สาม — ยอมสร้าง page ใหม่ทุก 5 ใบ แลกกับเพดานของ heap

## ฟอนต์

ทั้งหมดมาจาก Google Fonts ใต้สัญญาอนุญาต OFL (ตัวสัญญาอยู่ใน `packages/fonts/licenses/`) รวม ~2.9MB

| กลุ่ม | ตระกูล |
| --- | --- |
| Sans | **Sarabun** (ค่าตั้งต้น · ฟอนต์ราชการไทย) · Noto Sans Thai · IBM Plex Sans Thai · Anuphan · Prompt · Kanit |
| Serif | Noto Serif Thai · Trirong |
| Display | Chakra Petch · Charm |

Noto Sans Thai, Noto Serif Thai และ Anuphan เป็น variable font — ไฟล์เดียวครอบคลุมทุกน้ำหนัก (`weightRange` ใน `FontFace`) ที่เหลือมี 400 กับ 700

ทุกตระกูลครอบคลุมทั้งไทยและละติน และมี fallback ต่อท้ายเสมอ (`Noto Sans Thai` → `Sarabun` → `sans-serif`) กลิฟที่ขาดจึงไม่กลายเป็นกล่องเปล่า

**เอกสารจะฝังเฉพาะตระกูลที่ใช้จริง** — emitter เดินทั้งเทมเพลตเก็บ `fontFamily` ที่ถูกอ้างถึง แล้วปล่อย `@font-face` เท่าที่จำเป็น ใบกำกับภาษีที่ใช้ Sarabun อย่างเดียวจึงหนัก ~760KB แทนที่จะเป็น 3.7MB

เพิ่มฟอนต์เองได้ผ่าน `template.fonts` (ชี้ไป URL หรือ data URI ก็ได้) โดยไม่ต้องแตะแพ็กเกจ

## ความเที่ยงตรง

Studio กับ PDF วัดความกว้างข้อความเท่ากันเพราะ CSS บังคับ `text-rendering: geometricPrecision` — ถ้าไม่มีบรรทัดนี้ เบราว์เซอร์ปกติจะวัดข้อความกว้างกว่า headless (glyph advance ถูกปัดตาม hinting) แล้ว preview จะตัดบรรทัดไม่ตรงกับ PDF

### snapshot ของ layout

paginator เป็นส่วนที่ unit test จับไม่ได้ เพราะผลลัพธ์ของมันคือ “ของไปตกอยู่ตรงไหนบนหน้า” `packages/pdf/test/layout.test.ts` จึงบันทึกสิ่งนั้นตรง ๆ — ทุก element ที่ emitter ติด `data-id` ไว้ ตกหน้าไหน กล่องกว้างยาวเท่าไร **เป็นมิลลิเมตร** พร้อมข้อความของแต่ละหน้า เก็บไว้ใต้ `packages/pdf/test/snapshots/`

เลือกเก็บเป็นเรขาคณิตไม่ใช่พิกเซล เพราะ PNG diff จะพังทุกครั้งที่ Chromium เปลี่ยน antialiasing แต่กลับเงียบสนิทตอนที่ตารางเลิกซ้ำหัวตาราง และไฟล์ PNG รีวิวใน diff ไม่ได้ ส่วนมิลลิเมตรคือหน่วยเดียวกับที่เขียนเทมเพลต snapshot ที่พังจึงอ่านได้เป็น `h1 y: 61.6 → 59.6` ซึ่งคือสิ่งที่เพี้ยนจริง ๆ

```bash
pnpm test                     # เทียบกับ snapshot เดิม (คลาดได้ 0.35 มม.)
SNAPSHOT=update pnpm test     # ยอมรับ layout ใหม่ — อ่าน diff ก่อน commit
```

ครอบสามอย่าง: ใบกำกับตัวอย่างทั้งใบ · `thead` ต้องซ้ำทุกหน้าและ `tfoot` ต้องอยู่หน้าสุดท้ายหน้าเดียว · `rowSpan` ที่ยาวคร่อมสองรอยต่อหน้า และปิดท้ายด้วยการเรนเดอร์ PDF จริงแล้วเทียบจำนวนหน้าใน page tree กับที่ DOM ตัดไว้ — กันกรณีที่ pagination ถูกต้องบนจอแต่หายไปตอนพิมพ์

หมายเหตุ: `resolve.ts` ต่อท้าย id ที่ถูกโคลนด้วยตัวนับที่อยู่ยาวเท่าอายุโปรเซส เรนเดอร์ครั้งที่สองในโปรเซสเดียวกันจึงได้ id คนละชุด — snapshot ตัดส่วนต่อท้ายทิ้งก่อนเทียบ

## ข้อจำกัดที่รู้อยู่

- `barcode` ยังเป็นกล่องเปล่า — schema/ตัว inspector พร้อมแล้ว แต่ยังไม่ได้ต่อตัวเข้ารหัส (QR / PromptPay / Code128)
- ย่อหน้าเดียวที่สูงเกินหนึ่งหน้าจะไม่ถูกตัด — paginator ตัดที่ระดับ block และแถวตาราง ยังไม่ตัดระดับบรรทัด
- `rowSpan` ที่คร่อมรอยต่อหน้าตัดถูกแล้ว — เซลล์ที่ต่อไปหน้าใหม่เป็นกล่องว่างสไตล์เดิม เนื้อหาอยู่หน้าแรกใบเดียว
- Studio แก้เนื้อหา `body` ผ่าน inspector (ยังลากวางในโซน flow ไม่ได้ — ตามนิยามของ flow)
