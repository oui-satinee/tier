// ═══════════════════════════════════════════════════════════════
// Price Tier Segmentation Tool — Tableau Dashboard Extension
// Main logic file: tier_segmentation.js
// ═══════════════════════════════════════════════════════════════

/* global tableau, Chart */

// ─── Constants ───────────────────────────────────────────────
const TIERS = ['ECO', 'MASS', 'PREMIUM', 'LUXURY'];
const TC = {
    ECO:     { c: '#27ae60', bg: '#eafaf1' },
    MASS:    { c: '#2980b9', bg: '#ebf5fb' },
    PREMIUM: { c: '#e67e22', bg: '#fef5e7' },
    LUXURY:  { c: '#8e44ad', bg: '#f5eef8' }
};

// ─── Column Mapping ──────────────────────────────────────────
// Possible field names for auto-detection.
// Tableau may wrap fields in aggregations like SUM(Sale Amt).
const COLUMN_MAP = {
    sku:      ['sku', 'skuid', 'sku_id', 'item_code', 'itemcode', 'product_code', 'productcode'],
    product:  ['product', 'product_name', 'productname', 'item_name', 'itemname', 'description'],
    mch3:     ['mch3', 'category', 'cat', 'mch_3', 'mch3_name', 'category_name', 'cat_name'],
    mch1:     ['mch1', 'product_group', 'prod_group', 'mch_1', 'mch1_name', 'group', 'subcategory'],
    brand:    ['brand', 'brand_name', 'brandname'],
    flag:     ['flag', 'brand_type', 'brandtype', 'brand_flag', 'type', 'private_brand_flag'],
    price:    ['price', 'unit_price', 'unitprice', 'selling_price', 'sellingprice', 'avg_price'],
    saleAmt:  ['sale_amt', 'saleamt', 'sales_amount', 'salesamount', 'revenue', 'sales', 'amount', 'sale'],
    saleQty:  ['sale_qty', 'saleqty', 'sales_qty', 'salesqty', 'quantity', 'qty', 'units_sold', 'unitssold'],
    profit:   ['profit', 'gross_profit', 'grossprofit', 'margin_amount', 'marginamount']
};

