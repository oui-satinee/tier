// ═══════════════════════════════════════════════════════════════
// Price Tier Segmentation Tool — Configuration Dialog
// config.js
// ═══════════════════════════════════════════════════════════════

/* global tableau */

// Fields that the extension needs from the worksheet
const REQUIRED_FIELDS = [
    { key: 'sku',      label: 'SKU / Item Code',   required: false },
    { key: 'product',  label: 'Product Name',       required: false },
    { key: 'mch3',     label: 'MCH3 (หมวด)',        required: false },
    { key: 'mch1',     label: 'MCH1 (กลุ่มสินค้า)',   required: true  },
    { key: 'brand',    label: 'Brand',               required: false },
    { key: 'flag',     label: 'Brand Type (Flag)',   required: false },
    { key: 'price',    label: 'Price',               required: true  },
    { key: 'saleAmt',  label: 'Sale Amount',         required: true  },
    { key: 'saleQty',  label: 'Sale Quantity',       required: true  },
    { key: 'profit',   label: 'Profit',              required: false }
];

// Possible aliases for auto-detection
const COLUMN_ALIASES = {
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

let currentColumns = [];
let autoDetected = {};

// ─── Helpers ─────────────────────────────────────────────────
function normalize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function stripAgg(fieldName) {
    const m = fieldName.match(/^(?:SUM|AVG|MIN|MAX|COUNT|ATTR|AGG)\s*\(\s*(.+?)\s*\)$/i);
    return m ? m[1] : fieldName;
}

function autoDetectColumns(columns) {
    const detected = {};
    const used = new Set();

    for (let i = 0; i < columns.length; i++) {
        const raw = columns[i].getFieldName
            ? columns[i].getFieldName()
            : (columns[i].fieldCaption || columns[i].fieldName || '');
        const stripped = stripAgg(raw);
        const norm = normalize(stripped);

        for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
            if (detected[field] !== undefined) continue;
            if (aliases.some(a => norm === a || norm.includes(a))) {
                detected[field] = i;
                used.add(i);
                break;
            }
        }
    }

    return detected;
}

// ─── Initialization ──────────────────────────────────────────
tableau.extensions.initializeDialogAsync().then(() => {
    const settings = tableau.extensions.settings;
    const savedWs = settings.get('worksheetName') || '';
    const savedMapping = settings.get('columnMapping');
    const savedMappingObj = savedMapping ? JSON.parse(savedMapping) : null;

    // Populate worksheet dropdown
    const dashboard = tableau.extensions.dashboardContent.dashboard;
    const worksheets = dashboard.worksheets;
    const wsSelect = document.getElementById('worksheetSelect');

    worksheets.forEach(ws => {
        const opt = document.createElement('option');
        opt.value = ws.name;
        opt.textContent = ws.name;
        if (ws.name === savedWs) opt.selected = true;
        wsSelect.appendChild(opt);
    });

    // If a worksheet was previously selected, trigger column loading
    if (savedWs) {
        onWorksheetChange(savedMappingObj);
    }

    // Listen for worksheet change
    wsSelect.addEventListener('change', () => {
        onWorksheetChange(null);
    });
}).catch(err => {
    console.error('Dialog init failed:', err);
});

async function onWorksheetChange(savedMapping) {
    const wsName = document.getElementById('worksheetSelect').value;
    const mappingSection = document.getElementById('mappingSection');
    const saveBtn = document.getElementById('saveBtn');

    if (!wsName) {
        mappingSection.style.display = 'none';
        saveBtn.disabled = true;
        return;
    }

    // Get columns from selected worksheet
    try {
        const dashboard = tableau.extensions.dashboardContent.dashboard;
        const ws = dashboard.worksheets.find(w => w.name === wsName);
        if (!ws) {
            mappingSection.style.display = 'none';
            saveBtn.disabled = true;
            return;
        }

        // Fetch summary data to get columns
        let dataTable;
        if (typeof ws.getSummaryDataReaderAsync === 'function') {
            const reader = await ws.getSummaryDataReaderAsync();
            dataTable = await reader.getPageAsync(0);
        } else {
            dataTable = await ws.getSummaryDataAsync();
        }

        currentColumns = dataTable.columns;
        autoDetected = autoDetectColumns(currentColumns);

        // Build mapping UI
        buildMappingUI(savedMapping);
        mappingSection.style.display = '';
        saveBtn.disabled = false;

    } catch (err) {
        console.error('Error loading columns:', err);
        mappingSection.style.display = 'none';
        saveBtn.disabled = true;
    }
}

