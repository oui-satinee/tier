// ═══════════════════════════════════════════════════════════════
// Price Tier Segmentation Tool — Tableau Dashboard Extension
// tier_segmentation.js
// ═══════════════════════════════════════════════════════════════

(function () {
  "use strict";

  /* global tableau, Chart */

  // ─── Constants ────────────────────────────────────────────
  var TIERS = ["ECO", "MASS", "PREMIUM", "LUXURY"];
  var TC = {
    ECO:     { c: "#27ae60", bg: "#eafaf1" },
    MASS:    { c: "#2980b9", bg: "#ebf5fb" },
    PREMIUM: { c: "#e67e22", bg: "#fef5e7" },
    LUXURY:  { c: "#8e44ad", bg: "#f5eef8" }
  };

  // ─── Column Auto-Detect ───────────────────────────────────
  var COLUMN_MAP = {
    sku:      ["sku", "skuid", "sku_id", "item_code", "itemcode", "product_code", "productcode"],
    product:  ["product", "product_name", "productname", "item_name", "itemname", "description"],
    mch3:     ["mch3", "category", "cat", "mch_3", "mch3_name", "category_name", "cat_name"],
    mch1:     ["mch1", "product_group", "prod_group", "mch_1", "mch1_name", "group", "subcategory"],
    brand:    ["brand", "brand_name", "brandname"],
    flag:     ["flag", "brand_type", "brandtype", "brand_flag", "type", "private_brand_flag"],
    price:    ["price", "unit_price", "unitprice", "selling_price", "sellingprice", "avg_price"],
    saleAmt:  ["sale_amt", "saleamt", "sales_amount", "salesamount", "revenue", "sales", "amount", "sale"],
    saleQty:  ["sale_qty", "saleqty", "sales_qty", "salesqty", "quantity", "qty", "units_sold", "unitssold"],
    profit:   ["profit", "gross_profit", "grossprofit", "margin_amount", "marginamount"]
  };

  function normalize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function stripAgg(fieldName) {
    var m = fieldName.match(/^(?:SUM|AVG|MIN|MAX|COUNT|CNT|ATTR|AGG)\s*\(\s*(.+?)\s*\)$/i);
    return m ? m[1] : fieldName;
  }

  function buildColumnIndex(columns) {
    var index = {};
    var used = {};

    for (var ci = 0; ci < columns.length; ci++) {
      if (used[ci]) continue;
      var raw = columns[ci].getFieldName
        ? columns[ci].getFieldName()
        : (columns[ci].fieldCaption || columns[ci].fieldName || "");

      // 4-tier matching (same as marketbasket)
      var stripped = stripAgg(raw);
      var normRaw  = normalize(raw);
      var normStr  = normalize(stripped);

      for (var field in COLUMN_MAP) {
        if (index[field] !== undefined) continue;
        var aliases = COLUMN_MAP[field];
        for (var ai = 0; ai < aliases.length; ai++) {
          var normAlias = normalize(aliases[ai]);
          if (normRaw === normAlias || normStr === normAlias ||
              normRaw.indexOf(normAlias) !== -1 || normStr.indexOf(normAlias) !== -1) {
            index[field] = ci;
            used[ci] = true;
            break;
          }
        }
        if (used[ci]) break;
      }
    }
    return index;
  }

  function parseNumber(val) {
    if (val === null || val === undefined) return 0;
    var n = typeof val === "number" ? val : parseFloat(String(val).replace(/[,$]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  function extractRecords(dataTable) {
    var colIndex = buildColumnIndex(dataTable.columns);
    console.log("[TierSeg] Columns detected:", colIndex);
    console.log("[TierSeg] Raw columns:", dataTable.columns.map(function (c, i) {
      return i + ": " + (c.getFieldName ? c.getFieldName() : (c.fieldCaption || c.fieldName || "?"));
    }));
    var rows = [];
    var data = dataTable.data;
    console.log("[TierSeg] Total raw rows:", data.length);
    if (data.length > 0) {
      console.log("[TierSeg] First row sample:", data[0].map(function (cell) {
        return { nativeValue: cell.nativeValue, value: cell.value };
      }));
    }

    for (var r = 0; r < data.length; r++) {
      var row = data[r];
      function get(field) {
        var ci = colIndex[field];
        if (ci === undefined) return "";
        var cell = row[ci];
        if (!cell) return "";
        return cell.nativeValue !== undefined ? cell.nativeValue : (cell.value !== undefined ? cell.value : "");
      }

      var price   = parseNumber(get("price"));
      var saleAmt = parseNumber(get("saleAmt"));
      var saleQty = parseNumber(get("saleQty"));

      if (price === 0 && saleAmt === 0 && saleQty === 0) continue;

      rows.push({
        sku:     String(get("sku") || "ROW-" + (r + 1)),
        product: String(get("product") || ""),
        mch3:    String(get("mch3") || ""),
        mch1:    String(get("mch1") || ""),
        brand:   String(get("brand") || ""),
        flag:    String(get("flag") || "Market Brand"),
        price:   price,
        saleAmt: saleAmt,
        saleQty: saleQty,
        profit:  parseNumber(get("profit"))
      });
    }
    return rows;
  }

  // ─── State ────────────────────────────────────────────────
  var S = {
    data: [],
    mch3Sel: {},
    mch1Sel: {},
    mch1Bounds: {},
    mch1Linked: {},
    tableView: {},
    dFilter: "ALL",
    sortCol: null,
    sortDir: "asc",
    ddOpen: false,
    dd3Open: false,
    worksheetName: ""
  };

  var charts = { bar: null, donut: null, profit: null };
  var unregisterFns = [];

  // Set helpers
  function setFrom(obj) {
    var keys = [];
    for (var k in obj) { if (obj[k]) keys.push(k); }
    return keys;
  }
  function setHas(obj, key) { return !!obj[key]; }
  function setAdd(obj, key) { obj[key] = true; }
  function setDel(obj, key) { delete obj[key]; }
  function setClear(obj) { for (var k in obj) delete obj[k]; }
  function setToggle(obj, key) { if (obj[key]) delete obj[key]; else obj[key] = true; }

  // ─── Data Index (performance) ─────────────────────────────
  var _idx = { byMch1: {}, byMch3: {}, mch1List: [], mch3List: [] };

  function rebuildIndex() {
    _idx.byMch1 = {};
    _idx.byMch3 = {};
    var m1 = {}, m3 = {};
    S.data.forEach(function (d) {
      if (!_idx.byMch1[d.mch1]) _idx.byMch1[d.mch1] = [];
      _idx.byMch1[d.mch1].push(d);
      if (!_idx.byMch3[d.mch3]) _idx.byMch3[d.mch3] = [];
      _idx.byMch3[d.mch3].push(d);
      m1[d.mch1] = true;
      m3[d.mch3] = true;
    });
    _idx.mch1List = Object.keys(m1).sort();
    _idx.mch3List = Object.keys(m3).sort();
  }

  function getDataForMch1(mch1) { return _idx.byMch1[mch1] || []; }

  function getActiveData() {
    var activeMch3s = getActiveMCH3s();
    var activeMch1s = getActiveMCH1s();
    var result = [];
    activeMch1s.forEach(function (m) {
      var items = _idx.byMch1[m] || [];
      items.forEach(function (d) {
        if (activeMch3s.indexOf(d.mch3) !== -1) result.push(d);
      });
    });
    return result;
  }

  // ─── UI Helpers ───────────────────────────────────────────
  function showLoading(msg) {
    document.getElementById("loadingOverlay").style.display = "";
    document.getElementById("loadingText").textContent = msg || "กำลังโหลดข้อมูลจาก Tableau...";
  }

  function hideLoading() {
    document.getElementById("loadingOverlay").style.display = "none";
  }

  function showError(msg) {
    document.getElementById("errorBanner").style.display = "";
    document.getElementById("errorText").textContent = msg;
  }

  function hideError() {
    document.getElementById("errorBanner").style.display = "none";
  }

  function showDashboard(show) {
    document.getElementById("ctrlBar").style.display        = show ? "" : "none";
    document.getElementById("chartsRow").style.display      = show ? "" : "none";
    document.getElementById("detailCard").style.display     = show ? "" : "none";
  }

  // ─── Tableau: Data Loading ────────────────────────────────
  function getSelectedWorksheet() {
    var dashboard = tableau.extensions.dashboardContent.dashboard;
    var name = S.worksheetName;
    if (!name) return null;
    var worksheets = dashboard.worksheets;
    for (var i = 0; i < worksheets.length; i++) {
      if (worksheets[i].name === name) return worksheets[i];
    }
    return null;
  }

  function loadWorksheetData() {
    var ws = getSelectedWorksheet();
    if (!ws) {
      showDashboard(false);
      hideLoading();
      showError("ไม่พบ Worksheet \"" + S.worksheetName + "\"");
      return;
    }

    showLoading("กำลังอ่านข้อมูลจาก Worksheet \"" + ws.name + "\"...");
    hideError();

    try {
      var dataPromise;

      // Primary: DataReader (handles large datasets with pagination)
      if (typeof ws.getSummaryDataReaderAsync === "function") {
        dataPromise = ws.getSummaryDataReaderAsync().then(function (reader) {
          var allData = [];
          var allColumns = null;
          var totalPages = reader.totalPageCount;

          function readPage(pageIndex) {
            return reader.getPageAsync(pageIndex).then(function (pageData) {
              if (!allColumns && pageData.columns) allColumns = pageData.columns;
              if (pageData && pageData.data) {
                for (var i = 0; i < pageData.data.length; i++) allData.push(pageData.data[i]);
              }
              showLoading("กำลังอ่านข้อมูล... " + allData.length + " rows (" + (pageIndex + 1) + "/" + totalPages + " pages)");
              if (pageIndex + 1 < totalPages) return readPage(pageIndex + 1);
              return { columns: allColumns, data: allData };
            });
          }

          return readPage(0).then(function (result) {
            return reader.releaseAsync().then(function () { return result; });
          });
        });
      } else if (typeof ws.getSummaryDataAsync === "function") {
        // Fallback: simpler API (may have row limits)
        dataPromise = ws.getSummaryDataAsync().then(function (dataTable) {
          return { columns: dataTable.columns, data: dataTable.data };
        });
      } else {
        showError("Worksheet does not support data reading API");
        hideLoading();
        return;
      }

      dataPromise.then(function (dataTable) {
        try {
          if (!dataTable || !dataTable.columns) {
            showError("ไม่สามารถอ่านข้อมูล — dataTable หรือ columns เป็น null");
            hideLoading();
            return;
          }

          var colNames = dataTable.columns.map(function (c, i) {
            return i + ": " + (c.getFieldName ? c.getFieldName() : (c.fieldCaption || c.fieldName || "?"));
          });

          var records = extractRecords(dataTable);

          if (records.length === 0) {
            showError("ไม่พบข้อมูลที่ extract ได้ (rows: " + dataTable.data.length + ") — columns: " + colNames.join(" | "));
            hideLoading();
            return;
          }

          // Reset state
          S.data = records;
          rebuildIndex();
          setClear(S.mch3Sel);
          setClear(S.mch1Sel);
          S.mch1Bounds = {};
          S.mch1Linked = {};
          S.tableView  = {};
          S.dFilter    = "ALL";
          S.sortCol    = null;
          S.sortDir    = "asc";

          hideError();
          hideLoading();
          showDashboard(true);
          initBounds();
          updateAll();

        } catch (innerErr) {
          showError("ข้อผิดพลาดในการประมวลผลข้อมูล: " + innerErr.message);
          hideLoading();
        }
      }).catch(function (err) {
        showError("ไม่สามารถโหลดข้อมูลจาก Worksheet: " + (err.message || err));
        hideLoading();
      });
    } catch (outerErr) {
      showError("ข้อผิดพลาด: " + outerErr.message);
      hideLoading();
    }
  }

  // ─── Tableau: Event Listeners ─────────────────────────────
  function registerFilterListeners() {
    // Unregister old listeners
    for (var i = 0; i < unregisterFns.length; i++) {
      unregisterFns[i]();
    }
    unregisterFns = [];

    var dashboard = tableau.extensions.dashboardContent.dashboard;
    dashboard.worksheets.forEach(function (ws) {
      var fn = function () {
        if (ws.name === S.worksheetName) {
          loadWorksheetData();
        }
      };
      var unregister1 = ws.addEventListener(tableau.TableauEventType.FilterChanged, fn);
      var unregister2 = ws.addEventListener(tableau.TableauEventType.SummaryDataChanged, fn);
      unregisterFns.push(unregister1);
      unregisterFns.push(unregister2);
    });
  }

  // ═══════════════════════════════════════════════════════════
  // BUSINESS LOGIC (reused from original)
  // ═══════════════════════════════════════════════════════════

  function getFilteredData() { return S.data; }

  function getMCH3s() { return _idx.mch3List; }

  function getActiveMCH3s() {
    var sel = setFrom(S.mch3Sel);
    return sel.length === 0 ? _idx.mch3List : sel;
  }

  function getMCH1s() {
    var activeMch3s = getActiveMCH3s();
    if (activeMch3s.length === _idx.mch3List.length) return _idx.mch1List;
    var seen = {};
    activeMch3s.forEach(function (m3) {
      var items = _idx.byMch3[m3] || [];
      items.forEach(function (d) { seen[d.mch1] = true; });
    });
    return Object.keys(seen).sort();
  }

  function getActiveMCH1s() {
    var activeMch3s = getActiveMCH3s();
    var available = getMCH1s();
    var sel = setFrom(S.mch1Sel);
    if (sel.length === 0) return available;
    return sel.filter(function (m) { return available.indexOf(m) !== -1; });
  }

  // ─── Bounds & Tier ────────────────────────────────────────
  function getPercentile(arr, p) {
    if (!arr.length) return 0;
    var idx = (arr.length - 1) * p;
    var base = Math.floor(idx);
    var rest = idx - base;
    if (arr[base + 1] !== undefined) return arr[base] + rest * (arr[base + 1] - arr[base]);
    return arr[base];
  }

  function calcDefaultBounds(mch1) {
    var prices = getDataForMch1(mch1).map(function (d) { return d.price; }).sort(function (a, b) { return a - b; });
    return [Math.round(getPercentile(prices, 0.25)), Math.round(getPercentile(prices, 0.50)), Math.round(getPercentile(prices, 0.75))];
  }

  function initBounds() {
    getMCH1s().forEach(function (m) {
      if (!S.mch1Bounds[m]) {
        S.mch1Bounds[m] = calcDefaultBounds(m);
        S.mch1Linked[m] = true;
      }
    });
  }

  function getActiveBounds(mch1) {
    if (!S.mch1Bounds[mch1]) S.mch1Bounds[mch1] = calcDefaultBounds(mch1);
    return S.mch1Bounds[mch1];
  }

  function propagateBounds(sourceMch1, bounds) {
    if (!S.mch1Linked[sourceMch1]) return;
    getMCH1s().forEach(function (m) {
      if (m !== sourceMch1 && S.mch1Linked[m]) S.mch1Bounds[m] = bounds.slice();
    });
  }

  function assignTier(price, bounds) {
    if (price >= bounds[2]) return "LUXURY";
    if (price >= bounds[1]) return "PREMIUM";
    if (price >= bounds[0]) return "MASS";
    return "ECO";
  }

  function getSKUTier(d) { return assignTier(d.price, getActiveBounds(d.mch1)); }

  function tierPriceRange(tier, bounds) {
    switch (tier) {
      case "ECO":     return "< ฿" + bounds[0].toLocaleString();
      case "MASS":    return "฿" + bounds[0].toLocaleString() + " - ฿" + bounds[1].toLocaleString();
      case "PREMIUM": return "฿" + bounds[1].toLocaleString() + " - ฿" + bounds[2].toLocaleString();
      case "LUXURY":  return "> ฿" + bounds[2].toLocaleString();
    }
  }

  // ─── Dropdowns ────────────────────────────────────────────
  function toggleDD3() {
    S.dd3Open = !S.dd3Open;
    document.getElementById("dd3Menu").classList.toggle("show", S.dd3Open);
    document.getElementById("dd3Toggle").classList.toggle("open", S.dd3Open);
  }

  function toggleDD() {
    S.ddOpen = !S.ddOpen;
    document.getElementById("ddMenu").classList.toggle("show", S.ddOpen);
    document.getElementById("ddToggle").classList.toggle("open", S.ddOpen);
  }

  function renderDropdownMCH3() {
    var mch3s = getMCH3s();
    var fd = getFilteredData();
    var sel = setFrom(S.mch3Sel);
    var allChecked = sel.length === 0 || sel.length === mch3s.length;

    document.getElementById("dd3Text").textContent = sel.length === 0 ? "เลือกทั้งหมด" : sel.join(", ");

    var html = '<div class="dd-opt all-opt" data-mch3="__all__"><input type="checkbox" ' + (allChecked ? "checked" : "") + '><span>เลือกทั้งหมด</span><span class="dd-count">' + fd.length + " SKU</span></div>";
    mch3s.forEach(function (m) {
      var checked = setHas(S.mch3Sel, m);
      var count = (_idx.byMch3[m] || []).length;
      html += '<div class="dd-opt" data-mch3="' + m + '"><input type="checkbox" ' + (checked ? "checked" : "") + "><span>" + m + "</span><span class=\"dd-count\">" + count + " SKU</span></div>";
    });
    document.getElementById("dd3Menu").innerHTML = html;
  }

  function renderDropdown() {
    var mch1s = getMCH1s();
    var activeMch3s = getActiveMCH3s();
    // Count per MCH1 filtered by active MCH3s using index
    var totalActive = 0;
    var countsByMch1 = {};
    activeMch3s.forEach(function (m3) {
      var items = _idx.byMch3[m3] || [];
      items.forEach(function (d) {
        if (!countsByMch1[d.mch1]) countsByMch1[d.mch1] = 0;
        countsByMch1[d.mch1]++;
        totalActive++;
      });
    });
    var sel = setFrom(S.mch1Sel);
    var allChecked = sel.length === 0 || sel.length === mch1s.length;

    document.getElementById("ddText").textContent = sel.length === 0 ? "เลือกทั้งหมด" : sel.join(", ");

    var html = '<div class="dd-opt all-opt" data-mch1="__all__"><input type="checkbox" ' + (allChecked ? "checked" : "") + '><span>เลือกทั้งหมด</span><span class="dd-count">' + totalActive + " SKU</span></div>";
    mch1s.forEach(function (m) {
      var checked = setHas(S.mch1Sel, m);
      var count = countsByMch1[m] || 0;
      html += '<div class="dd-opt" data-mch1="' + m + '"><input type="checkbox" ' + (checked ? "checked" : "") + "><span>" + m + "</span><span class=\"dd-count\">" + count + " SKU</span></div>";
    });
    document.getElementById("ddMenu").innerHTML = html;
  }

  // ─── Slider ───────────────────────────────────────────────
  var _drag = null;

  function startSliderDrag(e, mch1, idx) {
    e.preventDefault();
    e.stopPropagation();
    _drag = { mch1: mch1, idx: idx };
    e.target.classList.add("dragging");
    document.addEventListener("mousemove", doSliderDrag);
    document.addEventListener("mouseup", endSliderDrag);
    document.addEventListener("touchmove", doSliderDragTouch, { passive: false });
    document.addEventListener("touchend", endSliderDrag);
  }

  function doSliderDrag(e) {
    if (!_drag) return;
    var bar = document.querySelector('.slider-bar[data-mch1="' + _drag.mch1 + '"]');
    if (!bar) return;
    var rect = bar.getBoundingClientRect();
    var max = parseFloat(bar.dataset.max);
    if (max <= 0) return;
    var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    var val = Math.round(pct * max);

    var bounds = (S.mch1Bounds[_drag.mch1] || [0, 0, 0]).slice();
    if (_drag.idx === 0) bounds[0] = Math.min(val, bounds[1]);
    else if (_drag.idx === 1) bounds[1] = Math.max(bounds[0], Math.min(val, bounds[2]));
    else bounds[2] = Math.max(bounds[1], val);

    S.mch1Bounds[_drag.mch1] = bounds;
    updateSliderDOM(_drag.mch1, bounds, max);
    propagateBounds(_drag.mch1, bounds);
  }

  function doSliderDragTouch(e) {
    e.preventDefault();
    if (!_drag) return;
    var touch = e.touches[0];
    var bar = document.querySelector('.slider-bar[data-mch1="' + _drag.mch1 + '"]');
    if (!bar) return;
    var rect = bar.getBoundingClientRect();
    var max = parseFloat(bar.dataset.max);
    if (max <= 0) return;
    var pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    var val = Math.round(pct * max);

    var bounds = (S.mch1Bounds[_drag.mch1] || [0, 0, 0]).slice();
    if (_drag.idx === 0) bounds[0] = Math.min(val, bounds[1]);
    else if (_drag.idx === 1) bounds[1] = Math.max(bounds[0], Math.min(val, bounds[2]));
    else bounds[2] = Math.max(bounds[1], val);

    S.mch1Bounds[_drag.mch1] = bounds;
    updateSliderDOM(_drag.mch1, bounds, max);
    propagateBounds(_drag.mch1, bounds);
  }

  function endSliderDrag() {
    if (_drag) {
      document.querySelectorAll(".slider-handle.dragging").forEach(function (h) { h.classList.remove("dragging"); });
      var mch1 = _drag.mch1;
      _drag = null;
      document.removeEventListener("mousemove", doSliderDrag);
      document.removeEventListener("mouseup", endSliderDrag);
      document.removeEventListener("touchmove", doSliderDragTouch);
      document.removeEventListener("touchend", endSliderDrag);
      updateAll();
    }
  }

  function updateSliderDOM(mch1, bounds, max) {
    var tc = document.querySelector('.tier-ctrl[data-mch1="' + mch1 + '"]');
    if (!tc) return;
    var b0 = bounds[0], b1 = bounds[1], b2 = bounds[2];

    tc.querySelectorAll(".slider-handle").forEach(function (h) {
      var i = parseInt(h.dataset.idx);
      h.style.left = [b0, b1, b2][i] / max * 100 + "%";
    });
    var segs = tc.querySelectorAll(".slider-track .seg");
    if (segs.length === 4) {
      segs[0].style.width = b0 / max * 100 + "%";
      segs[1].style.width = (b1 - b0) / max * 100 + "%";
      segs[2].style.width = (b2 - b1) / max * 100 + "%";
      segs[3].style.width = (max - b2) / max * 100 + "%";
    }
    function lbl(cls, txt, left) {
      var el = tc.querySelector("." + cls);
      if (el) { el.textContent = txt; el.style.left = left + "%"; }
    }
    lbl("lbl-eco",  "ECO: ฿" + b0.toLocaleString(), b0 / max * 100);
    lbl("lbl-mass", "MASS: ฿" + b1.toLocaleString(), b1 / max * 100);
    lbl("lbl-prem", "PREM: ฿" + b2.toLocaleString(), b2 / max * 100);

    var ai = tc.querySelectorAll(".ai input:not([disabled])");
    if (ai[0]) { ai[0].value = b0; ai[0].max = b1; }
    if (ai[1]) { ai[1].value = b1; ai[1].min = b0; ai[1].max = b2; }
    if (ai[2]) { ai[2].value = b2; ai[2].min = b1; }
  }

  function onAbsInput(mch1, idx, val) {
    val = Math.round(parseFloat(val));
    if (isNaN(val) || val < 0) return;
    var bounds = (S.mch1Bounds[mch1] || [0, 0, 0]).slice();
    var prices = getDataForMch1(mch1).map(function (d) { return d.price; });
    var max = prices.length ? Math.max.apply(null, prices) : 10000;
    if (idx === 0) bounds[0] = Math.min(val, bounds[1]);
    else if (idx === 1) bounds[1] = Math.max(bounds[0], Math.min(val, bounds[2]));
    else bounds[2] = Math.max(bounds[1], Math.min(val, max));
    S.mch1Bounds[mch1] = bounds;
    propagateBounds(mch1, bounds);
    updateAll();
  }

  function onLinkToggle(mch1, cb) {
    S.mch1Linked[mch1] = cb.checked;
    if (cb.checked) {
      var linked = getMCH1s().filter(function (m) { return S.mch1Linked[m] && m !== mch1; });
      if (linked.length > 0) S.mch1Bounds[mch1] = S.mch1Bounds[linked[0]].slice();
    }
    updateAll();
  }

  // ─── Table Builders ───────────────────────────────────────
  var fmt = function (n) { return n.toLocaleString(undefined, { maximumFractionDigits: 0 }); };

  function buildSimpleTableContent(catData, bounds) {
    var tot = { sku: 0, amt: 0, qty: 0, profit: 0 };
    var results = {};
    TIERS.forEach(function (t) { results[t] = { sku: 0, amt: 0, qty: 0, profit: 0 }; });

    catData.forEach(function (d) {
      var tier = assignTier(d.price, bounds);
      results[tier].sku++; results[tier].amt += d.saleAmt; results[tier].qty += d.saleQty; results[tier].profit += d.profit;
      tot.sku++; tot.amt += d.saleAmt; tot.qty += d.saleQty; tot.profit += d.profit;
    });

    var html = "";
    TIERS.forEach(function (tier) {
      var d = results[tier];
      var ss = tot.sku ? (d.sku / tot.sku * 100) : 0;
      var as = tot.amt ? (d.amt / tot.amt * 100) : 0;
      html += "<tr><td><span class=\"badge-tier " + tier.toLowerCase() + "\">" + tier + "</span></td>"
        + "<td style=\"font-size:.72rem;color:var(--text-mid);\">" + tierPriceRange(tier, bounds) + "</td>"
        + "<td>" + fmt(d.sku) + "</td><td>" + fmt(d.amt) + "</td><td>" + fmt(d.qty) + "</td>"
        + "<td>" + ss.toFixed(2) + "%</td><td>" + as.toFixed(2) + "%</td>"
        + "<td>" + fmt(d.profit) + "</td>"
        + "<td>" + fmt(Math.round(d.qty ? d.profit / d.qty : 0)) + "</td>"
        + "<td>" + (d.amt ? d.profit / d.amt * 100 : 0).toFixed(2) + "%</td>"
        + "<td>" + fmt(Math.round(d.qty ? d.amt / d.qty : 0)) + "</td></tr>";
    });

    var gp = tot.qty ? tot.profit / tot.qty : 0;
    html += "<tr class=\"total-row\"><td>Grand Total</td><td></td>"
      + "<td>" + fmt(tot.sku) + "</td><td>" + fmt(tot.amt) + "</td><td>" + fmt(tot.qty) + "</td>"
      + "<td>100.00%</td><td>100.00%</td>"
      + "<td>" + fmt(tot.profit) + "</td><td>" + fmt(Math.round(gp)) + "</td>"
      + "<td>" + (tot.amt ? tot.profit / tot.amt * 100 : 0).toFixed(2) + "%</td>"
      + "<td>" + fmt(Math.round(tot.qty ? tot.amt / tot.qty : 0)) + "</td></tr>";
    return html;
  }

  function buildSummaryTableContent(catData, bounds) {
    var tot = { sku: 0, amt: 0, qty: 0, profit: 0 };
    var results = {};
    TIERS.forEach(function (t) { results[t] = { pb: { sku: 0, amt: 0, qty: 0, profit: 0 }, mb: { sku: 0, amt: 0, qty: 0, profit: 0 }, total: { sku: 0, amt: 0, qty: 0, profit: 0 } }; });

    catData.forEach(function (d) {
      var tier = assignTier(d.price, bounds);
      var flagLower = (d.flag || "").toLowerCase();
      var bt = (flagLower.indexOf("private") !== -1 || flagLower.indexOf("pb") !== -1) ? "pb" : "mb";
      results[tier][bt].sku++; results[tier][bt].amt += d.saleAmt; results[tier][bt].qty += d.saleQty; results[tier][bt].profit += d.profit;
      results[tier].total.sku++; results[tier].total.amt += d.saleAmt; results[tier].total.qty += d.saleQty; results[tier].total.profit += d.profit;
      tot.sku++; tot.amt += d.saleAmt; tot.qty += d.saleQty; tot.profit += d.profit;
    });

    var html = "";
    TIERS.forEach(function (tier) {
      var bg = TC[tier].bg;
      var types = [{ key: "mb", label: "🏷️ Market Brand", cls: "flag-mb" }, { key: "pb", label: "📌 Private Brand", cls: "flag-pb" }, { key: "total", label: "รวม " + tier, cls: null }];
      types.forEach(function (bt, idx) {
        var d = results[tier][bt.key];
        var ss = tot.sku ? (d.sku / tot.sku * 100) : 0;
        var as = tot.amt ? (d.amt / tot.amt * 100) : 0;
        if (bt.key === "total") {
          html += "<tr class=\"sub-group\" style=\"background:" + bg + ";font-weight:600;\"><td>รวม " + tier + "</td>"
            + "<td style=\"text-align:right\">" + fmt(d.sku) + "</td><td style=\"text-align:right\">" + fmt(d.amt) + "</td><td style=\"text-align:right\">" + fmt(d.qty) + "</td>"
            + "<td>" + ss.toFixed(2) + "%</td><td>" + as.toFixed(2) + "%</td>"
            + "<td>" + fmt(d.profit) + "</td><td>" + fmt(Math.round(d.qty ? d.profit / d.qty : 0)) + "</td>"
            + "<td>" + (d.amt ? d.profit / d.amt * 100 : 0).toFixed(2) + "%</td>"
            + "<td>" + fmt(Math.round(d.qty ? d.amt / d.qty : 0)) + "</td></tr>";
        } else {
          html += "<tr class=\"sub-brand\">"
            + (idx === 0 ? "<td rowspan=\"3\" style=\"vertical-align:middle;font-weight:bold;background:" + bg + ";\"><span class=\"badge-tier " + tier.toLowerCase() + "\">" + tier + "</span></td>"
              + "<td rowspan=\"3\" style=\"font-size:.72rem;color:var(--text-mid);vertical-align:middle;background:" + bg + ";\">" + tierPriceRange(tier, bounds) + "</td>" : "")
            + "<td class=\"" + bt.cls + "\">" + bt.label + "</td>"
            + "<td style=\"text-align:right\">" + fmt(d.sku) + "</td><td style=\"text-align:right\">" + fmt(d.amt) + "</td><td style=\"text-align:right\">" + fmt(d.qty) + "</td>"
            + "<td>" + ss.toFixed(2) + "%</td><td>" + as.toFixed(2) + "%</td>"
            + "<td>" + fmt(d.profit) + "</td><td>" + fmt(Math.round(d.qty ? d.profit / d.qty : 0)) + "</td>"
            + "<td>" + (d.amt ? d.profit / d.amt * 100 : 0).toFixed(2) + "%</td>"
            + "<td>" + fmt(Math.round(d.qty ? d.amt / d.qty : 0)) + "</td></tr>";
        }
      });
    });

    var gp = tot.qty ? tot.profit / tot.qty : 0;
    html += "<tr class=\"total-row\" style=\"background:#edf2f7;font-weight:bold;\"><td colspan=\"2\"></td><td>Grand Total</td>"
      + "<td style=\"text-align:right\">" + fmt(tot.sku) + "</td><td style=\"text-align:right\">" + fmt(tot.amt) + "</td><td style=\"text-align:right\">" + fmt(tot.qty) + "</td>"
      + "<td>100.00%</td><td>100.00%</td>"
      + "<td>" + fmt(tot.profit) + "</td><td>" + fmt(Math.round(gp)) + "</td>"
      + "<td>" + (tot.amt ? tot.profit / tot.amt * 100 : 0).toFixed(2) + "%</td>"
      + "<td>" + fmt(Math.round(tot.qty ? tot.amt / tot.qty : 0)) + "</td></tr>";
    return html;
  }

  function buildBrandTableContent(catData, bounds) {
    var tot = { sku: 0, amt: 0, qty: 0, profit: 0 };
    var results = {};
    var order = {};
    TIERS.forEach(function (t) { results[t] = {}; order[t] = []; });

    catData.forEach(function (d) {
      var tier = assignTier(d.price, bounds);
      var b = d.brand;
      if (!results[tier][b]) { results[tier][b] = { sku: 0, amt: 0, qty: 0, profit: 0 }; order[tier].push(b); }
      results[tier][b].sku++; results[tier][b].amt += d.saleAmt; results[tier][b].qty += d.saleQty; results[tier][b].profit += d.profit;
      tot.sku++; tot.amt += d.saleAmt; tot.qty += d.saleQty; tot.profit += d.profit;
    });

    var html = "";
    TIERS.forEach(function (tier) {
      var bg = TC[tier].bg;
      var brands = order[tier];
      var rowCount = brands.length + 1;

      brands.forEach(function (brand, idx) {
        var d = results[tier][brand];
        var ss = tot.sku ? (d.sku / tot.sku * 100) : 0;
        var as = tot.amt ? (d.amt / tot.amt * 100) : 0;
        html += "<tr class=\"sub-brand\">"
          + (idx === 0 ? "<td rowspan=\"" + rowCount + "\" style=\"vertical-align:middle;font-weight:bold;background:" + bg + ";\"><span class=\"badge-tier " + tier.toLowerCase() + "\">" + tier + "</span></td>"
            + "<td rowspan=\"" + rowCount + "\" style=\"font-size:.72rem;color:var(--text-mid);vertical-align:middle;background:" + bg + ";\">" + tierPriceRange(tier, bounds) + "</td>" : "")
          + "<td>" + brand + "</td>"
          + "<td style=\"text-align:right\">" + fmt(d.sku) + "</td><td style=\"text-align:right\">" + fmt(d.amt) + "</td><td style=\"text-align:right\">" + fmt(d.qty) + "</td>"
          + "<td>" + ss.toFixed(2) + "%</td><td>" + as.toFixed(2) + "%</td>"
          + "<td>" + fmt(d.profit) + "</td><td>" + fmt(Math.round(d.qty ? d.profit / d.qty : 0)) + "</td>"
          + "<td>" + (d.amt ? d.profit / d.amt * 100 : 0).toFixed(2) + "%</td>"
          + "<td>" + fmt(Math.round(d.qty ? d.amt / d.qty : 0)) + "</td></tr>";
      });

      var tt = { sku: 0, amt: 0, qty: 0, profit: 0 };
      brands.forEach(function (b) { var d = results[tier][b]; tt.sku += d.sku; tt.amt += d.amt; tt.qty += d.qty; tt.profit += d.profit; });
      html += "<tr class=\"sub-group\" style=\"background:" + bg + ";font-weight:600;\"><td>รวม " + tier + "</td>"
        + "<td style=\"text-align:right\">" + fmt(tt.sku) + "</td><td style=\"text-align:right\">" + fmt(tt.amt) + "</td><td style=\"text-align:right\">" + fmt(tt.qty) + "</td>"
        + "<td>" + (tot.sku ? tt.sku / tot.sku * 100 : 0).toFixed(2) + "%</td><td>" + (tot.amt ? tt.amt / tot.amt * 100 : 0).toFixed(2) + "%</td>"
        + "<td>" + fmt(tt.profit) + "</td><td>" + fmt(Math.round(tt.qty ? tt.profit / tt.qty : 0)) + "</td>"
        + "<td>" + (tt.amt ? tt.profit / tt.amt * 100 : 0).toFixed(2) + "%</td>"
        + "<td>" + fmt(Math.round(tt.qty ? tt.amt / tt.qty : 0)) + "</td></tr>";
    });

    html += "<tr class=\"total-row\" style=\"background:#edf2f7;font-weight:bold;\"><td colspan=\"2\"></td><td>Grand Total</td>"
      + "<td style=\"text-align:right\">" + fmt(tot.sku) + "</td><td style=\"text-align:right\">" + fmt(tot.amt) + "</td><td style=\"text-align:right\">" + fmt(tot.qty) + "</td>"
      + "<td>100.00%</td><td>100.00%</td><td>" + fmt(tot.profit) + "</td><td>" + fmt(Math.round(tot.qty ? tot.profit / tot.qty : 0)) + "</td>"
      + "<td>" + (tot.amt ? tot.profit / tot.amt * 100 : 0).toFixed(2) + "%</td>"
      + "<td>" + fmt(Math.round(tot.qty ? tot.amt / tot.qty : 0)) + "</td></tr>";
    return html;
  }

  // ─── Render Summary ───────────────────────────────────────
  function renderSummary() {
    var activeMch1s = getActiveMCH1s();
    var container = document.getElementById("summaryContainer");

    if (activeMch1s.length === 0) {
      container.innerHTML = "<div class=\"card\" style=\"text-align:center;color:var(--text-light);padding:40px;\">ไม่มีข้อมูล — กด Settings เพื่อเลือก Worksheet</div>";
      return;
    }

    var html = "";
    activeMch1s.forEach(function (m) {
      var catData = getDataForMch1(m);
      var prices = catData.map(function (d) { return d.price; });
      var max = prices.length ? Math.max.apply(null, prices) : 10000;
      var bounds = getActiveBounds(m);
      var b0 = bounds[0], b1 = bounds[1], b2 = bounds[2];
      var view = S.tableView[m] || "simple";

      var tableContent;
      if (view === "simple") tableContent = buildSimpleTableContent(catData, bounds);
      else if (view === "detailed") tableContent = buildSummaryTableContent(catData, bounds);
      else tableContent = buildBrandTableContent(catData, bounds);

      var headers = view === "simple"
        ? "<th>ระดับราคา (Tier)</th><th>ช่วงราคา</th><th>SKU Count</th><th>Sale Amt (฿)</th><th>Sale Qty</th><th>% SKU Share</th><th>% Sale Share</th><th>Profit (฿)</th><th>Profit/Item</th><th>Margin%</th><th>Avg Price/Item</th>"
        : view === "detailed"
        ? "<th>ระดับราคา (Tier)</th><th>ช่วงราคา</th><th>ประเภทแบรนด์</th><th>SKU Count</th><th>Sale Amt (฿)</th><th>Sale Qty</th><th>% SKU Share</th><th>% Sale Share</th><th>Profit (฿)</th><th>Profit/Item</th><th>Margin%</th><th>Avg Price/Item</th>"
        : "<th>ระดับราคา (Tier)</th><th>ช่วงราคา</th><th>Brand</th><th>SKU Count</th><th>Sale Amt (฿)</th><th>Sale Qty</th><th>% SKU Share</th><th>% Sale Share</th><th>Profit (฿)</th><th>Profit/Item</th><th>Margin%</th><th>Avg Price/Item</th>";

      html += "<div class=\"card\" style=\"margin-bottom:24px;\">"
        + "<div class=\"mch1-title\"><div class=\"mch1-icon\"></div>"
        + "<span style=\"font-size:1.1rem;color:var(--text)\">หมวดหมู่: <b>" + m + "</b> (" + catData.length + " SKU)</span>"
        + "<label class=\"link-cb " + (S.mch1Linked[m] ? "active" : "") + "\">"
        + "<input type=\"checkbox\" class=\"link-cb-input\" data-mch1=\"" + m + "\"" + (S.mch1Linked[m] ? " checked" : "") + "> 🔗 เชื่อมโยงเกณฑ์ราคากลาง</label></div>"

        + "<div class=\"tier-ctrl\" data-mch1=\"" + m + "\">"
        + "<div class=\"tier-ctrl-label\">🎛️ ช่วงราคา (ECO → MASS → PREMIUM → LUXURY) — ลากจุดกลมเพื่อปรับ</div>"
        + "<div class=\"slider-labels\" style=\"position:relative;height:18px;margin-bottom:4px;\">"
        + "<span style=\"left:0%;position:absolute;\">฿0</span>"
        + "<span class=\"lbl-eco\" style=\"left:" + (b0/max*100) + "%;position:absolute;transform:translateX(-50%);color:var(--eco);font-weight:600;\">ECO: ฿" + b0.toLocaleString() + "</span>"
        + "<span class=\"lbl-mass\" style=\"left:" + (b1/max*100) + "%;position:absolute;transform:translateX(-50%);color:var(--mass);font-weight:600;\">MASS: ฿" + b1.toLocaleString() + "</span>"
        + "<span class=\"lbl-prem\" style=\"left:" + (b2/max*100) + "%;position:absolute;transform:translateX(-50%);color:var(--premium);font-weight:600;\">PREM: ฿" + b2.toLocaleString() + "</span>"
        + "<span style=\"right:0%;position:absolute;\">Max: ฿" + max.toLocaleString() + "</span></div>"

        + "<div class=\"slider-bar\" data-mch1=\"" + m + "\" data-max=\"" + max + "\" style=\"position:relative;height:40px;background:#e2e8f0;border-radius:6px;overflow:visible;\">"
        + "<div class=\"slider-track\" style=\"position:absolute;top:14px;left:0;right:0;height:12px;display:flex;border-radius:6px;overflow:hidden;\">"
        + "<div class=\"seg\" style=\"width:" + (b0/max*100) + "%;background:var(--eco-bg);height:100%;\"></div>"
        + "<div class=\"seg\" style=\"width:" + ((b1-b0)/max*100) + "%;background:var(--mass-bg);height:100%;\"></div>"
        + "<div class=\"seg\" style=\"width:" + ((b2-b1)/max*100) + "%;background:var(--premium-bg);height:100%;\"></div>"
        + "<div class=\"seg\" style=\"width:" + ((max-b2)/max*100) + "%;background:var(--luxury-bg);height:100%;\"></div></div>"
        + "<div class=\"slider-handle h-eco\" data-idx=\"0\" style=\"left:" + (b0/max*100) + "%\" data-mch1=\"" + m + "\" data-drag-idx=\"0\"></div>"
        + "<div class=\"slider-handle h-mass\" data-idx=\"1\" style=\"left:" + (b1/max*100) + "%\" data-mch1=\"" + m + "\" data-drag-idx=\"1\"></div>"
        + "<div class=\"slider-handle h-prem\" data-idx=\"2\" style=\"left:" + (b2/max*100) + "%\" data-mch1=\"" + m + "\" data-drag-idx=\"2\"></div></div>"

        + "<div class=\"abs-inputs\">"
        + "<div class=\"ai\"><div class=\"ai-dot\" style=\"background:var(--eco)\"></div><span class=\"ai-label\">Max ECO</span><input type=\"number\" min=\"0\" max=\"" + b1 + "\" value=\"" + b0 + "\" data-abs-mch1=\"" + m + "\" data-abs-idx=\"0\"></div>"
        + "<div class=\"ai\"><div class=\"ai-dot\" style=\"background:var(--mass)\"></div><span class=\"ai-label\">Max MASS</span><input type=\"number\" min=\"" + b0 + "\" max=\"" + b2 + "\" value=\"" + b1 + "\" data-abs-mch1=\"" + m + "\" data-abs-idx=\"1\"></div>"
        + "<div class=\"ai\"><div class=\"ai-dot\" style=\"background:var(--premium)\"></div><span class=\"ai-label\">Max PREMIUM</span><input type=\"number\" min=\"" + b1 + "\" max=\"" + max + "\" value=\"" + b2 + "\" data-abs-mch1=\"" + m + "\" data-abs-idx=\"2\"></div>"
        + "<div class=\"ai\"><div class=\"ai-dot\" style=\"background:var(--luxury)\"></div><span class=\"ai-label\">Max LUXURY</span><input type=\"number\" value=\"" + max + "\" disabled></div></div></div>"

        + "<div class=\"tab-bar\" style=\"margin-top:14px;display:inline-flex;\">"
        + "<button class=\"tab-btn " + (view === "simple" ? "active" : "") + "\" data-tab-mch1=\"" + m + "\" data-tab-view=\"simple\">สรุปรวม</button>"
        + "<button class=\"tab-btn " + (view === "detailed" ? "active" : "") + "\" data-tab-mch1=\"" + m + "\" data-tab-view=\"detailed\">Private Brand</button>"
        + "<button class=\"tab-btn " + (view === "brand" ? "active" : "") + "\" data-tab-mch1=\"" + m + "\" data-tab-view=\"brand\">Brand</button></div>"

        + "<div style=\"overflow-x:auto;\"><table class=\"sum-table\"><thead><tr>" + headers + "</tr></thead><tbody>" + tableContent + "</tbody></table></div></div>";
    });

    container.innerHTML = html;
  }

  // ─── Render Charts ────────────────────────────────────────
  function renderCharts() {
    var counts = { ECO: 0, MASS: 0, PREMIUM: 0, LUXURY: 0 };
    var sales  = { ECO: 0, MASS: 0, PREMIUM: 0, LUXURY: 0 };
    var profits = { ECO: 0, MASS: 0, PREMIUM: 0, LUXURY: 0 };

    getActiveData().forEach(function (d) {
      var tier = getSKUTier(d);
      counts[tier]++; sales[tier] += d.saleAmt; profits[tier] += d.profit;
    });

    var bgColors = TIERS.map(function (t) { return TC[t].c; });

    if (charts.bar) charts.bar.destroy();
    charts.bar = new Chart(document.getElementById("chartBar").getContext("2d"), {
      type: "bar",
      data: { labels: TIERS, datasets: [{ label: "SKU Count", data: TIERS.map(function (t) { return counts[t]; }), backgroundColor: bgColors, borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: "#f0f0f0" } }, x: { grid: { display: false } } } }
    });

    if (charts.donut) charts.donut.destroy();
    charts.donut = new Chart(document.getElementById("chartDonut").getContext("2d"), {
      type: "doughnut",
      data: { labels: TIERS, datasets: [{ data: TIERS.map(function (t) { return sales[t]; }), backgroundColor: bgColors }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } } }
    });

    if (charts.profit) charts.profit.destroy();
    charts.profit = new Chart(document.getElementById("chartProfit").getContext("2d"), {
      type: "bar",
      data: { labels: TIERS, datasets: [{ label: "Margin %", data: TIERS.map(function (t) { return sales[t] ? profits[t] / sales[t] * 100 : 0; }), backgroundColor: TIERS.map(function (t) { return TC[t].c + "CC"; }), borderColor: bgColors, borderWidth: 1, borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return v + "%"; } }, grid: { color: "#f0f0f0" } }, x: { grid: { display: false } } } }
    });
  }

  // ─── Render Detail ────────────────────────────────────────
  function renderDetail() {
    var search = document.getElementById("searchBox").value.toLowerCase();
    var activeMch1s = getActiveMCH1s();
    var activeMch3s = getActiveMCH3s();

    var filtered = getActiveData().filter(function (d) {
      if (search && d.sku.toLowerCase().indexOf(search) === -1 && d.product.toLowerCase().indexOf(search) === -1 && d.mch3.toLowerCase().indexOf(search) === -1 && d.mch1.toLowerCase().indexOf(search) === -1 && d.brand.toLowerCase().indexOf(search) === -1) return false;
      if (S.dFilter !== "ALL" && getSKUTier(d) !== S.dFilter) return false;
      return true;
    });

    if (S.sortCol) {
      filtered.sort(function (a, b) {
        var va = S.sortCol === "tier" ? getSKUTier(a) : a[S.sortCol];
        var vb = S.sortCol === "tier" ? getSKUTier(b) : b[S.sortCol];
        if (typeof va === "string") return S.sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        return S.sortDir === "asc" ? va - vb : vb - va;
      });
    }

    document.getElementById("rowCount").textContent = filtered.length.toLocaleString();
    var html = "";
    filtered.forEach(function (d) {
      var tier = getSKUTier(d);
      html += "<tr><td>" + d.sku + "</td><td><b>" + d.product + "</b></td><td>" + d.mch3 + "</td><td>" + d.mch1 + "</td>"
        + "<td>" + d.brand + " <span style=\"font-size:.72rem;color:var(--text-light);\">(" + d.flag + ")</span></td>"
        + "<td>฿" + fmt(d.price) + "</td><td>฿" + fmt(d.saleAmt) + "</td><td>" + fmt(d.saleQty) + "</td>"
        + "<td>฿" + fmt(d.profit) + "</td><td><span class=\"badge-tier " + tier.toLowerCase() + "\">" + tier + "</span></td></tr>";
    });
    document.getElementById("dBody").innerHTML = html;
  }

  // ─── Export ───────────────────────────────────────────────
  function exportCSV() {
    if (!S.data.length) return;
    var filtered = getActiveData();
    var csv = "﻿SKU,Product,MCH3,MCH1,Brand,Flag,Price,Sale Amt,Sale Qty,Profit,Tier\n";
    filtered.forEach(function (d) {
      csv += d.sku + ",\"" + d.product.replace(/"/g, '""') + "\"," + d.mch3 + "," + d.mch1 + "," + d.brand + "," + d.flag + "," + d.price + "," + d.saleAmt + "," + d.saleQty + "," + d.profit + "," + getSKUTier(d) + "\n";
    });
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "price_tier_segmentation_" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
  }

  function exportSummary() {
    var activeMch1s = getActiveMCH1s();
    if (!activeMch1s.length) return;
    var csv = "﻿";
    activeMch1s.forEach(function (m) {
      var catData = getDataForMch1(m);
      var bounds = getActiveBounds(m);
      csv += "\nหมวดหมู่: " + m + " (" + catData.length + " SKU)\n";
      csv += "ช่วงราคา,ECO < ฿" + bounds[0].toLocaleString() + ",MASS ฿" + bounds[0].toLocaleString() + "-" + bounds[1].toLocaleString() + ",PREMIUM ฿" + bounds[1].toLocaleString() + "-" + bounds[2].toLocaleString() + ",LUXURY > ฿" + bounds[2].toLocaleString() + "\n\n";
      csv += "Tier,ช่วงราคา,SKU Count,Sale Amt,Sale Qty,% SKU Share,% Sale Share,Profit,Profit/Item,Margin%,Avg Price/Item\n";
      TIERS.forEach(function (tier) {
        var td = catData.filter(function (d) { return assignTier(d.price, bounds) === tier; });
        var sku = td.length, amt = td.reduce(function (s, d) { return s + d.saleAmt; }, 0), qty = td.reduce(function (s, d) { return s + d.saleQty; }, 0), pf = td.reduce(function (s, d) { return s + d.profit; }, 0);
        csv += tier + "," + tierPriceRange(tier, bounds).replace(/<[^>]*>/g, "") + "," + sku + "," + amt + "," + qty + "," + (catData.length ? sku / catData.length * 100 : 0).toFixed(2) + "%," + (catData.reduce(function (s, d) { return s + d.saleAmt; }, 0) ? amt / catData.reduce(function (s, d) { return s + d.saleAmt; }, 0) * 100 : 0).toFixed(2) + "%," + pf + "," + (qty ? Math.round(pf / qty) : 0) + "," + (amt ? (pf / amt * 100).toFixed(2) : 0) + "%," + (qty ? Math.round(amt / qty) : 0) + "\n";
      });
    });
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tier_summary_" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
  }

  // ─── Master Update ───────────────────────────────────────
  function updateAll() {
    try {
      renderDropdownMCH3();
      renderDropdown();
      renderSummary();
      renderCharts();
      renderDetail();
    } catch (err) {
      showError("render error: " + err.message + " (line " + (err.lineNumber || "?") + ")");
    }
  }

  function resetBounds() {
    S.mch1Bounds = {};
    S.mch1Linked = {};
    S.tableView = {};
    S.dFilter = "ALL";
    S.sortCol = null;
    S.sortDir = "asc";
    initBounds();
    updateAll();
  }

  // ─── Event Attachment ─────────────────────────────────────
  function attachEvents() {
    // Config panel toggle (works before data loads)
    document.querySelectorAll(".section-toggle").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.dataset.target);
        if (target) target.classList.toggle("is-collapsed");
      });
    });

    // Error close
    document.getElementById("errorCloseBtn").addEventListener("click", hideError);

    // Load data button
    document.getElementById("loadDataBtn").addEventListener("click", function () {
      var wsSelect = document.getElementById("worksheetSelect");
      S.worksheetName = wsSelect.value;
      if (!S.worksheetName || S.worksheetName.indexOf("--") === 0) return;
      // Persist selection
      tableau.extensions.settings.set("worksheet", S.worksheetName);
      tableau.extensions.settings.saveAsync().then(function () {
        loadWorksheetData();
        registerFilterListeners();
      });
    });

    // Export buttons
    document.getElementById("exportCSVTier").addEventListener("click", exportCSV);
    document.getElementById("exportSummaryBtn").addEventListener("click", exportSummary);
    document.getElementById("resetBoundsBtn").addEventListener("click", resetBounds);

    // Dropdown toggles
    document.getElementById("dd3Toggle").addEventListener("click", toggleDD3);
    document.getElementById("ddToggle").addEventListener("click", toggleDD);

    // Click outside to close dropdowns
    document.addEventListener("click", function (e) {
      var wrap3 = document.getElementById("dd3Wrap");
      if (wrap3 && !wrap3.contains(e.target)) {
        S.dd3Open = false;
        document.getElementById("dd3Menu").classList.remove("show");
        document.getElementById("dd3Toggle").classList.remove("open");
      }
      var wrap = document.getElementById("ddWrap");
      if (wrap && !wrap.contains(e.target)) {
        S.ddOpen = false;
        document.getElementById("ddMenu").classList.remove("show");
        document.getElementById("ddToggle").classList.remove("open");
      }
    });

    // Delegated events for dynamic content — use document level
    // so both ctrlBar (dropdowns) and summaryContainer (tables/sliders) are caught

    // Slider handles need mousedown (not click) for drag
    document.addEventListener("mousedown", function (e) {
      var handle = e.target.closest(".slider-handle");
      if (handle) {
        startSliderDrag(e, handle.dataset.mch1, parseInt(handle.dataset.dragIdx));
        return;
      }
    });

    document.addEventListener("click", function (e) {
      // MCH3 dropdown options
      var dd3Opt = e.target.closest("[data-mch3]");
      if (dd3Opt) {
        e.stopPropagation();
        var mch3 = dd3Opt.dataset.mch3;
        if (mch3 === "__all__") {
          var all = getMCH3s();
          if (setFrom(S.mch3Sel).length === all.length) setClear(S.mch3Sel);
          else { setClear(S.mch3Sel); all.forEach(function (m) { setAdd(S.mch3Sel, m); }); }
        } else {
          setToggle(S.mch3Sel, mch3);
        }
        updateAll();
        return;
      }

      // MCH1 dropdown options
      var dd1Opt = e.target.closest("[data-mch1]");
      if (dd1Opt) {
        e.stopPropagation();
        var mch1 = dd1Opt.dataset.mch1;
        if (mch1 === "__all__") {
          var all1 = getMCH1s();
          if (setFrom(S.mch1Sel).length === all1.length) setClear(S.mch1Sel);
          else { setClear(S.mch1Sel); all1.forEach(function (m) { setAdd(S.mch1Sel, m); }); }
        } else {
          setToggle(S.mch1Sel, mch1);
        }
        updateAll();
        return;
      }

      // Link checkboxes
      var linkCb = e.target.closest(".link-cb");
      if (linkCb) {
        var cb = linkCb.querySelector("input[type=checkbox]");
        if (e.target !== cb) cb.checked = !cb.checked;
        onLinkToggle(cb.dataset.mch1, cb);
        return;
      }

      // Tab buttons
      var tabBtn = e.target.closest("[data-tab-mch1]");
      if (tabBtn && tabBtn.classList.contains("tab-btn")) {
        S.tableView[tabBtn.dataset.tabMch1] = tabBtn.dataset.tabView;
        updateAll();
        return;
      }
    });

    // Delegated change for abs inputs
    document.getElementById("summaryContainer").addEventListener("change", function (e) {
      var absInput = e.target.closest("[data-abs-mch1]");
      if (absInput) {
        onAbsInput(absInput.dataset.absMch1, parseInt(absInput.dataset.absIdx), absInput.value);
      }
    });

    // Search box
    document.getElementById("searchBox").addEventListener("input", renderDetail);

    // Filter chips
    document.querySelectorAll(".f-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        S.dFilter = chip.dataset.f;
        document.querySelectorAll(".f-chip").forEach(function (c) {
          c.classList.toggle("sel", c.dataset.f === S.dFilter);
        });
        renderDetail();
      });
    });

    // Detail table sort
    document.querySelectorAll(".d-table th[data-col]").forEach(function (th) {
      th.addEventListener("click", function () {
        var col = th.dataset.col;
        if (S.sortCol === col) S.sortDir = S.sortDir === "asc" ? "desc" : "asc";
        else { S.sortCol = col; S.sortDir = "asc"; }
        renderDetail();
      });
    });
  }

  // ─── Tableau Bootstrap ────────────────────────────────────
  function initializeExtension() {
    tableau.extensions.initializeAsync().then(function () {
      // Populate worksheet selector
      var dashboard = tableau.extensions.dashboardContent.dashboard;
      var wsSelect = document.getElementById("worksheetSelect");
      dashboard.worksheets.forEach(function (ws) {
        var opt = document.createElement("option");
        opt.value = ws.name;
        opt.textContent = ws.name;
        wsSelect.appendChild(opt);
      });

      // Restore saved worksheet
      var saved = tableau.extensions.settings.get("worksheet");
      if (saved) {
        wsSelect.value = saved;
        S.worksheetName = saved;
        loadWorksheetData();
        registerFilterListeners();
      }

      // Attach UI events
      attachEvents();
      showDashboard(false);

    }).catch(function (err) {
      console.error("Tableau init failed:", err);
      showError("ไม่สามารถเชื่อมต่อกับ Tableau ได้: " + (err.message || err));
    });
  }

  // ─── Start ────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", initializeExtension);

})();