function normalizeFieldName(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripAggregation(fieldName) {
    // Strip patterns like SUM(...), AVG(...), AGG(...)
    const match = fieldName.match(/^(?:SUM|AVG|MIN|MAX|COUNT|ATTR|AGG)\s*\(\s*(.+?)\s*\)$/i);
    return match ? match[1] : fieldName;
}

function buildColumnIndex(columns, userMapping) {
    // Returns { sku: colIndex, product: colIndex, ... }
    const index = {};
    const used = new Set();

    // If user provided explicit mapping, use it first
    if (userMapping) {
        for (const [field, colName] of Object.entries(userMapping)) {
            if (!colName) continue;
            const normal = normalizeFieldName(colName);
            for (let i = 0; i < columns.length; i++) {
                if (used.has(i)) continue;
                const colNameRaw = columns[i].getFieldName ? columns[i].getFieldName() : (columns[i].fieldCaption || columns[i].fieldName || '');
                const stripped = stripAggregation(colNameRaw);
                if (normalizeFieldName(stripped) === normal) {
                    index[field] = i;
                    used.add(i);
                    break;
                }
            }
        }
    }

    // Auto-detect remaining unmapped fields
    for (let i = 0; i < columns.length; i++) {
        if (used.has(i)) continue;
        const colNameRaw = columns[i].getFieldName ? columns[i].getFieldName() : (columns[i].fieldCaption || columns[i].fieldName || '');
        const stripped = stripAggregation(colNameRaw);
        const normal = normalizeFieldName(stripped);

        for (const [field, aliases] of Object.entries(COLUMN_MAP)) {
            if (index[field] !== undefined) continue; // already mapped
            if (aliases.some(a => normal === a || normal.includes(a))) {
                index[field] = i;
                used.add(i);
                break;
            }
        }
    }

    return index;
}

function parseNumber(val) {
    if (val === null || val === undefined) return 0;
    const n = typeof val === 'number' ? val : parseFloat(String(val).replace(/[,$]/g, ''));
    return isNaN(n) ? 0 : n;
}

function extractRecords(dataTable, colIndex) {
    const rows = [];
    const data = dataTable.data;
    const totalRows = data.length;

    for (let r = 0; r < totalRows; r++) {
        const row = data[r];
        const get = (field) => {
            const ci = colIndex[field];
            if (ci === undefined) return '';
            const cell = row[ci];
            if (!cell) return '';
            return cell.nativeValue !== undefined ? cell.nativeValue : (cell.value !== undefined ? cell.value : '');
        };

        const price   = parseNumber(get('price'));
        const saleAmt = parseNumber(get('saleAmt'));
        const saleQty = parseNumber(get('saleQty'));
        const profit  = parseNumber(get('profit'));

        // Skip rows with zero price (likely header/footer)
        if (price === 0 && saleAmt === 0 && saleQty === 0) continue;

        rows.push({
            sku:     String(get('sku') || `ROW-${r + 1}`),
            product: String(get('product') || ''),
            mch3:    String(get('mch3') || ''),
            mch1:    String(get('mch1') || ''),
            brand:   String(get('brand') || ''),
            flag:    String(get('flag') || 'Market Brand'),
            price,
            saleAmt,
            saleQty,
            profit
        });
    }
    return rows;
}

// ─── State ───────────────────────────────────────────────────
let S = {
    data: [],
    mch3Sel: new Set(),
    mch1Sel: new Set(),
    mch1Bounds: {},
    mch1Linked: {},
    tableView: {},
    dFilter: 'ALL',
    sortCol: null,
    sortDir: 'asc',
    ddOpen: false,
    dd3Open: false,
    // Tableau-specific
    worksheetName: '',
    columnMapping: null
};

let charts = { bar: null, donut: null, profit: null };

// ─── Tableau: UI Helpers ─────────────────────────────────────
function showLoading(msg) {
    const el = document.getElementById('loadingOverlay');
    const txt = document.getElementById('loadingText');
    if (el) el.style.display = '';
    if (txt) txt.textContent = msg || 'กำลังโหลดข้อมูลจาก Tableau...';
}

function hideLoading() {
    const el = document.getElementById('loadingOverlay');
    if (el) el.style.display = 'none';
}

function showError(msg) {
    const el = document.getElementById('errorBanner');
    const txt = document.getElementById('errorText');
    if (el) el.style.display = '';
    if (txt) txt.textContent = msg;
}

function hideError() {
    const el = document.getElementById('errorBanner');
    if (el) el.style.display = 'none';
}

function showNoConfig() {
    document.getElementById('noConfig').style.display = '';
    document.getElementById('ctrlBar').style.display = 'none';
    document.getElementById('summaryContainer').innerHTML = '';
    document.getElementById('chartsRow').style.display = 'none';
    document.getElementById('detailCard').style.display = 'none';
}

function hideNoConfig() {
    document.getElementById('noConfig').style.display = 'none';
    document.getElementById('ctrlBar').style.display = '';
}

// ─── Tableau: Data Loading ───────────────────────────────────
function getSelectedWorksheet() {
    const dashboard = tableau.extensions.dashboardContent.dashboard;
    const wsName = S.worksheetName;
    if (!wsName) return null;
    const worksheets = dashboard.worksheets;
    return worksheets.find(ws => ws.name === wsName) || null;
}

async function loadWorksheetData() {
    const ws = getSelectedWorksheet();
    if (!ws) {
        showNoConfig();
        hideLoading();
        return;
    }

    showLoading('กำลังอ่านข้อมูลจาก Worksheet "' + ws.name + '"...');
    hideError();

    try {
        let dataTable;

        // Try getSummaryDataReaderAsync first (API 1.4+)
        if (typeof ws.getSummaryDataReaderAsync === 'function') {
            const reader = await ws.getSummaryDataReaderAsync();
            const totalPages = reader.totalPageCount;
            const allRows = [];

            for (let page = 0; page < totalPages; page++) {
                const pageData = await reader.getPageAsync(page);
                if (page === 0) {
                    dataTable = pageData;
                }
                // Collect all rows across pages
                if (pageData && pageData.data) {
                    for (let r = 0; r < pageData.data.length; r++) {
                        if (dataTable !== pageData) {
                            allRows.push(pageData.data[r]);
                        }
                    }
                }
            }

            // If we collected rows from multiple pages, merge them
            if (allRows.length > 0 && dataTable) {
                dataTable = {
                    columns: dataTable.columns,
                    data: [...dataTable.data, ...allRows]
                };
            }
        } else {
            // Fallback for older API
            dataTable = await ws.getSummaryDataAsync();
        }

        if (!dataTable || !dataTable.columns) {
            showError('ไม่สามารถอ่านข้อมูลจาก Worksheet "' + ws.name + '" ได้');
            hideLoading();
            return;
        }

        // Build column index
        const colIndex = buildColumnIndex(dataTable.columns, S.columnMapping);

        // Check required fields
        const required = ['price'];
        const missing = required.filter(f => colIndex[f] === undefined);
        if (missing.length > 0) {
            showError('ไม่พบ column ที่จำเป็น: ' + missing.join(', ') + ' — กด ⚙️ Settings เพื่อ map column');
            hideLoading();
            showNoConfig();
            return;
        }

        // Extract records
        const records = extractRecords(dataTable, colIndex);

        if (records.length === 0) {
            showError('ไม่พบข้อมูลใน Worksheet "' + ws.name + '"');
            hideLoading();
            return;
        }

        // Update state
        S.data = records;
        S.mch3Sel.clear();
        S.mch1Sel.clear();
        S.mch1Bounds = {};
        S.mch1Linked = {};
        S.tableView = {};
        S.dFilter = 'ALL';
        S.sortCol = null;
        S.sortDir = 'asc';

        hideNoConfig();
        hideLoading();

        initBounds();
        updateAll();

        // Show charts and detail
        document.getElementById('chartsRow').style.display = '';
        document.getElementById('detailCard').style.display = '';

    } catch (err) {
        console.error('Error loading worksheet data:', err);
        showError('เกิดข้อผิดพลาด: ' + (err.message || err));
        hideLoading();
    }
}

// ─── Tableau: Config Popup ──────────────────────────────────
function configure() {
    const popupUrl = window.location.href.replace('tier_segmentation.html', 'config.html');
    tableau.extensions.ui.displayDialogAsync(popupUrl, '', { width: 600, height: 550 })
        .then((closePayload) => {
            // Dialog closed — reload settings and data
            restoreSettings();
            loadWorksheetData();
        })
        .catch((err) => {
            // Dialog was cancelled or errored
            if (err && err.message && !err.message.includes('cancelled')) {
                console.warn('Config dialog error:', err);
            }
        });
}

function openConfig() {
    configure();
}

function restoreSettings() {
    const settings = tableau.extensions.settings;
    S.worksheetName = settings.get('worksheetName') || '';
    const mappingStr = settings.get('columnMapping');
    S.columnMapping = mappingStr ? JSON.parse(mappingStr) : null;
}

// ─── Tableau: Event Listeners ────────────────────────────────
function registerTableauListeners() {
    const dashboard = tableau.extensions.dashboardContent.dashboard;

    // Listen for settings changes (when config dialog saves)
    tableau.extensions.settings.addEventListener(
        tableau.TableauEventType.SettingsChanged,
        (event) => {
            restoreSettings();
            loadWorksheetData();
        }
    );

    // Listen for filter changes on all worksheets
    dashboard.worksheets.forEach(ws => {
        ws.addEventListener(
            tableau.TableauEventType.FilterChanged,
            (event) => {
                if (ws.name === S.worksheetName) {
                    loadWorksheetData();
                }
            }
        );
        ws.addEventListener(
            tableau.TableauEventType.SummaryDataChanged,
            (event) => {
                if (ws.name === S.worksheetName) {
                    loadWorksheetData();
                }
            }
        );
    });
}

// ─── Tableau: Initialization ─────────────────────────────────
tableau.extensions.initializeAsync({ configure: configure }).then(() => {
    restoreSettings();

    if (S.worksheetName) {
        loadWorksheetData();
    } else {
        showNoConfig();
        hideLoading();
    }

    registerTableauListeners();
}).catch(err => {
    console.error('Tableau init failed:', err);
    showError('ไม่สามารถเชื่อมต่อกับ Tableau ได้: ' + (err.message || err));
    hideLoading();
});

// ═══════════════════════════════════════════════════════════════
// REUSED FUNCTIONS (from original tier_segmentation_tool.html)
// ═══════════════════════════════════════════════════════════════

function getMCH3s() {
    const list = [...new Set(getFilteredData().map(d => d.mch3))];
    return list.sort();
}

function getActiveMCH3s() {
    return S.mch3Sel.size === 0 ? getMCH3s() : Array.from(S.mch3Sel);
}

function getMCH1s() {
    const fd = getFilteredData();
    const activeMch3s = getActiveMCH3s();
    const list = [...new Set(fd.filter(d => activeMch3s.includes(d.mch3)).map(d => d.mch1))];
    return list.sort();
}

function getActiveMCH1s() {
    const fd = getFilteredData();
    const activeMch3s = getActiveMCH3s();
    const availableMch1s = [...new Set(fd.filter(d => activeMch3s.includes(d.mch3)).map(d => d.mch1))];
    if (S.mch1Sel.size === 0) return availableMch1s.sort();
    return Array.from(S.mch1Sel).filter(m => availableMch1s.includes(m));
}

// ─── Bounds & Tier Logic ────────────────────────────────────
function getPercentile(arr, p) {
    if (!arr.length) return 0;
    const idx = (arr.length - 1) * p;
    const base = Math.floor(idx);
    const rest = idx - base;
    if (arr[base + 1] !== undefined) {
        return arr[base] + rest * (arr[base + 1] - arr[base]);
    } else {
        return arr[base];
    }
}

function calcDefaultBounds(mch1) {
    const prices = getFilteredData().filter(d => d.mch1 === mch1).map(d => d.price).sort((a, b) => a - b);
    if (!prices.length) return [0, 0, 0];

    const p25 = Math.round(getPercentile(prices, 0.25));
    const p50 = Math.round(getPercentile(prices, 0.50));
    const p75 = Math.round(getPercentile(prices, 0.75));
    return [p25, p50, p75];
}

function initBounds() {
    const mch1s = getMCH1s();
    mch1s.forEach(m => {
        if (!S.mch1Bounds[m]) {
            S.mch1Bounds[m] = calcDefaultBounds(m);
            S.mch1Linked[m] = true;
        }
    });
}

function getActiveBounds(mch1) {
    if (!S.mch1Bounds[mch1]) {
        S.mch1Bounds[mch1] = calcDefaultBounds(mch1);
    }
    return S.mch1Bounds[mch1];
}

function propagateBounds(sourceMch1, bounds) {
    if (!S.mch1Linked[sourceMch1]) return;
    getMCH1s().forEach(m => {
        if (m !== sourceMch1 && S.mch1Linked[m]) {
            S.mch1Bounds[m] = [...bounds];
        }
    });
}

function assignTier(price, bounds) {
    if (price >= bounds[2]) return 'LUXURY';
    if (price >= bounds[1]) return 'PREMIUM';
    if (price >= bounds[0]) return 'MASS';
    return 'ECO';
}

function getSKUTier(d) {
    const bounds = getActiveBounds(d.mch1);
    return assignTier(d.price, bounds);
}

function tierPriceRange(tier, bounds) {
    const b0 = bounds[0], b1 = bounds[1], b2 = bounds[2];
    switch (tier) {
        case 'ECO':     return `< ฿${b0.toLocaleString()}`;
        case 'MASS':    return `฿${b0.toLocaleString()} - ฿${b1.toLocaleString()}`;
        case 'PREMIUM': return `฿${b1.toLocaleString()} - ฿${b2.toLocaleString()}`;
        case 'LUXURY':  return `> ฿${b2.toLocaleString()}`;
    }
}

// ─── Dropdowns ───────────────────────────────────────────────
function toggleDD3() {
    const menu = document.getElementById('dd3Menu');
    const toggle = document.getElementById('dd3Toggle');
    S.dd3Open = !S.dd3Open;
    if (S.dd3Open) {
        menu.classList.add('show');
        toggle.classList.add('open');
    } else {
        menu.classList.remove('show');
        toggle.classList.remove('open');
    }
}

function toggleDD() {
    const menu = document.getElementById('ddMenu');
    const toggle = document.getElementById('ddToggle');
    S.ddOpen = !S.ddOpen;
    if (S.ddOpen) {
        menu.classList.add('show');
        toggle.classList.add('open');
    } else {
        menu.classList.remove('show');
        toggle.classList.remove('open');
    }
}

document.addEventListener('click', (e) => {
    const wrap3 = document.getElementById('dd3Wrap');
    if (wrap3 && !wrap3.contains(e.target)) {
        S.dd3Open = false;
        document.getElementById('dd3Menu').classList.remove('show');
        document.getElementById('dd3Toggle').classList.remove('open');
    }
    const wrap = document.getElementById('ddWrap');
    if (wrap && !wrap.contains(e.target)) {
        S.ddOpen = false;
        document.getElementById('ddMenu').classList.remove('show');
        document.getElementById('ddToggle').classList.remove('open');
    }
});

function renderDropdownMCH3() {
    const mch3s = getMCH3s();
    const menu = document.getElementById('dd3Menu');
    const textEl = document.getElementById('dd3Text');

    if (S.mch3Sel.size === 0) {
        textEl.textContent = 'เลือกทั้งหมด';
    } else {
        textEl.textContent = Array.from(S.mch3Sel).join(', ');
    }

    let html = '';
    const allChecked = S.mch3Sel.size === 0 || S.mch3Sel.size === mch3s.length;
    const fd = getFilteredData();
    html += `<div class="dd-opt all-opt" onclick="onDD3CheckAll(event)">
        <input type="checkbox" ${allChecked ? 'checked' : ''}>
        <span>เลือกทั้งหมด</span>
        <span class="dd-count">${fd.length} SKU</span>
    </div>`;

    mch3s.forEach(m => {
        const checked = S.mch3Sel.has(m);
        const count = fd.filter(d => d.mch3 === m).length;
        html += `<div class="dd-opt" onclick="onDD3Check(event, '${m}')">
            <input type="checkbox" ${checked ? 'checked' : ''}>
            <span>${m}</span>
            <span class="dd-count">${count} SKU</span>
        </div>`;
    });
    menu.innerHTML = html;
}

function onDD3Check(e, mch3) {
    e.stopPropagation();
    if (S.mch3Sel.has(mch3)) {
        S.mch3Sel.delete(mch3);
    } else {
        S.mch3Sel.add(mch3);
    }
    updateAll();
}

function onDD3CheckAll(e) {
    e.stopPropagation();
    const mch3s = getMCH3s();
    if (S.mch3Sel.size === mch3s.length) {
        S.mch3Sel.clear();
    } else {
        S.mch3Sel = new Set(mch3s);
    }
    updateAll();
}

function renderDropdown() {
    const mch1s = getMCH1s();
    const menu = document.getElementById('ddMenu');
    const textEl = document.getElementById('ddText');

    if (S.mch1Sel.size === 0) {
        textEl.textContent = 'เลือกทั้งหมด';
    } else {
        textEl.textContent = Array.from(S.mch1Sel).join(', ');
    }

    const activeMch3s = getActiveMCH3s();
    const filteredData = getFilteredData().filter(d => activeMch3s.includes(d.mch3));

    let html = '';
    const allChecked = S.mch1Sel.size === 0 || S.mch1Sel.size === mch1s.length;
    html += `<div class="dd-opt all-opt" onclick="onDDCheckAll(event)">
        <input type="checkbox" ${allChecked ? 'checked' : ''}>
        <span>เลือกทั้งหมด</span>
        <span class="dd-count">${filteredData.length} SKU</span>
    </div>`;

    mch1s.forEach(m => {
        const checked = S.mch1Sel.has(m);
        const count = filteredData.filter(d => d.mch1 === m).length;
        html += `<div class="dd-opt" onclick="onDDCheck(event, '${m}')">
            <input type="checkbox" ${checked ? 'checked' : ''}>
            <span>${m}</span>
            <span class="dd-count">${count} SKU</span>
        </div>`;
    });
    menu.innerHTML = html;
}

function onDDCheck(e, mch1) {
    e.stopPropagation();
    if (S.mch1Sel.has(mch1)) {
        S.mch1Sel.delete(mch1);
    } else {
        S.mch1Sel.add(mch1);
    }
    updateAll();
}

function onDDCheckAll(e) {
    e.stopPropagation();
    const mch1s = getMCH1s();
    if (S.mch1Sel.size === mch1s.length) {
        S.mch1Sel.clear();
    } else {
        S.mch1Sel = new Set(mch1s);
    }
    updateAll();
}

// ─── Slider & Abs Input ─────────────────────────────────────
let _drag = null;

function startSliderDrag(e, mch1, idx) {
    e.preventDefault();
    _drag = { mch1, idx };
    e.target.classList.add('dragging');
    document.addEventListener('mousemove', doSliderDrag);
    document.addEventListener('mouseup', endSliderDrag);
}

function doSliderDrag(e) {
    if (!_drag) return;
    const bar = document.querySelector('.slider-bar[data-mch1="' + _drag.mch1 + '"]');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const max = parseFloat(bar.dataset.max);
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const val = Math.round(pct * max);

    const bounds = [...(S.mch1Bounds[_drag.mch1] || [0, 0, 0])];
    const idx = _drag.idx;
    if (idx === 0) bounds[0] = Math.min(val, bounds[1]);
    else if (idx === 1) bounds[1] = Math.max(bounds[0], Math.min(val, bounds[2]));
    else bounds[2] = Math.max(bounds[1], val);

    S.mch1Bounds[_drag.mch1] = bounds;
    propagateBounds(_drag.mch1, bounds);

    updateSliderDOM(_drag.mch1, bounds, max);
}

function endSliderDrag() {
    if (_drag) {
        document.querySelectorAll('.slider-handle.dragging').forEach(h => h.classList.remove('dragging'));
        const mch1 = _drag.mch1;
        _drag = null;
        document.removeEventListener('mousemove', doSliderDrag);
        document.removeEventListener('mouseup', endSliderDrag);
        updateAll();
    }
}

function updateSliderDOM(mch1, bounds, max) {
    const tc = document.querySelector('.tier-ctrl[data-mch1="' + mch1 + '"]');
    if (!tc) return;
    const b0 = bounds[0], b1 = bounds[1], b2 = bounds[2];

    tc.querySelectorAll('.slider-handle').forEach(h => {
        const i = parseInt(h.dataset.idx);
        h.style.left = [b0, b1, b2][i] / max * 100 + '%';
    });
    const segs = tc.querySelectorAll('.slider-track .seg');
    if (segs.length === 4) {
        segs[0].style.width = b0 / max * 100 + '%';
        segs[1].style.width = (b1 - b0) / max * 100 + '%';
        segs[2].style.width = (b2 - b1) / max * 100 + '%';
        segs[3].style.width = (max - b2) / max * 100 + '%';
    }
    const lbl = (cls, txt, left) => {
        const el = tc.querySelector('.' + cls);
        if (el) { el.textContent = txt; el.style.left = left + '%'; }
    };
    lbl('lbl-eco', 'ECO: ฿' + b0.toLocaleString(), b0 / max * 100);
    lbl('lbl-mass', 'MASS: ฿' + b1.toLocaleString(), b1 / max * 100);
    lbl('lbl-prem', 'PREM: ฿' + b2.toLocaleString(), b2 / max * 100);

    const ai = tc.querySelectorAll('.ai input:not([disabled])');
    if (ai[0]) { ai[0].value = b0; ai[0].max = b1; }
    if (ai[1]) { ai[1].value = b1; ai[1].min = b0; ai[1].max = b2; }
    if (ai[2]) { ai[2].value = b2; ai[2].min = b1; }
}

function onSliderInput(mch1, idx, val) {
    val = Math.round(parseFloat(val));
    const bounds = S.mch1Bounds[mch1] || [0, 0, 0];

    if (idx === 0) {
        bounds[0] = Math.min(val, bounds[1]);
    } else if (idx === 1) {
        bounds[1] = Math.max(bounds[0], Math.min(val, bounds[2]));
    } else if (idx === 2) {
        bounds[2] = Math.max(bounds[1], val);
    }

    S.mch1Bounds[mch1] = bounds;
    propagateBounds(mch1, bounds);
    updateAll();
}

function onAbsInput(mch1, idx, val) {
    val = Math.round(parseFloat(val));
    if (isNaN(val) || val < 0) return;

    const bounds = S.mch1Bounds[mch1] || [0, 0, 0];
    const prices = S.data.filter(d => d.mch1 === mch1).map(d => d.price);
    const max = prices.length ? Math.max(...prices) : 10000;

    if (idx === 0) {
        bounds[0] = Math.min(val, bounds[1]);
    } else if (idx === 1) {
        bounds[1] = Math.max(bounds[0], Math.min(val, bounds[2]));
    } else if (idx === 2) {
        bounds[2] = Math.max(bounds[1], Math.min(val, max));
    }

    S.mch1Bounds[mch1] = bounds;
    propagateBounds(mch1, bounds);
    updateAll();
}

function onLinkChange(mch1, checked) {
    S.mch1Linked[mch1] = checked;
    if (checked) {
        const linkedMch1s = getMCH1s().filter(m => S.mch1Linked[m] && m !== mch1);
        if (linkedMch1s.length > 0) {
            S.mch1Bounds[mch1] = [...S.mch1Bounds[linkedMch1s[0]]];
        }
    }
    updateAll();
}

function onLinkToggle(mch1, e) {
    const cb = e.currentTarget.querySelector('input[type="checkbox"]');
    if (e.target === cb) return;
    cb.checked = !cb.checked;
    onLinkChange(mch1, cb.checked);
}

function switchTableView(mch1, mode) {
    S.tableView[mch1] = mode;
    updateAll();
}

function getFilteredData() {
    return S.data;
}

// ─── Table Builders ──────────────────────────────────────────
function buildSimpleTableContent(mch1, catData, bounds) {
    const tot = { sku: 0, amt: 0, qty: 0, profit: 0 };
    const results = {};
    TIERS.forEach(t => { results[t] = { sku: 0, amt: 0, qty: 0, profit: 0 }; });

    catData.forEach(d => {
        const tier = assignTier(d.price, bounds);
        results[tier].sku++;
        results[tier].amt += d.saleAmt;
        results[tier].qty += d.saleQty;
        results[tier].profit += d.profit;
        tot.sku++;
        tot.amt += d.saleAmt;
        tot.qty += d.saleQty;
        tot.profit += d.profit;
    });

    let html = '';
    const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

    TIERS.forEach(tier => {
        const data = results[tier];
        const skuShare = tot.sku ? (data.sku / tot.sku * 100) : 0;
        const amtShare = tot.amt ? (data.amt / tot.amt * 100) : 0;
        const ppr = data.qty ? (data.profit / data.qty) : 0;
        const ppc = data.amt ? (data.profit / data.amt) : 0;
        const bpr = data.qty ? (data.amt / data.qty) : 0;

        html += `
        <tr>
            <td><span class="badge-tier ${tier.toLowerCase()}">${tier}</span></td>
            <td style="font-size:.72rem;color:var(--text-mid);">${tierPriceRange(tier, bounds)}</td>
            <td>${fmt(data.sku)}</td>
            <td>${fmt(data.amt)}</td>
            <td>${fmt(data.qty)}</td>
            <td>${skuShare.toFixed(2)}%</td>
            <td>${amtShare.toFixed(2)}%</td>
            <td>${fmt(data.profit)}</td>
            <td>${fmt(Math.round(ppr))}</td>
            <td>${(ppc * 100).toFixed(2)}%</td>
            <td>${fmt(Math.round(bpr))}</td>
        </tr>`;
    });

    const gp = tot.qty ? (tot.profit / tot.qty) : 0;
    const gpc = tot.amt ? (tot.profit / tot.amt) : 0;
    const gbr = tot.qty ? (tot.amt / tot.qty) : 0;

    html += `
    <tr class="total-row">
        <td>Grand Total</td>
        <td></td>
        <td>${fmt(tot.sku)}</td>
        <td>${fmt(tot.amt)}</td>
        <td>${fmt(tot.qty)}</td>
        <td>100.00%</td>
        <td>100.00%</td>
        <td>${fmt(tot.profit)}</td>
        <td>${fmt(Math.round(gp))}</td>
        <td>${(gpc * 100).toFixed(2)}%</td>
        <td>${fmt(Math.round(gbr))}</td>
    </tr>`;

    return html;
}

function buildSummaryTableContent(mch1, catData, bounds) {
    const tot = { sku: 0, amt: 0, qty: 0, profit: 0 };
    const maxPrice = catData.length ? Math.max(...catData.map(d => d.price)) : 0;

    const results = {};
    TIERS.forEach(t => {
        results[t] = {
            'Private Brand': { sku: 0, amt: 0, qty: 0, profit: 0 },
            'Market Brand': { sku: 0, amt: 0, qty: 0, profit: 0 },
            'Total': { sku: 0, amt: 0, qty: 0, profit: 0 }
        };
    });

    catData.forEach(d => {
        const tier = assignTier(d.price, bounds);
        const brandType = d.flag === 'Private Brand' ? 'Private Brand' : 'Market Brand';

        results[tier][brandType].sku++;
        results[tier][brandType].amt += d.saleAmt;
        results[tier][brandType].qty += d.saleQty;
        results[tier][brandType].profit += d.profit;

        results[tier]['Total'].sku++;
        results[tier]['Total'].amt += d.saleAmt;
        results[tier]['Total'].qty += d.saleQty;
        results[tier]['Total'].profit += d.profit;

        tot.sku++;
        tot.amt += d.saleAmt;
        tot.qty += d.saleQty;
        tot.profit += d.profit;
    });

    let html = '';
    const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

    TIERS.forEach(tier => {
        const tierBg = TC[tier].bg;

        ['Market Brand', 'Private Brand', 'Total'].forEach((bType, idx) => {
            const data = results[tier][bType];

            const skuShare = tot.sku ? (data.sku / tot.sku * 100) : 0;
            const amtShare = tot.amt ? (data.amt / tot.amt * 100) : 0;
            const ppr = data.qty ? (data.profit / data.qty) : 0;
            const ppc = data.amt ? (data.profit / data.amt) : 0;
            const bpr = data.qty ? (data.amt / data.qty) : 0;

            if (bType === 'Total') {
                html += `
                <tr class="sub-group" style="background: ${tierBg}; font-weight: 600;">
                    <td>รวม ${tier}</td>
                    <td style="text-align:right">${fmt(data.sku)}</td>
                    <td style="text-align:right">${fmt(data.amt)}</td>
                    <td style="text-align:right">${fmt(data.qty)}</td>
                    <td>${skuShare.toFixed(2)}%</td>
                    <td>${amtShare.toFixed(2)}%</td>
                    <td>${fmt(data.profit)}</td>
                    <td>${fmt(Math.round(ppr))}</td>
                    <td>${(ppc * 100).toFixed(2)}%</td>
                    <td>${fmt(Math.round(bpr))}</td>
                </tr>
                `;
            } else {
                const isPrivate = bType === 'Private Brand';
                const flagClass = isPrivate ? 'flag-pb' : 'flag-mb';

                html += `
                <tr class="sub-brand">
                    ${idx === 0 ? `<td rowspan="3" style="vertical-align:middle;font-weight:bold;background:${tierBg};"><span class="badge-tier ${tier.toLowerCase()}">${tier}</span></td>` : ''}
                    ${idx === 0 ? `<td rowspan="3" style="font-size:.72rem;color:var(--text-mid);vertical-align:middle;background:${tierBg};">${tierPriceRange(tier, bounds)}</td>` : ''}
                    <td class="${flagClass}">${isPrivate ? '📌 Private Brand' : '🏷️ Market Brand'}</td>
                    <td style="text-align:right">${fmt(data.sku)}</td>
                    <td style="text-align:right">${fmt(data.amt)}</td>
                    <td style="text-align:right">${fmt(data.qty)}</td>
                    <td>${skuShare.toFixed(2)}%</td>
                    <td>${amtShare.toFixed(2)}%</td>
                    <td>${fmt(data.profit)}</td>
                    <td>${fmt(Math.round(ppr))}</td>
                    <td>${(ppc * 100).toFixed(2)}%</td>
                    <td>${fmt(Math.round(bpr))}</td>
                </tr>
                `;
            }
        });
    });

    const gp = tot.qty ? (tot.profit / tot.qty) : 0;
    const gpc = tot.amt ? (tot.profit / tot.amt) : 0;
    const gbr = tot.qty ? (tot.amt / tot.qty) : 0;

    html += `
    <tr class="total-row" style="background: #edf2f7; font-weight: bold;">
        <td colspan="2"></td>
        <td>Grand Total</td>
        <td style="text-align:right">${fmt(tot.sku)}</td>
        <td style="text-align:right">${fmt(tot.amt)}</td>
        <td style="text-align:right">${fmt(tot.qty)}</td>
        <td>100.00%</td>
        <td>100.00%</td>
        <td>${fmt(tot.profit)}</td>
        <td>${fmt(Math.round(gp))}</td>
        <td>${(gpc * 100).toFixed(2)}%</td>
        <td>${fmt(Math.round(gbr))}</td>
    </tr>
    `;

    return html;
}

function buildBrandTableContent(mch1, catData, bounds) {
    const tot = { sku: 0, amt: 0, qty: 0, profit: 0 };
    const results = {};
    TIERS.forEach(t => { results[t] = {}; });
    const tierBrandOrder = {};
    TIERS.forEach(t => { tierBrandOrder[t] = []; });

    catData.forEach(d => {
        const tier = assignTier(d.price, bounds);
        const b = d.brand;
        if (!results[tier][b]) { results[tier][b] = { sku: 0, amt: 0, qty: 0, profit: 0 }; tierBrandOrder[tier].push(b); }
        results[tier][b].sku++;
        results[tier][b].amt += d.saleAmt;
        results[tier][b].qty += d.saleQty;
        results[tier][b].profit += d.profit;
        tot.sku++; tot.amt += d.saleAmt; tot.qty += d.saleQty; tot.profit += d.profit;
    });

    let html = '';
    const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

    TIERS.forEach(tier => {
        const tierBg = TC[tier].bg;
        const brands = tierBrandOrder[tier];
        const rowCount = brands.length + 1;

        brands.forEach((brand, idx) => {
            const data = results[tier][brand];
            const skuShare = tot.sku ? (data.sku / tot.sku * 100) : 0;
            const amtShare = tot.amt ? (data.amt / tot.amt * 100) : 0;
            const ppr = data.qty ? (data.profit / data.qty) : 0;
            const ppc = data.amt ? (data.profit / data.amt) : 0;
            const bpr = data.qty ? (data.amt / data.qty) : 0;

            html += `<tr class="sub-brand">
                ${idx === 0 ? `<td rowspan="${rowCount}" style="vertical-align:middle;font-weight:bold;background:${tierBg};"><span class="badge-tier ${tier.toLowerCase()}">${tier}</span></td>` : ''}
                ${idx === 0 ? `<td rowspan="${rowCount}" style="font-size:.72rem;color:var(--text-mid);vertical-align:middle;background:${tierBg};">${tierPriceRange(tier, bounds)}</td>` : ''}
                <td>${brand}</td>
                <td style="text-align:right">${fmt(data.sku)}</td>
                <td style="text-align:right">${fmt(data.amt)}</td>
                <td style="text-align:right">${fmt(data.qty)}</td>
                <td>${skuShare.toFixed(2)}%</td>
                <td>${amtShare.toFixed(2)}%</td>
                <td>${fmt(data.profit)}</td>
                <td>${fmt(Math.round(ppr))}</td>
                <td>${(ppc * 100).toFixed(2)}%</td>
                <td>${fmt(Math.round(bpr))}</td>
            </tr>`;
        });

        const tierTot = { sku: 0, amt: 0, qty: 0, profit: 0 };
        brands.forEach(b => { const d = results[tier][b]; tierTot.sku += d.sku; tierTot.amt += d.amt; tierTot.qty += d.qty; tierTot.profit += d.profit; });
        const ts = tot.sku ? (tierTot.sku / tot.sku * 100) : 0;
        const ta = tot.amt ? (tierTot.amt / tot.amt * 100) : 0;
        const tp = tierTot.qty ? (tierTot.profit / tierTot.qty) : 0;
        const tc2 = tierTot.amt ? (tierTot.profit / tierTot.amt) : 0;
        const tb = tierTot.qty ? (tierTot.amt / tierTot.qty) : 0;

        html += `<tr class="sub-group" style="background:${tierBg};font-weight:600;">
            <td>รวม ${tier}</td>
            <td style="text-align:right">${fmt(tierTot.sku)}</td>
            <td style="text-align:right">${fmt(tierTot.amt)}</td>
            <td style="text-align:right">${fmt(tierTot.qty)}</td>
            <td>${ts.toFixed(2)}%</td>
            <td>${ta.toFixed(2)}%</td>
            <td>${fmt(tierTot.profit)}</td>
            <td>${fmt(Math.round(tp))}</td>
            <td>${(tc2 * 100).toFixed(2)}%</td>
            <td>${fmt(Math.round(tb))}</td>
        </tr>`;
    });

    const gp = tot.qty ? (tot.profit / tot.qty) : 0;
    const gpc = tot.amt ? (tot.profit / tot.amt) : 0;
    const gbr = tot.qty ? (tot.amt / tot.qty) : 0;
    html += `<tr class="total-row" style="background:#edf2f7;font-weight:bold;">
        <td colspan="2"></td><td>Grand Total</td>
        <td style="text-align:right">${fmt(tot.sku)}</td><td style="text-align:right">${fmt(tot.amt)}</td><td style="text-align:right">${fmt(tot.qty)}</td>
        <td>100.00%</td><td>100.00%</td><td>${fmt(tot.profit)}</td><td>${fmt(Math.round(gp))}</td>
        <td>${(gpc * 100).toFixed(2)}%</td><td>${fmt(Math.round(gbr))}</td>
    </tr>`;
    return html;
}

// ─── Render Summary ──────────────────────────────────────────
function renderSummary() {
    const activeMch1s = getActiveMCH1s();
    const container = document.getElementById('summaryContainer');

    if (activeMch1s.length === 0) {
        container.innerHTML = `<div class="card" style="text-align: center; color: var(--text-light); padding: 40px;">ไม่มีข้อมูล — กรุณาเลือก Worksheet และ map column ใน ⚙️ Settings</div>`;
        return;
    }

    let html = '';
    activeMch1s.forEach(m => {
        const catData = getFilteredData().filter(d => d.mch1 === m);
        const prices = catData.map(d => d.price);
        const max = prices.length ? Math.max(...prices) : 10000;
        const bounds = getActiveBounds(m);
        const b0 = bounds[0];
        const b1 = bounds[1];
        const b2 = bounds[2];

        const view = S.tableView[m] || 'simple';
        let tableContent;
        if (view === 'simple') tableContent = buildSimpleTableContent(m, catData, bounds);
        else if (view === 'detailed') tableContent = buildSummaryTableContent(m, catData, bounds);
        else tableContent = buildBrandTableContent(m, catData, bounds);

        html += `
        <div class="card" style="margin-bottom: 24px;">
            <div class="mch1-title">
                <div class="mch1-icon"></div>
                <span style="font-size: 1.1rem; color: var(--text)">หมวดหมู่: <b>${m}</b> (${catData.length} SKU)</span>
                <label class="link-cb ${S.mch1Linked[m] ? 'active' : ''}" onclick="onLinkToggle('${m}', event)">
                    <input type="checkbox" ${S.mch1Linked[m] ? 'checked' : ''}>
                    🔗 เชื่อมโยงเกณฑ์ราคากลาง
                </label>
            </div>

            <div class="tier-ctrl" data-mch1="${m}">
                <div class="tier-ctrl-label">🎛️ ช่วงราคา (ECO → MASS → PREMIUM → LUXURY) — ลากจุดกลมเพื่อปรับ</div>
                <div class="slider-labels" style="position: relative; height: 18px; margin-bottom: 4px;">
                    <span style="left: 0%; position: absolute;">฿0</span>
                    <span class="lbl-eco" style="left: ${b0/max*100}%; position: absolute; transform: translateX(-50%); color: var(--eco); font-weight: 600;">ECO: ฿${b0.toLocaleString()}</span>
                    <span class="lbl-mass" style="left: ${b1/max*100}%; position: absolute; transform: translateX(-50%); color: var(--mass); font-weight: 600;">MASS: ฿${b1.toLocaleString()}</span>
                    <span class="lbl-prem" style="left: ${b2/max*100}%; position: absolute; transform: translateX(-50%); color: var(--premium); font-weight: 600;">PREM: ฿${b2.toLocaleString()}</span>
                    <span style="right: 0%; position: absolute;">Max: ฿${max.toLocaleString()}</span>
                </div>
                <div class="slider-bar" data-mch1="${m}" data-max="${max}" style="position: relative; height: 40px; background: #e2e8f0; border-radius: 6px; overflow: visible;">
                    <div class="slider-track" style="position: absolute; top:14px; left:0; right:0; height: 12px; display: flex; border-radius: 6px; overflow: hidden;">
                        <div class="seg" style="width: ${b0/max*100}%; background: var(--eco-bg); height: 100%;"></div>
                        <div class="seg" style="width: ${(b1-b0)/max*100}%; background: var(--mass-bg); height: 100%;"></div>
                        <div class="seg" style="width: ${(b2-b1)/max*100}%; background: var(--premium-bg); height: 100%;"></div>
                        <div class="seg" style="width: ${(max-b2)/max*100}%; background: var(--luxury-bg); height: 100%;"></div>
                    </div>
                    <div class="slider-handle h-eco" data-idx="0" style="left:${b0/max*100}%" onmousedown="startSliderDrag(event,'${m}',0)"></div>
                    <div class="slider-handle h-mass" data-idx="1" style="left:${b1/max*100}%" onmousedown="startSliderDrag(event,'${m}',1)"></div>
                    <div class="slider-handle h-prem" data-idx="2" style="left:${b2/max*100}%" onmousedown="startSliderDrag(event,'${m}',2)"></div>
                </div>

                <div class="abs-inputs">
                    <div class="ai">
                        <div class="ai-dot" style="background: var(--eco)"></div>
                        <span class="ai-label">Max ECO</span>
                        <input type="number" min="0" max="${b1}" value="${b0}" onchange="onAbsInput('${m}', 0, this.value)">
                    </div>
                    <div class="ai">
                        <div class="ai-dot" style="background: var(--mass)"></div>
                        <span class="ai-label">Max MASS</span>
                        <input type="number" min="${b0}" max="${b2}" value="${b1}" onchange="onAbsInput('${m}', 1, this.value)">
                    </div>
                    <div class="ai">
                        <div class="ai-dot" style="background: var(--premium)"></div>
                        <span class="ai-label">Max PREMIUM</span>
                        <input type="number" min="${b1}" max="${max}" value="${b2}" onchange="onAbsInput('${m}', 2, this.value)">
                    </div>
                    <div class="ai">
                        <div class="ai-dot" style="background: var(--luxury)"></div>
                        <span class="ai-label">Max LUXURY</span>
                        <input type="number" value="${max}" disabled>
                    </div>
                </div>
            </div>

            <div class="tab-bar" style="margin-top:14px;display:inline-flex;">
                <button class="tab-btn ${view === 'simple' ? 'active' : ''}" onclick="switchTableView('${m}','simple')">สรุปรวม</button>
                <button class="tab-btn ${view === 'detailed' ? 'active' : ''}" onclick="switchTableView('${m}','detailed')">Private Brand</button>
                <button class="tab-btn ${view === 'brand' ? 'active' : ''}" onclick="switchTableView('${m}','brand')">Brand</button>
            </div>
            <div style="overflow-x: auto;">
                <table class="sum-table">
                    <thead>
                        <tr>${view === 'simple'
                            ? '<th>ระดับราคา (Tier)</th><th>ช่วงราคา</th><th>SKU Count</th><th>Sale Amt (฿)</th><th>Sale Qty</th><th>% SKU Share</th><th>% Sale Share</th><th>Profit (฿)</th><th>Profit/Item</th><th>Margin%</th><th>Avg Price/Item</th>'
                            : view === 'detailed'
                            ? '<th>ระดับราคา (Tier)</th><th>ช่วงราคา</th><th>ประเภทแบรนด์</th><th>SKU Count</th><th>Sale Amt (฿)</th><th>Sale Qty</th><th>% SKU Share</th><th>% Sale Share</th><th>Profit (฿)</th><th>Profit/Item</th><th>Margin%</th><th>Avg Price/Item</th>'
                            : '<th>ระดับราคา (Tier)</th><th>ช่วงราคา</th><th>Brand</th><th>SKU Count</th><th>Sale Amt (฿)</th><th>Sale Qty</th><th>% SKU Share</th><th>% Sale Share</th><th>Profit (฿)</th><th>Profit/Item</th><th>Margin%</th><th>Avg Price/Item</th>'
                        }</tr>
                    </thead>
                    <tbody>
                        ${tableContent}
                    </tbody>
                </table>
            </div>
        </div>
        `;
    });

    container.innerHTML = html;
}

// ─── Render Charts ───────────────────────────────────────────
function renderCharts() {
    const counts = { ECO: 0, MASS: 0, PREMIUM: 0, LUXURY: 0 };
    const sales  = { ECO: 0, MASS: 0, PREMIUM: 0, LUXURY: 0 };
    const profits = { ECO: 0, MASS: 0, PREMIUM: 0, LUXURY: 0 };

    const activeMch1s = getActiveMCH1s();
    const activeData = getFilteredData().filter(d => activeMch1s.includes(d.mch1));

    activeData.forEach(d => {
        const tier = getSKUTier(d);
        counts[tier]++;
        sales[tier] += d.saleAmt;
        profits[tier] += d.profit;
    });

    const labels = TIERS;
    const bgColors = TIERS.map(t => TC[t].c);

    // SKU Count Chart
    if (charts.bar) charts.bar.destroy();
    const barCtx = document.getElementById('chartBar').getContext('2d');
    charts.bar = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'SKU Count',
                data: TIERS.map(t => counts[t]),
                backgroundColor: bgColors,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, grid: { color: '#f0f0f0' } },
                x: { grid: { display: false } }
            }
        }
    });

    // Revenue Share Donut
    if (charts.donut) charts.donut.destroy();
    const donutCtx = document.getElementById('chartDonut').getContext('2d');
    charts.donut = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: TIERS.map(t => sales[t]),
                backgroundColor: bgColors
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } }
            }
        }
    });

    // Profit margin% by Tier
    const margins = TIERS.map(t => sales[t] ? (profits[t] / sales[t] * 100) : 0);
    if (charts.profit) charts.profit.destroy();
    const profitCtx = document.getElementById('chartProfit').getContext('2d');
    charts.profit = new Chart(profitCtx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Margin %',
                data: margins,
                backgroundColor: TIERS.map(t => TC[t].c + 'CC'),
                borderColor: bgColors,
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { callback: v => v + '%' },
                    grid: { color: '#f0f0f0' }
                },
                x: { grid: { display: false } }
            }
        }
    });
}