function buildMappingUI(savedMapping) {
    const grid = document.getElementById('mappingGrid');
    grid.innerHTML = '';

    REQUIRED_FIELDS.forEach(field => {
        const item = document.createElement('div');
        item.className = 'mapping-item';

        const label = document.createElement('label');
        label.textContent = field.label + (field.required ? ' *' : '');
        item.appendChild(label);

        const select = document.createElement('select');
        select.id = 'map_' + field.key;

        // Empty option
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = '— ไม่ระบุ —';
        select.appendChild(emptyOpt);

        // Build column options
        currentColumns.forEach((col, idx) => {
            const colName = col.getFieldName
                ? col.getFieldName()
                : (col.fieldCaption || col.fieldName || `Column ${idx + 1}`);
            const opt = document.createElement('option');
            opt.value = colName;
            opt.textContent = colName;
            select.appendChild(opt);
        });

        // Set selected value: saved mapping → auto-detected → empty
        if (savedMapping && savedMapping[field.key]) {
            select.value = savedMapping[field.key];
        } else if (autoDetected[field.key] !== undefined) {
            const colName = currentColumns[autoDetected[field.key]].getFieldName
                ? currentColumns[autoDetected[field.key]].getFieldName()
                : (currentColumns[autoDetected[field.key]].fieldCaption || currentColumns[autoDetected[field.key]].fieldName || '');
            select.value = colName;
        }

        select.addEventListener('change', updateStatus);
        item.appendChild(select);
        grid.appendChild(item);
    });

    updateStatus();
}

function updateStatus() {
    const statusBar = document.getElementById('statusBar');
    const statusText = document.getElementById('statusText');

    let matched = 0;
    let requiredMatched = 0;
    let requiredTotal = 0;

    REQUIRED_FIELDS.forEach(field => {
        const select = document.getElementById('map_' + field.key);
        if (select && select.value) {
            matched++;
            if (field.required) requiredMatched++;
        }
        if (field.required) requiredTotal++;
    });

    statusBar.style.display = '';

    if (requiredMatched === requiredTotal) {
        statusBar.className = 'status-bar ok';
        statusText.textContent = `${matched}/${REQUIRED_FIELDS.length} columns matched — Required fields OK`;
    } else {
        statusBar.className = 'status-bar warn';
        statusText.textContent = `${matched}/${REQUIRED_FIELDS.length} columns matched — Required: ${requiredMatched}/${requiredTotal}`;
    }
}

// ─── Save & Close ────────────────────────────────────────────
function saveConfig() {
    const wsName = document.getElementById('worksheetSelect').value;
    if (!wsName) return;

    const mapping = {};
    REQUIRED_FIELDS.forEach(field => {
        const select = document.getElementById('map_' + field.key);
        if (select && select.value) {
            mapping[field.key] = select.value;
        }
    });

    tableau.extensions.settings.set('worksheetName', wsName);
    tableau.extensions.settings.set('columnMapping', JSON.stringify(mapping));

    tableau.extensions.settings.saveAsync().then(() => {
        tableau.extensions.ui.closeDialog('saved');
    }).catch(err => {
        console.error('Save failed:', err);
    });
}

function cancelConfig() {
    tableau.extensions.ui.closeDialog('cancelled');
}
