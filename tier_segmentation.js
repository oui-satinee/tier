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
    mch2:     ["mch2", "category_group", "cat_group", "mch_2", "mch2_name"],
    mch1:     ["mch1", "product_group", "prod_group", "mch_1", "mch1_name", "group", "subcategory"],
    brand:    ["brand", "brand_name", "brandname"],
    flag:     ["flag", "brand_type", "brandtype", "brand_flag", "type", "private_brand_flag"],
    price:    ["price", "unit_price", "unitprice", "selling_price", "sellingprice", "avg_price"],
    saleAmt:  ["sale_amt", "saleamt", "sales_amount", "salesamount", "revenue", "sales", "amount", "sale"],
    saleQty:  ["sale_qty", "saleqty", "sales_qty", "salesqty", "quantity", "qty", "units_sold", "unitssold"],
    profit:   ["profit", "gross_profit", "grossprofit", "margin_amount", "marginamount"],
    margin:   ["margin", "margin%", "marginpct", "margin_percent", "marginpercent", "margin_rate"]
  };

  function normalize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function stripAgg(fieldName) {
    var m = fieldName.match(/^(?:SUM|AVG|MIN|MAX|COUNT|CNT|ATTR|AGG)\s*\(\s*(.+?)\s*\)$/i);
    return m ? m[1] : fieldName;
  }

  function getColName(col) {
    // Try multiple sources for the column name
    var names = [];
    if (col.getFieldName) {
      try { var fn = col.getFieldName(); if (fn) names.push(fn); } catch(e) {}
    }
    if (col.fieldCaption) names.push(col.fieldCaption);
    if (col.fieldName) names.push(col.fieldName);
    return names;
  }

  function buildColumnIndex(columns) {
    var index = {};
    var used = {};

    for (var ci = 0; ci < columns.length; ci++) {
      if (used[ci]) continue;

      // Get all possible names for this column
      var names = getColName(columns[ci]);
      // For each name, try raw + stripped versions
      var candidates = [];
      names.forEach(function (raw) {
        candidates.push(raw);
        var stripped = stripAgg(raw);
        if (stripped !== raw) candidates.push(stripped);
      });

      for (var field in COLUMN_MAP) {
        if (index[field] !== undefined) continue;
        var aliases = COLUMN_MAP[field];
        var matched = false;

        for (var ai = 0; ai < aliases.length && !matched; ai++) {
          var normAlias = normalize(aliases[ai]);
          for (var ni = 0; ni < candidates.length && !matched; ni++) {
            var normCand = normalize(candidates[ni]);
            if (normCand === normAlias || normCand.indexOf(normAlias) !== -1) {
              index[field] = ci;
              used[ci] = true;
              matched = true;
            }
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

  function escAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

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
      var profit  = parseNumber(get("profit"));

      // Skip completely empty rows (no numeric data at all)
      if (price === 0 && saleAmt === 0 && saleQty === 0 && profit === 0) continue;

      // If price is 0 but we have qty, estimate price from amt/qty
      if (price === 0 && saleQty > 0 && saleAmt > 0) {
        price = Math.round(saleAmt / saleQty);
      }

      rows.push({
        sku:     String(get("sku") || "ROW-" + (r + 1)),
        product: String(get("product") || ""),
        mch3:    String(get("mch3") || ""),
        mch2:    String(get("mch2") || ""),
        mch1:    String(get("mch1") || ""),
        brand:   String(get("brand") || ""),
        flag:    String(get("flag") || "Market Brand"),
        price:   price,
        saleAmt: saleAmt,
        saleQty: saleQty,
        profit:  profit,
        margin:  parseNumber(get("margin"))
      });
    }
    return rows;
  }

  // ─── State ────────────────────────────────────────────────
  var S = {
    data: [],
    catLevel: "MCH1",
    catBounds: { MCH1: {}, MCH2: {} },
    tableView: {},
    dFilter: "ALL",
    sortCol: null,
    sortDir: "asc",
    worksheetName: "",
    brandSort: {}
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
  var _idx = { byMch1: {}, byMch2: {}, byMch3: {}, mch1List: [], mch2List: [], mch3List: [] };

  function rebuildIndex() {
    _idx.byMch1 = {};
    _idx.byMch2 = {};
    _idx.byMch3 = {};
    var m1 = {}, m2 = {}, m3 = {};
    S.data.forEach(function (d) {
      if (!_idx.byMch1[d.mch1]) _idx.byMch1[d.mch1] = [];
      _idx.byMch1[d.mch1].push(d);
      if (!_idx.byMch2[d.mch2]) _idx.byMch2[d.mch2] = [];
      _idx.byMch2[d.mch2].push(d);
      if (!_idx.byMch3[d.mch3]) _idx.byMch3[d.mch3] = [];
      _idx.byMch3[d.mch3].push(d);
      m1[d.mch1] = true;
      m2[d.mch2] = true;
      m3[d.mch3] = true;
    });
    _idx.mch1List = Object.keys(m1).sort();
    _idx.mch2List = Object.keys(m2).sort();
    _idx.mch3List = Object.keys(m3).sort();
  }

  function getDataForMch1(mch1) { return _idx.byMch1[mch1] || []; }
  function getDataForMch2(mch2) { return _idx.byMch2[mch2] || []; }

  function getDataForCat(cat) {
    return S.catLevel === "MCH2" ? getDataForMch2(cat) : getDataForMch1(cat);
  }
  function catOfRecord(d) { return S.catLevel === "MCH2" ? d.mch2 : d.mch1; }
  function boundsMap() { return S.catLevel === "MCH2" ? S.catBounds.MCH2 : S.catBounds.MCH1; }
  function catDisplayName(cat) { return cat && cat !== "" ? cat : "ไม่ระบุหมวด"; }
  function catStateKey(cat) { return S.catLevel + "\u0001" + cat; }
  function hasMch2Data() {
    for (var i = 0; i < _idx.mch2List.length; i++) { if (_idx.mch2List[i]) return true; }
    return false;
  }

  function getActiveData() {
    // No cascade filter — return all data (filtering handled by data source)
    return S.data;
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
    document.getElementById("chartsRow").style.display      = show ? "" : "none";
    document.getElementById("detailCard").style.display     = show ? "" : "none";
    document.getElementById("catLevelBar").style.display    = show ? "flex" : "none";
    if (show) refreshCatToggle();
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

          // Reset state — all data used directly (filtering handled by data source)
          S.data = records;
          rebuildIndex();

          // Preserve category-level selection (MCH1/MCH2) across filter/data refreshes
          S.catBounds  = { MCH1: {}, MCH2: {} };
          if (S.catLevel === "MCH2" && !hasMch2Data()) S.catLevel = "MCH1";
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

  // No dropdown filters — all data used directly
  function getCategories() {
    return S.catLevel === "MCH2" ? _idx.mch2List : _idx.mch1List;
  }
  function setCatLevel(level) {
    if (level !== "MCH1" && level !== "MCH2") return;
    if (level === "MCH2" && !hasMch2Data()) return;
    S.catLevel = level;
    initBounds();
    refreshCatToggle();
    updateAll();
  }
  function refreshCatToggle() {
    var bar = document.getElementById("catLevelBar");
    if (!bar) return;
    var has2 = hasMch2Data();
    bar.querySelectorAll("[data-cat-level]").forEach(function (btn) {
      var lvl = btn.dataset.catLevel;
      btn.disabled = (lvl === "MCH2" && !has2);
      btn.title = (lvl === "MCH2" && !has2) ? "ไม่มีข้อมูลคอลัมน์ MCH2 ใน Worksheet นี้" : "";
      btn.classList.toggle("active", lvl === S.catLevel);
    });
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

  function calcDefaultBounds(cat) {
    var prices = getDataForCat(cat).map(function (d) { return d.price; }).sort(function (a, b) { return a - b; });
    return [Math.round(getPercentile(prices, 0.25)), Math.round(getPercentile(prices, 0.50)), Math.round(getPercentile(prices, 0.75))];
  }

  function initBounds() {
    var bm = boundsMap();
    getCategories().forEach(function (m) {
      if (!bm[m]) {
        bm[m] = calcDefaultBounds(m);
      }
    });
  }

  function getActiveBounds(cat) {
    var bm = boundsMap();
    if (!bm[cat]) bm[cat] = calcDefaultBounds(cat);
    return bm[cat];
  }

  function assignTier(price, bounds) {
    if (price >= bounds[2]) return "LUXURY";
    if (price >= bounds[1]) return "PREMIUM";
    if (price >= bounds[0]) return "MASS";
    return "ECO";
  }

  function getSKUTier(d) { return assignTier(d.price, getActiveBounds(catOfRecord(d))); }

  function tierPriceRange(tier, bounds) {
    switch (tier) {
      case "ECO":     return "< ฿" + bounds[0].toLocaleString();
      case "MASS":    return "฿" + bounds[0].toLocaleString() + " - ฿" + bounds[1].toLocaleString();
      case "PREMIUM": return "฿" + bounds[1].toLocaleString() + " - ฿" + bounds[2].toLocaleString();
      case "LUXURY":  return "> ฿" + bounds[2].toLocaleString();
    }
  }

  // ─── Dropdowns (removed — filtering handled by data source) ──

  // ─── Slider ───────────────────────────────────────────────
  var _drag = null;

  function startSliderDrag(e, cat, idx) {
    e.preventDefault();
    e.stopPropagation();
    _drag = { cat: cat, idx: idx };
    e.target.classList.add("dragging");
    document.addEventListener("mousemove", doSliderDrag);
    document.addEventListener("mouseup", endSliderDrag);
    document.addEventListener("touchmove", doSliderDragTouch, { passive: false });
    document.addEventListener("touchend", endSliderDrag);
  }

  function doSliderDrag(e) {
    if (!_drag) return;
    var bar = document.querySelector('.slider-bar[data-cat="' + _drag.cat + '"]');
    if (!bar) return;
    var rect = bar.getBoundingClientRect();
    var max = parseFloat(bar.dataset.max);
    if (max <= 0) return;
    var pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    var val = Math.round(pct * max);

    var bm = boundsMap();
    var bounds = (bm[_drag.cat] || [0, 0, 0]).slice();
    if (_drag.idx === 0) bounds[0] = Math.min(val, bounds[1]);
    else if (_drag.idx === 1) bounds[1] = Math.max(bounds[0], Math.min(val, bounds[2]));
    else bounds[2] = Math.max(bounds[1], val);

    bm[_drag.cat] = bounds;
    updateSliderDOM(_drag.cat, bounds, max);
  }

  function doSliderDragTouch(e) {
    e.preventDefault();
    if (!_drag) return;
    var touch = e.touches[0];
    var bar = document.querySelector('.slider-bar[data-cat="' + _drag.cat + '"]');
    if (!bar) return;
    var rect = bar.getBoundingClientRect();
    var max = parseFloat(bar.dataset.max);
    if (max <= 0) return;
    var pct = Math.max(0, Math.min(1, (touch.clientX - rect.left) / rect.width));
    var val = Math.round(pct * max);

    var bm = boundsMap();
    var bounds = (bm[_drag.cat] || [0, 0, 0]).slice();
    if (_drag.idx === 0) bounds[0] = Math.min(val, bounds[1]);
    else if (_drag.idx === 1) bounds[1] = Math.max(bounds[0], Math.min(val, bounds[2]));
    else bounds[2] = Math.max(bounds[1], val);

    bm[_drag.cat] = bounds;
    updateSliderDOM(_drag.cat, bounds, max);
  }

  function endSliderDrag() {
    if (_drag) {
      document.querySelectorAll(".slider-handle.dragging").forEach(function (h) { h.classList.remove("dragging"); });
      _drag = null;
      document.removeEventListener("mousemove", doSliderDrag);
      document.removeEventListener("mouseup", endSliderDrag);
      document.removeEventListener("touchmove", doSliderDragTouch);
      document.removeEventListener("touchend", endSliderDrag);
      updateAll();
    }
  }

  function updateSliderDOM(cat, bounds, max) {
    var tc = document.querySelector('.tier-ctrl[data-cat="' + cat + '"]');
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

  function onAbsInput(cat, idx, val) {
    val = Math.round(parseFloat(val));
    if (isNaN(val) || val < 0) return;
    var bm = boundsMap();
    var bounds = (bm[cat] || [0, 0, 0]).slice();
    var prices = getDataForCat(cat).map(function (d) { return d.price; });
    var max = prices.length ? Math.max.apply(null, prices) : 10000;
    if (idx === 0) bounds[0] = Math.min(val, bounds[1]);
    else if (idx === 1) bounds[1] = Math.max(bounds[0], Math.min(val, bounds[2]));
    else bounds[2] = Math.max(bounds[1], Math.min(val, max));
    bm[cat] = bounds;
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
        var tierSku = results[tier].total.sku;
        var tierAmt = results[tier].total.amt;
        var ss, as;
        if (bt.key === "total") {
          // รวม Tier row: % share relative to grand total
          ss = tot.sku ? (d.sku / tot.sku * 100) : 0;
          as = tot.amt ? (d.amt / tot.amt * 100) : 0;
        } else {
          // MB/PB sub-rows: % share relative to tier total
          ss = tierSku ? (d.sku / tierSku * 100) : 0;
          as = tierAmt ? (d.amt / tierAmt * 100) : 0;
        }
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

  function buildBrandTableContent(catData, bounds, mch1) {
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

      // Sort brands within this tier by Sale Amt (default) or user-selected column
      var bs = (mch1 && S.brandSort[catStateKey(mch1)]) || { col: "amt", dir: "desc" };
      brands.sort(function (a, b) {
        var da = results[tier][a], db = results[tier][b];
        var va, vb;
        switch (bs.col) {
          case "brand": va = a; vb = b; break;
          case "sku": va = da.sku; vb = db.sku; break;
          case "amt": va = da.amt; vb = db.amt; break;
          case "qty": va = da.qty; vb = db.qty; break;
          case "profit": va = da.profit; vb = db.profit; break;
          default: va = da.amt; vb = db.amt;
        }
        if (typeof va === "string") return bs.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
        return bs.dir === "asc" ? va - vb : vb - va;
      });

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
    var activeMch1s = getCategories();
    var container = document.getElementById("summaryContainer");

    if (activeMch1s.length === 0) {
      container.innerHTML = "<div class=\"card\" style=\"text-align:center;color:var(--text-light);padding:40px;\">ไม่มีข้อมูล — กด Settings เพื่อเลือก Worksheet</div>";
      return;
    }

    var html = "";
    activeMch1s.forEach(function (m) {
      var catData = getDataForCat(m);
      var prices = catData.map(function (d) { return d.price; });
      var max = prices.length ? Math.max.apply(null, prices) : 10000;
      var bounds = getActiveBounds(m);
      var b0 = bounds[0], b1 = bounds[1], b2 = bounds[2];
      var view = S.tableView[catStateKey(m)] || "simple";

      var tableContent;
      if (view === "simple") tableContent = buildSimpleTableContent(catData, bounds);
      else if (view === "detailed") tableContent = buildSummaryTableContent(catData, bounds);
      else tableContent = buildBrandTableContent(catData, bounds, m);

      var headers;
      if (view === "simple") {
        headers = "<th>ระดับราคา (Tier)</th><th>ช่วงราคา</th><th>SKU Count</th><th>Sale Amt (฿)</th><th>Sale Qty</th><th>% SKU Share</th><th>% Sale Share</th><th>Profit (฿)</th><th>Profit/Item</th><th>Margin%</th><th>Avg Price/Item</th>";
      } else if (view === "detailed") {
        headers = "<th>ระดับราคา (Tier)</th><th>ช่วงราคา</th><th>ประเภทแบรนด์</th><th>SKU Count</th><th>Sale Amt (฿)</th><th>Sale Qty</th><th>% SKU Share</th><th>% Sale Share</th><th>Profit (฿)</th><th>Profit/Item</th><th>Margin%</th><th>Avg Price/Item</th>";
      } else {
        // Brand view — sortable column headers with sort indicators
        var bs = S.brandSort[catStateKey(m)] || { col: "amt", dir: "desc" };
        function sh(col, label) {
          var arrow = bs.col === col ? (bs.dir === "asc" ? " ▲" : " ▼") : " ↕";
          return '<th data-brand-sort="' + col + '" class="brand-sort-th">' + label + arrow + '</th>';
        }
        headers = "<th>ระดับราคา (Tier)</th><th>ช่วงราคา</th>"
          + sh("brand", "Brand") + sh("sku", "SKU Count") + sh("amt", "Sale Amt (฿)") + sh("qty", "Sale Qty")
          + "<th>% SKU Share</th><th>% Sale Share</th>" + sh("profit", "Profit (฿)")
          + "<th>Profit/Item</th><th>Margin%</th><th>Avg Price/Item</th>";
      }

      html += "<div class=\"card\" style=\"margin-bottom:24px;\">"
        + "<div class=\"mch1-title\"><div class=\"mch1-icon\"></div>"
        + "<span style=\"font-size:1.1rem;color:var(--text)\">หมวดหมู่ (" + S.catLevel + "): <b>" + catDisplayName(m) + "</b> (" + catData.length + " SKU)</span>"
        + "</div>"

        + "<div class=\"tier-ctrl\" data-cat=\"" + escAttr(m) + "\">"
        + "<div class=\"tier-ctrl-label\">🎛️ ช่วงราคา (ECO → MASS → PREMIUM → LUXURY) — ลากจุดกลมเพื่อปรับ</div>"
        + "<div class=\"slider-labels\" style=\"position:relative;height:18px;margin-bottom:4px;\">"
        + "<span style=\"left:0%;position:absolute;\">฿0</span>"
        + "<span class=\"lbl-eco\" style=\"left:" + (b0/max*100) + "%;position:absolute;transform:translateX(-50%);color:var(--eco);font-weight:600;\">ECO: ฿" + b0.toLocaleString() + "</span>"
        + "<span class=\"lbl-mass\" style=\"left:" + (b1/max*100) + "%;position:absolute;transform:translateX(-50%);color:var(--mass);font-weight:600;\">MASS: ฿" + b1.toLocaleString() + "</span>"
        + "<span class=\"lbl-prem\" style=\"left:" + (b2/max*100) + "%;position:absolute;transform:translateX(-50%);color:var(--premium);font-weight:600;\">PREM: ฿" + b2.toLocaleString() + "</span>"
        + "<span style=\"right:0%;position:absolute;\">Max: ฿" + max.toLocaleString() + "</span></div>"

        + "<div class=\"slider-bar\" data-cat=\"" + escAttr(m) + "\" data-max=\"" + max + "\" style=\"position:relative;height:40px;background:#e2e8f0;border-radius:6px;overflow:visible;\">"
        + "<div class=\"slider-track\" style=\"position:absolute;top:14px;left:0;right:0;height:12px;display:flex;border-radius:6px;overflow:hidden;\">"
        + "<div class=\"seg\" style=\"width:" + (b0/max*100) + "%;background:var(--eco-bg);height:100%;\"></div>"
        + "<div class=\"seg\" style=\"width:" + ((b1-b0)/max*100) + "%;background:var(--mass-bg);height:100%;\"></div>"
        + "<div class=\"seg\" style=\"width:" + ((b2-b1)/max*100) + "%;background:var(--premium-bg);height:100%;\"></div>"
        + "<div class=\"seg\" style=\"width:" + ((max-b2)/max*100) + "%;background:var(--luxury-bg);height:100%;\"></div></div>"
        + "<div class=\"slider-handle h-eco\" data-idx=\"0\" style=\"left:" + (b0/max*100) + "%\" data-cat=\"" + escAttr(m) + "\" data-drag-idx=\"0\"></div>"
        + "<div class=\"slider-handle h-mass\" data-idx=\"1\" style=\"left:" + (b1/max*100) + "%\" data-cat=\"" + escAttr(m) + "\" data-drag-idx=\"1\"></div>"
        + "<div class=\"slider-handle h-prem\" data-idx=\"2\" style=\"left:" + (b2/max*100) + "%\" data-cat=\"" + escAttr(m) + "\" data-drag-idx=\"2\"></div></div>"

        + "<div class=\"abs-inputs\">"
        + "<div class=\"ai\"><div class=\"ai-dot\" style=\"background:var(--eco)\"></div><span class=\"ai-label\">Max ECO</span><input type=\"number\" min=\"0\" max=\"" + b1 + "\" value=\"" + b0 + "\" data-abs-cat=\"" + escAttr(m) + "\" data-abs-idx=\"0\"></div>"
        + "<div class=\"ai\"><div class=\"ai-dot\" style=\"background:var(--mass)\"></div><span class=\"ai-label\">Max MASS</span><input type=\"number\" min=\"" + b0 + "\" max=\"" + b2 + "\" value=\"" + b1 + "\" data-abs-cat=\"" + escAttr(m) + "\" data-abs-idx=\"1\"></div>"
        + "<div class=\"ai\"><div class=\"ai-dot\" style=\"background:var(--premium)\"></div><span class=\"ai-label\">Max PREMIUM</span><input type=\"number\" min=\"" + b1 + "\" max=\"" + max + "\" value=\"" + b2 + "\" data-abs-cat=\"" + escAttr(m) + "\" data-abs-idx=\"2\"></div>"
        + "<div class=\"ai\"><div class=\"ai-dot\" style=\"background:var(--luxury)\"></div><span class=\"ai-label\">Max LUXURY</span><input type=\"number\" value=\"" + max + "\" disabled></div></div></div>"

        + "<div class=\"tab-bar\" style=\"margin-top:14px;display:inline-flex;\">"
        + "<button class=\"tab-btn " + (view === "simple" ? "active" : "") + "\" data-tab-cat=\"" + escAttr(m) + "\" data-tab-view=\"simple\">สรุปรวม</button>"
        + "<button class=\"tab-btn " + (view === "detailed" ? "active" : "") + "\" data-tab-cat=\"" + escAttr(m) + "\" data-tab-view=\"detailed\">Private Brand</button>"
        + "<button class=\"tab-btn " + (view === "brand" ? "active" : "") + "\" data-tab-cat=\"" + escAttr(m) + "\" data-tab-view=\"brand\">Brand</button></div>"

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

    var countData = TIERS.map(function (t) { return counts[t]; });
    if (charts.bar) charts.bar.destroy();
    charts.bar = new Chart(document.getElementById("chartBar").getContext("2d"), {
      type: "bar",
      data: { labels: TIERS, datasets: [{ label: "SKU Count", data: countData, backgroundColor: bgColors, borderRadius: 6 }] },
      plugins: [{
        id: "barLabels",
        afterDraw: function (chart) {
          var ctx2 = chart.ctx;
          var meta = chart.getDatasetMeta(0);
          meta.data.forEach(function (bar, i) {
            ctx2.save();
            ctx2.fillStyle = "#1a202c";
            ctx2.font = "bold 12px Segoe UI, sans-serif";
            ctx2.textAlign = "center";
            ctx2.textBaseline = "bottom";
            ctx2.fillText(countData[i].toLocaleString(), bar.x, bar.y - 4);
            ctx2.restore();
          });
        }
      }],
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: "#f0f0f0" } }, x: { grid: { display: false } } } }
    });

    if (charts.donut) charts.donut.destroy();
    var totalSales = TIERS.reduce(function (s, t) { return s + sales[t]; }, 0);
    var pctLabels = TIERS.map(function (t) { return totalSales ? (sales[t] / totalSales * 100).toFixed(1) : 0; });
    charts.donut = new Chart(document.getElementById("chartDonut").getContext("2d"), {
      type: "doughnut",
      data: { labels: TIERS, datasets: [{ data: TIERS.map(function (t) { return sales[t]; }), backgroundColor: bgColors }] },
      plugins: [{
        id: "pctLabels",
        afterDraw: function (chart) {
          var ctx2 = chart.ctx;
          var meta = chart.getDatasetMeta(0);
          TIERS.forEach(function (t, i) {
            var arc = meta.data[i];
            if (!arc) return;
            var pct = pctLabels[i];
            if (pct < 2) return;
            var midAngle = (arc.startAngle + arc.endAngle) / 2;
            var radius = (arc.innerRadius + arc.outerRadius) / 2;
            var x = arc.x + Math.cos(midAngle) * radius;
            var y = arc.y + Math.sin(midAngle) * radius;
            ctx2.save();
            ctx2.fillStyle = "#fff";
            ctx2.font = "bold 12px Segoe UI, sans-serif";
            ctx2.textAlign = "center";
            ctx2.textBaseline = "middle";
            ctx2.shadowColor = "rgba(0,0,0,0.4)";
            ctx2.shadowBlur = 3;
            ctx2.fillText(pct + "%", x, y);
            ctx2.restore();
          });
        }
      }],
      options: { responsive: true, maintainAspectRatio: false, cutout: "40%", plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } } }
    });

    var marginData = TIERS.map(function (t) { return sales[t] ? profits[t] / sales[t] * 100 : 0; });
    if (charts.profit) charts.profit.destroy();
    charts.profit = new Chart(document.getElementById("chartProfit").getContext("2d"), {
      type: "bar",
      data: { labels: TIERS, datasets: [{ label: "Margin %", data: marginData, backgroundColor: TIERS.map(function (t) { return TC[t].c + "CC"; }), borderColor: bgColors, borderWidth: 1, borderRadius: 6 }] },
      plugins: [{
        id: "marginLabels",
        afterDraw: function (chart) {
          var ctx2 = chart.ctx;
          var meta = chart.getDatasetMeta(0);
          meta.data.forEach(function (bar, i) {
            ctx2.save();
            ctx2.fillStyle = "#1a202c";
            ctx2.font = "bold 12px Segoe UI, sans-serif";
            ctx2.textAlign = "center";
            ctx2.textBaseline = "bottom";
            ctx2.fillText(marginData[i].toFixed(1) + "%", bar.x, bar.y - 4);
            ctx2.restore();
          });
        }
      }],
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: function (v) { return v + "%"; } }, grid: { color: "#f0f0f0" } }, x: { grid: { display: false } } } }
    });
  }

  // ─── Render Detail ────────────────────────────────────────
  function renderDetail() {
    var search = document.getElementById("searchBox").value.toLowerCase();

    var filtered = getActiveData().filter(function (d) {
      if (search && d.sku.toLowerCase().indexOf(search) === -1 && d.product.toLowerCase().indexOf(search) === -1 && d.mch3.toLowerCase().indexOf(search) === -1 && d.mch2.toLowerCase().indexOf(search) === -1 && d.mch1.toLowerCase().indexOf(search) === -1 && d.brand.toLowerCase().indexOf(search) === -1) return false;
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
      var margin = d.margin ? d.margin.toFixed(2) + "%" : "-";
      html += "<tr><td>" + d.sku + "</td><td><b>" + d.product + "</b></td><td>" + d.mch3 + "</td><td>" + d.mch2 + "</td><td>" + d.mch1 + "</td>"
        + "<td>" + d.brand + " <span style=\"font-size:.72rem;color:var(--text-light);\">(" + d.flag + ")</span></td>"
        + "<td>฿" + fmt(d.price) + "</td><td>฿" + fmt(d.saleAmt) + "</td><td>" + fmt(d.saleQty) + "</td>"
        + "<td>฿" + fmt(d.profit) + "</td><td>" + margin + "</td><td><span class=\"badge-tier " + tier.toLowerCase() + "\">" + tier + "</span></td></tr>";
    });
    document.getElementById("dBody").innerHTML = html;
  }

  // ─── Export ───────────────────────────────────────────────
  function exportCSV() {
    if (!S.data.length) return;
    var filtered = getActiveData();
    var csv = "﻿SKU,Product,MCH3,MCH2,MCH1,Brand,Flag,Price,Sale Amt,Sale Qty,Profit,Margin%,Tier\n";
    filtered.forEach(function (d) {
      var margin = d.margin ? d.margin.toFixed(2) : 0;
      csv += d.sku + ",\"" + d.product.replace(/"/g, '""') + "\"," + d.mch3 + "," + d.mch2 + "," + d.mch1 + "," + d.brand + "," + d.flag + "," + d.price + "," + d.saleAmt + "," + d.saleQty + "," + d.profit + "," + margin + "%," + getSKUTier(d) + "\n";
    });
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "price_tier_segmentation_" + new Date().toISOString().slice(0, 10) + ".csv";
    a.click();
  }

  function exportSummary() {
    var activeMch1s = getCategories();
    if (!activeMch1s.length) return;
    var csv = "﻿";
    activeMch1s.forEach(function (m) {
      var catData = getDataForCat(m);
      var bounds = getActiveBounds(m);
      csv += "\nหมวดหมู่ (" + S.catLevel + "): " + catDisplayName(m) + " (" + catData.length + " SKU)\n";
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
      renderSummary();
      renderCharts();
      renderDetail();
    } catch (err) {
      showError("render error: " + err.message + " (line " + (err.lineNumber || "?") + ")");
    }
  }

  function resetBounds() {
    S.catBounds = { MCH1: {}, MCH2: {} };
    S.tableView = {};
    S.dFilter = "ALL";
    S.sortCol = null;
    S.sortDir = "asc";
    S.brandSort = {};
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

    // Settings toggle
    document.getElementById("settingsToggle").addEventListener("click", function () {
      document.getElementById("settingsBar").style.display = "flex";
    });
    document.getElementById("settingsClose").addEventListener("click", function () {
      document.getElementById("settingsBar").style.display = "none";
    });

    // Delegated events for dynamic content
    // Delegated events for summaryContainer (tables/sliders)

    // Slider handles need mousedown (not click) for drag
    document.addEventListener("mousedown", function (e) {
      var handle = e.target.closest(".slider-handle");
      if (handle) {
        startSliderDrag(e, handle.dataset.cat, parseInt(handle.dataset.dragIdx));
        return;
      }
    });

    document.addEventListener("click", function (e) {
      // Tab buttons
      var tabBtn = e.target.closest("[data-tab-cat]");
      if (tabBtn && tabBtn.classList.contains("tab-btn")) {
        S.tableView[catStateKey(tabBtn.dataset.tabCat)] = tabBtn.dataset.tabView;
        updateAll();
        return;
      }

      // Brand table column sort
      var brandSortTh = e.target.closest("[data-brand-sort]");
      if (brandSortTh) {
        var card = brandSortTh.closest(".card");
        var catEl = card ? card.querySelector("[data-cat]") : null;
        var sortCat = catEl ? catEl.dataset.cat : null;
        if (sortCat) {
          var key = catStateKey(sortCat);
          var col = brandSortTh.dataset.brandSort;
          if (!S.brandSort[key]) S.brandSort[key] = { col: "amt", dir: "desc" };
          if (S.brandSort[key].col === col) {
            S.brandSort[key].dir = S.brandSort[key].dir === "desc" ? "asc" : "desc";
          } else {
            S.brandSort[key] = { col: col, dir: "desc" };
          }
          updateAll();
        }
        return;
      }

      // Category level toggle (MCH1 / MCH2)
      var catBtn = e.target.closest("[data-cat-level]");
      if (catBtn && !catBtn.disabled) {
        setCatLevel(catBtn.dataset.catLevel);
        return;
      }
    });

    // Delegated change for abs inputs
    document.getElementById("summaryContainer").addEventListener("change", function (e) {
      var absInput = e.target.closest("[data-abs-cat]");
      if (absInput) {
        onAbsInput(absInput.dataset.absCat, parseInt(absInput.dataset.absIdx), absInput.value);
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
