# Price Tier Segmentation — Tableau Dashboard Extension

แบ่งกลุ่มสินค้าตามช่วงราคา (ECO / MASS / PREMIUM / LUXURY) ด้วย interactive price boundary sliders พร้อมตารางสรุป กราฟ และ export CSV

## โครงสร้างไฟล์

```
tier-segmentation-extension/
├── PriceTierSegmentation.trex        # Tableau extension manifest
├── tier_segmentation.html            # Main extension UI
├── tier_segmentation.js              # Main extension logic
├── config.html                       # Configuration popup UI
├── config.js                         # Configuration popup logic
├── tableau.extensions.1.latest.js    # Tableau Extensions API (local)
├── chart.umd.min.js                  # Chart.js v4.4.7 (local)
└── README.md
```

## ข้อกำหนดข้อมูล (Data Requirements)

Extension ต้องการข้อมูลจาก Tableau Worksheet ที่มี column เหล่านี้:

| Field       | Required | Description                        |
|-------------|----------|------------------------------------|
| **MCH1**    | ✅ Yes   | กลุ่มสินค้า / Product Group        |
| **Price**   | ✅ Yes   | ราคาต่อหน่วย                      |
| **Sale Amt**| ✅ Yes   | ยอดขาย (บาท)                       |
| **Sale Qty**| ✅ Yes   | จำนวนขาย                           |
| SKU         | Optional | รหัสสินค้า                         |
| Product     | Optional | ชื่อสินค้า                         |
| MCH3        | Optional | หมวดหมู่ใหญ่                      |
| Brand       | Optional | แบรนด์                             |
| Flag        | Optional | ประเภทแบรนด์ (Private/Market Brand) |
| Profit      | Optional | กำไร                               |

ระบบ auto-detect column จากชื่อ field และนามสกุลที่เป็นไปได้ (เช่น `SUM(Sale Amt)` → Sale Amount)

## วิธีติดตั้งและใช้งาน

### Development (localhost)

1. **เปิด local server:**
   ```bash
   cd tier-segmentation-extension
   npx http-server -p 8765 --cors
   ```

2. **เปิด Tableau Desktop:**
   - เปิด Workbook ที่มีข้อมูล SKU
   - สร้าง Dashboard → ลาก Worksheet ที่มีข้อมูลเข้าไป
   - Objects → Extensions → เลือกไฟล์ `PriceTierSegmentation.trex`

3. **Configure:**
   - กดปุ่ม "Configure" หรือ ⚙️ Settings
   - เลือก Worksheet ที่มีข้อมูล
   - Map column ให้ตรง → Save

### Production (GitHub Pages)

1. **Push ไป GitHub:**
   ```bash
   git init
   git add .
   git commit -m "feat: initial Tableau extension"
   git remote add origin https://github.com/<username>/tier-segmentation-extension.git
   git push -u origin main
   ```

2. **เปิด GitHub Pages:**
   - ไปที่ repo Settings → Pages
   - Source: Deploy from a branch → `main` / `/ (root)`
   - Save

3. **อัปเดต .trex URL:**
   - เปิด `PriceTierSegmentation.trex`
   - เปลี่ยน `<url>` เป็น:
     ```
     https://<username>.github.io/tier-segmentation-extension/tier_segmentation.html
     ```

4. **Tableau Server:**
   - Admin ต้องเพิ่ม URL `https://<username>.github.io` ใน safe list

## ฟีเจอร์

- **Interactive Sliders** — ลากปรับเกณฑ์ราคาแบ่ง Tier (ECO/MASS/PREMIUM/LUXURY)
- **Linked Bounds** — เชื่อมโยงเกณฑ์ราคากลางระหว่างหมวดหมู่
- **3 มุมมองตาราง:** สรุปรวม / Private Brand / Brand
- **กราฟ:** SKU Count by Tier, % Sale Share (Donut), Margin% by Tier
- **ตารางรายละเอียด SKU** — ค้นหา, filter, sort
- **Export CSV** — Export ทั้ง SKU detail และตารางหมวดหมู่
- **Auto-refresh** — เมื่อเปลี่ยน filter ใน Tableau ข้อมูล refresh อัตโนมัติ
- **Settings persistence** — worksheet selection และ column mapping บันทึกไว้ใน workbook

## การแก้ปัญหา

| ปัญหา | วิธีแก้ |
|--------|---------|
| Extension ไม่โหลด | ตรวจสอบ URL ใน `.trex` และ local server |
| ไม่เห็น column | กด ⚙️ Settings → map column ด้วยมือ |
| ข้อมูลไม่ refresh | ตรวจสอบว่า worksheet ถูกเลือกถูกต้อง |
| กราฟไม่แสดง | ตรวจสอบว่า `chart.umd.min.js` โหลดสำเร็จ |

## License

MIT