// ─── Render Detail Table ─────────────────────────────────────
function renderDetail() {
    const search = document.getElementById('searchBox').value.toLowerCase();

    let filtered = getFilteredData();

    const activeMch3s = getActiveMCH3s();
    filtered = filtered.filter(d => activeMch3s.includes(d.mch3));

    if (S.mch1Sel.size > 0) {
        filtered = filtered.filter(d => S.mch1Sel.has(d.mch1));
    }

    if (search) {
        filtered = filtered.filter(d =>
            d.sku.toLowerCase().includes(search) ||
            d.product.toLowerCase().includes(search) ||
            d.mch3.toLowerCase().includes(search) ||
            d.mch1.toLowerCase().includes(search) ||
            d.brand.toLowerCase().includes(search)
        );
    }

    if (S.dFilter !== 'ALL') {
        filtered = filtered.filter(d => getSKUTier(d) === S.dFilter);
    }

    if (S.sortCol) {
        filtered.sort((a, b) => {
            let valA = a[S.sortCol];
            let valB = b[S.sortCol];
            if (S.sortCol === 'tier') {
                valA = getSKUTier(a);
                valB = getSKUTier(b);
            }
            if (typeof valA === 'string') {
                return S.sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else {
                return S.sortDir === 'asc' ? valA - valB : valB - valA;
            }
        });
    }

    document.getElementById('rowCount').textContent = filtered.length.toLocaleString();

    const tbody = document.getElementById('dBody');
    let html = '';
    const fmt = n => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

    filtered.forEach(d => {
        const tier = getSKUTier(d);
        html += `
        <tr>
            <td>${d.sku}</td>
            <td><b>${d.product}</b></td>
            <td>${d.mch3}</td>
            <td>${d.mch1}</td>
            <td>${d.brand} <span style="font-size: 0.72rem; color: var(--text-light);">(${d.flag})</span></td>
            <td>฿${fmt(d.price)}</td>
            <td>฿${fmt(d.saleAmt)}</td>
            <td>${fmt(d.saleQty)}</td>
            <td>฿${fmt(d.profit)}</td>
            <td><span class="badge-tier ${tier.toLowerCase()}">${tier}</span></td>
        </tr>
        `;
    });

    tbody.innerHTML = html;
}

function sortD(col) {
    if (S.sortCol === col) {
        S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
        S.sortCol = col;
        S.sortDir = 'asc';
    }
    renderDetail();
}

function setDFilter(tier) {
    S.dFilter = tier;
    document.querySelectorAll('.tbl-controls .f-chip').forEach(btn => {
        btn.classList.remove('sel');
        if (btn.getAttribute('data-f') === tier) {
            btn.classList.add('sel');
        }
    });
    renderDetail();
}

// ─── Export ──────────────────────────────────────────────────
function exportSummary() {
    const activeMch1s = getActiveMCH1s();
    if (!activeMch1s.length) return;

    let csv = '﻿';

    activeMch1s.forEach(m => {
        const catData = getFilteredData().filter(d => d.mch1 === m);
        const bounds = getActiveBounds(m);
        const view = S.tableView[m] || 'simple';

        csv += `\nหมวดหมู่: ${m} (${catData.length} SKU)\n`;
        csv += `ช่วงราคา,ECO < ฿${bounds[0].toLocaleString()},MASS ฿${bounds[0].toLocaleString()}-${bounds[1].toLocaleString()},PREMIUM ฿${bounds[1].toLocaleString()}-${bounds[2].toLocaleString()},LUXURY > ฿${bounds[2].toLocaleString()}\n\n`;

        if (view === 'brand') {
            csv += 'Tier,ช่วงราคา,Brand,SKU Count,Sale Amt (฿),Sale Qty,% SKU Share,% Sale Share,Profit (฿),Profit/Item,Margin%,Avg Price/Item\n';
            TIERS.forEach(tier => {
                const brands = [...new Set(catData.filter(d => assignTier(d.price, bounds) === tier).map(d => d.brand))];
                const tierData = catData.filter(d => assignTier(d.price, bounds) === tier);
                const totS = tierData.length, totA = tierData.reduce((s,d)=>s+d.saleAmt,0);
                brands.forEach(b => {
                    const bd = tierData.filter(d => d.brand === b);
                    const sku = bd.length, amt = bd.reduce((s,d)=>s+d.saleAmt,0), qty = bd.reduce((s,d)=>s+d.saleQty,0), pf = bd.reduce((s,d)=>s+d.profit,0);
                    const ts = catData.length ? (sku/catData.length*100) : 0;
                    const as = catData.reduce((s,d)=>s+d.saleAmt,0) ? (amt/catData.reduce((s,d)=>s+d.saleAmt,0)*100) : 0;
                    csv += `${tier},${tierPriceRange(tier,bounds).replace(/<[^>]*>/g,'')},${b},${sku},${amt},${qty},${ts.toFixed(2)}%,${as.toFixed(2)}%,${pf},${qty?Math.round(pf/qty):0},${amt?(pf/amt*100).toFixed(2):0}%,${qty?Math.round(amt/qty):0}\n`;
                });
                const ts2 = catData.length ? (totS/catData.length*100) : 0;
                const as2 = catData.reduce((s,d)=>s+d.saleAmt,0) ? (totA/catData.reduce((s,d)=>s+d.saleAmt,0)*100) : 0;
                const tQty = tierData.reduce((s,d)=>s+d.saleQty,0), tPf = tierData.reduce((s,d)=>s+d.profit,0);
                csv += `${tier},${tierPriceRange(tier,bounds).replace(/<[^>]*>/g,'')},รวม ${tier},${totS},${totA},${tQty},${ts2.toFixed(2)}%,${as2.toFixed(2)}%,${tPf},${tQty?Math.round(tPf/tQty):0},${totA?(tPf/totA*100).toFixed(2):0}%,${tQty?Math.round(totA/tQty):0}\n`;
            });
        } else {
            const cols = view === 'simple'
                ? 'Tier,ช่วงราคา,SKU Count,Sale Amt (฿),Sale Qty,% SKU Share,% Sale Share,Profit (฿),Profit/Item,Margin%,Avg Price/Item\n'
                : 'Tier,ช่วงราคา,ประเภทแบรนด์,SKU Count,Sale Amt (฿),Sale Qty,% SKU Share,% Sale Share,Profit (฿),Profit/Item,Margin%,Avg Price/Item\n';
            csv += cols;

            const tot = { sku: catData.length, amt: catData.reduce((s,d)=>s+d.saleAmt,0), qty: catData.reduce((s,d)=>s+d.saleQty,0), profit: catData.reduce((s,d)=>s+d.profit,0) };
            TIERS.forEach(tier => {
                const td = catData.filter(d => assignTier(d.price, bounds) === tier);
                if (view === 'simple') {
                    const sku=td.length, amt=td.reduce((s,d)=>s+d.saleAmt,0), qty=td.reduce((s,d)=>s+d.saleQty,0), pf=td.reduce((s,d)=>s+d.profit,0);
                    csv += `${tier},${tierPriceRange(tier,bounds).replace(/<[^>]*>/g,'')},${sku},${amt},${qty},${tot.sku?(sku/tot.sku*100).toFixed(2):0}%,${tot.amt?(amt/tot.amt*100).toFixed(2):0}%,${pf},${qty?Math.round(pf/qty):0},${amt?(pf/amt*100).toFixed(2):0}%,${qty?Math.round(amt/qty):0}\n`;
                } else {
                    ['Market Brand','Private Brand'].forEach(bt => {
                        const bd = td.filter(d => (bt==='Private Brand') === ['DARA','BATH&BATH','GELATO BATH','PREMA'].includes(d.brand));
                        const sku=bd.length, amt=bd.reduce((s,d)=>s+d.saleAmt,0), qty=bd.reduce((s,d)=>s+d.saleQty,0), pf=bd.reduce((s,d)=>s+d.profit,0);
                        csv += `${tier},${tierPriceRange(tier,bounds).replace(/<[^>]*>/g,'')},${bt},${sku},${amt},${qty},${tot.sku?(sku/tot.sku*100).toFixed(2):0}%,${tot.amt?(amt/tot.amt*100).toFixed(2):0}%,${pf},${qty?Math.round(pf/qty):0},${amt?(pf/amt*100).toFixed(2):0}%,${qty?Math.round(amt/qty):0}\n`;
                    });
                    const sku=td.length, amt=td.reduce((s,d)=>s+d.saleAmt,0), qty=td.reduce((s,d)=>s+d.saleQty,0), pf=td.reduce((s,d)=>s+d.profit,0);
                    csv += `${tier},${tierPriceRange(tier,bounds).replace(/<[^>]*>/g,'')},รวม ${tier},${sku},${amt},${qty},${tot.sku?(sku/tot.sku*100).toFixed(2):0}%,${tot.amt?(amt/tot.amt*100).toFixed(2):0}%,${pf},${qty?Math.round(pf/qty):0},${amt?(pf/amt*100).toFixed(2):0}%,${qty?Math.round(amt/qty):0}\n`;
                }
            });
            const gp=tot.qty?Math.round(tot.profit/tot.qty):0, gpc=tot.amt?(tot.profit/tot.amt*100).toFixed(2):0, gbr=tot.qty?Math.round(tot.amt/tot.qty):0;
            csv += `Grand Total,,${tot.sku},${tot.amt},${tot.qty},100.00%,100.00%,${tot.profit},${gp},${gpc}%,${gbr}\n`;
        }
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tier_summary_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportCSV() {
    if (!S.data.length) return;
    const activeMch1s = getActiveMCH1s();
    const filtered = getFilteredData().filter(d => activeMch1s.includes(d.mch1));
    let csv = '﻿SKU,Product,MCH3,MCH1,Brand,Flag,Price,Sale Amt,Sale Qty,Profit,Tier\n';
    filtered.forEach(d => {
        const tier = getSKUTier(d);
        csv += `${d.sku},"${d.product.replace(/"/g, '""')}",${d.mch3},${d.mch1},${d.brand},${d.flag},${d.price},${d.saleAmt},${d.saleQty},${d.profit},${tier}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `price_tier_segmentation_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── Reset Bounds ────────────────────────────────────────────
function resetBounds() {
    S.mch1Bounds = {};
    S.mch1Linked = {};
    S.tableView = {};
    S.dFilter = 'ALL';
    S.sortCol = null;
    S.sortDir = 'asc';
    initBounds();
    updateAll();
}

// ─── Master Update ───────────────────────────────────────────
function updateAll() {
    renderDropdownMCH3();
    renderDropdown();
    renderSummary();
    renderCharts();
    renderDetail();
}
