# Price Tier Segmentation — Tableau Dashboard Extension

แบ่งกลุ่มสินค้าตามช่วงราคา (ECO / MASS / PREMIUM / LUXURY) ด้วย interactive price boundary sliders พร้อมตารางสรุป กราฟ และ export CSV

## โครงสร้างไฟล์

```
tier-segmentation-extension/
├── tier_segmentation.html            # Main extension UI (HTML + CSS)
├── tier_segmentation.js              # Main extension logic (IIFE)
├── tableau.extensions.1.latest.js    # Tableau Extensions API (local)
├── chart.umd.min.js                  # Chart.js v4.4.7 (CDN fallback)
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

2. **สร้าง .trex manifest** (เฉพาะครั้งแรก) — สร้างไฟล์ `PriceTierSegmentation.trex`:
   ```xml
   <?xml version="1.0" encoding="utf-8"?>
   <manifest manifest-version="0.1" xmlns="http://www.tableau.com/xml/extension_manifest">
     <dashboard-extension id="com.satinee.price-tier-segmentation" extension-version="1.0.0">
       <default-locale>en_US</default-locale>
       <name resource-id="name"/>
       <description>Price Tier Segmentation Tool</description>
       <author name="Satinee" email="satinee@example.com" organization="Satinee"/>
       <min-api-version>1.4</min-api-version>
       <source-location>
         <url>http://localhost:8765/tier_segmentation.html</url>
       </source-location>
       <context-menu>
         <configure-context-menu-item />
       </context-menu>
       <permissions>
         <permission>full data</permission>
       </permissions>
     </dashboard-extension>
     <resources>
       <resource id="name">
         <text locale="en_US">Price Tier Segmentation</text>
       </resource>
     </resources>
   </manifest>
   ```

3. **เปิด Tableau Desktop:**
   - เปิด Workbook ที่มีข้อมูล SKU
   - สร้าง Dashboard → ลาก Worksheet ที่มีข้อมูลเข้าไป
   - Objects → Extensions → เลือกไฟล์ `.trex`

4. **Configure:**
   - กด Settings → เลือก Worksheet → Load Data

### Production (GitHub Pages)

1. เปลี่ยน `<url>` ใน `.trex` เป็น GitHub Pages URL:
   ```
   https://oui-satinee.github.io/tier/tier_segmentation.html
   ```
2. เปิด GitHub Pages ใน repo Settings → Pages → `main` / `root`

## ฟีเจอร์

- **Interactive Sliders** — ลากปรับเกณฑ์ราคาแบ่ง Tier (ECO/MASS/PREMIUM/LUXURY)
- **Linked Bounds** — เชื่อมโยงเกณฑ์ราคากลางระหว่างหมวดหมู่
- **3 มุมมองตาราง:** สรุปรวม / Private Brand / Brand
- **กราฟ:** SKU Count by Tier, % Sale Share (Donut), Margin% by Tier
- **ตารางรายละเอียด SKU** — ค้นหา, filter, sort
- **Export CSV** — Export ทั้ง SKU detail และตารางหมวดหมู่
- **Auto-refresh** — เมื่อเปลี่ยน filter ใน Tableau ข้อมูล refresh อัตโนมัติ
- **Settings persistence** — worksheet selection บันทึกไว้ใน workbook
- **Inline config** — เลือก Worksheet ได้จากหน้าหลัก (ไม่ต้องเปิด popup)

## License

MIT
