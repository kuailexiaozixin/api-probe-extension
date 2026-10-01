
// Global error handler to catch and report any JS errors
window.onerror = function(msg, source, lineno, colno, error) {
  console.error('[API Probe] GLOBAL ERROR:', msg, 'at', source, lineno, colno, error);
  return true;
};
window.addEventListener('unhandledrejection', function(e) {
  console.error('[API Probe] UNHANDLED PROMISE REJECTION:', e.reason);
});

let recording = false;

let currentTabId = null;

let requests = [];

let filteredRequests = [];

let events = [];  // UI interaction events (click, input, navigation)
window.events = events;  // 全局引用，确保 CDP 等外部访问一致性

// 工作流变量（从 content script 接收）
var workflowVars = {};
var currentStepVars = {}; // 按步骤保存的变量快照

let methodFilter = '';

let keywordFilter = '';

let ctxRequest = null;

// 提取字段配置面板
var extractFieldModal = null;

const reqList = document.getElementById('req-list');

const btnRecord = document.getElementById('btnRecord');

const btnClear = document.getElementById('btnClear');

const btnExport = document.getElementById('btnExport');

const statusText = document.getElementById('statusText');

const tabList = document.getElementById('tab-list');

const searchInput = document.getElementById('searchInput');

const filterCount = document.getElementById('filterCount');

const methodGroup = document.getElementById('methodGroup');

const ctxMenu = document.getElementById('ctxMenu');

const ctxViewStack = document.getElementById('ctxViewStack');

const ctxReplay = document.getElementById('ctxReplay');

const ctxExportCode = document.getElementById('ctxExportCode');
// 鼠标滚轮 → 横向滚动（filter-bar 按钮过多时）
document.querySelector('.filter-bar')?.addEventListener('wheel', function(e) {
  if (this.scrollWidth > this.clientWidth) {
    e.preventDefault();
    this.scrollLeft += e.deltaY;
  }
}, { passive: false });

// 鼠标滚轮 → 横向滚动（tab-list 标签页过多时）
document.querySelector('#tab-list')?.addEventListener('wheel', function(e) {
  if (this.scrollWidth > this.clientWidth) {
    e.preventDefault();
    this.scrollLeft += e.deltaY;
  }
}, { passive: false });

// 鼠标滚轮 → 横向滚动（builder 协议标签过多时）
document.querySelector('#builderProtoTabs')?.addEventListener('wheel', function(e) {
  if (this.scrollWidth > this.clientWidth) {
    e.preventDefault();
    this.scrollLeft += e.deltaY;
  }
}, { passive: false });


const ctxSubmenu = document.getElementById('ctxSubmenu');

const btnExportWrap = document.getElementById('btnExportWrap');

const exportDropdown = document.getElementById('exportDropdown');

const btnNewRequest = document.getElementById('btnNewRequest');

const paramsToggle = document.getElementById('paramsToggle');

const paramsTable = document.getElementById('paramsTable');

const paramsRows = document.getElementById('paramsRows');

const btnAddParam = document.getElementById('btnAddParam');





const hdrModeSwitch = document.getElementById('hdrModeSwitch');

const hdrKvEditor = document.getElementById('hdrKvEditor');

const hdrRows = document.getElementById('hdrRows');

const btnAddHdr = document.getElementById('btnAddHdr');

const bodyType = document.getElementById('bodyType');

const bodyKvEditor = document.getElementById('bodyKvEditor');

const bodyKvRows = document.getElementById('bodyKvRows');

const btnAddBodyKv = document.getElementById('btnAddBodyKv');

const builderPanel = document.getElementById('builderPanel');

const builderClose = document.getElementById('builderClose');

const builderMethod = document.getElementById('builderMethod');

const builderUrl = document.getElementById('builderUrl');

const builderHeaders = document.getElementById('builderHeaders');

const builderHeadersError = document.getElementById('builderHeadersError');

const builderBody = document.getElementById('builderBody');

const builderBodySection = document.getElementById('builderBodySection');

const builderBodyError = document.getElementById('builderBodyError');

const builderSend = document.getElementById('builderSend');

const builderCopyCurl = document.getElementById('builderCopyCurl');

const builderResponse = document.getElementById('builderResponse');

const builderStatusBadge = document.getElementById('builderStatusBadge');

const builderDuration = document.getElementById('builderDuration');

const builderRespHeaders = document.getElementById('builderRespHeaders');

const builderRespBody = document.getElementById('builderRespBody');

const builderRespError = document.getElementById('builderRespError');

const builderHdrModeSwitch = document.getElementById('builderHdrModeSwitch');

const builderHdrKvEditor = document.getElementById('builderHdrKvEditor');

const builderHdrRows = document.getElementById('builderHdrRows');

const builderAddHdr = document.getElementById('builderAddHdr');

const builderBodyType = document.getElementById('builderBodyType');

const builderBodyKvEditor = document.getElementById('builderBodyKvEditor');

const builderBodyKvRows = document.getElementById('builderBodyKvRows');

const builderAddBodyKv = document.getElementById('builderAddBodyKv');

const builderParamsToggle = document.getElementById('builderParamsToggle');

const builderParamsTable = document.getElementById('builderParamsTable');

const builderParamsRows = document.getElementById('builderParamsRows');

const builderAddParam = document.getElementById('builderAddParam');

// ===== Code Editor Elements =====
const codeEditorPanel = document.getElementById('codeEditorPanel');
const ceTextarea = document.getElementById('ceTextarea');
const ceFmtBadge = document.getElementById('ceFmtBadge');
const ceCopy = document.getElementById('ceCopy');
const ceDownload = document.getElementById('ceDownload');
const ceClose = document.getElementById('ceClose');
const ceCloseBtn = document.getElementById('ceCloseBtn');
const ceStatus = document.getElementById('ceStatus');
// State: current code content and format for the editor
var _ceContent = '';
var _ceFilename = '';
var _ceFmt = '';

// Headers editor mode: 'kv' or 'raw'

var hdrMode = 'kv';

// Body editor mode: 'json', 'form', 'multipart'

let bodyEditorMode = 'json';

const methodColors = {

  GET: 'method-GET', POST: 'method-POST', PUT: 'method-PUT',

  DELETE: 'method-DELETE', PATCH: 'method-PATCH',
  EVENTSOURCE: 'method-SSE', WEBSOCKET: 'method-WS',
  SOCKETIO: 'method-SOCKETIO', MQTT: 'method-MQTT',
  GQL: 'method-GQL'

};
function isGraphQL(req) {
  if (!req) return false;
  if (req.url && /graphql/i.test(req.url)) return true;
  if (req.requestBody) {
    try {
      var body = typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody);
      var p = JSON.parse(body);
      if (p.query || p.operationName) return true;
    } catch(e) {}
  }
  return false;
}

// 记录已接收的请求 id，用于去重
var _receivedIds = new Set();

// ---- 统一消息监听器 ----
chrome.runtime.onMessage.addListener((msg) => {

  // 1. 工作流变量更新
  if (msg.type === 'API_PROBE_AUTO_EXTRACTED' && msg.data && msg.data.fields) {
    var autoFields = msg.data.fields;
    for (var fkey in autoFields) {
      if (autoFields.hasOwnProperty(fkey)) {
        workflowVars['auto_' + fkey.replace(/\./g, '_')] = autoFields[fkey];
      }
    }
    if (msg.data.step) currentStepVars[msg.data.step] = workflowVars;
    updateVarsPanel();
    return;
  }

  if (msg.type === 'API_PROBE_VARS_UPDATED' && msg.data) {
    workflowVars = msg.data.vars || {};
    currentStepVars[msg.data.step || 0] = workflowVars;
    updateVarsPanel();
    return;
  }

  // 2. 清理事件
  if (msg.type === 'API_PROBE_CLEARED') {
    requests = [];
    filteredRequests = [];
    _receivedIds.clear();
    workflowVars = {};
    currentStepVars = {};
    renderRequests();
    updateStatus();
    updateVarsPanel();
    return;
  }

  // 3. API 请求录制
  if (msg.type === 'API_PROBE_RECORD' && msg.data) {
    if (currentTabId && msg.data.tabId && msg.data.tabId !== currentTabId) return;
    if (_receivedIds.has(msg.data.id)) {
      if (msg.data.tabId || msg.data.pageUrl) {
        for (var _di = 0; _di < requests.length; _di++) {
          if (requests[_di].id === msg.data.id) {
            if (msg.data.tabId) requests[_di].tabId = msg.data.tabId;
            if (msg.data.pageUrl) requests[_di].pageUrl = msg.data.pageUrl;
            break;
          }
        }
      }
      return;
    }
    _receivedIds.add(msg.data.id);
    if (msg.data.extractFields) msg.data.extractFields = msg.data.extractFields || [];
    if (msg.data.dependencies === undefined) msg.data.dependencies = [];
    requests.push(msg.data);
    saveRequests();
    applyFilters();
    updateStatus();
    return;
  }

  // 4. 标签页列表
  if (msg.type === 'API_PROBE_TABS_LIST') {
    console.log('[API Probe] Received TABS_LIST with', msg.tabs ? msg.tabs.length : 0, 'tabs');
    renderTabs(msg.tabs);
    return;
  }

  // 5. WebSocket 消息
  if (msg.type === 'API_PROBE_WS_MESSAGE' && msg.data) {
    for (var wi = 0; wi < requests.length; wi++) {
      if (requests[wi].id === msg.data.id) {
        if (!requests[wi].wsMessages) requests[wi].wsMessages = [];
        if (requests[wi].wsMessages.length < 500) requests[wi].wsMessages.push(msg.data);
        break;
      }
    }
    if (ctxRequest && ctxRequest.id === msg.data.id) renderRequest(ctxRequest);
    saveRequests();
    return;
  }

  // 6. SSE 消息
  if (msg.type === 'API_PROBE_SSE_MESSAGE' && msg.data) {
    for (var si = 0; si < requests.length; si++) {
      if (requests[si].id === msg.data.id) {
        if (!requests[si].sseMessages) requests[si].sseMessages = [];
        if (requests[si].sseMessages.length < 500) requests[si].sseMessages.push(msg.data);
        break;
      }
    }
    if (ctxRequest && ctxRequest.id === msg.data.id) renderRequest(ctxRequest);
    saveRequests();
    return;
  }

  // 7. 录制状态变更
  if (msg.type === 'API_PROBE_RECORDING_CHANGED') {
    recording = !!msg.recording;
    btnRecord.textContent = recording ? '\u25cf \u5f55\u5236\u4e2d' : '\u5f55\u5236';
    btnRecord.classList.toggle('recording', recording);
    updateStatus();
    return;
  }

  // 8. Console 输出捕获
  if (msg.type === 'API_PROBE_CONSOLE' && msg.data) {
    var conData = msg.data;
    if (!window._consoleEvents) window._consoleEvents = [];
    window._consoleEvents.push({
      level: conData.level || 'log',
      message: (conData.message || '').slice(0, 500),
      timestamp: conData.timestamp || new Date().toISOString(),
    });
    if (window._consoleEvents.length > 100) window._consoleEvents.splice(0, window._consoleEvents.length - 100);
    events.push({
      id: 'console_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: 'ui',
      subtype: 'console_' + (conData.level || 'log'),
      text: conData.message || '',
      timestamp: conData.timestamp || new Date().toISOString(),
      tabId: msg.tabId,
      pageUrl: conData.pageUrl || '',
    });
    renderEvents();
    return;
  }

  
  // 10. 截屏请求处理
  if (msg.type === 'API_PROBE_SCREENSHOT') {
    if (currentTabId) {
      try {
        chrome.tabs.captureVisibleTab(null, {format: 'png', quality: 80}, function(dataUrl) {
          if (chrome.runtime.lastError) return;
          events.push({
            id: 'ss_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            type: 'ui',
            subtype: 'screenshot',
            text: JSON.stringify({
              dataUrl: dataUrl,
              url: msg.data ? msg.data.url : '',
              title: msg.data ? msg.data.title : '',
            }),
            timestamp: new Date().toISOString(),
            pageUrl: msg.data ? msg.data.url : '',
          });
          renderEvents();
        });
      } catch(e) {
        console.error('[API Probe] Screenshot failed:', e);
      }
    }
    return;
  }

  // 9. UI 交互事件（click, input, submit, keydown 等）
  if (msg.type === 'API_PROBE_UI_EVENT' && msg.data) {
    var uiData = msg.data;
    if (currentTabId && uiData.tabId && uiData.tabId !== currentTabId) return;

    // 去重：同一 subtype + 时间戳(同秒) + pageUrl 的事件忽略重复
    var dedupKey = (uiData.subtype || '') + '_' + (uiData.timestamp || '').slice(0, 19) + '_' + (uiData.data ? uiData.data.pageUrl || '' : '');
    // 对话框事件按 type（alert/confirm/prompt）额外细分，避免同秒互斥去重
    if (uiData.subtype === 'dialog' && uiData.data && uiData.data.type) {
      dedupKey += '_' + uiData.data.type;
    }
    if (!window._uiEventDedup) window._uiEventDedup = new Set();
    if (window._uiEventDedup.has(dedupKey)) return;
    window._uiEventDedup.add(dedupKey);
    // 限制去重集大小
    if (window._uiEventDedup.size > 500) window._uiEventDedup.clear();

    events.push({
      id: 'ui_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      type: 'ui',
      subtype: uiData.subtype,
      text: JSON.stringify(uiData.data || {}),
      timestamp: uiData.timestamp || new Date().toISOString(),
      tabId: uiData.tabId,
      pageUrl: uiData.pageUrl || (uiData.data ? uiData.data.pageUrl : '') || '',
      storageSnapshot: uiData.data ? (uiData.data.storageState || null) : null,
    });
    renderEvents();
    return;
  }

});

methodGroup.addEventListener('click', (e) => {

  const btn = e.target.closest('.method-btn');

  if (!btn) return;

  methodGroup.querySelectorAll('.method-btn').forEach(b => b.classList.remove('active'));

  btn.classList.add('active');

  methodFilter = btn.dataset.method;

  applyFilters();

  updateStatus();

});

let searchTimer = null;

searchInput.addEventListener('input', () => {

  clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {

    keywordFilter = searchInput.value.trim().toLowerCase();

    applyFilters();

    updateStatus();

  }, 200);

});

function applyFilters() {

  filteredRequests = requests.filter(r => {

    if (currentTabId && r.tabId && r.tabId !== currentTabId) return false;

    if (methodFilter === 'EVENTSOURCE') {
      if (r.type !== 'SSE' && r.method !== 'EVENTSOURCE') return false;
    } else if (methodFilter && (methodFilter === 'GQL' ? !isGraphQL(r) : r.method !== methodFilter)) {
      return false;
    }

    if (keywordFilter) {

      const t = (r.url + ' ' + JSON.stringify(r.requestBody || '') + ' ' + JSON.stringify(r.responseBody || '')).toLowerCase();

      if (!t.includes(keywordFilter)) return false;

    }

    return true;

  });

  renderRequests();

}

function loadTabs() {

  console.log("[API Probe] loadTabs called");

  // 直接查询，无需经过 background
  chrome.tabs.query({ currentWindow: true }, function(tabs) {
    var list = tabs.map(function(t) { return { id: t.id, title: t.title || t.url, url: t.url }; });
    if (typeof renderTabs === 'function') renderTabs(list);
  });

}



// ===== Event Recording View =====
var evtList = document.getElementById('evt-list');
var evtCountEl = document.getElementById('evtCount');

function renderEvents() {
  if (!evtList) return;
  if (events.length === 0) {
    evtList.innerHTML = '<div class="empty-state"><div class="icon">🎯</div><div>等待事件录制...</div><div style="font-size:12px;margin-top:8px;color:#d1d5db">点击「录制」后，页面上的点击、输入、提交等 DOM 操作将被记录</div></div>';
    if (evtCountEl) evtCountEl.textContent = '';
    return;
  }

  var typeIcons = { ui: '🟢' };
  var typeLabels = { ui: 'UI' };

  evtList.innerHTML = events.map(function(evt, i) {
    var icon = typeIcons[evt.type] || '⚪';
    var label = typeLabels[evt.type] || evt.type.toUpperCase();
    var text = evt.text || '';
    if (evt.subtype) text = evt.subtype + (text ? ': ' + text : '');
    var time = new Date(evt.timestamp).toLocaleTimeString();
    var expanded = evt._expanded ? ' expanded' : '';

    return '<div class="req-item evt-item' + expanded + '" data-eidx="' + i + '">'
      + '<div class="req-summary">'
      + '<span style="font-size:12px">' + icon + '</span>'
      + '<span class="req-status" style="color:#6b7280;font-size:10px">' + label + '</span>'
      + '<span class="req-path" title="' + escapeHtml(text) + '">' + escapeHtml(text.substring(0, 80)) + '</span>'
      + '<span class="req-duration">' + time + '</span>'
      + '<span class="req-expand">▸</span>'
      + '<span class="evt-delete" data-eidx="' + i + '" title="删除此事件" style="cursor:pointer;color:#ef4444;font-size:14px;margin-left:6px;display:none">&times;</span>'
      + '</div>'
      + '<div class="req-detail">'
      + '<div class="detail-section" style="margin-top:4px;display:flex;gap:6px;align-items:center">'
      + '<input class="evt-name-input" data-eidx="' + i + '" type="text" placeholder="步骤命名..." value="' + escapeHtml(evt.stepName || '') + '" style="flex:1;padding:3px 6px;font-size:10px;border:1px solid #d1d5db;border-radius:4px" />'
      + '<button class="evt-del-btn" data-eidx="' + i + '" style="background:#fee2e2;border:1px solid #fecaca;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:10px;color:#dc2626">删除</button>'
      + '</div>'
      + '<div class="detail-section"><div class="detail-label">TYPE</div><div class="detail-value">' + escapeHtml(evt.type + (evt.subtype ? '.' + evt.subtype : '')) + '</div></div>'
      + (evt.url ? '<div class="detail-section"><div class="detail-label">URL</div><div class="detail-value">' + escapeHtml(evt.url) + '</div></div>' : '')
      + (evt.pageUrl ? '<div class="detail-section"><div class="detail-label">PAGE</div><div class="detail-value">' + escapeHtml(evt.pageUrl) + '</div></div>' : '')
      + '<div class="detail-section"><div class="detail-label">DATA</div><div class="detail-value">' + escapeHtml(text) + '</div></div>'
      + '<div class="detail-section"><div class="detail-label">TIME</div><div class="detail-value">' + escapeHtml(evt.timestamp) + '</div></div>'
      + '</div></div>';
  }).join('');

  if (evtCountEl) evtCountEl.textContent = events.length + ' 条';

  // Bind click handlers for expand/collapse
  evtList.querySelectorAll('.req-item').forEach(function(el) {
    el.addEventListener('click', function(e) {
      if (e.target.closest('.req-detail')) return;
      if (e.target.closest('.evt-delete') || e.target.closest('.evt-del-btn')) return;
      if (e.button === 0) {
        el.classList.toggle('expanded');
        var idx = parseInt(el.dataset.eidx);
        if (events[idx]) events[idx]._expanded = el.classList.contains('expanded');
      }
    });
  });
  
  // Bind delete handlers
  evtList.querySelectorAll('.evt-delete, .evt-del-btn').forEach(function(el) {
    el.addEventListener('click', function(e) {
      e.stopPropagation();
      var idx = parseInt(el.dataset.eidx);
      if (!isNaN(idx) && idx >= 0 && idx < events.length) {
        events.splice(idx, 1);
        renderEvents();
      }
    });
  });
  
  // Bind step name input change
  evtList.querySelectorAll('.evt-name-input').forEach(function(el) {
    el.addEventListener('change', function(e) {
      e.stopPropagation();
      var idx = parseInt(el.dataset.eidx);
      if (!isNaN(idx) && idx >= 0 && idx < events.length) {
        events[idx].stepName = this.value || '';
      }
    });
    // Also save on blur
    el.addEventListener('blur', function(e) {
      var idx = parseInt(this.dataset.eidx);
      if (!isNaN(idx) && idx >= 0 && idx < events.length) {
        events[idx].stepName = this.value || '';
      }
    });
  });
}

function renderTabs(tabs) {

  console.log("[API Probe] renderTabs called with", tabs.length, "tabs");
  tabList.innerHTML = '';

  const allTab = document.createElement('div');

  allTab.className = 'tab-item' + (currentTabId === null ? ' active' : '');

  allTab.textContent = '\u6240\u6709\u6807\u7b7e\u9875';

  allTab.dataset.tabId = '';

  allTab.addEventListener('click', () => selectTab(null));

  tabList.appendChild(allTab);

  for (const t of tabs) {

    const el = document.createElement('div');

    el.className = 'tab-item' + (currentTabId === t.id ? ' active' : '');

    el.textContent = t.title?.slice(0, 30) || t.url?.slice(0, 30) || 'Tab ' + t.id;

    el.title = t.url || '';

    el.dataset.tabId = t.id;

    el.addEventListener('click', () => selectTab(t.id));

    tabList.appendChild(el);

  }

}

function selectTab(tabId) {

  currentTabId = tabId;

  tabList.querySelectorAll('.tab-item').forEach(el => {

    el.classList.toggle('active', el.dataset.tabId === String(tabId));

  });

  applyFilters();

}

btnRecord.addEventListener('click', () => {
  recording = !recording;


  btnRecord.textContent = recording ? '\u25cf \u5f55\u5236\u4e2d' : '\u5f55\u5236';

  btnRecord.classList.toggle('recording', recording);

  // 开始录制时清空旧数据，避免跨会话的去重残留导致新请求被忽略
  if (recording) {
    _receivedIds.clear();
    requests = [];
    filteredRequests = [];
    renderRequests();
    updateStatus();
    clearStorage();
  }

  // 始终发送录制消息，background 会广播到所有标签页
  // currentTabId 可为 null（"所有标签页"模式），此时不过滤请求
  chrome.runtime.sendMessage({ type: 'API_PROBE_SET_RECORDING', tabId: currentTabId, recording: recording });



  if (!recording) {
    currentTabId = null;
    applyFilters();
  }

});

function renderRequests() {

  if (filteredRequests.length === 0) {

    const hasFilters = methodFilter || keywordFilter;

    reqList.innerHTML = '<div class="empty-state"><div class="icon">' + (hasFilters ? '\ud83d\udd0e' : '\ud83d\udd0d') + '</div><div>' + (hasFilters ? '\u6ca1\u6709\u5339\u914d\u7684\u8bf7\u6c42' : (recording ? '\u7b49\u5f85 API \u8bf7\u6c42\u548c\u4e8b\u4ef6...' : '\u70b9\u51fb\u300c\u5f55\u5236\u300d\u5f00\u59cb\u63a2\u6d4b')) + '</div><div style="font-size:12px;margin-top:8px;color:#d1d5db">' + (hasFilters ? '\u5c1d\u8bd5\u8c03\u6574\u7b5b\u9009\u6761\u4ef6' : (recording ? '\u6355\u83b7 fetch/XHR/DOM/Console \u7b49\u4e8b\u4ef6' : '\u5f55\u5236\u540e\u7f51\u7edc\u8bf7\u6c42\u548c\u9875\u9762\u4e8b\u4ef6\u5c06\u88ab\u6355\u83b7')) + '</div></div>';

    return;

  }

  const sorted = [...filteredRequests];

    // Event type colors (DOM interaction events)
    var evtColors = { ui: 'method-EVT-UI' };
    var evtLabels = { ui: 'UI' };

  reqList.innerHTML = sorted.map((req, i) => {

    // ---- Event items ----
    if (req._isEvent) {
      var ec = evtColors[req.eventType] || 'method-GET';
      var el = evtLabels[req.eventType] || req.eventType.toUpperCase();
      var sub = req.eventSubtype || '';
      var detail = req.requestBody || '';
      var expandedClass = req._expanded ? ' expanded' : '';
      var time = new Date(req.timestamp).toLocaleTimeString();

      return '<div class="req-item evt-item' + expandedClass + '" data-idx="' + i + '">'
        + '<div class="req-summary">'
        + '<span class="req-method ' + ec + '">' + el + '</span>'
        + '<span class="req-status" style="color:#6b7280">' + sub + '</span>'
        + '<span class="req-path" title="' + escapeHtml(detail) + '">' + escapeHtml(detail.substring(0, 80)) + '</span>'
        + '<span class="req-duration">' + time + '</span>'
        + '<span class="req-expand">\u25b6</span></div>'
        + '<div class="req-detail">'
        + '<div class="detail-section"><div class="detail-label">TYPE</div><div class="detail-value">' + escapeHtml(req.eventType + '.' + sub) + '</div></div>'
        + (req.url ? '<div class="detail-section"><div class="detail-label">URL</div><div class="detail-value">' + escapeHtml(req.url) + '</div></div>' : '')
        + (detail ? '<div class="detail-section"><div class="detail-label">DATA</div><div class="detail-value">' + escapeHtml(detail) + '</div></div>' : '')
        + '<div class="detail-section"><div class="detail-label">TIME</div><div class="detail-value">' + escapeHtml(req.timestamp) + '</div></div>'
        + '</div></div>';
    }

    // ---- API Request items ----
    var displayMethod = req.type === 'SOCKETIO' ? 'SOCKETIO' : (req.type === 'MQTT' ? 'MQTT' : (isGraphQL(req) ? 'GQL' : req.method));
    const mc = methodColors[displayMethod] || 'method-GET';

    const sc = req.status >= 200 && req.status < 300 ? 'status-2xx' : req.status >= 400 ? 'status-4xx' : '';

    const p = getPath(req.url);

    const h = getHost(req.url);

    const proto = req.url && req.url.match(/^(https?):/i);

    const protoTag = proto ? '<span class="proto-tag ' + (proto[1].toLowerCase() === 'https' ? 'proto-https' : 'proto-http') + '">' + proto[1].toUpperCase() + '</span>' : '';

    const d = req.duration != null ? req.duration + 'ms' : '';

    var expandedClass = req._expanded ? ' expanded' : '';

    return '<div class="req-item' + expandedClass + '" data-idx="' + i + '">'

      + '<div class="req-summary">'

      + '<span class="req-method ' + mc + '">' + (isGraphQL(req) ? 'GQL' : req.method) + '</span>'

      + '<span class="req-status ' + sc + '">' + (req.status || 'ERR') + '</span>'

      + '<span class="req-path" title="' + escapeHtml(req.url) + '"><span style="color:#6b7280">' + escapeHtml(h) + '</span>' + escapeHtml(p) + '</span>'

      + '<span class="req-duration">' + d + '</span>'

      + '<span class="req-expand">\u25b6</span></div>'

      + '<div class="req-detail">'

      + '<div class="detail-section"><div class="detail-label">URL</div><div class="detail-value">' + escapeHtml(req.url) + '</div></div>'

      + (req.requestHeaders && Object.keys(req.requestHeaders).length ? '<div class="detail-section"><div class="detail-label">\u8bf7\u6c42\u5934 (' + Object.keys(req.requestHeaders).length + ')</div><div class="detail-value">' + escapeHtml(JSON.stringify(req.requestHeaders, null, 2)) + '</div></div>' : '')

      + (req.requestBody ? '<div class="detail-section"><div class="detail-label">\u8bf7\u6c42\u4f53</div><div class="detail-value">' + formatBody(req.requestBody) + '</div></div>' : '')

      + (req.responseBody ? '<div class="detail-section"><div class="detail-label">\u54cd\u5e94\u4f53' + (req.contentType ? ' (' + req.contentType + ')' : '') + '</div><div class="detail-value">' + formatBody(req.responseBody) + '</div></div>' : '')

      + (req.callStack ? '<div class="detail-section"><div class="detail-label">\u8c03\u7528\u94fe</div><div class="detail-value" style="font-size:10px;line-height:1.4;max-height:300px">' + escapeHtml(req.callStack) + '</div></div>' : '')

      + (req.error ? '<div class="detail-section"><div class="detail-label">\u9519\u8bef</div><div class="detail-value" style="color:#b91c1c">' + escapeHtml(req.error) + '</div></div>' : '')

      
+ (req.sseMessages && req.sseMessages.length ? '<div class="detail-section"><div class="detail-label">SSE \u6d88\u606f (' + req.sseMessages.length + ')</div><div class="detail-value sse-view">' + req.sseMessages.map(function(m) { return '<div class=\"sse-msg\"><span class=\"sse-event\">' + escapeHtml(m.event||'message') + '</span><span class=\"sse-data\">' + escapeHtml((m.data||'').toString().substring(0,500)) + '</span></div>'; }).reverse().join('') + '</div></div>' : '')
+ (req.wsMessages && req.wsMessages.length ? '<div class="detail-section"><div class="detail-label">WebSocket \u6d88\u606f (' + req.wsMessages.length + ')</div><div class="detail-value ws-view">' + req.wsMessages.map(function(m) { var dir = m.direction === 'send' ? '\u2192' : (m.direction === 'receive' ? '\u2190' : (m.direction === 'close' ? '\u2715' : '\u26a0')); var cls = m.direction === 'send' ? 'ws-send' : (m.direction === 'receive' ? 'ws-receive' : 'ws-event'); var extra = m.direction === 'close' ? (' code=' + (m.code||'') + ' reason=' + escapeHtml(m.reason||'')) : ''; return '<div class=\"ws-msg ' + cls + '\"><span class=\"ws-dir\">' + dir + '</span><span class=\"ws-data\">' + escapeHtml((m.data||extra||'').toString().substring(0,500)) + '</span></div>'; }).reverse().join('') + '</div></div>' : '')

+ '<div class="detail-section"><div class="detail-label">\u65f6\u95f4</div><div class="detail-value">' + new Date(req.timestamp).toLocaleTimeString() + '</div></div>'

      + '</div></div>';

  }).join('');

  reqList.querySelectorAll('.req-item').forEach((el) => {

    el.addEventListener('click', (e) => {

      // 点击详情区域不触发折叠

      if (e.target.closest('.req-detail')) return;

      if (e.button === 0) {

        el.classList.toggle('expanded');

        var idx = parseInt(el.dataset.idx);

        var sorted2 = [...filteredRequests];

        var r = sorted2[idx];

        if (r) r._expanded = el.classList.contains('expanded');

      }

    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const idx = parseInt(el.dataset.idx);
      const req = sorted[idx];
      if (req) showCtxMenu(e, req);
    });

  });

}

// ===== 工作流变量面板更新 =====
function updateVarsPanel() {
  var varsPanel = document.getElementById('varsPanel');
  if (!varsPanel) return;
  
  var varsList = document.getElementById('varsList');
  if (!varsList) return;
  
  if (Object.keys(workflowVars).length === 0) {
    varsList.innerHTML = '<span style="color:#9ca3af;font-size:11px">无变量</span>';
    return;
  }
  
  // 构建变量依赖图：哪些步骤产生了哪些变量
  var depHtml = '';
  
  // 从buildWorkflowExport获取变量依赖关系
  try {
    var wf = typeof buildWorkflowExport === 'function' ? buildWorkflowExport() : null;
    if (wf && wf.variable_dependencies && Object.keys(wf.variable_dependencies).length > 0) {
      depHtml += '<div style="margin:6px 0 4px;font-size:10px;color:#6b7280;font-weight:600">变量依赖关系</div>';
      depHtml += '<div style="font-size:10px;line-height:1.6">';
      for (var depKey in wf.variable_dependencies) {
        var dep = wf.variable_dependencies[depKey];
        depHtml += '<div style="display:flex;align-items:center;gap:4px;margin:2px 0">';
        depHtml += '<span style="color:#2563eb;font-weight:500">' + depKey + '</span>';
        depHtml += '<span style="color:#9ca3af">←</span>';
        depHtml += '<span style="color:#059669">步骤 ' + (dep.source_step || '?') + '</span>';
        if (dep.used_by && dep.used_by.length > 0) {
          depHtml += '<span style="color:#9ca3af">→</span>';
          depHtml += '<span style="color:#8b5cf6">' + dep.used_by.map(function(u) { return '步骤' + u; }).join(', ') + '</span>';
        }
        depHtml += '</div>';
      }
      depHtml += '</div><hr style="border:none;border-top:1px solid #e5e7eb;margin:6px 0">';
    }
  } catch(e) {}
  
  var html = depHtml;
  for (var key in workflowVars) {
    var val = workflowVars[key];
    var valStr = typeof val === 'object' ? JSON.stringify(val) : String(val);
    if (valStr.length > 50) valStr = valStr.substring(0, 50) + '...';
    html += '<div style="margin:2px 0;font-size:11px;display:flex;align-items:center;gap:4px">';
    html += '<span style="color:#2563eb;font-weight:500">' + key + '</span>';
    html += '<span style="color:#9ca3af">=</span>';
    html += '<span style="color:#059669;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px" title="' + escapeHtml(valStr) + '">' + escapeHtml(valStr) + '</span>';
    html += '</div>';
  }
  varsList.innerHTML = html;
}

function updateStatus() {

  const total = requests.length;

  const shown = filteredRequests.length;

  const hasFilters = methodFilter || keywordFilter || currentTabId !== null;

  filterCount.textContent = hasFilters ? shown + ' / ' + total : '';

  statusText.textContent = recording ? (hasFilters ? '\u25cf \u5f55\u5236\u4e2d (' + shown + '/' + total + ')' : '\u25cf \u5f55\u5236\u4e2d (' + total + ' \u4e2a\u8bf7\u6c42)') : (total > 0 ? (hasFilters ? '\u5df2\u6682\u505c (' + shown + '/' + total + ')' : '\u5df2\u6682\u505c (' + total + ' \u4e2a\u8bf7\u6c42)') : '\u5c31\u7eea');

}

// ===== 持久化存储 =====

var _saveTimer = null;

function saveRequests() {

  clearTimeout(_saveTimer);

  _saveTimer = setTimeout(function() {

    try {

      // 限制存储大小：最多保留最近 2000 条请求
      var toSave = requests;
      if (toSave.length > 2000) {
        toSave = toSave.slice(toSave.length - 2000);
      }

      // 同时保存去重 ID 集合（转为数组）
      var idsArray = Array.from(_receivedIds);

      chrome.storage.local.set({ apiProbeRequests: toSave, apiProbeReceivedIds: idsArray }, function() {

        if (chrome.runtime.lastError) {

          console.warn('[API Probe] Save error:', chrome.runtime.lastError.message);

        }

      });

    } catch(e) {

      console.warn('[API Probe] Save error:', e.message);

    }

  }, 300);

}

function loadRequests(callback) {

  try {

    chrome.storage.local.get(['apiProbeRequests', 'apiProbeReceivedIds'], function(result) {

      if (chrome.runtime.lastError) {

        console.warn('[API Probe] Load error:', chrome.runtime.lastError.message);

        if (callback) callback();

        return;

      }

      if (result.apiProbeRequests && Array.isArray(result.apiProbeRequests)) {

        requests.length = 0;

        for (var i = 0; i < result.apiProbeRequests.length; i++) {

          requests.push(result.apiProbeRequests[i]);

        }

      }

      // 恢复去重 ID 集合
      if (result.apiProbeReceivedIds && Array.isArray(result.apiProbeReceivedIds)) {

        _receivedIds = new Set(result.apiProbeReceivedIds);

      }

      if (callback) callback();

    });

  } catch(e) {

    console.warn('[API Probe] Load error:', e.message);

    if (callback) callback();

  }

}

function clearStorage() {

  _receivedIds = new Set();

  try {

    chrome.storage.local.remove(['apiProbeRequests', 'apiProbeReceivedIds'], function() {

      if (chrome.runtime.lastError) {

        console.warn('[API Probe] Clear storage error:', chrome.runtime.lastError.message);

      }

    });

  } catch(e) {

    console.warn('[API Probe] Clear storage error:', e.message);

  }

}

function requestToMarkdown(req, heading) {

  var lines = [];

  if (heading) lines.push('# ' + heading + '\n');

  lines.push('## \u57fa\u672c\u4fe1\u606f\n');

  lines.push('- **URL**: `' + req.url + '`');

  lines.push('- **\u65b9\u6cd5**: `' + req.method + '`');

  lines.push('- **\u72b6\u6001\u7801**: `' + (req.status || 'ERR') + '`');

  if (req.duration != null) lines.push('- **\u8017\u65f6**: ' + req.duration + 'ms');

  lines.push('- **\u65f6\u95f4**: ' + (req.timestamp || new Date().toISOString()) + '\n');

  if (req.requestHeaders && Object.keys(req.requestHeaders).length) {

    lines.push('## \u8bf7\u6c42\u5934\n\`\`\`json\n' + JSON.stringify(req.requestHeaders, null, 2) + '\n\`\`\`\n');

  }

  if (req.requestBody) {

    lines.push('## \u8bf7\u6c42\u4f53\n\`\`\`json\n' + (typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody, null, 2)) + '\n\`\`\`\n');

  }

  if (req.responseBody) {

    var lang = req.contentType?.includes('json') ? 'json' : req.contentType?.includes('html') ? 'html' : '';

    lines.push('## \u54cd\u5e94\u4f53\n\`\`\`' + lang + '\n' + (typeof req.responseBody === 'string' ? req.responseBody : JSON.stringify(req.responseBody, null, 2)) + '\n\`\`\`\n');

  }

  if (req.callStack) {

    lines.push('## \u8c03\u7528\u94fe\n\`\`\`\n' + req.callStack + '\n\`\`\`\n');

  }

  if (req.error) {

    lines.push('## \u9519\u8bef\n\`\`\`\n' + req.error + '\n\`\`\`\n');

  }

  return lines.join('\n');

}

function getPath(url) { try { var u = new URL(url); return u.pathname + u.search; } catch(e) { return url; } }

function getHost(url) { try { var u = new URL(url); return u.origin; } catch(e) { return ''; } }

function formatBody(body) {

  if (!body) return '';

  var str = typeof body === 'string' ? body : JSON.stringify(body, null, 2);

  var sliced = str.slice(0, 2000);

  // 尝试 JSON 高亮

  try {

    JSON.parse(sliced);

    return highlightJsonStr(sliced);

  } catch(e) {

    return escapeHtml(sliced);

  }

}

// 简易 JSON 字符串语法高亮（返回带 span 的 HTML）

function highlightJsonStr(str) {

  var html = escapeHtml(str);

  // key

  html = html.replace(/(&quot;[^&]+&quot;)(\s*:)/g, '<span class="jsk">$1</span>$2');

  // string value

  html = html.replace(/(:\s*)(&quot;[^&]*&quot;)/g, '$1<span class="jss">$2</span>');

  // number

  html = html.replace(/(:\s*)(-?\d+\.?\d*(?:[eE][+-]?\d+)?)/g, '$1<span class="jsn">$2</span>');

  // boolean

  html = html.replace(/(true|false)/g, '<span class="jsb">$1</span>');

  // null

  html = html.replace(/null/g, '<span class="jsnull">null</span>');

  return html;

}

function escapeAttr(str) {

  if (!str) return '';

  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

}

function escapeHtml(str) {

  if (!str) return '';

  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

}

function clearError(el, errorEl) {

  if (el) el.classList.remove('error');

  if (errorEl) errorEl.textContent = '';

}

// ===== 右键子菜单：导出代码 =====

ctxSubmenu.addEventListener('click', function(e) {

  var item = e.target.closest('.ctx-sub-item');

  if (!item || !ctxRequest) return;

  var fmt = item.dataset.format;

  hideCtxMenu();

  exportFormatted(fmt, ctxRequest);

});

// ===== 右键菜单显示/隐藏 =====

function hideCtxMenu() {
  ctxMenu.style.display = 'none';
}

function showCtxMenu(e, req) {
  ctxRequest = req;
  // 菜单位置跟随鼠标
  ctxMenu.style.left = e.clientX + 'px';
  ctxMenu.style.top = e.clientY + 'px';
  // 根据请求类型显示/隐藏专用菜单项
  document.getElementById('ctxWsView').style.display = (req.type === 'WS') ? '' : 'none';
  document.getElementById('ctxSseView').style.display = (req.type === 'SSE') ? '' : 'none';
  document.getElementById('ctxGqlConsole').style.display = isGraphQL(req) ? '' : 'none';
  // 填充集合子菜单
  var collSub = document.getElementById('ctxCollectionSubmenu');
  if (collSub) {
    var colls = (collData && collData.collections) || [];
    collSub.innerHTML = '';
    if (colls.length === 0) {
      collSub.innerHTML = '<div class="ctx-sub-item" style="color:#9ca3af;cursor:default">(无集合，请先创建)</div>';
    } else {
      colls.forEach(function(c, idx) {
        var item = document.createElement('div');
        item.className = 'ctx-sub-item';
        item.dataset.ci = idx;
        item.textContent = c.name || '未命名';
        item.addEventListener('click', function(e) {
          e.stopPropagation();
          addReqToCollection(idx);
        });
        collSub.appendChild(item);
      });
    }
  }
  ctxMenu.style.display = 'block';
}

// ===== 加入集合 =====

function addReqToCollection(ci) {
  var req = ctxRequest;
  if (!req) return;
  hideCtxMenu();
  if (!collData.collections[ci]) {
    showToast('集合不存在');
    return;
  }
  if (!collData.collections[ci].requests) collData.collections[ci].requests = [];
  // 避免重复添加
  for (var i = 0; i < collData.collections[ci].requests.length; i++) {
    if (collData.collections[ci].requests[i].id === req.id &&
        collData.collections[ci].requests[i].url === req.url) {
      showToast('该请求已在集合中');
      return;
    }
  }
  // 保存请求的副本
  collData.collections[ci].requests.push(JSON.parse(JSON.stringify(req)));
  saveColl();
  renderCollections();
  showToast('已加入集合「' + collData.collections[ci].name + '」');
}

function showToast(msg) {

  var t = document.getElementById('toast');

  if (!t) return;

  t.textContent = msg;

  t.classList.add('show');

  clearTimeout(t._timer);

  t._timer = setTimeout(function() { t.classList.remove('show'); }, 2000);

}

// ===== 代码生成器 =====

function generateSnippet(fmt, req) {

  var method = req.method || 'GET', url = req.url || '';

  var hdr = req.requestHeaders || {}, body = req.requestBody;

  switch (fmt) {

    case 'curl': return genCurl(method, url, hdr, body);

    case 'python': return genPython(method, url, hdr, body);

    case 'python-httpx': return genPythonHttpx(method, url, hdr, body);

    case 'js-fetch': return genJsFetch(method, url, hdr, body);

    case 'js-axios': return genJsAxios(method, url, hdr, body);

    default: return '';

  }

}

function genCurl(method, url, hdr, body) {

  var cmd = 'curl -X ' + method + ' "' + url + '"';

  var keys = Object.keys(hdr);

  for (var i = 0; i < keys.length; i++) {

    var v = String(hdr[keys[i]]).replace(/"/g, '\\"');

    cmd += ' \\n  -H "' + keys[i] + ': ' + v + '"';

  }

  if (body && method !== 'GET' && method !== 'HEAD') {

    var b = typeof body === 'string' ? body : JSON.stringify(body, null, 2);

    cmd += ' \\n  -d \'' + b.replace(/'/g, "'\\''") + '\'';

  }

  return cmd;

}

function genPython(method, url, hdr, body) {

  var sp = '    ';

  var lines = ['import requests', ''];

  var hdrStr = JSON.stringify(hdr, null, 6).replace(/\n\s*\}/, '\n' + sp + '}');

  if (Object.keys(hdr).length === 0) hdrStr = '{}';

  var hasBody = body && method !== 'GET' && method !== 'HEAD';

  var bodyArg = '';

  if (hasBody) {

    if (typeof body === 'string') {

      try { JSON.parse(body); bodyArg = 'json=' + body; } catch(e) { bodyArg = 'data=' + JSON.stringify(body); }

    } else { bodyArg = 'json=' + JSON.stringify(body, null, 4); }

  }

  var args = ['"' + url + '"', 'headers=' + hdrStr];

  if (bodyArg) args.push(bodyArg.replace(/\n/g, '\n' + sp + '  '));

  lines.push('response = requests.' + method.toLowerCase() + '(\n' + sp + args.join(',\n' + sp) + '\n)');

  lines.push('print(response.status_code)');

  lines.push('print(response.json())');

  return lines.join('\n');

}

function genPythonHttpx(method, url, hdr, body) {

  var sp = '    ';

  var lines = ['import httpx', ''];

  var hdrStr = JSON.stringify(hdr, null, 6).replace(/\n\s*\}/, '\n' + sp + '}');

  if (Object.keys(hdr).length === 0) hdrStr = '{}';

  var hasBody = body && method !== 'GET' && method !== 'HEAD';

  var bodyArg = '';

  if (hasBody) {

    if (typeof body === 'string') {

      try { JSON.parse(body); bodyArg = 'json=' + body; } catch(e) { bodyArg = 'content=' + JSON.stringify(body); }

    } else { bodyArg = 'json=' + JSON.stringify(body, null, 4); }

  }

  var args = ['"' + url + '"', 'headers=' + hdrStr];

  if (bodyArg) args.push(bodyArg.replace(/\n/g, '\n' + sp + '  '));

  lines.push('with httpx.Client() as client:');

  lines.push(sp + 'response = client.' + method.toLowerCase() + '(\n' + sp + sp + args.join(',\n' + sp + sp) + '\n' + sp + ')');

  lines.push('print(response.status_code)');

  lines.push('print(response.json())');

  return lines.join('\n');

}

function genJsFetch(method, url, hdr, body) {

  var obj = { method: method };

  if (Object.keys(hdr).length) obj.headers = hdr;

  if (body && method !== 'GET' && method !== 'HEAD')

    obj.body = typeof body === 'string' ? body : JSON.stringify(body, null, 2);

  return 'fetch("' + url + '", ' + JSON.stringify(obj, null, 2) + ')\n  .then(function(r) { return r.json(); })\n  .then(function(d) { console.log(d); });';

}

function genJsAxios(method, url, hdr, body) {

  var lines = ['axios({'];

  lines.push('  method: "' + method.toLowerCase() + '",');

  lines.push('  url: "' + url + '",');

  if (Object.keys(hdr).length)

    lines.push('  headers: ' + JSON.stringify(hdr, null, 2).replace(/\n/g, '\n  ') + ',');

  if (body && method !== 'GET' && method !== 'HEAD') {

    var b = typeof body === 'string' ? body : JSON.stringify(body, null, 2);

    lines.push('  data: ' + b.replace(/\n/g, '\n  ') + ',');

  }

  var last = lines.length - 1;

  lines[last] = lines[last].replace(/,$/, '');

  lines.push('}).then(function(r) { console.log(r.data); });');

  return lines.join('\n');

}

document.addEventListener('click', (e) => {

  if (ctxMenu.style.display === 'block' && !ctxMenu.contains(e.target)) hideCtxMenu();

  if (exportDropdown.classList.contains('show') && !btnExportWrap.contains(e.target)) {

    exportDropdown.classList.remove('show');

  }

});

document.addEventListener('keydown', (e) => {

  if (e.key === 'Escape') hideCtxMenu();

  // Ctrl+Enter: Send request in builder or replay
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    var builderPanel = document.getElementById('builderPanel');
    if (builderPanel && builderPanel.style.display !== 'none') {
      e.preventDefault();
      document.getElementById('builderSend').click();
      return;
    }
  }

});

// ===== Builder Panel (Full-screen) =====
var builderParamsVisible = false;

var builderHdrMode = 'kv';

var builderBodyMode = 'json';

function openBuilderPanel(req, proto) {
  builderCurrentReq = req || null;

  // Reset all protocol bodies to default
  var bodies = ['builderRestBody', 'builderGqlBody', 'builderSseBody', 'builderWsBody', 'builderSioBody', 'builderMqttBody'];
  for (var bi = 0; bi < bodies.length; bi++) {
    var el = document.getElementById(bodies[bi]);
    if (el) el.style.display = 'none';
  }

  // Determine protocol from request or parameter
  var targetProto = proto || 'rest';
  if (req) {
    var meth = (req.method || '').toUpperCase();
    if (meth === 'GQL' || isGraphQL(req)) targetProto = 'graphql';
    else if (req.type === 'WS' || req.type === 'WEBSOCKET') targetProto = 'ws';
    else if (req.type === 'SSE' || req.type === 'EVENTSOURCE') targetProto = 'sse';
    else if (req.type === 'SOCKETIO') targetProto = 'socketio';
    else if (req.type === 'MQTT') targetProto = 'mqtt';
  }
  
  // Update tabs
  var protoTabs = document.getElementById('builderProtoTabs');
  if (protoTabs) {
    protoTabs.querySelectorAll('.proto-tab').forEach(function(t) {
      t.classList.toggle('active', t.dataset.proto === targetProto);
    });
  }
  
  // Show target body
  var bodyMap = { rest: 'builderRestBody', graphql: 'builderGqlBody', sse: 'builderSseBody', ws: 'builderWsBody', socketio: 'builderSioBody', mqtt: 'builderMqttBody' };
  var showEl = document.getElementById(bodyMap[targetProto]);
  if (showEl) showEl.style.display = 'flex';
  
  // Update footer
  var hint = document.getElementById('builderFooterHint');
  var sendBtn = document.getElementById('builderSend');
  var names = { rest: 'REST API', graphql: 'GraphQL', sse: 'SSE 事件流', ws: 'WebSocket', socketio: 'Socket.IO', mqtt: 'MQTT' };
  if (hint) hint.textContent = names[targetProto];
  if (sendBtn) sendBtn.textContent = (targetProto === 'sse' || targetProto === 'ws') ? '▶ 连接' : '▶ 发送请求';
  
  builderProto = targetProto;

  // Reset form
  builderMethod.value = 'POST';
  builderUrl.value = '';
  builderHeaders.value = '{}';
  clearError(builderUrl, null);
  clearError(builderHeaders, builderHeadersError);
  clearError(builderBody, builderBodyError);
  builderHeadersError.textContent = '';
  builderBodyError.textContent = '';

  // Headers KV reset

  builderHdrMode = 'kv';

  builderHdrRows.innerHTML = '';

  builderHdrKvEditor.style.display = '';

  builderHeaders.style.display = 'none';

  builderHdrModeSwitch.querySelectorAll('.hdr-mode-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.mode === 'kv'); });

  // Body reset

  builderBodyMode = 'json';

  builderBodyType.value = 'json';

  builderBodyKvEditor.style.display = 'none';

  builderBodyKvRows.innerHTML = '';

  builderBody.style.display = '';

  builderBody.value = '';

  toggleBuilderBodySection();

  // Params reset

  builderParamsVisible = false;

  builderParamsTable.style.display = 'none';

  builderParamsRows.innerHTML = '';

  builderParamsToggle.querySelector('.params-arrow').classList.remove('open');

  // Response reset

  builderResponse.classList.remove('active');

  builderResponse.style.display = 'none';

  builderRespError.style.display = 'none';

  // 如果传入请求对象（重放模式），预填参数
  if (req) {
    if (targetProto === 'graphql') {
      document.getElementById('builderGqlUrl').value = req.url || '';
      if (req.requestBody) {
        try {
          var body = typeof req.requestBody === 'string' ? JSON.parse(req.requestBody) : req.requestBody;
          var qel = document.getElementById('builderGqlQuery');
          var vel = document.getElementById('builderGqlVariables');
          if (body.query) qel.value = body.query;
          else if (typeof body === 'string') qel.value = body;
          else qel.value = JSON.stringify(body, null, 2);
          if (body.variables && vel) vel.value = JSON.stringify(body.variables, null, 2);
        } catch(e) {
          document.getElementById('builderGqlQuery').value = String(req.requestBody);
        }
      }
    } else if (targetProto === 'sse') {
      document.getElementById('builderSseUrl').value = req.url || '';
    } else if (targetProto === 'ws') {
      document.getElementById('builderWsUrl').value = (req.url || '').replace(/^http/i, 'ws');
    } else {
      builderMethod.value = req.method || 'GET';
      var rurl = req.url || '';
      if (rurl && !rurl.match(/^https?:\/\//i)) {
        var pageUrl = req.pageUrl || '';
        if (pageUrl) {
          try { var origin = new URL(pageUrl).origin; rurl = rurl.startsWith('/') ? origin + rurl : origin + '/' + rurl; } catch(e) {}
        }
      }
      builderUrl.value = rurl;
      if (req.requestHeaders) {
        try {
          var h = typeof req.requestHeaders === 'string' ? JSON.parse(req.requestHeaders) : req.requestHeaders;
          builderHeaders.value = JSON.stringify(h, null, 2);
        } catch(e) {}
      }
      if (req.requestBody) {
        try {
          var b = typeof req.requestBody === 'string' ? req.requestBody : JSON.stringify(req.requestBody, null, 2);
          builderBody.value = b;
        } catch(e) {}
      }
    }
  }

  // Show panel, hide main content

  builderPanel.classList.add('active');

}

function closeBuilderPanel() {

  builderPanel.classList.remove('active');

}

builderClose.addEventListener('click', closeBuilderPanel);

// Method toggle -> body section visibility

function toggleBuilderBodySection() {

  var m = builderMethod.value;

  builderBodySection.style.display = (m === 'POST' || m === 'PUT' || m === 'PATCH') ? '' : 'none';

}

builderMethod.addEventListener('change', toggleBuilderBodySection);

// Headers KV/Raw switch

builderHdrModeSwitch.addEventListener('click', function(e) {

  var btn = e.target.closest('.hdr-mode-btn');

  if (!btn) return;

  var mode = btn.dataset.mode;

  builderHdrModeSwitch.querySelectorAll('.hdr-mode-btn').forEach(function(b) { b.classList.remove('active'); });

  btn.classList.add('active');

  builderHdrMode = mode;

  if (mode === 'kv') {

    builderHdrKvEditor.style.display = '';

    builderHeaders.style.display = 'none';

    try {

      var obj = JSON.parse(builderHeaders.value || '{}');

      builderHdrRows.innerHTML = '';

      var keys = Object.keys(obj);

      for (var i = 0; i < keys.length; i++) {

        builderAddHdrRow(keys[i], String(obj[keys[i]]));

      }

    } catch(e) {}

  } else {

    builderHdrKvEditor.style.display = 'none';

    builderHeaders.style.display = '';

    var rows = [];

    var els = builderHdrRows.querySelectorAll('.param-row');

    for (var i = 0; i < els.length; i++) {

      var k = els[i].querySelector('.param-key').value.trim();

      var v = els[i].querySelector('.param-val').value;

      if (k) rows.push({ key: k, value: v });

    }

    var obj = {};

    for (var i = 0; i < rows.length; i++) obj[rows[i].key] = rows[i].value;

    builderHeaders.value = JSON.stringify(obj, null, 2);

  }

});

function builderAddHdrRow(key, val) {

  var row = document.createElement('div');

  row.className = 'param-row';

  row.innerHTML = '<input class="param-key" type="text" value="' + escapeAttr(key || '') + '" placeholder="Header name">'

    + '<input class="param-val" type="text" value="' + escapeAttr(val || '') + '" placeholder="Value">'

    + '<button class="param-del" title="Remove">\u2715</button>';

  row.querySelector('.param-del').addEventListener('click', function() {

    row.remove();

  });

  builderHdrRows.appendChild(row);

}

builderAddHdr.addEventListener('click', function() { builderAddHdrRow('', ''); });

// Body type switch

builderBodyType.addEventListener('change', function() {

  builderBodyMode = builderBodyType.value;

  var useRaw = (builderBodyMode === 'json' || builderBodyMode === 'xml' || builderBodyMode === 'text' || builderBodyMode === 'html' || builderBodyMode === 'yaml');

  if (useRaw) {

    builderBodyKvEditor.style.display = 'none';

    builderBody.style.display = '';

    var placeholders = {
      json: '{\n  "key": "value"\n}',
      xml: '<root>\n  <element>value</element>\n</root>',
      text: 'Plain text body...',
      html: '<html>\n  <body>Hello</body>\n</html>',
      yaml: 'key: value\nlist:\n  - item1\n  - item2'
    };

    builderBody.placeholder = placeholders[builderBodyMode] || '';

  } else {

    builderBodyKvEditor.style.display = '';

    builderBody.style.display = 'none';

    builderBodyKvRows.innerHTML = '';

    try {

      var obj = JSON.parse(builderBody.value || '{}');

      for (var k in obj) {

        if (obj.hasOwnProperty(k)) builderAddBodyKvRow(k, String(obj[k]));

      }

    } catch(e) {}

  }

});

function builderAddBodyKvRow(key, val) {

  var row = document.createElement('div');

  row.className = 'param-row';

  row.innerHTML = '<input class="param-key" type="text" value="' + escapeAttr(key || '') + '" placeholder="Key">'

    + '<input class="param-val" type="text" value="' + escapeAttr(val || '') + '" placeholder="Value">'

    + '<button class="param-del" title="Remove">\u2715</button>';

  row.querySelector('.param-del').addEventListener('click', function() { row.remove(); });

  builderBodyKvRows.appendChild(row);

}

builderAddBodyKv.addEventListener('click', function() { builderAddBodyKvRow('', ''); });

// Params toggle

builderParamsToggle.addEventListener('click', function() {

  builderParamsVisible = !builderParamsVisible;

  builderParamsTable.style.display = builderParamsVisible ? '' : 'none';

  builderParamsToggle.querySelector('.params-arrow').classList.toggle('open', builderParamsVisible);

  if (builderParamsVisible) {

    builderRefreshParams();

  }

});

function builderRefreshParams() {

  var url = builderUrl.value.trim();

  try {

    var u = new URL(url);

    builderParamsRows.innerHTML = '';

    u.searchParams.forEach(function(v, k) {

      var row = document.createElement('div');

      row.className = 'param-row';

      row.innerHTML = '<input class="param-key" type="text" value="' + escapeAttr(k) + '" placeholder="key">'

        + '<input class="param-val" type="text" value="' + escapeAttr(v) + '" placeholder="value">'

        + '<button class="param-del" title="Remove">\u2715</button>';

      row.querySelector('.param-del').addEventListener('click', function() {

        row.remove();

        builderSyncParamsToUrl();

      });

      var keyInput = row.querySelector('.param-key');

      var valInput = row.querySelector('.param-val');

      keyInput.addEventListener('input', builderSyncParamsToUrl);

      valInput.addEventListener('input', builderSyncParamsToUrl);

      builderParamsRows.appendChild(row);

    });

  } catch(e) {}

}

function builderSyncParamsToUrl() {

  var url = builderUrl.value.trim();

  if (!url) return;

  try {

    var u = new URL(url);

    u.search = '';

    var els = builderParamsRows.querySelectorAll('.param-row');

    for (var i = 0; i < els.length; i++) {

      var k = els[i].querySelector('.param-key').value.trim();

      var v = els[i].querySelector('.param-val').value;

      if (k) u.searchParams.append(k, v || '');

    }

    builderUrl.value = u.toString();

  } catch(e) {}

}

builderAddParam.addEventListener('click', function() {

  var row = document.createElement('div');

  row.className = 'param-row';

  row.innerHTML = '<input class="param-key" type="text" value="" placeholder="key">'

    + '<input class="param-val" type="text" value="" placeholder="value">'

    + '<button class="param-del" title="Remove">\u2715</button>';

  row.querySelector('.param-del').addEventListener('click', function() {

    row.remove();

    builderSyncParamsToUrl();

  });

  var keyInput = row.querySelector('.param-key');

  var valInput = row.querySelector('.param-val');

  keyInput.addEventListener('input', builderSyncParamsToUrl);

  valInput.addEventListener('input', builderSyncParamsToUrl);

  builderParamsRows.appendChild(row);

});

builderUrl.addEventListener('input', function() {

  if (builderParamsVisible) builderRefreshParams();

});

// ===== Send request from builder =====


// ===== Builder Protocol Switcher =====
var builderProto = 'rest';
var builderCurrentReq = null;

document.getElementById('builderProtoTabs').addEventListener('click', function(e) {
  var tab = e.target.closest('.proto-tab');
  if (!tab) return;
  var proto = tab.dataset.proto;
  if (proto === builderProto) return;
  
  // Update tabs
  this.querySelectorAll('.proto-tab').forEach(function(t) { t.classList.remove('active'); });
  tab.classList.add('active');
  
  // Hide all proto bodies
  document.getElementById('builderRestBody').style.display = 'none';
  document.getElementById('builderGqlBody').style.display = 'none';
  document.getElementById('builderSseBody').style.display = 'none';
  document.getElementById('builderWsBody').style.display = 'none';
  document.getElementById('builderSioBody').style.display = 'none';
  document.getElementById('builderMqttBody').style.display = 'none';
  
  // Show selected proto body
  var bodyMap = { rest: 'builderRestBody', graphql: 'builderGqlBody', sse: 'builderSseBody', ws: 'builderWsBody', socketio: 'builderSioBody', mqtt: 'builderMqttBody' };
  var showEl = document.getElementById(bodyMap[proto]);
  showEl.style.display = 'flex';
  
  // Update footer
  var hint = document.getElementById('builderFooterHint');
  var sendBtn = document.getElementById('builderSend');
  var names = { rest: 'REST API', graphql: 'GraphQL', sse: 'SSE 事件流', ws: 'WebSocket', socketio: 'Socket.IO', mqtt: 'MQTT' };
  hint.textContent = names[proto] || proto;
  
  if (proto === 'sse' || proto === 'ws') {
    sendBtn.textContent = '▶ 连接';
  } else {
    sendBtn.textContent = '▶ 发送请求';
  }
  
  // Hide response when switching
  var resp = document.getElementById('builderResponse');
  if (resp) resp.style.display = 'none';
  
  builderProto = proto;
});

// ===== Builder: GraphQL =====
(function() {
  var gqlQuery = document.getElementById('builderGqlQuery');
  var gqlVariables = document.getElementById('builderGqlVariables');
  var gqlUrl = document.getElementById('builderGqlUrl');
  var gqlStatus = document.getElementById('builderGqlStatus');
  var gqlRespBody = document.getElementById('gqlRespBody');
  var gqlRespHeaders = document.getElementById('gqlRespHeaders');
  var gqlRespErrors = document.getElementById('gqlRespErrors');
  var gqlSchemaTree = document.getElementById('builderGqlSchemaTree');
  var _gqlSchemaTypes = [];

  // ---- Editor tabs ----
  document.querySelectorAll('.gql-editor-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.gql-editor-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var pane = tab.dataset.pane;
      document.getElementById('gqlPaneQuery').style.display = pane === 'query' ? 'flex' : 'none';
      document.getElementById('gqlPaneVariables').style.display = pane === 'variables' ? 'flex' : 'none';
      document.getElementById('gqlPaneHeaders').style.display = pane === 'headers' ? 'flex' : 'none';
    });
  });

  // ---- Response tabs ----
  document.querySelectorAll('.gql-resp-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.gql-resp-tab').forEach(function(t) { t.classList.remove('active'); });
      tab.classList.add('active');
      var pane = tab.dataset.pane;
      gqlRespBody.style.display = pane === 'body' ? '' : 'none';
      gqlRespHeaders.style.display = pane === 'headers' ? '' : 'none';
      gqlRespErrors.style.display = pane === 'errors' ? '' : 'none';
    });
  });

  // ---- Tab key in query editor ----
  gqlQuery.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = this.selectionStart, end = this.selectionEnd;
      this.value = this.value.substring(0, s) + '  ' + this.value.substring(end);
      this.selectionStart = this.selectionEnd = s + 2;
    }
    // Ctrl+Enter to execute
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      document.getElementById('builderGqlExecute').click();
    }
  });

  gqlVariables.addEventListener('keydown', function(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var s = this.selectionStart, end = this.selectionEnd;
      this.value = this.value.substring(0, s) + '  ' + this.value.substring(end);
      this.selectionStart = this.selectionEnd = s + 2;
    }
  });

  // ---- Execute query ----
  document.getElementById('builderGqlExecute').addEventListener('click', function() {
    var query = gqlQuery.value.trim();
    var url = gqlUrl.value.trim();
    if (!query) { gqlStatus.textContent = '请输入查询'; return; }
    if (!url) { gqlStatus.textContent = '请输入端点 URL'; return; }
    if (!url.match(/^https?:\/\//i)) url = 'https://' + url;

    // Parse variables
    var variables = null;
    var varsStr = gqlVariables.value.trim();
    if (varsStr) {
      try { variables = JSON.parse(varsStr); }
      catch(e) { gqlStatus.textContent = 'Variables JSON 错误'; return; }
    }

    // Collect headers
    var gqlHeaders = { 'Content-Type': 'application/json' };
    document.querySelectorAll('#builderGqlHdrRows .param-row').forEach(function(row) {
      var k = row.querySelector('.param-key').value.trim();
      var v = row.querySelector('.param-val').value;
      if (k) gqlHeaders[k] = v;
    });

    gqlStatus.textContent = '执行中...';
    gqlRespBody.textContent = '';
    gqlRespHeaders.textContent = '';
    gqlRespErrors.textContent = '';

    var payload = { query: query };
    if (variables) payload.variables = variables;

    var startTime = Date.now();
    proxyFetch(url, 'POST', gqlHeaders, JSON.stringify(payload))
      .then(function(r) {
        var duration = Date.now() - startTime;
        var respHeaders = {};
        r.headers.forEach(function(v, k) { respHeaders[k] = v; });
        gqlRespHeaders.textContent = JSON.stringify(respHeaders, null, 2);
        return r.text().then(function(bodyText) {
          gqlStatus.textContent = '完成 (' + duration + 'ms)';

          try {
            var parsed = JSON.parse(bodyText);
            // Show errors separately
            if (parsed.errors && parsed.errors.length) {
              var errLines = [];
              parsed.errors.forEach(function(err, i) {
                errLines.push('[' + (i + 1) + '] ' + (err.message || 'Unknown error'));
                if (err.locations) {
                  err.locations.forEach(function(loc) {
                    errLines.push('    at line ' + loc.line + ', column ' + loc.column);
                  });
                }
                if (err.path) errLines.push('    path: ' + err.path.join(' > '));
              });
              gqlRespErrors.textContent = errLines.join('\n');
              // Switch to errors tab if no data
              if (!parsed.data) {
                document.querySelectorAll('.gql-resp-tab').forEach(function(t) { t.classList.remove('active'); });
                document.querySelector('.gql-resp-tab[data-pane="errors"]').classList.add('active');
                gqlRespBody.style.display = 'none';
                gqlRespHeaders.style.display = 'none';
                gqlRespErrors.style.display = '';
              }
            } else {
              gqlRespErrors.textContent = '(no errors)';
            }
            // Show data
            gqlRespBody.textContent = JSON.stringify(parsed.data || parsed, null, 2);
          } catch(e) {
            gqlRespBody.textContent = bodyText;
          }
        });
      })
      .catch(function(err) {
        gqlStatus.textContent = '错误';
        gqlRespBody.textContent = '请求失败: ' + err.message;
      });
  });

  // ---- Pretty print ----
  document.getElementById('builderGqlPretty').addEventListener('click', function() {
    var text = gqlQuery.value;
    try {
      var parsed = JSON.parse(text);
      gqlQuery.value = JSON.stringify(parsed, null, 2);
    } catch(e) {
      var lines = text.split('\n');
      var out = [];
      var indent = 0;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) continue;
        if (/^[}\])]/.test(line)) indent = Math.max(0, indent - 1);
        out.push('  '.repeat(indent) + line);
        if (/[{(\[]/.test(line) && !/[}\])]/.test(line)) indent++;
      }
      gqlQuery.value = out.join('\n');
    }
  });

  // ---- Minify ----
  document.getElementById('builderGqlMinify').addEventListener('click', function() {
    gqlQuery.value = gqlQuery.value.replace(/\s+/g, ' ').trim();
  });

  // ---- Query snippets ----
  document.getElementById('builderGqlSnippet').addEventListener('click', function() {
    var types = _gqlSchemaTypes || [];
    var queryTypes = types.filter(function(t) { return t.kind === 'OBJECT' && t.name && !t.name.startsWith('__'); });
    if (queryTypes.length === 0) {
      gqlQuery.value = 'query {\n  # 在此输入查询\n  field\n}';
      return;
    }
    // Build a sample query from the first Query type
    var queryType = types.find(function(t) { return t.name === 'Query'; }) || queryTypes[0];
    if (!queryType || !queryType.fields || !queryType.fields.length) {
      gqlQuery.value = 'query {\n  # 在此输入查询\n  field\n}';
      return;
    }
    var qLines = ['query {'];
    var fields = queryType.fields.slice(0, 3);
    fields.forEach(function(f) {
      if (f.args && f.args.length) {
        var argStr = f.args.map(function(a) { return a.name + ': $' + a.name; }).join(', ');
        qLines.push('  ' + f.name + '(' + argStr + ') {');
        // Try to add sub-fields from return type
        var retType = f.type;
        while (retType && retType.ofType) retType = retType.ofType;
        if (retType && retType.kind === 'OBJECT') {
          var subType = types.find(function(t) { return t.name === retType.name; });
          if (subType && subType.fields) {
            subType.fields.slice(0, 3).forEach(function(sf) { qLines.push('    ' + sf.name); });
          }
        }
        qLines.push('  }');
      } else {
        qLines.push('  ' + f.name);
      }
    });
    qLines.push('}');
    gqlQuery.value = qLines.join('\n');

    // Build variables
    var vLines = ['{'];
    fields.forEach(function(f) {
      if (f.args && f.args.length) {
        f.args.forEach(function(a) {
          var def = '';
          var tn = a.type;
          while (tn && tn.ofType) tn = tn.ofType;
          if (tn && tn.name === 'Int') def = '0';
          else if (tn && tn.name === 'Float') def = '0.0';
          else if (tn && tn.name === 'Boolean') def = 'false';
          else def = '""';
          vLines.push('  "' + a.name + '": ' + def);
        });
      }
    });
    vLines.push('}');
    gqlVariables.value = vLines.join('\n');
  });

  // ---- Schema load ----
  document.getElementById('builderGqlLoadSchema').addEventListener('click', function() {
    var url = gqlUrl.value.trim();
    if (!url) { gqlStatus.textContent = '请输入端点 URL'; return; }
    if (!url.match(/^https?:\/\//i)) url = 'https://' + url;

    gqlSchemaTree.innerHTML = '加载中...';
    gqlStatus.textContent = 'Schema 自省中...';

    var introspectionQuery = 'query IntrospectionQuery { __schema { queryType { name } mutationType { name } subscriptionType { name } types { kind name description fields(includeDeprecated:true) { name description args { name description type { kind name ofType { kind name } } } type { kind name ofType { kind name ofType { kind name } } } enumValues { name description } inputFields { name description type { kind name ofType { kind name } } } } } }';

    proxyFetch(url, 'POST', { 'Content-Type': 'application/json' }, JSON.stringify({ query: introspectionQuery }))
      .then(function(r) { return r.text(); })
      .then(function(bodyText) {
        var result = JSON.parse(bodyText);
        if (result.errors) {
          gqlSchemaTree.innerHTML = '<span style="color:#b91c1c">Schema introspection failed</span>';
          gqlStatus.textContent = 'Error: ' + result.errors[0].message;
          return;
        }
        var schema = result.data.__schema;
        _gqlSchemaTypes = schema.types || [];

        // Build collapsible type tree
        var html = '';
        // Show query/mutation/subscription types first
        var entryTypes = [];
        if (schema.queryType) entryTypes.push({ label: 'Query', type: schema.queryType });
        if (schema.mutationType) entryTypes.push({ label: 'Mutation', type: schema.mutationType });
        if (schema.subscriptionType) entryTypes.push({ label: 'Subscription', type: schema.subscriptionType });

        entryTypes.forEach(function(entry) {
          var fullType = schema.types.find(function(t) { return t.name === entry.type.name; });
          if (!fullType || !fullType.fields) return;
          html += '<div style="margin:4px 0 2px;font-weight:600;color:#059669;font-size:11px">' + entry.label + '</div>';
          fullType.fields.forEach(function(f) {
            var typeStr = formatGQLType(f.type);
            html += '<div class="gql-field" style="margin:1px 0 1px 8px;font-size:10px;color:#374151" data-field="' + escapeAttr(f.name) + '" data-type="' + escapeAttr(typeStr) + '">';
            html += '<span style="color:#2563eb;font-weight:600">' + f.name + '</span>';
            if (f.args && f.args.length) {
              var argsStr = f.args.map(function(a) { return a.name + ': ' + formatGQLType(a.type); }).join(', ');
              html += '<span style="color:#9ca3af">(' + escapeHtml(argsStr) + ')</span>';
            }
            html += '<span style="color:#9ca3af;margin-left:4px">→ ' + escapeHtml(typeStr) + '</span>';
            if (f.description) html += '<div style="font-size:9px;color:#9ca3af;margin-left:8px">' + escapeHtml(f.description.slice(0, 80)) + '</div>';
            html += '</div>';
          });
        });

        // Show custom types
        var customTypes = schema.types.filter(function(t) {
          return t.name && !t.name.startsWith('__') && t.kind !== 'OBJECT';
        });
        if (customTypes.length) {
          html += '<div style="margin:8px 0 2px;font-weight:600;color:#6b7280;font-size:10px;border-top:1px solid #e5e7eb;padding-top:4px">Types</div>';
          customTypes.forEach(function(t) {
            html += '<div class="gql-type" style="margin:2px 0 1px 8px;font-size:10px;color:#374151" data-type-name="' + escapeAttr(t.name) + '">';
            html += '<span style="color:#8b5cf6;font-weight:500">' + t.kind.toLowerCase() + '</span> ';
            html += '<span style="color:#2563eb">' + t.name + '</span>';
            if (t.description) html += '<span style="color:#9ca3af;margin-left:4px;font-size:9px">' + escapeHtml(t.description.slice(0, 50)) + '</span>';
            // Show fields for OBJECT types
            if (t.fields && t.kind === 'OBJECT') {
              html += '<div style="margin:1px 0 1px 16px;font-size:9px;color:#6b7280">';
              t.fields.forEach(function(f) {
                html += '<div class="gql-field" data-field="' + escapeAttr(f.name) + '">' + f.name + ' <span style="color:#9ca3af">→ ' + escapeHtml(formatGQLType(f.type)) + '</span></div>';
              });
              html += '</div>';
            }
            // Show enum values
            if (t.enumValues && t.enumValues.length) {
              html += '<div style="margin:1px 0 1px 16px;font-size:9px;color:#6b7280">';
              t.enumValues.forEach(function(ev) {
                html += '<div>' + ev.name + '</div>';
              });
              html += '</div>';
            }
            html += '</div>';
          });
        }

        gqlSchemaTree.innerHTML = html || '<span style="color:#9ca3af">无类型定义</span>';

        // Click to insert field names
        gqlSchemaTree.querySelectorAll('.gql-field').forEach(function(el) {
          el.addEventListener('click', function() {
            var fieldName = this.dataset.field;
            if (!fieldName) return;
            var pos = gqlQuery.selectionStart;
            gqlQuery.value = gqlQuery.value.substring(0, pos) + fieldName + gqlQuery.value.substring(gqlQuery.selectionEnd);
            gqlQuery.selectionStart = gqlQuery.selectionEnd = pos + fieldName.length;
            gqlQuery.focus();
          });
        });

        var typeCount = customTypes.length + (entryTypes.length ? entryTypes.length : 0);
        gqlStatus.textContent = 'Schema loaded (' + schema.types.length + ' types)';
      })
      .catch(function(err) {
        gqlSchemaTree.innerHTML = '<span style="color:#b91c1c">Request failed: ' + escapeHtml(err.message) + '</span>';
        gqlStatus.textContent = 'Error: ' + err.message;
      });
  });

  function formatGQLType(type) {
    if (!type) return 'Unknown';
    if (type.kind === 'NON_NULL') return formatGQLType(type.ofType) + '!';
    if (type.kind === 'LIST') return '[' + formatGQLType(type.ofType) + ']';
    return type.name || 'Unknown';
  }

  document.getElementById('builderGqlClearSchema').addEventListener('click', function() {
    gqlSchemaTree.innerHTML = '点击「加载 Schema」浏览类型定义';
    gqlStatus.textContent = '';
    _gqlSchemaTypes = [];
  });

  // ---- Headers editor ----
  document.getElementById('builderGqlAddHdr').addEventListener('click', function() {
    var row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = '<input class="param-key" type="text" value="" placeholder="Header name">'
      + '<input class="param-val" type="text" value="" placeholder="Value">'
      + '<button class="param-del" title="Remove">\u2715</button>';
    row.querySelector('.param-del').addEventListener('click', function() { row.remove(); });
    document.getElementById('builderGqlHdrRows').appendChild(row);
  });

})();

// ===== Builder: SSE =====
(function() {
  var _sseSource = null;
  var _sseMsgCount = 0;
  var log = document.getElementById('builderSseLog');
  var status = document.getElementById('builderSseStatus');
  var countEl = document.getElementById('builderSseCount');
  var connectBtn = document.getElementById('builderSseConnect');
  var disconnectBtn = document.getElementById('builderSseDisconnect');
  var autoScroll = document.getElementById('builderSseAutoScroll');

  function sseAppendMsg(badge, badgeClass, text) {
    var div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = '<span class="msg-time">' + new Date().toLocaleTimeString() + '</span><span class="msg-badge ' + badgeClass + '">' + badge + '</span><span class="msg-data">' + escapeHtml(text) + '</span>';
    log.appendChild(div);
    _sseMsgCount++;
    if (countEl) countEl.textContent = _sseMsgCount + ' 条';
    if (autoScroll && autoScroll.checked) log.scrollTop = log.scrollHeight;
  }

  function collectSseHeaders() {
    var h = {};
    document.querySelectorAll('#builderSseHdrRows .param-row').forEach(function(row) {
      var k = row.querySelector('.param-key').value.trim();
      var v = row.querySelector('.param-val').value;
      if (k) h[k] = v;
    });
    return h;
  }

  connectBtn.addEventListener('click', function() {
    if (_sseSource) { _sseSource.close(); _sseSource = null; }
    var url = document.getElementById('builderSseUrl').value.trim();
    if (!url) return;
    if (!url.match(/^https?:\/\//i)) url = 'https://' + url;

    log.innerHTML = '';
    sseAppendMsg('SYS', 'sys', '正在连接 ' + url);
    status.textContent = '连接中...';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = '';

    try {
      _sseSource = new EventSource(url);
      _sseSource.onopen = function() {
        status.textContent = '已连接';
        sseAppendMsg('✓', 'info', '连接成功');
      };
      _sseSource.onmessage = function(e) {
        var data = e.data || '';
        try { data = JSON.stringify(JSON.parse(data), null, 2); } catch(ex) {}
        sseAppendMsg('MSG', 'recv', data.substring(0, 2000));
      };
      _sseSource.addEventListener('error', function(e) {
        if (_sseSource && _sseSource.readyState === EventSource.CLOSED) {
          status.textContent = '已断开';
          sseAppendMsg('✕', 'err', '连接已断开');
          connectBtn.style.display = '';
          disconnectBtn.style.display = 'none';
          _sseSource = null;
        }
      });
      // Listen for custom event types
      var origAdd = _sseSource.addEventListener.bind(_sseSource);
    } catch(err) {
      status.textContent = '连接失败';
      sseAppendMsg('✕', 'err', err.message);
      connectBtn.style.display = '';
      disconnectBtn.style.display = 'none';
    }
  });

  disconnectBtn.addEventListener('click', function() {
    if (_sseSource) { _sseSource.close(); _sseSource = null; }
    connectBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    status.textContent = '已断开';
    sseAppendMsg('■', 'sys', '手动断开');
  });

  document.getElementById('builderSseClear').addEventListener('click', function() {
    log.innerHTML = '';
    _sseMsgCount = 0;
    if (countEl) countEl.textContent = '';
  });

  // Headers toggle
  var sseHdrToggle = document.getElementById('builderSseHdrToggle');
  var sseHdrPanel = document.getElementById('builderSseHdrPanel');
  if (sseHdrToggle && sseHdrPanel) {
    sseHdrToggle.addEventListener('click', function() {
      var vis = sseHdrPanel.style.display !== 'none';
      sseHdrPanel.style.display = vis ? 'none' : '';
      sseHdrToggle.querySelector('.params-arrow').textContent = vis ? '\u25b8' : '\u25be';
    });
  }
  document.getElementById('builderSseAddHdr').addEventListener('click', function() {
    var row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = '<input class="param-key" type="text" value="" placeholder="Key"><input class="param-val" type="text" value="" placeholder="Value"><button class="param-del" title="Remove">\u2715</button>';
    row.querySelector('.param-del').addEventListener('click', function() { row.remove(); });
    document.getElementById('builderSseHdrRows').appendChild(row);
  });
})();

// ===== Builder: WebSocket =====
(function() {
  var _wsSocket = null;
  var _wsMsgCount = 0;
  var log = document.getElementById('builderWsLog');
  var status = document.getElementById('builderWsStatus');
  var countEl = document.getElementById('builderWsCount');
  var connectBtn = document.getElementById('builderWsConnect');
  var disconnectBtn = document.getElementById('builderWsDisconnect');
  var autoScroll = document.getElementById('builderWsAutoScroll');

  function wsAppendMsg(badge, badgeClass, text) {
    var div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = '<span class="msg-time">' + new Date().toLocaleTimeString() + '</span><span class="msg-badge ' + badgeClass + '">' + badge + '</span><span class="msg-data">' + escapeHtml(text) + '</span>';
    log.appendChild(div);
    _wsMsgCount++;
    if (countEl) countEl.textContent = _wsMsgCount + ' 条';
    if (autoScroll && autoScroll.checked) log.scrollTop = log.scrollHeight;
  }

  connectBtn.addEventListener('click', function() {
    if (_wsSocket) { _wsSocket.close(); _wsSocket = null; }
    var url = document.getElementById('builderWsUrl').value.trim();
    if (!url) return;
    if (!url.match(/^wss?:\/\//i)) {
      if (url.match(/^https?:\/\//i)) url = url.replace(/^https/, 'wss').replace(/^http/, 'ws');
      else url = 'wss://' + url;
    }

    log.innerHTML = '';
    wsAppendMsg('SYS', 'sys', '正在连接 ' + url);
    status.textContent = '连接中...';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = '';

    try {
      _wsSocket = new WebSocket(url);
      _wsSocket.onopen = function() {
        status.textContent = '已连接';
        wsAppendMsg('✓', 'info', '连接成功');
      };
      _wsSocket.onmessage = function(e) {
        var data = typeof e.data === 'string' ? e.data : '(binary)';
        try { if (typeof e.data === 'string') data = JSON.stringify(JSON.parse(data), null, 2); } catch(ex) {}
        wsAppendMsg('← RECV', 'recv', data.substring(0, 2000));
      };
      _wsSocket.onclose = function(e) {
        status.textContent = '已断开 (code=' + e.code + ')';
        wsAppendMsg('■', 'sys', '连接已关闭 (code=' + e.code + ', reason=' + (e.reason || '') + ')');
        connectBtn.style.display = '';
        disconnectBtn.style.display = 'none';
        _wsSocket = null;
      };
      _wsSocket.onerror = function() {
        wsAppendMsg('✕', 'err', 'WebSocket 错误');
      };
    } catch(err) {
      status.textContent = '连接失败';
      wsAppendMsg('✕', 'err', err.message);
      connectBtn.style.display = '';
      disconnectBtn.style.display = 'none';
    }
  });

  disconnectBtn.addEventListener('click', function() {
    if (_wsSocket) { _wsSocket.close(); _wsSocket = null; }
    connectBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    status.textContent = '已断开';
    wsAppendMsg('■', 'sys', '手动断开');
  });

  document.getElementById('builderWsSend').addEventListener('click', function() {
    if (!_wsSocket || _wsSocket.readyState !== WebSocket.OPEN) {
      status.textContent = '未连接';
      return;
    }
    var msg = document.getElementById('builderWsMessage').value;
    if (!msg) return;
    _wsSocket.send(msg);
    wsAppendMsg('→ SEND', 'send', msg.substring(0, 2000));
    document.getElementById('builderWsMessage').value = '';
  });

  document.getElementById('builderWsMessage').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('builderWsSend').click();
    }
  });

  document.getElementById('builderWsClear').addEventListener('click', function() {
    log.innerHTML = '';
    _wsMsgCount = 0;
    if (countEl) countEl.textContent = '';
  });

  // Headers toggle
  var wsHdrToggle = document.getElementById('builderWsHdrToggle');
  var wsHdrPanel = document.getElementById('builderWsHdrPanel');
  if (wsHdrToggle && wsHdrPanel) {
    wsHdrToggle.addEventListener('click', function() {
      var vis = wsHdrPanel.style.display !== 'none';
      wsHdrPanel.style.display = vis ? 'none' : '';
      wsHdrToggle.querySelector('.params-arrow').textContent = vis ? '\u25b8' : '\u25be';
    });
  }
  document.getElementById('builderWsAddHdr').addEventListener('click', function() {
    var row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = '<input class="param-key" type="text" value="" placeholder="Key"><input class="param-val" type="text" value="" placeholder="Value"><button class="param-del" title="Remove">\u2715</button>';
    row.querySelector('.param-del').addEventListener('click', function() { row.remove(); });
    document.getElementById('builderWsHdrRows').appendChild(row);
  });
})();

// ===== Builder: Socket.IO =====
(function() {
  var _sioSocket = null;
  var _sioMsgCount = 0;
  var log = document.getElementById('builderSioLog');
  var status = document.getElementById('builderSioStatus');
  var countEl = document.getElementById('builderSioCount');
  var connectBtn = document.getElementById('builderSioConnect');
  var disconnectBtn = document.getElementById('builderSioDisconnect');
  var autoScroll = document.getElementById('builderSioAutoScroll');

  function sioAppendMsg(badge, badgeClass, text) {
    var div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = '<span class="msg-time">' + new Date().toLocaleTimeString() + '</span><span class="msg-badge ' + badgeClass + '">' + badge + '</span><span class="msg-data">' + escapeHtml(text) + '</span>';
    log.appendChild(div);
    _sioMsgCount++;
    if (countEl) countEl.textContent = _sioMsgCount + ' 条';
    if (autoScroll && autoScroll.checked) log.scrollTop = log.scrollHeight;
  }

  connectBtn.addEventListener('click', function() {
    if (_sioSocket) { _sioSocket.close(); _sioSocket = null; }
    var url = document.getElementById('builderSioUrl').value.trim();
    var path = document.getElementById('builderSioPath').value.trim() || '/socket.io';
    if (!url) return;
    var connectUrl = url.replace(/\/*$/, '') + path;

    log.innerHTML = '';
    sioAppendMsg('SYS', 'sys', '正在连接 ' + connectUrl);
    status.textContent = '连接中...';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = '';

    try {
      _sioSocket = new WebSocket(connectUrl.replace(/^http/, 'ws'));
      _sioSocket.onopen = function() {
        status.textContent = '已连接';
        sioAppendMsg('✓', 'info', '连接成功');
      };
      _sioSocket.onmessage = function(e) {
        var data = typeof e.data === 'string' ? e.data : JSON.stringify(e.data);
        try { data = JSON.stringify(JSON.parse(data), null, 2); } catch(ex) {}
        sioAppendMsg('MSG', 'recv', data.substring(0, 2000));
      };
      _sioSocket.onclose = function() {
        status.textContent = '已断开';
        sioAppendMsg('■', 'sys', '连接已关闭');
        connectBtn.style.display = '';
        disconnectBtn.style.display = 'none';
        _sioSocket = null;
      };
      _sioSocket.onerror = function() {
        sioAppendMsg('✕', 'err', 'Socket.IO 错误');
      };
    } catch(err) {
      status.textContent = '连接失败';
      sioAppendMsg('✕', 'err', err.message);
      connectBtn.style.display = '';
      disconnectBtn.style.display = 'none';
    }
  });

  disconnectBtn.addEventListener('click', function() {
    if (_sioSocket) { _sioSocket.close(); _sioSocket = null; }
    connectBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    status.textContent = '已断开';
    sioAppendMsg('■', 'sys', '手动断开');
  });

  document.getElementById('builderSioSend').addEventListener('click', function() {
    if (!_sioSocket || _sioSocket.readyState !== WebSocket.OPEN) {
      status.textContent = '未连接';
      return;
    }
    var evt = document.getElementById('builderSioEvent').value;
    var data = document.getElementById('builderSioData').value;
    if (!evt) return;
    var payload = JSON.stringify({ event: evt, data: data });
    _sioSocket.send(payload);
    sioAppendMsg('→ ' + evt, 'send', data.substring(0, 1000));
    document.getElementById('builderSioData').value = '';
  });

  document.getElementById('builderSioClear').addEventListener('click', function() {
    log.innerHTML = '';
    _sioMsgCount = 0;
    if (countEl) countEl.textContent = '';
  });

  // Headers toggle
  var sioHdrToggle = document.getElementById('builderSioHdrToggle');
  var sioHdrPanel = document.getElementById('builderSioHdrPanel');
  if (sioHdrToggle && sioHdrPanel) {
    sioHdrToggle.addEventListener('click', function() {
      var vis = sioHdrPanel.style.display !== 'none';
      sioHdrPanel.style.display = vis ? 'none' : '';
      sioHdrToggle.querySelector('.params-arrow').textContent = vis ? '\u25b8' : '\u25be';
    });
  }
  document.getElementById('builderSioAddHdr').addEventListener('click', function() {
    var row = document.createElement('div');
    row.className = 'param-row';
    row.innerHTML = '<input class="param-key" type="text" value="" placeholder="Key"><input class="param-val" type="text" value="" placeholder="Value"><button class="param-del" title="Remove">\u2715</button>';
    row.querySelector('.param-del').addEventListener('click', function() { row.remove(); });
    document.getElementById('builderSioHdrRows').appendChild(row);
  });
})();

// ===== Builder: MQTT =====
(function() {
  var _mqttClient = null;
  var _mqttMsgCount = 0;
  var _mqttSubscriptions = [];
  var log = document.getElementById('builderMqttLog');
  var status = document.getElementById('builderMqttStatus');
  var countEl = document.getElementById('builderMqttCount');
  var connectBtn = document.getElementById('builderMqttConnect');
  var disconnectBtn = document.getElementById('builderMqttDisconnect');
  var autoScroll = document.getElementById('builderMqttAutoScroll');

  function mqttAppendMsg(badge, badgeClass, text) {
    var div = document.createElement('div');
    div.className = 'msg';
    div.innerHTML = '<span class="msg-time">' + new Date().toLocaleTimeString() + '</span><span class="msg-badge ' + badgeClass + '">' + badge + '</span><span class="msg-data">' + escapeHtml(text) + '</span>';
    log.appendChild(div);
    _mqttMsgCount++;
    if (countEl) countEl.textContent = _mqttMsgCount + ' 条';
    if (autoScroll && autoScroll.checked) log.scrollTop = log.scrollHeight;
  }

  connectBtn.addEventListener('click', function() {
    if (_mqttClient) { try { _mqttClient.disconnect(); } catch(e) {} _mqttClient = null; }
    var url = document.getElementById('builderMqttUrl').value.trim();
    var clientId = document.getElementById('builderMqttClientId').value.trim() || 'mqtt_' + Date.now();
    if (!url) return;

    log.innerHTML = '';
    mqttAppendMsg('SYS', 'sys', '正在连接 ' + url + ' (client: ' + clientId + ')');
    status.textContent = '连接中...';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = '';

    try {
      _mqttClient = new WebSocket(url);
      _mqttClient._topicSubscriptions = [];

      _mqttClient.onopen = function() {
        status.textContent = '已连接';
        mqttAppendMsg('✓', 'info', 'MQTT 连接成功');
        // Send MQTT CONNECT packet
        var connectPacket = { type: 'connect', protocolId: 'MQTT', protocolVersion: 4, clean: true, clientId: clientId, keepalive: 60 };
        _mqttClient.send(JSON.stringify(connectPacket));
      };

      _mqttClient.onmessage = function(e) {
        var data = typeof e.data === 'string' ? e.data : '';
        var display = data.substring(0, 2000);
        var badge = 'MSG';
        var badgeClass = 'recv';
        try {
          var parsed = JSON.parse(data);
          if (parsed.type === 'connack' || parsed.type === 'suback') {
            badge = '✓ ' + (parsed.type || '').toUpperCase();
            badgeClass = 'info';
          } else if (parsed.type === 'publish' || parsed.topic) {
            badge = '📨 ' + (parsed.topic || '');
            badgeClass = 'recv';
            display = 'payload: ' + (parsed.payload || parsed.payloadBytes || '(binary)');
          }
        } catch(ex) {}
        mqttAppendMsg(badge, badgeClass, display);
      };

      _mqttClient.onclose = function() {
        status.textContent = '已断开';
        mqttAppendMsg('■', 'sys', 'MQTT 连接已关闭');
        connectBtn.style.display = '';
        disconnectBtn.style.display = 'none';
        _mqttClient = null;
      };

      _mqttClient.onerror = function() {
        mqttAppendMsg('✕', 'err', 'MQTT 错误');
      };
    } catch(err) {
      status.textContent = '连接失败';
      mqttAppendMsg('✕', 'err', err.message);
      connectBtn.style.display = '';
      disconnectBtn.style.display = 'none';
    }
  });

  disconnectBtn.addEventListener('click', function() {
    if (_mqttClient) { _mqttClient.close(); _mqttClient = null; }
    connectBtn.style.display = '';
    disconnectBtn.style.display = 'none';
    status.textContent = '已断开';
    mqttAppendMsg('■', 'sys', '手动断开');
  });

  document.getElementById('builderMqttSubscribe').addEventListener('click', function() {
    if (!_mqttClient || _mqttClient.readyState !== WebSocket.OPEN) {
      status.textContent = '未连接';
      return;
    }
    var topic = document.getElementById('builderMqttTopic').value.trim();
    var qos = parseInt(document.getElementById('builderMqttQos').value) || 0;
    if (!topic) return;
    var subPacket = JSON.stringify({ type: 'subscribe', topic: topic, qos: qos });
    _mqttClient.send(subPacket);
    _mqttSubscriptions.push(topic);
    mqttAppendMsg('📋 订阅', 'send', topic + ' (QoS ' + qos + ')');
    status.textContent = '已连接 (' + _mqttSubscriptions.length + ' 订阅)';
  });

  document.getElementById('builderMqttPublish').addEventListener('click', function() {
    if (!_mqttClient || _mqttClient.readyState !== WebSocket.OPEN) {
      status.textContent = '未连接';
      return;
    }
    var topic = document.getElementById('builderMqttTopic').value.trim();
    var msg = document.getElementById('builderMqttMessage').value.trim();
    var qos = parseInt(document.getElementById('builderMqttQos').value) || 0;
    var retain = document.getElementById('builderMqttRetain').checked;
    if (!topic) return;
    var pubPacket = JSON.stringify({ type: 'publish', topic: topic, payload: msg, qos: qos, retain: retain });
    _mqttClient.send(pubPacket);
    mqttAppendMsg('📤 发布', 'send', topic + ' = ' + msg.substring(0, 500) + (retain ? ' [retain]' : ''));
  });

  document.getElementById('builderMqttClear').addEventListener('click', function() {
    log.innerHTML = '';
    _mqttMsgCount = 0;
    if (countEl) countEl.textContent = '';
  });
})();

// ===== Builder: Response tabs =====
var respTabs = document.getElementById('builderRespTabs');
if (respTabs) {
  respTabs.addEventListener('click', function(e) {
    var tab = e.target.closest('.resp-tab');
    if (!tab) return;
    this.querySelectorAll('.resp-tab').forEach(function(t) { t.classList.remove('active'); });
    tab.classList.add('active');
    var pane = tab.dataset.pane;
    var bodyPane = document.getElementById('builderRespBodyPane');
    var hdrPane = document.getElementById('builderRespHeadersPane');
    if (bodyPane) bodyPane.style.display = pane === 'body' ? '' : 'none';
    if (hdrPane) hdrPane.style.display = pane === 'headers' ? '' : 'none';
  });
}

var respClose = document.getElementById('builderRespClose');
if (respClose) respClose.addEventListener('click', function() {
  var resp = document.getElementById('builderResponse');
  if (resp) resp.style.display = 'none';
});

builderSend.addEventListener('click', function() {

  var method = builderMethod.value;

  var url = builderUrl.value.trim();

  var headersStr = builderHeaders.value.trim();

  var bodyStr = builderBody.value.trim();

  var valid = true;

  // Auto-complete URL

  if (url && !url.match(/^https?:\/\//i)) {

    url = 'https://' + url;

    builderUrl.value = url;

  }

  try { new URL(url); clearError(builderUrl, null); }

  catch(e) { builderUrl.classList.add('error'); valid = false; }

  // Sync KV headers to textarea if in kv mode

  if (builderHdrMode === 'kv') {

    var hRows = [];

    var els = builderHdrRows.querySelectorAll('.param-row');

    for (var i = 0; i < els.length; i++) {

      var k = els[i].querySelector('.param-key').value.trim();

      var v = els[i].querySelector('.param-val').value;

      if (k) hRows.push({ key: k, value: v });

    }

    var hObj = {};

    for (var i = 0; i < hRows.length; i++) hObj[hRows[i].key] = hRows[i].value;

    headersStr = JSON.stringify(hObj, null, 2);

    builderHeaders.value = headersStr;

  }

  // Sync KV body to textarea if not in json mode

  if (builderBodyMode !== 'json') {

    var bRows = [];

    var bEls = builderBodyKvRows.querySelectorAll('.param-row');

    for (var i = 0; i < bEls.length; i++) {

      var k = bEls[i].querySelector('.param-key').value.trim();

      var v = bEls[i].querySelector('.param-val').value;

      if (k) bRows.push({ key: k, value: v });

    }

    var bObj = {};

    for (var i = 0; i < bRows.length; i++) bObj[bRows[i].key] = bRows[i].value;

    bodyStr = JSON.stringify(bObj, null, 2);

  }

  // Validate headers

  var headersObj = {};

  if (headersStr) {

    try { headersObj = JSON.parse(headersStr); clearError(builderHeaders, builderHeadersError); }

    catch(e) { builderHeaders.classList.add('error'); builderHeadersError.textContent = 'Headers JSON error'; valid = false; }

  }

  // Validate body

  var bodyFinal = null;

  var ct = (headersObj['Content-Type'] || headersObj['content-type'] || '').toLowerCase();

  // Auto-set Content-Type based on body type dropdown if not manually set
  if (!ct && bodyStr) {
    var ctMap = {
      json: 'application/json', xml: 'application/xml', text: 'text/plain',
      html: 'text/html', yaml: 'text/yaml',
      form: 'application/x-www-form-urlencoded', multipart: 'multipart/form-data'
    };
    var autoCt = ctMap[builderBodyMode];
    if (autoCt) {
      headersObj['Content-Type'] = autoCt;
      ct = autoCt;
    }
  }

  if (bodyStr && ct.includes('json')) {

    try { bodyFinal = JSON.parse(bodyStr); clearError(builderBody, builderBodyError); }

    catch(e) { builderBody.classList.add('error'); builderBodyError.textContent = 'Body JSON error'; valid = false; }

  } else if (bodyStr) {

    bodyFinal = bodyStr;

  }

  // Merge auth headers
  var authTypeEl_b = document.getElementById('builderAuthType');
  if (authTypeEl_b && authTypeEl_b.value) {
    var authType_b = authTypeEl_b.value;
    var authToken_b = document.getElementById('builderAuthToken').value.trim();
    var authKey_b = document.getElementById('builderAuthKey').value.trim();
    var authHeaders_b = applyAuth(authType_b, authToken_b, authKey_b);
    for (var k_b in authHeaders_b) headersObj[k_b] = authHeaders_b[k_b];
    // Apply query-param auth to URL
    if (authType_b === 'apikey-query' && authKey_b && authToken_b) {
      url = applyAuthToUrl(authType_b, authToken_b, authKey_b, url);
      builderUrl.value = url;
    }
  }

  if (!valid) return;

  // Execute pre-request script
  if (builderCurrentReq && builderCurrentReq.preScript) {
    var preResult = runScript(builderCurrentReq.preScript, {
      request: { url: url, method: method, headers: headersObj, body: bodyFinal },
      response: {}
    });
    if (!preResult.success) {
      showBuilderError('Pre-request script error: ' + preResult.error);
      return;
    }
  }

  // Send

  url = builderUrl.value.trim();

  url = resolveVars(url);

  if (bodyStr) bodyStr = resolveVars(bodyStr);

  var startTime = Date.now();

  builderSend.disabled = true;

  builderSend.textContent = '⏳ 发送中...';

  builderResponse.classList.remove('active');

  builderResponse.style.display = 'none';

  builderRespError.style.display = 'none';

  var globalTimeout = setTimeout(function() {

    if (builderSend.disabled) {

      builderSend.disabled = false;

      builderSend.textContent = '▶ 发送请求';

      showBuilderError('请求超时（20秒），未收到响应。');

      builderStatusBadge.className = 'resp-badge timeout';

      builderStatusBadge.textContent = 'ERR';

      builderDuration.textContent = '⏱ ' + (Date.now() - startTime) + 'ms';

    }

  }, 20000);

  try {

    var cleanedHeaders = {};

    for (var k in headersObj) {

      var lk = k.toLowerCase();

      if (lk === 'host' || lk === 'origin' || lk === 'referer' || lk === 'referrer') continue;

      cleanedHeaders[k] = String(headersObj[k]);

    }

    var fetchOpts = { method: method, headers: cleanedHeaders };

    if (bodyFinal && method !== 'GET' && method !== 'HEAD') {

      fetchOpts.body = bodyFinal;

    }

    proxyFetch(url, method, cleanedHeaders, bodyFinal).then(function(resp) {

      clearTimeout(globalTimeout);

      var duration = Date.now() - startTime;

      var ct2 = resp.headers.get('content-type') || '';

      var rh = {};

      resp.headers.forEach(function(v, k) { rh[k] = v; });

      return resp.text().then(function(bodyText) {

        var parsed = null;

        try {

          if (ct2.includes('json')) parsed = JSON.parse(bodyText);

          else parsed = bodyText.slice(0, 10000);

        } catch(e) { parsed = bodyText.slice(0, 10000); }

        // Execute post-response script
        var respObj = { status: resp.status, statusText: resp.statusText, headers: rh, body: parsed, contentType: ct2 };
        if (builderCurrentReq && builderCurrentReq.postScript) {
          var postResult = runScript(builderCurrentReq.postScript, {
            request: { url: url, method: method, headers: headersObj, body: bodyFinal },
            response: respObj
          });
          if (!postResult.success) {
            console.warn('[API Probe] Post-response script error:', postResult.error);
          }
        }

        builderSend.disabled = false;

        builderSend.textContent = '▶ 发送请求';

        renderBuilderResponse({ status: resp.status, statusText: resp.statusText, duration: duration, headers: rh, contentType: ct2, body: parsed, error: null });

      });

    }).catch(function(err) {

      clearTimeout(globalTimeout);

      builderSend.disabled = false;

      builderSend.textContent = '▶ 发送请求';

      var msg = err.name === 'AbortError' ? '请求超时（15秒）' : err.message;

      showBuilderError(msg + "\nURL: " + url);

      builderStatusBadge.className = 'resp-badge timeout';

      builderStatusBadge.textContent = 'ERR';

      builderDuration.textContent = '⏱ ' + (Date.now() - startTime) + 'ms';

    });

  } catch(e) {

    clearTimeout(globalTimeout);

    builderSend.disabled = false;

    builderSend.textContent = '▶ 发送请求';

    showBuilderError('发送失败: ' + e.message);

  }

});

function showBuilderError(msg) {

  builderResponse.classList.add('active');

  builderResponse.style.display = '';

  builderRespError.style.display = '';

  builderRespError.textContent = '❌ ' + msg;

}

function renderBuilderResponse(resp) {

  builderResponse.classList.add('active');

  builderResponse.style.display = '';

  var statusTextMap = {

    200: 'OK', 201: 'Created', 204: 'No Content',

    301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',

    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',

    404: 'Not Found', 405: 'Method Not Allowed', 408: 'Request Timeout',

    429: 'Too Many Requests',

    500: 'Internal Server Error', 502: 'Bad Gateway',

    503: 'Service Unavailable', 504: 'Gateway Timeout'

  };

  var badgeClass = '', st = '';

  if (resp.status >= 200 && resp.status < 300) badgeClass = 'ok';

  else if (resp.status >= 400) badgeClass = 'err';

  var desc = statusTextMap[resp.status] || resp.statusText || '';

  st = resp.status + (desc ? ' ' + desc : '');

  builderStatusBadge.className = 'resp-badge ' + badgeClass;

  builderStatusBadge.textContent = st;

  builderDuration.textContent = '⏱ ' + resp.duration + 'ms';

  if (resp.error) {

    builderRespError.style.display = '';

    builderRespError.textContent = '❌ ' + resp.error;

  } else {

    builderRespError.style.display = 'none';

  }

  builderRespHeaders.textContent = JSON.stringify(resp.headers || {}, null, 2);

  var bodyStr = resp.body ? (typeof resp.body === 'object' ? JSON.stringify(resp.body, null, 2) : String(resp.body)) : '';

  var truncated = bodyStr.length > 10000;

  var displayStr = truncated ? bodyStr.slice(0, 10000) : bodyStr;

  var useViewer = renderJsonViewer(builderRespBody, displayStr);

  if (!useViewer) {

    builderRespBody.textContent = displayStr + (truncated ? '\n\n...（截断）' : '');

  } else if (truncated) {

    var note = document.createElement('div');

    note.style.cssText = 'font-size:11px;color:#9ca3af;padding:4px 8px;font-style:italic';

    note.textContent = '... 响应体已截断（仅显示前 10000 字符）';

    builderRespBody.appendChild(note);

  }

  addCopyButton(builderRespBody, bodyStr);

}


// ===== JSON 响应查看器 =====
function renderJsonViewer(container, str) {
  if (!str || typeof str !== 'string') return false;
  try {
    var obj = JSON.parse(str);
    container.innerHTML = '';
    container.style.whiteSpace = 'pre-wrap';
    container.style.fontFamily = "monospace";
    container.style.fontSize = '11px';
    container.style.lineHeight = '1.5';
    renderJsonNode(obj, container, 0);
    return true;
  } catch(e) { return false; }
}

function renderJsonNode(val, parent, depth) {
  var indent = '  '.repeat(Math.min(depth, 20));
  if (val === null) {
    var span = document.createElement('span');
    span.style.color = '#9ca3af';
    span.textContent = 'null';
    parent.appendChild(span);
  } else if (Array.isArray(val)) {
    if (val.length === 0) {
      var span = document.createElement('span');
      span.style.color = '#9ca3af';
      span.textContent = '[]';
      parent.appendChild(span);
    } else {
      parent.appendChild(document.createTextNode('[\n'));
      for (var i = 0; i < val.length; i++) {
        var line = document.createElement('div');
        line.style.paddingLeft = (depth + 1) * 16 + 'px';
        var idxSpan = document.createElement('span');
        idxSpan.style.color = '#6b7280';
        idxSpan.textContent = i + ': ';
        line.appendChild(idxSpan);
        renderJsonNode(val[i], line, depth + 1);
        if (i < val.length - 1) line.appendChild(document.createTextNode(','));
        parent.appendChild(line);
      }
      var close = document.createElement('div');
      close.style.paddingLeft = depth * 16 + 'px';
      close.textContent = ']';
      parent.appendChild(close);
    }
  } else if (typeof val === 'object') {
    var keys = Object.keys(val);
    if (keys.length === 0) {
      var span = document.createElement('span');
      span.style.color = '#9ca3af';
      span.textContent = '{}';
      parent.appendChild(span);
    } else {
      parent.appendChild(document.createTextNode('{\n'));
      for (var i = 0; i < keys.length; i++) {
        var line = document.createElement('div');
        line.style.paddingLeft = (depth + 1) * 16 + 'px';
        var kSpan = document.createElement('span');
        kSpan.style.color = '#e5e7eb';
        kSpan.textContent = '"' + keys[i] + '": ';
        line.appendChild(kSpan);
        renderJsonNode(val[keys[i]], line, depth + 1);
        if (i < keys.length - 1) line.appendChild(document.createTextNode(','));
        parent.appendChild(line);
      }
      var close = document.createElement('div');
      close.style.paddingLeft = depth * 16 + 'px';
      close.textContent = '}';
      parent.appendChild(close);
    }
  } else if (typeof val === 'string') {
    var span = document.createElement('span');
    span.style.color = '#4ade80';
    span.textContent = '"' + val.replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
    parent.appendChild(span);
  } else if (typeof val === 'number') {
    var span = document.createElement('span');
    span.style.color = '#60a5fa';
    span.textContent = String(val);
    parent.appendChild(span);
  } else if (typeof val === 'boolean') {
    var span = document.createElement('span');
    span.style.color = '#f59e0b';
    span.textContent = String(val);
    parent.appendChild(span);
  } else {
    parent.appendChild(document.createTextNode(String(val)));
  }
}

function addCopyButton(container, text) {
  if (!container || !text) return;
  var btn = document.createElement('button');
  btn.textContent = '📋 复制';
  btn.style.cssText = 'position:absolute;top:4px;right:4px;padding:2px 8px;font-size:10px;background:#2563eb;color:#fff;border:none;border-radius:3px;cursor:pointer;opacity:0.6';
  btn.onmouseover = function() { btn.style.opacity = '1'; };
  btn.onmouseout = function() { btn.style.opacity = '0.6'; };
  btn.onclick = function() {
    navigator.clipboard.writeText(text).then(function() {
      btn.textContent = '✓ 已复制';
      setTimeout(function() { btn.textContent = '📋 复制'; }, 1500);
    });
  };
  container.style.position = 'relative';
  container.appendChild(btn);
}

// Builder cURL copy

builderCopyCurl.addEventListener('click', function() {

  var method = builderMethod.value;

  var url = builderUrl.value.trim();

  if (!url) return;

  // Collect headers

  var headersObj = {};

  if (builderHdrMode === 'kv') {

    var els = builderHdrRows.querySelectorAll('.param-row');

    for (var i = 0; i < els.length; i++) {

      var k = els[i].querySelector('.param-key').value.trim();

      var v = els[i].querySelector('.param-val').value;

      if (k) headersObj[k] = v;

    }

  } else {

    try { headersObj = JSON.parse(builderHeaders.value || '{}'); } catch(e) {}

  }

  var cmd = 'curl -X ' + method + ' "' + url + '"';

  var keys = Object.keys(headersObj);

  for (var i = 0; i < keys.length; i++) {

    var v = String(headersObj[keys[i]]).replace(/"/g, '\"');

    cmd += ' \\n  -H "' + keys[i] + ': ' + v + '"';

  }

  if (builderBody.value.trim() && method !== 'GET' && method !== 'HEAD') {

    var b = builderBody.value.trim().replace(/'/g, "'\\''");

    cmd += ' \\n  -d \'' + b + '\'';

  }

  navigator.clipboard.writeText(cmd.replace(/\\n/g, '\n')).then(function() {

    builderCopyCurl.textContent = '✅ 已复制';

    setTimeout(function() { builderCopyCurl.textContent = '保存为 cURL'; }, 1500);

  }).catch(function() {

    builderCopyCurl.textContent = '❌ 复制失败';

    setTimeout(function() { builderCopyCurl.textContent = '保存为 cURL'; }, 1500);

  });

});

// ===== Builder 导出下拉菜单（复用 exportFormatted）=====
var builderExportBtn = document.getElementById('builderExportBtn');
var builderExportDropdown = document.getElementById('builderExportDropdown');
var builderExportWrap = document.getElementById('builderExportWrap');

builderExportBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  builderExportDropdown.style.display = builderExportDropdown.style.display === 'none' ? '' : 'none';
});

builderExportDropdown.addEventListener('click', function(e) {
  var item = e.target.closest('.dd-item');
  if (!item) return;
  builderExportDropdown.style.display = 'none';
  var fmt = item.dataset.format;
  var req = collectBuilderRequest();
  if (!req) return;
  exportFormatted(fmt, req, false);
  builderExportBtn.textContent = '✅ 已导出';
  setTimeout(function() { builderExportBtn.textContent = '导出 ▾'; }, 1500);
});

function collectBuilderRequest() {
  var method = builderMethod.value;
  var url = builderUrl.value.trim();
  if (!url) return null;
  var headersObj = {};
  if (builderHdrMode === 'kv') {
    var els = builderHdrRows.querySelectorAll('.param-row');
    for (var i = 0; i < els.length; i++) {
      var k = els[i].querySelector('.param-key').value.trim();
      var v = els[i].querySelector('.param-val').value;
      if (k) headersObj[k] = v;
    }
  } else {
    try { headersObj = JSON.parse(builderHeaders.value || '{}'); } catch(e) {}
  }
  var aEl = document.getElementById('builderAuthType');
  if (aEl && aEl.value) {
    var aHdrs = applyAuth(aEl.value, document.getElementById('builderAuthToken').value.trim(), document.getElementById('builderAuthKey').value.trim());
    for (var k in aHdrs) headersObj[k] = aHdrs[k];
    if (aEl.value === 'apikey-query') {
      url = applyAuthToUrl(aEl.value, document.getElementById('builderAuthToken').value.trim(), document.getElementById('builderAuthKey').value.trim(), url);
    }
  }
  var body = builderBody.value.trim();
  return { method: method, url: url, requestHeaders: headersObj, requestBody: body };
}

// 点击其他区域关闭 builder 导出下拉菜单
document.addEventListener('click', function(e) {
  if (builderExportDropdown.style.display !== 'none' && !builderExportWrap.contains(e.target)) {
    builderExportDropdown.style.display = 'none';
  }
});

// ===== Proxy fetch through background service worker (bypass CORS) =====

function proxyFetch(url, method, headers, body) {

  // 解析环境变量

  url = resolveVars(url);

  headers = resolveHeadersObj(headers);

  if (body && typeof body === 'string') body = resolveVars(body);

  var options = { method: method, headers: headers };

  if (body && method !== 'GET' && method !== 'HEAD') {

    options.body = body;

  }

  // 使用消息ID回调模式：sidepanel 发送 PROXY_FETCH 请求，background 处理后广播 PROXY_RESULT
  var proxyId = 'pf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

  return new Promise(function(resolve, reject) {

    var handler = function(msg) {
      if (msg && msg.type === 'API_PROBE_PROXY_RESULT' && msg._proxyId === proxyId) {
        chrome.runtime.onMessage.removeListener(handler);
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error + ' [' + url + ']'));
        else {
          var mockResp = {
            status: msg.status,
            statusText: msg.statusText,
            headers: {
              get: function(name) {
                var lower = name.toLowerCase();
                if (msg.headers) {
                  for (var k in msg.headers) {
                    if (k.toLowerCase() === lower) return msg.headers[k];
                  }
                }
                return null;
              },
              forEach: function(cb) {
                if (msg.headers) {
                  for (var k in msg.headers) cb(msg.headers[k], k);
                }
              }
            },
            text: function() { return Promise.resolve(msg.body || ''); }
          };
          resolve(mockResp);
        }
      }
    };

    chrome.runtime.onMessage.addListener(handler);

    var timer = setTimeout(function() {
      chrome.runtime.onMessage.removeListener(handler);
      reject(new Error('代理请求超时'));
    }, 25000);

    chrome.runtime.sendMessage({
      type: 'API_PROBE_PROXY_FETCH',
      _proxyId: proxyId,
      url: url,
      options: options
    }).catch(function(err) {
      chrome.runtime.onMessage.removeListener(handler);
      clearTimeout(timer);
      reject(new Error('发送消息失败: ' + err.message));
    });

  });

}

// ===== 环境变量系统 =====

var envData = { environments: { '默认': {} }, active: '默认' };

var envVarTimer = null;

function initEnv() {

  chrome.storage.local.get('apiProbeEnv', function(r) {

    if (r && r.apiProbeEnv) {

      envData = r.apiProbeEnv;

      if (!envData.environments) envData.environments = {};

      if (!envData.environments[envData.active]) {

        var keys = Object.keys(envData.environments);

        envData.active = keys.length > 0 ? keys[0] : '默认';

        if (!envData.environments[envData.active]) envData.environments['默认'] = {};

      }

    }

    refreshEnvUI();

  });

}

function saveEnv() {

  clearTimeout(envVarTimer);

  envVarTimer = setTimeout(function() {

    try { chrome.storage.local.set({ apiProbeEnv: envData }); } catch(e) {}

  }, 300);

}

function refreshEnvUI() {

  var el = document.getElementById('headerEnvName');

  if (el) el.textContent = envData.active;

}

function resolveVars(str) {

  if (!str || typeof str !== 'string') return str;

  var env = envData.environments[envData.active] || {};

  return str.replace(/\{\{([^}]+)\}\}/g, function(match, varName) {

    return env[varName.trim()] !== undefined ? String(env[varName.trim()]) : match;

  });

}

function resolveHeadersObj(obj) {

  var resolved = {};

  for (var k in obj) {

    if (obj.hasOwnProperty(k)) {

      var rk = resolveVars(k);

      resolved[rk] = resolveVars(String(obj[k]));

    }

  }

  return resolved;

}

// ---- Environment Modal ----

(function() {

  var envModal = document.getElementById('envModal');

  if (!envModal) return;

  var envSelector = document.getElementById('envSelector');

  var envVarsList = document.getElementById('envVarsList');

  document.getElementById('headerEnv').addEventListener('click', function() {
    try { renderEnvModal(); } catch(e) { console.warn('[API Probe] renderEnvModal error:', e); }
    envModal.style.display = 'flex';
    envModal.style.zIndex = '9999';
  });

  document.getElementById('envModalClose').addEventListener('click', function() { envModal.style.display = 'none'; });

  document.getElementById('envAddBtn').addEventListener('click', function() {
    var name = prompt('输入新环境名称:');
    if (!name || name.trim() === '') return;
    name = name.trim();
    if (envData.environments[name]) { alert('环境 "' + name + '" 已存在'); return; }
    envData.environments[name] = {};
    envData.active = name;
    saveEnv(); renderEnvModal(); refreshEnvUI();
  });

  document.getElementById('envRenameBtn').addEventListener('click', function() {
    var oldName = envSelector.value;
    var newName = prompt('重命名 "' + oldName + '" 为:', oldName);
    if (!newName || newName.trim() === '' || newName.trim() === oldName) return;
    newName = newName.trim();
    if (envData.environments[newName]) { alert('环境 "' + newName + '" 已存在'); return; }
    envData.environments[newName] = envData.environments[oldName];
    delete envData.environments[oldName];
    if (envData.active === oldName) envData.active = newName;
    saveEnv(); renderEnvModal(); refreshEnvUI();
  });

  document.getElementById('envDelBtn').addEventListener('click', function() {
    var name = envSelector.value;
    if (name === '默认' || Object.keys(envData.environments).length <= 1) { alert('至少保留一个环境'); return; }
    if (!confirm('删除环境 "' + name + '"？')) return;
    delete envData.environments[name];
    if (envData.active === name) {
      var keys = Object.keys(envData.environments);
      envData.active = keys[0];
    }
    saveEnv(); renderEnvModal(); refreshEnvUI();
  });

  envSelector.addEventListener('change', function() {
    envData.active = envSelector.value;
    renderEnvVars(); refreshEnvUI();
  });

  document.getElementById('envSaveBtn').addEventListener('click', function() {
    var rows = envVarsList.querySelectorAll('.env-var-row');
    var vars = {};
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].querySelector('.env-var-key').value.trim();
      var v = rows[i].querySelector('.env-var-val').value;
      if (k) vars[k] = v;
    }
    envData.environments[envSelector.value] = vars;
    saveEnv();
    showToast('环境变量已保存');
    envModal.style.display = 'none';
  });

  function renderEnvModal() {
    if (!envSelector) return;
    try {
      envSelector.innerHTML = '';
      var keys = envData && envData.environments ? Object.keys(envData.environments) : [];
      for (var i = 0; i < keys.length; i++) {
        var opt = document.createElement('option');
        opt.value = keys[i]; opt.textContent = keys[i];
        if (keys[i] === envData.active) opt.selected = true;
        envSelector.appendChild(opt);
      }
      renderEnvVars();
    } catch(e) { console.warn('[API Probe] renderEnvModal error:', e); }
  }

  function renderEnvVars() {
    if (!envVarsList) return;
    try {
      envVarsList.innerHTML = '';
      var envName = envSelector ? envSelector.value : '';
      var vars = (envData && envData.environments) ? (envData.environments[envName] || {}) : {};
      var vk = Object.keys(vars);
      if (vk.length === 0) addEnvVarRow('', '');
      else for (var i = 0; i < vk.length; i++) addEnvVarRow(vk[i], vars[vk[i]]);
      var btn = document.createElement('button');
      btn.className = 'btn-add-param'; btn.textContent = '+ 添加变量';
      btn.style.marginTop = '4px';
      btn.addEventListener('click', function() { addEnvVarRow('', ''); });
      envVarsList.appendChild(btn);
    } catch(e) { console.warn('[API Probe] renderEnvVars error:', e); }
  }

  function addEnvVarRow(key, val) {
    if (!envVarsList) return;
    key = key || ''; val = val || '';
    var row = document.createElement('div');
    row.className = 'param-row env-var-row';
    row.innerHTML = '<input class="param-key env-var-key" type="text" value="' + key.replace(/"/g,'&quot;') + '" placeholder="VARIABLE_NAME">'
      + '<input class="param-val env-var-val" type="text" value="' + val.replace(/"/g,'&quot;') + '" placeholder="Value">'
      + '<button class="param-del" title="Remove">✕</button>';
    row.querySelector('.param-del').addEventListener('click', function() { row.remove(); });
    envVarsList.appendChild(row);
  }

})();

// ===== 集合系统 =====

var collData = { collections: [] };

var collTimer = null;

function initColl() {

  chrome.storage.local.get('apiProbeColl', function(r) {

    if (r && r.apiProbeColl) collData = r.apiProbeColl;

    renderCollections();

  });

}

function saveColl() {

  clearTimeout(collTimer);

  collTimer = setTimeout(function() {

    try {
      // 限制集合总大小：最多保留最近 500 条请求
      var totalReqs = 0;
      for (var i = 0; i < collData.collections.length; i++) {
        var coll = collData.collections[i];
        if (coll && coll.requests) totalReqs += coll.requests.length;
      }
      if (totalReqs > 500) {
        // 从最早的集合开始删除多余的请求
        var toRemove = totalReqs - 500;
        for (var i = 0; i < collData.collections.length && toRemove > 0; i++) {
          var coll = collData.collections[i];
          if (coll && coll.requests) {
            if (coll.requests.length <= toRemove) {
              toRemove -= coll.requests.length;
              coll.requests = [];
            } else {
              coll.requests.splice(0, toRemove);
              toRemove = 0;
            }
          }
        }
      }
      chrome.storage.local.set({ apiProbeColl: collData }); 
    } catch(e) {}

  }, 300);

}

// ---- View tab switching ----

var viewTabs = document.querySelectorAll('.view-tab');

var recordView = document.getElementById('recordView');

var collectionsView = document.getElementById('collectionsView');

var eventsView = document.getElementById('eventsView');

var filterBar = document.getElementById('filterBar');

if (viewTabs.length) {

  viewTabs.forEach(function(tab) {

    tab.addEventListener('click', function() {

      viewTabs.forEach(function(t) { t.classList.remove('active'); });

      tab.classList.add('active');

      var view = tab.dataset.view;

      // Hide all views first
      if (recordView) { recordView.classList.remove('active'); recordView.style.display = 'none'; }
      if (collectionsView) collectionsView.style.display = 'none';
      if (eventsView) eventsView.style.display = 'none';
      if (filterBar) filterBar.style.display = 'none';

      if (view === 'record') {
        if (recordView) { recordView.classList.add('active'); recordView.style.display = ''; }
        if (filterBar) filterBar.style.display = '';
        renderRequests();
      } else if (view === 'collections') {
        if (collectionsView) collectionsView.style.display = 'flex';
        renderCollections();
      } else if (view === 'events') {
        if (eventsView) eventsView.style.display = 'flex';
        renderEvents();
      }

    });

  });

}

// ---- Collection render ----

var collectionList = document.getElementById('collectionList');

var collectionEmpty = document.getElementById('collectionEmpty');

function renderCollections() {

  if (!collectionList) return;

  collectionList.innerHTML = '';

  if (!collData.collections || collData.collections.length === 0) {

    if (collectionEmpty) collectionEmpty.style.display = '';

    return;

  }

  if (collectionEmpty) collectionEmpty.style.display = 'none';

  for (var ci = 0; ci < collData.collections.length; ci++) {

    var coll = collData.collections[ci];

    if (!coll) continue;

    var group = document.createElement('div');

    group.className = 'collection-group';

    

    var header = document.createElement('div');

    header.className = 'collection-header';

    header.innerHTML = '<span class="collection-arrow">\u25b6</span>'

      + '<span class="collection-name">' + (coll.name || '未命名') + ' (' + (coll.requests ? coll.requests.length : 0) + ')</span>'

      + '<span class="collection-del" data-ci="' + ci + '" title="删除集合">\u2715</span>';

    

    var items = document.createElement('div');

    items.className = 'collection-items';

    

    var reqs = coll.requests || [];

    for (var ri = 0; ri < reqs.length; ri++) {

      var r = reqs[ri]; if (!r) continue;

      var riDiv = document.createElement('div');

      riDiv.className = 'coll-req-item';

      var methodColors = { GET:'#22c55e', POST:'#3b82f6', PUT:'#f59e0b', DELETE:'#ef4444', PATCH:'#8b5cf6' };

      riDiv.innerHTML = '<span class="method-badge" style="color:' + (methodColors[r.method] || '#6b7280') + '">' + (r.method||'GET') + '</span>'

        + '<span class="req-name">' + (r.name || r.url || '') + '</span>'

        + '<span class="coll-req-del" data-ci="' + ci + '" data-ri="' + ri + '" title="删除">\u2715</span>';

      riDiv.addEventListener('click', (function(cidx, ridx) {

        return function() { loadFromCollection(cidx, ridx); };

      })(ci, ri));

      items.appendChild(riDiv);

    }

    

    group.appendChild(header);

    group.appendChild(items);

    collectionList.appendChild(group);

    

    header.addEventListener('click', function(e) {

      if (e.target.closest('.collection-del')) return;

      var arrow = this.querySelector('.collection-arrow');

      var it = this.nextElementSibling;

      if (arrow) arrow.classList.toggle('open');

      if (it) it.classList.toggle('open');

    });

  }

  

  collectionList.querySelectorAll('.collection-del').forEach(function(btn) {

    btn.addEventListener('click', function(e) {

      e.stopPropagation();

      var ci = parseInt(this.dataset.ci);

      if (!collData.collections[ci]) return;

      if (!confirm('删除集合 "' + collData.collections[ci].name + '"？')) return;

      collData.collections.splice(ci, 1);

      saveColl();

      renderCollections();

    });

  });

  

  collectionList.querySelectorAll('.coll-req-del').forEach(function(btn) {

    btn.addEventListener('click', function(e) {

      e.stopPropagation();

      var ci = parseInt(this.dataset.ci);

      var ri = parseInt(this.dataset.ri);

      if (!confirm('删除此请求？')) return;

      if (collData.collections[ci] && collData.collections[ci].requests) {

        collData.collections[ci].requests.splice(ri, 1);

        saveColl();

        renderCollections();

      }

    });

  });

}

function loadFromCollection(ci, ri) {

  var coll = collData.collections[ci];

  if (!coll || !coll.requests || !coll.requests[ri]) return;

  var req = coll.requests[ri];

  // 兼容两种保存格式：headers/body 和 requestHeaders/requestBody
  openBuilderPanel({
    method: req.method,
    url: req.url,
    requestHeaders: req.headers || req.requestHeaders,
    requestBody: req.body || req.requestBody,
    pageUrl: req.pageUrl,
    _collName: req.name
  });

}

// ---- New Collection button ----

var btnNewCollection = document.getElementById('btnNewCollection');

if (btnNewCollection) {

  btnNewCollection.addEventListener('click', function() {

    var name = prompt('集合名称:');

    if (!name || name.trim() === '') return;

    name = name.trim();

    collData.collections.push({ name: name, requests: [] });

    saveColl();

    renderCollections();

  });

}

// ---- Save to Collection ----

var saveToCollModal = document.getElementById('saveToCollModal');

if (!saveToCollModal) {

  saveToCollModal = document.createElement('div');

  saveToCollModal.id = 'saveToCollModal';

  saveToCollModal.innerHTML = '<div><div style="display:flex;align-items:center;padding:12px 16px;border-bottom:1px solid #e5e7eb">'

    + '<span style="font-weight:600;font-size:14px;flex:1">保存到集合</span>'

    + '<span id="saveCollClose" style="cursor:pointer;color:#9ca3af;font-size:16px">\u2715</span></div>'

    + '<div id="saveCollList" style="flex:1;overflow-y:auto;padding:8px 0"></div>'

    + '<div style="padding:8px 16px;border-top:1px solid #e5e7eb;display:flex;gap:6px;justify-content:flex-end">'

    + '<button class="btn-secondary" id="saveCollNewBtn">+ 新建集合</button>'

    + '<button class="btn-send" id="saveCollConfirmBtn" style="font-size:11px;padding:5px 14px">\u2714 \u4fdd\u5b58</button></div></div>';

  document.body.appendChild(saveToCollModal);

}

var _saveCollTarget = null;

function renderSaveCollModal() {

  var list = document.getElementById('saveCollList');

  if (!list) return;

  list.innerHTML = '';

  if (!collData.collections || collData.collections.length === 0) {

    list.innerHTML = '<div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">暂无集合，请先创建</div>';

    document.getElementById('saveCollConfirmBtn').style.display = 'none';

  } else {

    document.getElementById('saveCollConfirmBtn').style.display = '';

    for (var i = 0; i < collData.collections.length; i++) {

      var item = document.createElement('div');

      item.className = 'save-coll-item';

      item.dataset.ci = i;

      item.innerHTML = '<span class="radio-circle' + (i === 0 ? ' selected' : '') + '"></span> ' + (collData.collections[i].name||'') + ' (' + (collData.collections[i].requests?collData.collections[i].requests.length:0) + ')';

      list.appendChild(item);

    }

    list.querySelectorAll('.save-coll-item').forEach(function(item) {

      item.addEventListener('click', function() {

        list.querySelectorAll('.save-coll-item .radio-circle').forEach(function(c) { c.classList.remove('selected'); });

        this.querySelector('.radio-circle').classList.add('selected');

      });

    });

  }

  saveToCollModal.style.display = 'flex';

}

document.getElementById('saveCollClose').addEventListener('click', function() { saveToCollModal.style.display = 'none'; });

document.getElementById('saveCollNewBtn').addEventListener('click', function() {

  var name = prompt('集合名称:');

  if (!name || name.trim() === '') return;

  name = name.trim();

  collData.collections.push({ name: name, requests: [] });

  saveColl();

  renderSaveCollModal();

});

document.getElementById('saveCollConfirmBtn').addEventListener('click', function() {

  var selected = document.querySelector('#saveCollList .radio-circle.selected');

  if (!selected) { alert('请选择一个集合'); return; }

  var ci = parseInt(selected.closest('.save-coll-item').dataset.ci);

  if (!_saveCollTarget || !collData.collections[ci]) return;

  var name = prompt('请求名称（可选）:', '');

  var req = {

    method: _saveCollTarget.method,

    url: _saveCollTarget.url,

    requestHeaders: _saveCollTarget.headers,

    requestBody: _saveCollTarget.body,

    name: name || _saveCollTarget.url.split('?')[0].split('/').pop() || 'unnamed'

  };

  if (!collData.collections[ci].requests) collData.collections[ci].requests = [];

  collData.collections[ci].requests.push(req);

  saveColl();

  saveToCollModal.style.display = 'none';

  showToast('已保存到 "' + collData.collections[ci].name + '"');

});

// ===== WebSocket 查看器 =====

var wsActiveConn = null;

function openWsViewer(url) {

  document.getElementById('wsViewer').style.display = 'flex';

  document.getElementById('wsUrl').value = url || '';

  document.getElementById('wsStatus').textContent = '未连接';

  document.getElementById('wsConnectBtn').style.display = '';

  document.getElementById('wsDisconnectBtn').style.display = 'none';

  document.getElementById('wsSendBtn').disabled = true;

  document.getElementById('wsMessageLog').innerHTML = '';

  document.getElementById('wsEmptyState').style.display = 'flex';

  document.getElementById('wsMessageLog').style.display = 'none';

  document.getElementById('wsInput').value = '';

}

function closeWsViewer() {

  disconnectWs();

  document.getElementById('wsViewer').style.display = 'none';

}

function connectWs() {

  var url = document.getElementById('wsUrl').value.trim();

  if (!url) { showToast('请输入 WebSocket URL'); return; }

  if (!url.match(/^wss?:\/\//i)) url = 'wss://' + url;

  if (wsActiveConn) { wsActiveConn.close(); wsActiveConn = null; }

  try {

    wsActiveConn = new WebSocket(url);

    document.getElementById('wsStatus').textContent = '正在连接...';

    document.getElementById('wsConnectBtn').style.display = 'none';

    document.getElementById('wsDisconnectBtn').style.display = '';

    document.getElementById('wsSendBtn').disabled = true;

    document.getElementById('wsEmptyState').style.display = 'none';

    document.getElementById('wsMessageLog').style.display = '';

    wsActiveConn.onopen = function() {

      document.getElementById('wsStatus').textContent = '已连接 \u2713';

      document.getElementById('wsSendBtn').disabled = false;

      addWsMessage('system', '已连接到 ' + url);

    };

    wsActiveConn.onmessage = function(e) {

      var d = e.data instanceof Blob ? '[Binary ' + e.data.size + ' bytes]' : (typeof e.data === 'string' ? e.data : String(e.data));

      addWsMessage('receive', d);

    };

    wsActiveConn.onclose = function(e) {

      document.getElementById('wsStatus').textContent = '已断开 (code=' + e.code + ')';

      document.getElementById('wsSendBtn').disabled = true;

      addWsMessage('system', '连接已关闭 (code=' + e.code + (e.reason ? ' reason=' + e.reason : '') + ')');

      document.getElementById('wsConnectBtn').style.display = '';

      document.getElementById('wsDisconnectBtn').style.display = 'none';

    };

    wsActiveConn.onerror = function() {

      addWsMessage('system', '连接错误');

    };

  } catch(err) {

    showToast('连接失败: ' + err.message);

    document.getElementById('wsStatus').textContent = '连接失败';

    document.getElementById('wsConnectBtn').style.display = '';

    document.getElementById('wsDisconnectBtn').style.display = 'none';

  }

}

function disconnectWs() {

  if (wsActiveConn) {

    wsActiveConn.close();

    wsActiveConn = null;

  }

  document.getElementById('wsStatus').textContent = '未连接';

  document.getElementById('wsConnectBtn').style.display = '';

  document.getElementById('wsDisconnectBtn').style.display = 'none';

  document.getElementById('wsSendBtn').disabled = true;

}

function sendWsMessage() {

  var input = document.getElementById('wsInput');

  var msg = input.value.trim();

  if (!msg || !wsActiveConn || wsActiveConn.readyState !== WebSocket.OPEN) return;

  try {

    wsActiveConn.send(msg);

    addWsMessage('send', msg);

    input.value = '';

  } catch(err) {

    showToast('发送失败: ' + err.message);

  }

}

function addWsMessage(direction, data) {

  var log = document.getElementById('wsMessageLog');

  if (!log) return;

  document.getElementById('wsEmptyState').style.display = 'none';

  log.style.display = '';

  var msgDiv = document.createElement('div');

  msgDiv.className = 'ws-msg';

  var time = new Date().toLocaleTimeString();

  var dirLabel = { send: 'SEND', receive: 'RECV', system: 'SYS' };

  var h = '<span class="ws-time">[' + time + ']</span>'

    + '<span class="ws-dir ' + direction + '">' + (dirLabel[direction] || direction) + '</span>'

    + '<span class="ws-data ' + direction + '">' + data + '</span>';

  msgDiv.innerHTML = h;

  log.appendChild(msgDiv);

  log.scrollTop = log.scrollHeight;

  while (log.children.length > 500) log.removeChild(log.firstChild);

}

// WS event bindings

document.getElementById('wsClose').addEventListener('click', closeWsViewer);

document.getElementById('wsConnectBtn').addEventListener('click', connectWs);

document.getElementById('wsDisconnectBtn').addEventListener('click', disconnectWs);

document.getElementById('wsSendBtn').addEventListener('click', sendWsMessage);

document.getElementById('wsInput').addEventListener('keydown', function(e) {

  if (e.key === 'Enter') sendWsMessage();

});

document.getElementById('wsClearMsg').addEventListener('click', function() {

  document.getElementById('wsMessageLog').innerHTML = '';

  document.getElementById('wsEmptyState').style.display = 'flex';

  document.getElementById('wsMessageLog').style.display = 'none';

});

// 查看调用链
document.getElementById('ctxViewStack').addEventListener('click', function() {
  var req = ctxRequest;
  hideCtxMenu();
  if (req && req.callStack) {
    openStackViewer(req.callStack);
  } else {
    showToast('无调用链信息');
  }
});

// 重放请求
document.getElementById('ctxReplay').addEventListener('click', function() {
  var req = ctxRequest;
  hideCtxMenu();
  if (req) openBuilderPanel(req);
});

// WS context menu click

document.getElementById('ctxWsView').addEventListener('click', function() {

  if (ctxRequest && ctxRequest.type === 'WS') {

    hideCtxMenu();

    openWsViewer(ctxRequest.url);

  }

});

// ===== SSE 查看器 =====

// ===== 调用链查看器 =====

function openStackViewer(stack) {
  // 用模态框显示调用链
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.4);z-index:2000;display:flex;justify-content:center;align-items:center;';
  var panel = document.createElement('div');
  panel.style.cssText = 'background:#fff;border-radius:8px;max-width:90%;max-height:80%;width:600px;display:flex;flex-direction:column;box-shadow:0 8px 30px rgba(0,0,0,0.2);';
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    panel.style.background = '#1b202a';
    panel.style.color = '#e5e7eb';
  }
  panel.innerHTML = '<div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid #e5e7eb;flex-shrink:0"><h3 style="font-size:14px;font-weight:600;flex:1">\u8c03\u7528\u94fe</h3><span style="cursor:pointer;font-size:18px;color:#9ca3af;padding:0 4px" class="close-stack">&times;</span></div>'
    + '<div style="flex:1;overflow-y:auto;padding:12px 16px"><pre style="font-family:monospace;font-size:11px;line-height:1.6;white-space:pre-wrap;word-break:break-all;margin:0">' + escapeHtml(stack) + '</pre></div>';
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  panel.querySelector('.close-stack').onclick = function() { document.body.removeChild(overlay); };
  overlay.onclick = function(e) { if (e.target === overlay) document.body.removeChild(overlay); };
}

var sseActiveConn = null;

// 存储 SSE 查看器的请求上下文（用于非 GET SSE 连接）
var _sseReqCtx = null;

function openSseViewer(url, reqData) {

  document.getElementById('sseViewer').style.display = 'flex';

  document.getElementById('sseUrl').value = url || '';

  // 保存请求上下文：method、headers、body
  _sseReqCtx = reqData || null;

  document.getElementById('sseStatus').textContent = '未连接';

  document.getElementById('sseConnectBtn').style.display = '';

  document.getElementById('sseDisconnectBtn').style.display = 'none';

  document.getElementById('sseMessageLog').innerHTML = '';

  document.getElementById('sseEmptyState').style.display = 'flex';

  document.getElementById('sseMessageLog').style.display = 'none';

}

document.getElementById('ctxScripts').addEventListener('click', function() {
  const req = ctxRequest;
  hideCtxMenu();
  openScriptEditor(req);
});
document.getElementById('ctxGqlConsole').addEventListener('click', function() {
  ctxMenu.style.display = 'none';
  openGqlConsole(ctxRequest);
});

function closeSseViewer() {

  if (sseActiveConn) { sseActiveConn.close(); sseActiveConn = null; }

  document.getElementById('sseViewer').style.display = 'none';

}

function connectSse() {

  var url = document.getElementById('sseUrl').value.trim();

  if (!url) { showToast('请输入 SSE URL'); return; }

  if (sseActiveConn) { sseActiveConn.close(); sseActiveConn = null; }

  // 判断是否使用原生 EventSource（仅 GET）或 fetch（POST 等）
  var method = (_sseReqCtx && _sseReqCtx.method) || 'GET';
  var useEventSource = (method === 'GET');

  document.getElementById('sseStatus').textContent = '正在连接...';
  document.getElementById('sseConnectBtn').style.display = 'none';
  document.getElementById('sseDisconnectBtn').style.display = '';
  document.getElementById('sseEmptyState').style.display = 'none';
  document.getElementById('sseMessageLog').style.display = '';

  addSseMessage('system', '正在连接 (' + method + ') ' + url);

  if (useEventSource) {
    // ---- 原生 EventSource（GET）- 可靠但仅支持 GET ----
    try {
      sseActiveConn = new EventSource(url);

      sseActiveConn.onopen = function() {
        document.getElementById('sseStatus').textContent = '已连接 ✓';
        addSseMessage('system', '已连接到 ' + url);
      };

      sseActiveConn.onmessage = function(e) {
        addSseMessage('message', e.data || '', e.lastEventId || '');
      };

      sseActiveConn.onerror = function() {
        document.getElementById('sseStatus').textContent = '连接异常';
        addSseMessage('error', '连接异常 (readyState=' + sseActiveConn.readyState + ')');
      };
    } catch(err) {
      showToast('连接失败: ' + err.message);
      document.getElementById('sseStatus').textContent = '连接失败';
      document.getElementById('sseConnectBtn').style.display = '';
      document.getElementById('sseDisconnectBtn').style.display = 'none';
    }
  } else {
    // ---- 基于 fetch 的 SSE 连接（兼容 POST/PUT/DELETE）- 支持自定义头 ----
    (function() {
      var cancelled = false;
      sseActiveConn = { close: function() { cancelled = true; }, readyState: 0 };

      var fetchOpts = { method: method, headers: {} };

      // 从请求上下文中复制关键头（排除 host/origin/referer 等自动头）
      if (_sseReqCtx && _sseReqCtx.requestHeaders) {
        var skipHeaders = { 'host':1, 'origin':1, 'referer':1, 'referrer':1, 'content-length':1 };
        for (var hk in _sseReqCtx.requestHeaders) {
          if (!skipHeaders[hk.toLowerCase()]) {
            fetchOpts.headers[hk] = String(_sseReqCtx.requestHeaders[hk]);
          }
        }
      }

      // 复制请求体
      if (_sseReqCtx && _sseReqCtx.requestBody && method !== 'GET') {
        var bodyStr = typeof _sseReqCtx.requestBody === 'object'
          ? JSON.stringify(_sseReqCtx.requestBody)
          : String(_sseReqCtx.requestBody);
        fetchOpts.body = bodyStr;
      }

      document.getElementById('sseStatus').textContent = '连接中 (' + method + ')...';

      fetch(url, fetchOpts).then(function(resp) {
        if (cancelled) return;
        if (!resp.ok) {
          document.getElementById('sseStatus').textContent = 'HTTP ' + resp.status;
          addSseMessage('error', 'HTTP 错误: ' + resp.status + ' ' + resp.statusText);
          return;
        }
        sseActiveConn.readyState = 1;
        document.getElementById('sseStatus').textContent = '已连接 ✓';
        addSseMessage('system', '已通过 ' + method + ' 连接到 ' + url);

        var reader = resp.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        function readChunk() {
          if (cancelled) return;
          reader.read().then(function(result) {
            if (cancelled) return;
            if (result.done) {
              sseActiveConn.readyState = 2;
              document.getElementById('sseStatus').textContent = '连接已关闭';
              addSseMessage('system', '流式响应已结束');
              return;
            }
            var text = decoder.decode(result.value, { stream: true });
            buffer += text;
            // 按 SSE 协议 \n\n 分割事件块
            var parts = buffer.split('\n\n');
            buffer = parts.pop() || '';
            for (var pi = 0; pi < parts.length; pi++) {
              var eventData = parts[pi];
              var lines = eventData.split('\n');
              var data = '';
              var event = '';
              var id = '';
              for (var li = 0; li < lines.length; li++) {
                var l = lines[li];
                if (l.startsWith('data: ')) data += l.substring(6) + '\n';
                else if (l.startsWith('event: ')) event = l.substring(7);
                else if (l.startsWith('id: ')) id = l.substring(4);
              }
              data = data.replace(/\n$/, '');
              addSseMessage(event || 'message', data || '(empty)', id);
            }
            readChunk();
          }).catch(function(err) {
            if (cancelled) return;
            document.getElementById('sseStatus').textContent = '读取错误';
            addSseMessage('error', '读取流错误: ' + err.message);
          });
        }
        readChunk();
      }).catch(function(err) {
        if (cancelled) return;
        document.getElementById('sseStatus').textContent = '连接失败';
        addSseMessage('error', '连接失败: ' + err.message);
        document.getElementById('sseConnectBtn').style.display = '';
        document.getElementById('sseDisconnectBtn').style.display = 'none';
      });
    })();
  }
}

function disconnectSse() {

  if (sseActiveConn) { sseActiveConn.close(); sseActiveConn = null; }

  addSseMessage('system', '已断开连接');

  document.getElementById('sseStatus').textContent = '未连接';

  document.getElementById('sseConnectBtn').style.display = '';

  document.getElementById('sseDisconnectBtn').style.display = 'none';

}

function addSseMessage(event, data, lastEventId) {

  var log = document.getElementById('sseMessageLog');

  if (!log) return;

  document.getElementById('sseEmptyState').style.display = 'none';

  log.style.display = '';

  var msgDiv = document.createElement('div');

  msgDiv.className = 'sse-msg';

  var time = new Date().toLocaleTimeString();

  var h = '<span class="sse-time">[' + time + ']</span>';

  if (event === 'system') h += '<span style="color:#6b7280;font-style:italic">' + data + '</span>';

  else if (event === 'error') h += '<span class="sse-event">ERROR</span><span class="sse-data" style="color:#ef4444">' + data + '</span>';

  else {

    h += '<span class="sse-event">' + event + '</span>';

    if (lastEventId) h += '<span style="color:#9ca3af;font-size:10px;margin-right:4px">[id:' + lastEventId + ']</span>';

    h += '<span class="sse-data">' + data + '</span>';

  }

  msgDiv.innerHTML = h;

  log.appendChild(msgDiv);

  log.scrollTop = log.scrollHeight;

  while (log.children.length > 500) log.removeChild(log.firstChild);

}

// SSE event bindings

document.getElementById('sseClose').addEventListener('click', closeSseViewer);

document.getElementById('sseConnectBtn').addEventListener('click', connectSse);

document.getElementById('sseDisconnectBtn').addEventListener('click', disconnectSse);

document.getElementById('sseClearMsg').addEventListener('click', function() {

  document.getElementById('sseMessageLog').innerHTML = '';

  document.getElementById('sseEmptyState').style.display = 'flex';

  document.getElementById('sseMessageLog').style.display = 'none';

});

// SSE context menu click

document.getElementById('ctxSseView').addEventListener('click', function() {

  if (ctxRequest && ctxRequest.type === 'SSE') {

    hideCtxMenu();

    // 将相对 URL 补全为绝对 URL（sidepanel 在 chrome-extension:// 下无法解析相对路径）
    var fullUrl = ctxRequest.url;
    if (fullUrl && !fullUrl.match(/^https?:\/\//i)) {
      // 优先使用录制时保存的 pageUrl（更可靠，此时 tab 可能已导航到其他页面）
      (function(url, reqData) {
        if (reqData.pageUrl) {
          try {
            var origin = new URL(reqData.pageUrl).origin;
            url = url.startsWith('/') ? origin + url : origin + '/' + url;
            openSseViewer(url, reqData);
            return;
          } catch(e) {
            // fall through to tab-based fallback
          }
        }
        var tabId = ctxRequest.tabId;
        if (tabId) {
          try {
            chrome.tabs.get(tabId, function(tab) {
              if (tab && tab.url) {
                var origin = new URL(tab.url).origin;
                url = url.startsWith('/') ? origin + url : origin + '/' + url;
              }
              openSseViewer(url, reqData);
            });
          } catch(e) {
            openSseViewer(url, reqData);
          }
        } else {
          openSseViewer(url, reqData);
        }
      })(ctxRequest.url, {
        method: ctxRequest.method,
        requestHeaders: ctxRequest.requestHeaders,
        requestBody: ctxRequest.requestBody,
        pageUrl: ctxRequest.pageUrl || ''
      });
    } else {
      openSseViewer(fullUrl, {
        method: ctxRequest.method,
        requestHeaders: ctxRequest.requestHeaders,
        requestBody: ctxRequest.requestBody
      });
    }

  }

});

// ===== Replay Modal 事件绑定（从原始代码恢复）=====


// ===== 导出下拉菜单项点击处理（批量导出）=====
exportDropdown.addEventListener('click', function(e) {
  var item = e.target.closest('.dd-item');
  if (!item) return;
  exportDropdown.classList.remove('show');
  var fmt = item.dataset.format;
  
  var reqs = typeof getFilteredRequests === 'function' ? getFilteredRequests() : requests;
  if (!reqs || reqs.length === 0) {
    btnExport.textContent = '❌ 无请求';
    setTimeout(function() { btnExport.textContent = '导出 ▾'; }, 1500);
    return;
  }
  
  exportFormatted(fmt, reqs, true);
  btnExport.textContent = '✅ 已导出';
  setTimeout(function() { btnExport.textContent = '导出 ▾'; }, 1500);
});

// ===== 统一导出函数（单个/批量共用）=====
function exportFormatted(fmt, req, isBatch) {
  var reqs = isBatch ? req : [req];
  var content, filename;

  if (fmt === 'markdown') {
    var mdLines = [];
    if (isBatch) {
      mdLines.push('# API Probe 导出报告');
      mdLines.push('');
      mdLines.push('> 导出时间: ' + new Date().toLocaleString());
      mdLines.push('');
    }
    for (var ui = 0; ui < reqs.length; ui++) {
      var heading = isBatch ? null : ('API ' + reqs[ui].method + ' ' + reqs[ui].status);
      mdLines.push(requestToMarkdown(reqs[ui], heading));
      if (isBatch && ui < reqs.length - 1) mdLines.push('');
    }
    content = mdLines.join('\n');
    filename = isBatch ? 'api-probe-export.md' : ('api-' + reqs[0].method + '-' + Date.now() + '.md');
  } else {
    var parts = [];
    for (var vi = 0; vi < reqs.length; vi++) {
      var s = generateSnippet(fmt, reqs[vi]);
      if (s) parts.push(s);
    }
    content = isBatch ? parts.join('\n\n# === === ===\n\n') : parts[0];
    var extMap = { curl: 'sh', python: 'py', 'python-httpx': 'py', 'js-fetch': 'js', 'js-axios': 'js' };
    filename = isBatch ? ('api-probe-export.' + (extMap[fmt] || 'txt')) : ('api-' + reqs[0].method + '-' + Date.now() + '.' + (extMap[fmt] || 'txt'));
  }

  openCodeEditor(content, filename, fmt);
}

// ===== Code Editor =====
function openCodeEditor(content, filename, fmt) {
  _ceContent = content;
  _ceFilename = filename;
  _ceFmt = fmt;
  
  ceTextarea.value = content;
  
  var fmtLabels = { markdown: 'Markdown', curl: 'cURL', python: 'Python (requests)', 'python-httpx': 'Python (httpx)', 'js-fetch': 'JavaScript (fetch)', 'js-axios': 'JavaScript (axios)' };
  ceFmtBadge.textContent = fmtLabels[fmt] || fmt;
  ceStatus.textContent = '已加载，' + content.split('\n').length + ' 行';
  
  codeEditorPanel.classList.add('active');
  ceTextarea.focus();
}

function closeCodeEditor() {
  codeEditorPanel.classList.remove('active');
}

// 代码编辑器：复制
ceCopy.addEventListener('click', function() {
  var text = ceTextarea.value;
  navigator.clipboard.writeText(text).then(function() {
    ceCopy.textContent = '✓ 已复制';
    ceStatus.textContent = '已复制到剪贴板';
    setTimeout(function() { ceCopy.textContent = '📋 复制代码'; }, 1500);
  }).catch(function() {
    ceCopy.textContent = '✗ 复制失败';
    setTimeout(function() { ceCopy.textContent = '📋 复制代码'; }, 1500);
  });
});

// 代码编辑器：下载
ceDownload.addEventListener('click', function() {
  var content = ceTextarea.value;
  var filename = _ceFilename;
  // 如果用户修改了内容，保留当前编辑器内容
  try {
    window.showSaveFilePicker({ suggestedName: filename,
      types: [{ description: 'Code File', accept: { 'text/plain': ['.md', '.sh', '.py', '.js', '.txt'] } }]
    }).then(function(handle) {
      return handle.createWritable().then(function(w) { return w.write(content).then(function() { return w.close(); }); });
    }).catch(function(err) {
      if (err.name === 'AbortError' || err.name === 'SecurityError') return;
      // fallback
      var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(blob);
    });
  } catch(err) {
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(blob);
  }
  ceDownload.textContent = '✓ 已下载';
  ceStatus.textContent = '文件已保存';
  setTimeout(function() { ceDownload.textContent = '⬇ 下载文件'; }, 1500);
});

// 代码编辑器：关闭（两个关闭按钮）
ceClose.addEventListener('click', closeCodeEditor);
ceCloseBtn.addEventListener('click', closeCodeEditor);

// 代码编辑器：按 Escape 关闭
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape' && codeEditorPanel.classList.contains('active')) {
    closeCodeEditor();
  }
});

// ===== Workflow Timeline Generator =====
// Merges API requests, UI events, nav events, storage snapshots, dom mutations
// into a single chronology with causal linking between UI events and API requests.

function buildTimeline() {
  var items = [];

  // Collect all API requests
  for (var i = 0; i < requests.length; i++) {
    var r = requests[i];
    items.push({
      type: 'api_request',
      timestamp: r.timestamp,
      sortKey: r.timestamp,
      data: r,
    });
  }

  // Collect UI events
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    var parsed = {};
    try { parsed = JSON.parse(e.text || '{}'); } catch(ex) { parsed = { raw: e.text }; }
    items.push({
      type: 'ui_event',
      subtype: e.subtype,
      timestamp: e.timestamp,
      sortKey: e.timestamp,
      data: parsed,
      stepName: e.stepName || '',
      eventStorage: e.storageSnapshot,
      eventPageUrl: e.pageUrl,
    });
  }

  // Sort chronologically
  items.sort(function(a, b) { return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0; });

  // Link UI events to subsequent API requests (up to 10 seconds, adaptive)
  for (var i = 0; i < items.length; i++) {
    if (items[i].type === 'ui_event') {
      var linked = [];
      var uiTime = new Date(items[i].timestamp).getTime();
      var clickType = items[i].subtype;
      // Click/submit events may trigger slow requests - use wider window
      var timeout = (clickType === 'click' || clickType === 'submit') ? 10000 : 5000;
      for (var j = i + 1; j < items.length; j++) {
        if (items[j].type === 'api_request') {
          var reqTime = new Date(items[j].timestamp).getTime();
          if (reqTime - uiTime <= timeout) {
            linked.push(items[j].data.id);
          } else {
            break;
          }
        }
      }
      if (linked.length > 0) items[i].triggeredRequests = linked;
    }
  }

  return items;
}

// ===== Workflow JSON Export Format =====
// Produces a structured, AI-friendly workflow description with variable extraction and dependency chains.
function buildWorkflowExport() {
  var timeline = buildTimeline();
  var pageUrl = '';
  for (var i = 0; i < requests.length; i++) {
    if (requests[i].pageUrl) { pageUrl = requests[i].pageUrl; break; }
  }
  // 也从 events 中获取 page_url
  if (!pageUrl) {
    for (var i = 0; i < events.length; i++) {
      if (events[i].pageUrl) { pageUrl = events[i].pageUrl; break; }
    }
  }

  var steps = [];
  var stepNum = 1;

  for (var i = 0; i < timeline.length; i++) {
    var item = timeline[i];

    if (item.type === 'ui_event') {
      var subtype = item.subtype;
      var d = item.data;

      // Navigation events
      if (subtype === 'navigation') {
        steps.push({
          step: stepNum++,
          type: 'navigation',
          step_name: item.stepName || '',
          nav_type: d.type,
          url: d.currentUrl || d.newUrl || d.url || '',
          old_url: d.oldUrl || '',
          title: d.title || '',
          storage_snapshot: d.storageState || null,
          timestamp: item.timestamp,
        });
        continue;
      }

      // Click events
      if (subtype === 'click') {
        // 优先从 event 的 storageSnapshot 获取，其次从 data 获取
        var evtStorage = item.eventStorage || null;
        steps.push({
          step: stepNum++,
          type: 'click',
          step_name: item.stepName || '',
          selector: d.selector || {},
          position: d.position || {},
          modifiers: { ctrl: d.ctrl, shift: d.shift, meta: d.meta },
          page_url: d.pageUrl || (item.eventPageUrl || ''),
          page_title: d.title || '',
          storage_snapshot: d.storageState || evtStorage,
          triggered_requests: item.triggeredRequests || [],
          timestamp: item.timestamp,
        });
        continue;
      }

      // Input events
      if (subtype === 'input' || subtype === 'change') {
        steps.push({
          step: stepNum++,
          type: 'input',
          step_name: item.stepName || '',
          selector: d.selector || {},
          value: d.value || '',
          storage_snapshot: d.storageState || null,
          triggered_requests: item.triggeredRequests || [],
          timestamp: item.timestamp,
        });
        continue;
      }

      // Key events
      if (subtype === 'key') {
        steps.push({
          step: stepNum++,
          type: 'key_press',
          step_name: item.stepName || '',
          key: d.key || '',
          selector: d.selector || {},
          modifiers: { ctrl: d.ctrl, shift: d.shift, alt: d.alt, meta: d.meta },
          triggered_requests: item.triggeredRequests || [],
          timestamp: item.timestamp,
        });
        continue;
      }

      // Submit events
      if (subtype === 'submit') {
        steps.push({
          step: stepNum++,
          type: 'form_submit',
          step_name: item.stepName || '',
          selector: d.selector || {},
          action: d.action || '',
          triggered_requests: item.triggeredRequests || [],
          timestamp: item.timestamp,
        });
        continue;
      }

      // DOM mutations
      if (subtype === 'dom_mutation') {
        steps.push({
          step: stepNum++,
          type: 'dom_mutation',
          step_name: item.stepName || '',
          changes: (d.changes || []).slice(0, 20),
          timestamp: item.timestamp,
        });
        continue;
      }

      // Focus / Dblclick
      steps.push({
        step: stepNum++,
        type: subtype,
        step_name: item.stepName || '',
        selector: d.selector || {},
        timestamp: item.timestamp,
      });
      continue;
    }

    // API Request events
    if (item.type === 'api_request') {
      var r = item.data;
      var reqType = r.type === 'SSE' ? 'sse' : (r.type === 'WS' || r.type === 'SOCKETIO' ? 'websocket' : 'http');
      var step = {
        step: stepNum++,
        type: reqType,
        url: r.url || '',
        method: r.method || 'GET',
        status: r.status,
        duration_ms: r.duration,
        request_headers: r.requestHeaders || {},
        request_body: r.requestBody || null,
        response_body: r.responseBody || null,
        content_type: r.contentType || '',
        error: r.error || null,
        call_stack: r.callStack || '',
        timestamp: r.timestamp,
        page_url: r.pageUrl || '',
        // 提取字段：定义从响应中提取哪些变量
        extract_fields: r.extractFields || [],
        // 依赖链：当前步骤依赖的步骤 ID 列表
        dependencies: r.dependencies || [],
        // 变量快照：步骤执行时的变量状态
        variables_at_step: currentStepVars[stepNum - 1] || {},
      };
      // Add SSE/WS messages if present
      if (r.sseMessages && r.sseMessages.length > 0) {
        step.sse_messages = r.sseMessages.slice(-100);
      }
      if (r.wsMessages && r.wsMessages.length > 0) {
        step.ws_messages = r.wsMessages.slice(-100);
      }
      steps.push(step);
    }
  }

  // Collect API summary
  var apiEndpoints = {};
  for (var i = 0; i < requests.length; i++) {
    var r = requests[i];
    if (r.type === 'SSE' || r.type === 'WS') continue;
    try {
      var u = new URL(r.url);
      var key = r.method + ' ' + u.pathname;
      if (!apiEndpoints[key]) {
        apiEndpoints[key] = { method: r.method, path: u.pathname, host: u.origin, examples: [], count: 0 };
      }
      apiEndpoints[key].count++;
      if (apiEndpoints[key].examples.length < 3) {
        apiEndpoints[key].examples.push({
          full_url: r.url,
          status: r.status,
          request_body: r.requestBody || null,
          response_body: r.responseBody || null,
          content_type: r.contentType || '',
        });
      }
    } catch(e) {}
  }

  // Collect all extracted variable paths
  var allExtractPaths = {};
  for (var i = 0; i < requests.length; i++) {
    var r = requests[i];
    if (r.extractFields) {
      for (var j = 0; j < r.extractFields.length; j++) {
        allExtractPaths[r.extractFields[j]] = true;
      }
    }
  }

  return {
    format_version: '1.0',
    exported_at: new Date().toISOString(),
    page_url: pageUrl,
    total_steps: steps.length,
    api_endpoints: Object.values(apiEndpoints),
    steps: steps,
    // 所有提取的字段路径（供 AI 参考）
    extracted_variables: Object.keys(allExtractPaths),
    // 所有步骤中的变量依赖关系
    variable_dependencies: buildVariableDependencies(steps),
  };
}

// 构建变量依赖关系：分析哪些步骤提取了变量，哪些步骤使用了这些变量
function buildVariableDependencies(steps) {
  var varUsage = {};
  // 检查请求体中是否有 {{varName}} 引用
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i];
    if (step.request_body && typeof step.request_body === 'string') {
      var matches = step.request_body.match(/\{\{(\w+)\}\}/g);
      if (matches) {
        for (var j = 0; j < matches.length; j++) {
          var varName = matches[j].replace(/\{\{|\}\}/g, '');
          if (!varUsage[varName]) varUsage[varName] = [];
          varUsage[varName].push(i + 1);
        }
      }
    }
    // 检查请求头中是否有 {{varName}} 引用
    if (step.request_headers) {
      for (var key in step.request_headers) {
        var val = step.request_headers[key];
        if (typeof val === 'string') {
          var matches = val.match(/\{\{(\w+)\}\}/g);
          if (matches) {
            for (var j = 0; j < matches.length; j++) {
              var varName = matches[j].replace(/\{\{|\}\}/g, '');
              if (!varUsage[varName]) varUsage[varName] = [];
              varUsage[varName].push(i + 1);
            }
          }
        }
      }
    }
  }
  return varUsage;
}

function exportWorkflowJSON() {
  var wf = buildWorkflowExport();
  var content = JSON.stringify(wf, null, 2);
  openCodeEditor(content, 'api-probe-workflow-' + Date.now() + '.json', 'workflow');
}

// ===== Playwright Code Generator =====
function generatePlaywrightCode(language) {
  var wf = buildWorkflowExport();
  var steps = wf.steps || [];
  var code = '';
  var auxFiles = [];
  
  if (language === 'node') {
    code = generateNodePlaywright(steps);
    // 生成配套 package.json
    var pkg = {
      name: 'api-probe-workflow',
      version: '1.0.0',
      private: true,
      scripts: { test: 'playwright test' },
      devDependencies: { '@playwright/test': '^1.40.0' }
    };
    auxFiles.push({ filename: 'package.json', content: JSON.stringify(pkg, null, 2) });
    auxFiles.push({ filename: 'README.md', content: '# API Probe - Recorded Workflow\n\n## Setup\n```bash\nnpm install\nnpx playwright install chromium\n```\n\n## Run\n```bash\nnpx playwright test\n```' });
  } else if (language === 'python') {
    code = generatePythonPlaywright(steps);
    // 生成配套 requirements.txt
    auxFiles.push({ filename: 'requirements.txt', content: 'playwright>=1.40.0\n' });
    auxFiles.push({ filename: 'README.md', content: '# API Probe - Recorded Workflow\n\n## Setup\n```bash\npip install -r requirements.txt\nplaywright install chromium\n```\n\n## Run\n```bash\npython workflow.py\n```' });
  }
  
  // 将配套文件信息传入代码编辑器
  var ext = language === 'node' ? '.spec.js' : '.spec.py';
  var auxInfo = '\n\n/* --- 配套文件 --- */\n';
  for (var ai = 0; ai < auxFiles.length; ai++) {
    auxInfo += '/* ' + auxFiles[ai].filename + ' :\n' + auxFiles[ai].content.split('\n').map(function(l) { return ' * ' + l; }).join('\n') + '\n */\n';
  }
  code += auxInfo;
  
  openCodeEditor(code, 'api-probe-workflow-' + Date.now() + ext, 'playwright-' + language);
}

function generateNodePlaywright(steps) {
  var lines = [];
  lines.push('const { test, expect } = require("@playwright/test");');
  lines.push('');
  lines.push('test.describe("AI Probe - Recorded Workflow", () => {');
  lines.push('  test("execute recorded steps", async ({ page }) => {');
  lines.push('    await page.setViewportSize({ width: 1280, height: 800 });');
  lines.push('');
  
  // 检查是否有导航步骤，没有则从page_url补充
  var hasNavigation = steps.some(function(s) { return s.type === 'navigation' && s.url; });
  if (!hasNavigation) {
    var firstPageUrl = '';
    for (var ni = 0; ni < steps.length; ni++) {
      if (steps[ni].page_url) { firstPageUrl = steps[ni].page_url; break; }
      if (steps[ni].url && steps[ni].type === 'http') { firstPageUrl = steps[ni].url; break; }
    }
    if (firstPageUrl) {
      lines.push('    // Navigate to start page');
      lines.push('    await page.goto("' + escapeJsString(firstPageUrl) + '");');
      lines.push('    await page.waitForLoadState("networkidle");');
      lines.push('');
    }
  }
  
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var comment = '    // Step ' + s.step + ': ';
    
    if (s.type === 'navigation') {
      lines.push(comment + 'Navigate to ' + (s.url || ''));
      if (s.url) lines.push('    await page.goto("' + escapeJsString(s.url) + '");');
      if (s.nav_type === 'pushState' || s.nav_type === 'replaceState') {
        lines.push('    // SPA navigation detected, waiting for page load');
        lines.push('    await page.waitForLoadState("networkidle");');
      }
      lines.push('');
      continue;
    }
    
    if (s.type === 'http' || s.type === 'sse' || s.type === 'websocket') {
      // Skip auto-generated API calls (like telemetry), only note them
      lines.push(comment + 'API: ' + (s.method || 'GET') + ' ' + (s.url || ''));
      lines.push('    // const response = await page.waitForResponse(');
      lines.push('    //   resp => resp.url().includes("' + escapeJsString(getUrlPath(s.url)) + '") && resp.status() === ' + (s.status || 200));
      lines.push('    // );');
      lines.push('');
      continue;
    }
    
    if (s.type === 'click') {
      var sel = s.selector || {};
      var selectorStr = buildBestSelector(sel);
      lines.push(comment + 'Click on ' + (sel.text || sel.tag || ''));
      lines.push('    // Selector: ' + selectorStr);
      lines.push('    // Position: (' + (s.position ? s.position.x : '?') + ', ' + (s.position ? s.position.y : '?') + ')');
      
      if (sel.iframe_path) {
        lines.push('    var frame = page.frameLocator("' + escapeJsString(sel.iframe_path) + '");');
        lines.push('    await frame.locator("' + escapeJsString(selectorStr) + '").click();');
      } else {
        lines.push('    await page.locator("' + escapeJsString(selectorStr) + '").click();');
      }
      lines.push('    await page.waitForTimeout(500);');
      lines.push('');
      continue;
    }
    
    if (s.type === 'input') {
      var sel = s.selector || {};
      var selectorStr = buildBestSelector(sel);
      var value = s.value || '';
      lines.push(comment + 'Type "' + value + '" into ' + (sel.tag || ''));
      lines.push('    // Selector: ' + selectorStr);
      if (sel.iframe_path) {
        lines.push('    var frame = page.frameLocator("' + escapeJsString(sel.iframe_path) + '");');
        lines.push('    await frame.locator("' + escapeJsString(selectorStr) + '").fill("' + escapeJsString(value) + '");');
      } else {
        lines.push('    await page.locator("' + escapeJsString(selectorStr) + '").fill("' + escapeJsString(value) + '");');
      }
      lines.push('');
      continue;
    }
    
    if (s.type === 'key_press') {
      lines.push(comment + 'Press "' + (s.key || '') + '"');
      lines.push('    await page.keyboard.press("' + escapeJsString(s.key || 'Enter') + '");');
      lines.push('');
      continue;
    }
    
    if (s.type === 'form_submit') {
      var sel = s.selector || {};
      lines.push(comment + 'Submit form');
      lines.push('    // Action: ' + (s.action || ''));
      lines.push('    await page.waitForLoadState("networkidle");');
      lines.push('');
      continue;
    }
    
    if (s.type === 'dom_mutation') {
      lines.push(comment + 'DOM mutation (auto-detected)');
      lines.push('    await page.waitForTimeout(300);');
      lines.push('');
      continue;
    }
    
    // Fallback for unknown types
    lines.push(comment + s.type);
    lines.push('    await page.waitForTimeout(300);');
    lines.push('');
  }
  
  lines.push('  });');
  lines.push('});');
  lines.push('');
  
  return lines.join('\n');
}

function generatePythonPlaywright(steps) {
  var lines = [];
  lines.push('import asyncio');
  lines.push('from playwright.async_api import async_playwright, expect');
  lines.push('');
  lines.push('');
  lines.push('async def run(playwright):');
  lines.push('    browser = await playwright.chromium.launch(headless=False)');
  lines.push('    context = await browser.new_context(viewport={"width": 1280, "height": 800})');
  lines.push('    page = await context.new_page()');
  lines.push('');
  
  // 检查是否有导航步骤，没有则从page_url补充
  var hasNavigation = steps.some(function(s) { return s.type === 'navigation' && s.url; });
  if (!hasNavigation) {
    var firstPageUrl = '';
    for (var ni = 0; ni < steps.length; ni++) {
      if (steps[ni].page_url) { firstPageUrl = steps[ni].page_url; break; }
      if (steps[ni].url && steps[ni].type === 'http') { firstPageUrl = steps[ni].url; break; }
    }
    if (firstPageUrl) {
      lines.push('    # Navigate to start page');
      lines.push('    await page.goto("' + escapeJsString(firstPageUrl) + '")');
      lines.push('    await page.wait_for_load_state("networkidle")');
      lines.push('');
    }
  }
  
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    var comment = '    # Step ' + s.step + ': ';
    
    if (s.type === 'navigation') {
      lines.push(comment + 'Navigate to ' + (s.url || ''));
      if (s.url) lines.push('    await page.goto("' + escapeJsString(s.url) + '")');
      lines.push('    await page.wait_for_load_state("networkidle")');
      lines.push('');
      continue;
    }
    
    if (s.type === 'http' || s.type === 'sse' || s.type === 'websocket') {
      lines.push(comment + 'API: ' + (s.method || 'GET') + ' ' + (s.url || ''));
      lines.push('    # await page.wait_for_response(');
      lines.push('    #     lambda resp: "' + escapeJsString(getUrlPath(s.url)) + '" in resp.url and resp.status == ' + (s.status || 200));
      lines.push('    # )');
      lines.push('');
      continue;
    }
    
    if (s.type === 'click') {
      var sel = s.selector || {};
      var selectorStr = buildBestSelector(sel);
      lines.push(comment + 'Click on ' + (sel.text || sel.tag || ''));
      lines.push('    # Selector: ' + selectorStr);
      if (sel.iframe_path) {
        lines.push('    frame = page.frame_locator("' + escapeJsString(sel.iframe_path) + '")');
        lines.push('    await frame.locator("' + escapeJsString(selectorStr) + '").click()');
      } else {
        lines.push('    await page.locator("' + escapeJsString(selectorStr) + '").click()');
      }
      lines.push('    await page.wait_for_timeout(500)');
      lines.push('');
      continue;
    }
    
    if (s.type === 'input') {
      var sel = s.selector || {};
      var selectorStr = buildBestSelector(sel);
      var value = s.value || '';
      lines.push(comment + 'Type "' + value + '" into ' + (sel.tag || ''));
      lines.push('    # Selector: ' + selectorStr);
      if (sel.iframe_path) {
        lines.push('    frame = page.frame_locator("' + escapeJsString(sel.iframe_path) + '")');
        lines.push('    await frame.locator("' + escapeJsString(selectorStr) + '").fill("' + escapeJsString(value) + '")');
      } else {
        lines.push('    await page.locator("' + escapeJsString(selectorStr) + '").fill("' + escapeJsString(value) + '")');
      }
      lines.push('');
      continue;
    }
    
    if (s.type === 'key_press') {
      lines.push(comment + 'Press "' + (s.key || '') + '"');
      lines.push('    await page.keyboard.press("' + escapeJsString(s.key || 'Enter') + '")');
      lines.push('');
      continue;
    }
    
    if (s.type === 'form_submit') {
      lines.push(comment + 'Submit form');
      lines.push('    await page.wait_for_load_state("networkidle")');
      lines.push('');
      continue;
    }
    
    // Fallback
    lines.push(comment + s.type);
    lines.push('    await page.wait_for_timeout(300)');
    lines.push('');
  }
  
  lines.push('    await browser.close()');
  lines.push('');
  lines.push('');
  lines.push('async def main():');
  lines.push('    async with async_playwright() as playwright:');
  lines.push('        await run(playwright)');
  lines.push('');
  lines.push('');
  lines.push('if __name__ == "__main__":');
  lines.push('    asyncio.run(main())');
  lines.push('');
  
  return lines.join('\n');
}

function buildBestSelector(sel) {
  if (!sel) return '*';
  // Priority: data-* attrs > id > aria-label > css path > tag+text
  if (sel.data_attrs) {
    for (var key in sel.data_attrs) {
      if (sel.data_attrs.hasOwnProperty(key) && sel.data_attrs[key]) {
        return '[' + key + '="' + escapeJsString(sel.data_attrs[key]) + '"]';
      }
    }
  }
  if (sel.id) return '#' + CSS.escape(sel.id);
  if (sel.aria_label) return '[' + (sel.role ? sel.role : '*') + '="' + escapeJsString(sel.aria_label) + '"]';
  if (sel.css) return sel.css;
  if (sel.tag && sel.text) return sel.tag + ':has-text("' + escapeJsString(sel.text.substring(0, 30)) + '")';
  if (sel.tag) return sel.tag;
  return '*';
}

// Helper: extract path from URL
function getUrlPath(url) {
  try { return new URL(url).pathname; } catch(e) { return url || ''; }
}

// Helper: escape for JS string
function escapeJsString(str) {
  if (typeof str !== 'string') return String(str || '');
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}


// Add "工作流" export option to the dropdowns
(function addWorkflowExportOptions() {
  var menus = [exportDropdown, ctxSubmenu];
  for (var mi = 0; mi < menus.length; mi++) {
    var menu = menus[mi];
    if (!menu) continue;
    var sep = document.createElement('div');
    sep.className = menu === ctxSubmenu ? 'ctx-sub-sep' : 'dd-sep';
    menu.appendChild(sep);
    var wfItem = document.createElement('div');
    wfItem.className = menu === ctxSubmenu ? 'ctx-sub-item' : 'dd-item';
    wfItem.dataset.format = 'workflow';
    wfItem.textContent = '🤖 AI 工作流 (.json)';
    wfItem.addEventListener('click', function(e) {
      e.stopPropagation();
      if (menu === ctxSubmenu) { hideCtxMenu(); }
      else { exportDropdown.classList.remove('show'); }
      exportWorkflowJSON();
    });
    menu.appendChild(wfItem);
    
    // Playwright Node.js
    var pwNodeItem = document.createElement('div');
    pwNodeItem.className = menu === ctxSubmenu ? 'ctx-sub-item' : 'dd-item';
    pwNodeItem.dataset.format = 'playwright-node';
    pwNodeItem.textContent = '🎭 Playwright (Node.js)';
    pwNodeItem.addEventListener('click', function(e) {
      e.stopPropagation();
      if (menu === ctxSubmenu) { hideCtxMenu(); }
      else { exportDropdown.classList.remove('show'); }
      generatePlaywrightCode('node');
    });
    menu.appendChild(pwNodeItem);
    
    // Playwright Python
    var pwPyItem = document.createElement('div');
    pwPyItem.className = menu === ctxSubmenu ? 'ctx-sub-item' : 'dd-item';
    pwPyItem.dataset.format = 'playwright-python';
    pwPyItem.textContent = '🎭 Playwright (Python)';
    pwPyItem.addEventListener('click', function(e) {
      e.stopPropagation();
      if (menu === ctxSubmenu) { hideCtxMenu(); }
      else { exportDropdown.classList.remove('show'); }
      generatePlaywrightCode('python');
    });
    menu.appendChild(pwPyItem);
    
    // 验证沙箱
    var sbItem = document.createElement('div');
    sbItem.className = menu === ctxSubmenu ? 'ctx-sub-item' : 'dd-item';
    sbItem.dataset.format = 'sandbox';
    sbItem.textContent = '🔍 验证沙箱 (HTML)';
    sbItem.addEventListener('click', function(e) {
      e.stopPropagation();
      if (menu === ctxSubmenu) { hideCtxMenu(); }
      else { exportDropdown.classList.remove('show'); }
      generateSandboxRunner();
    });
    menu.appendChild(sbItem);
  }
})();

initEnv();
initColl();
loadRequests(function() {
  applyFilters();
  updateStatus();
});
loadTabs();

// 恢复录制状态（从 session storage 读取）
chrome.storage.session.get('apiProbeRecording', function(r) {
  if (r && r.apiProbeRecording) {
    recording = true;
    btnRecord.textContent = '\u25cf \u5f55\u5236\u4e2d';
    btnRecord.classList.add('recording');
    updateStatus();
  }
});

// ---- 11. 验证沙箱：生成自包含HTML测试运行器 ----
function generateSandboxRunner() {
  var wf = buildWorkflowExport();
  var steps = wf.steps || [];
  var stepsJson = JSON.stringify(steps, null, 2).replace(/<\/script>/g, '<\\/script>');
  var workflowJson = JSON.stringify(wf, null, 2).replace(/<\/script>/g, '<\\/script>');
  
  var lines = [];
  lines.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>API Probe - 工作流验证沙箱</title>');
  lines.push('<style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px}');
  lines.push('h1{color:#333}.step{border:1px solid #ddd;border-radius:8px;padding:12px;margin:8px 0}');
  lines.push('.step-num{font-size:12px;color:#666}.step-type{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin:4px 0}');
  lines.push('.type-click{background:#dbeafe;color:#1d4ed8}.type-navigation{background:#dcfce7;color:#15803d}');
  lines.push('.type-input{background:#fef3c7;color:#92400e}.type-http{background:#f3e8ff;color:#6b21a8}');
  lines.push('.step-info{font-size:13px;margin:4px 0;color:#444}');
  lines.push('#controls{margin:16px 0;padding:12px;background:#f9fafb;border-radius:8px}');
  lines.push('button{padding:8px 16px;border:none;border-radius:4px;cursor:pointer;margin:4px}');
  lines.push('.btn-primary{background:#2563eb;color:#fff}.btn-secondary{background:#e5e7eb;color:#374151}');
  lines.push('#output{background:#1e293b;color:#e2e8f0;padding:12px;border-radius:8px;font-family:monospace;font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto;margin-top:12px}');
  lines.push('.log-info{color:#60a5fa}.log-success{color:#34d399}.log-error{color:#f87171}');
  lines.push('</style></head><body>');
  lines.push('<h1>\u{1F50D} API Probe - 工作流验证沙箱</h1>');
  lines.push('<p style="color:#6b7280;font-size:14px">此页面包含录制的工作流步骤，供AI参考生成可执行代码。</p>');
  lines.push('<div id="controls"><button class="btn-primary" onclick="runWorkflow()">\u25B6 运行工作流</button>');
  lines.push('<button class="btn-secondary" onclick="exportJSON()">\u{1F4E5} 导出JSON</button></div>');
  lines.push('<div id="steps"></div><div id="output">就绪，点击「运行工作流」开始验证</div>');
  lines.push('<script>');
  lines.push('var steps = ' + stepsJson + ';');
  lines.push('var wf = ' + workflowJson + ';');
  lines.push('function log(msg,tp){var o=document.getElementById("output");o.innerHTML+="<div class=\'log-\"+tp+"\'>\"+msg+"</div>";o.scrollTop=o.scrollHeight}');
  lines.push('function runWorkflow(){log("=== 开始工作流验证 ===","info");');
  lines.push('for(var i=0;i<steps.length;i++){var s=steps[i];');
  lines.push('log("Step "+s.step+": "+s.type+" "+(s.url||(s.selector?s.selector.css:"")||s.key||""),"info");');
  lines.push('if(s.type==="navigation"&&s.url)log("  \u2192 导航到: "+s.url,"success");');
  lines.push('if(s.type==="click"&&s.selector&&s.selector.css)log("  \u2192 点击: "+s.selector.css,"success");');
  lines.push('if(s.type==="input")log("  \u2192 输入: "+(s.value||""),"success");');
  lines.push('if(s.page_url)log("  \u2192 页面: "+s.page_url,"info");');
  lines.push('if(s.storage_snapshot)log("  \u2192 存储快照已记录","info");}');
  lines.push('log("=== 验证完成: 共"+steps.length+"个步骤 ===","success");}');
  lines.push('function exportJSON(){var b=new Blob([JSON.stringify(wf,null,2)],{type:"application/json"});');
  lines.push('var a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="api-probe-workflow-"+Date.now()+".json";a.click()}');
  lines.push('</script></body></html>');
  
  openCodeEditor(lines.join("\n"), "api-probe-sandbox-" + Date.now() + ".html", "sandbox");
}

// ===== Tab 管理：监听标签页变化，刷新 tab-list =====// ===== Tab 管理：监听标签页变化，刷新 tab-list =====
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo) {
  if (changeInfo.title || changeInfo.url) loadTabs();
});
chrome.tabs.onActivated.addListener(function() {
  loadTabs();
});

// 侧边栏启动时向当前活跃标签注入 content script

chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {

  if (tabs[0]) {

    chrome.runtime.sendMessage({ type: 'API_PROBE_INJECT_TAB', tabId: tabs[0].id }).catch(function() {});

  }

});

// ===== Script System (Pre-request / Post-response) =====
var scriptRequest = null;
var scriptCurrentTab = 'pre';
var pmVariables = {};

try { var saved = JSON.parse(localStorage.getItem('apiProbePmVars') || '{}'); pmVariables = saved; } catch(e) {}

function savePmVars() {
  try { localStorage.setItem('apiProbePmVars', JSON.stringify(pmVariables)); } catch(e) {}
}

var pm = {
  variables: {
    get: function(k) { return pmVariables[k]; },
    set: function(k, v) { pmVariables[k] = v; savePmVars(); },
    unset: function(k) { delete pmVariables[k]; savePmVars(); },
    clear: function() { pmVariables = {}; savePmVars(); }
  },
  _tests: [],
  test: function(name, cond) { pm._tests.push({ name: name, pass: !!cond }); }
};

function runScript(code, ctx) {
  pm._tests = [];
  var r = { success: true, error: null, output: '' };
  if (!code || !code.trim()) return r;
  try {
    var logs = [];
    var fn = new Function('pm', 'request', 'response', 'console', code);
    fn(pm, ctx.request || {}, ctx.response || {}, { log: function() {
      var args = Array.prototype.slice.call(arguments);
      logs.push(args.join(' '));
    }});
    r.output = logs.join('\n');
  } catch(e) { r.success = false; r.error = e.message; }
  r.tests = pm._tests;
  return r;
}

function openScriptEditor(req) {
  scriptRequest = req;
  var ep = document.getElementById('scriptEndpoint');
  if (ep) ep.textContent = req ? req.url : '';
  var ed = document.getElementById('scriptEditor');
  if (ed) ed.value = req && req.preScript ? req.preScript : '';
  switchScriptTab('pre');
  refreshVarsPanel();
  var ov = document.getElementById('scriptEditorOverlay');
  if (ov) ov.style.display = 'flex';
}

function switchScriptTab(tab) {
  scriptCurrentTab = tab;
  var tabs = document.querySelectorAll('.script-tab');
  for (var i = 0; i < tabs.length; i++) {
    var el = tabs[i];
    var active = el.dataset.tab === tab;
    el.style.color = active ? '#2563eb' : '#6b7280';
    el.style.borderBottomColor = active ? '#2563eb' : 'transparent';
    el.style.fontWeight = active ? '500' : '400';
  }
  if (scriptRequest) {
    var ed = document.getElementById('scriptEditor');
    if (ed) ed.value = tab === 'pre' ? (scriptRequest.preScript || '') : (scriptRequest.postScript || '');
  }
}

function refreshVarsPanel() {
  var list = document.getElementById('scriptVarsList');
  var panel = document.getElementById('scriptVarsPanel');
  if (!list || !panel) return;
  var keys = Object.keys(pmVariables);
  if (keys.length === 0) {
    list.innerHTML = '<span style="color:#6b7280">No variables set</span>';
    panel.style.display = 'none';
    return;
  }
  panel.style.display = 'flex';
  var h = '';
  for (var i = 0; i < keys.length; i++) {
    var v = typeof pmVariables[keys[i]] === 'string' ? pmVariables[keys[i]].substring(0, 50) : JSON.stringify(pmVariables[keys[i]]).substring(0, 50);
    h += '<div style="margin:2px 0"><span style="color:#2563eb">' + keys[i] + '</span> = <span style="color:#059669">' + v + '</span></div>';
  }
  list.innerHTML = h;
}

// DOM init
(function(){
  var closeBtn = document.getElementById('scriptEditorClose');
  if (closeBtn) closeBtn.addEventListener('click', function() { document.getElementById('scriptEditorOverlay').style.display = 'none'; });
  
  var tabs = document.querySelectorAll('.script-tab');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].addEventListener('click', function() { switchScriptTab(this.dataset.tab); });
  }
  
  var saveBtn = document.getElementById('scriptSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', function() {
    if (!scriptRequest) return;
    var code = document.getElementById('scriptEditor').value;
    var idx = requests.indexOf(scriptRequest);
    if (idx >= 0) {
      if (scriptCurrentTab === 'pre') requests[idx].preScript = code;
      else requests[idx].postScript = code;
    }
    if (ctxRequest === scriptRequest) {
      if (scriptCurrentTab === 'pre') ctxRequest.preScript = code;
      else ctxRequest.postScript = code;
    }
    saveRequests();
    var st = document.getElementById('scriptStatus');
    if (st) { st.textContent = 'Saved'; setTimeout(function() { st.textContent = ''; }, 2000); }
  });
  
  var runBtn = document.getElementById('scriptRunBtn');
  if (runBtn) runBtn.addEventListener('click', function() {
    var code = document.getElementById('scriptEditor').value;
    var out = document.getElementById('scriptOutput');
    var st = document.getElementById('scriptStatus');
    if (out) out.style.display = '';
    var mockReq = { url: 'https://api.example.com/test', method: 'POST', body: '{}' };
    var mockResp = { status: 200, body: '{"result":"ok"}', headers: {'content-type': 'application/json'} };
    var result = runScript(code, { request: mockReq, response: scriptCurrentTab === 'post' ? mockResp : {} });
    var html = '';
    if (result.output) html += result.output;
    if (!result.success) html += '\nError: ' + result.error;
    if (result.tests && result.tests.length > 0) {
      html += '\n--- Tests ---\n';
      for (var i = 0; i < result.tests.length; i++) {
        html += (result.tests[i].pass ? 'PASS' : 'FAIL') + ': ' + result.tests[i].name + '\n';
      }
    }
    if (out) out.textContent = html || '(no output)';
    if (st) st.textContent = result.success ? 'OK' : 'Error';
    refreshVarsPanel();
  });
})();

// ===== 清空按钮 =====

btnClear.addEventListener('click', () => {
  requests = []; filteredRequests = []; ctxRequest = null;
  hideCtxMenu(); renderRequests(); updateStatus(); clearStorage();
  chrome.runtime.sendMessage({ type: 'API_PROBE_CLEAR' });
});

// ===== 清空事件按钮 =====
var btnClearEvents = document.getElementById('btnClearEvents');
if (btnClearEvents) {
  btnClearEvents.addEventListener('click', function() {
    events = [];
    renderEvents();
  });
}

// ===== 新建请求按钮 =====

btnNewRequest.addEventListener('click', openBuilderPanel);

// ===== 导出按钮 =====

btnExport.addEventListener('click', () => {
  exportDropdown.classList.toggle('show');
});

// ===== Auth System (for builder & replay) =====
function applyAuth(authType, authToken, authKey) {
  var h = {};
  if (authType === 'bearer' && authToken) {
    h['Authorization'] = 'Bearer ' + authToken;
  } else if (authType === 'oauth2' && authToken) {
    h['Authorization'] = 'Bearer ' + authToken;
  } else if (authType === 'basic' && authToken) {
    var parts = authToken.split(':');
    var user = parts[0] || '';
    var pass = parts.slice(1).join(':');
    h['Authorization'] = 'Basic ' + btoa(user + ':' + pass);
  } else if (authType === 'digest' && authToken) {
    h['X-Auth-Digest-Credentials'] = authToken;
  } else if (authType === 'apikey' && authKey && authToken) {
    h[authKey] = authToken;
  }
  return h;
}

function applyAuthToUrl(authType, authToken, authKey, url) {
  if ((authType === 'apikey-query') && authKey && authToken && url) {
    try {
      var u = new URL(url);
      u.searchParams.append(authKey, authToken);
      return u.toString();
    } catch(e) {}
  }
  return url;
}

function setupAuthUI(authTypeSelect, tokenInput, keyInput, keyFields) {
  function update() {
    var t = authTypeSelect.value;
    tokenInput.style.display = (t === 'bearer' || t === 'oauth2' || t === 'basic' || t === 'digest') ? '' : 'none';
    keyFields.style.display = (t === 'apikey' || t === 'apikey-query') ? '' : 'none';
    if (t === '') tokenInput.style.display = 'none';
    if (t === 'basic') tokenInput.placeholder = 'username:password';
    else if (t === 'bearer') tokenInput.placeholder = 'Token or JWT...';
    else if (t === 'oauth2') tokenInput.placeholder = 'Access Token...';
    else if (t === 'digest') tokenInput.placeholder = 'user:password';
    else tokenInput.placeholder = 'Token or credentials...';
  }
  authTypeSelect.addEventListener('change', update);
  update();
}

// Builder Auth
(function(){
  var sel = document.getElementById('builderAuthType');
  var tok = document.getElementById('builderAuthToken');
  var key = document.getElementById('builderAuthKey');
  var keyF = document.getElementById('builderAuthKeyFields');
  if (sel) setupAuthUI(sel, tok, key, keyF);
  
  var tog = document.getElementById('builderAuthToggle');
  var pan = document.getElementById('builderAuthPanel');
  if (tog && pan) {
    tog.addEventListener('click', function() {
      var vis = pan.style.display !== 'none';
      pan.style.display = vis ? 'none' : '';
      tog.querySelector('.params-arrow').textContent = vis ? '\u25b8' : '\u25be';
    });
  }
})();

// Replay Auth
(function(){
  var sel = document.getElementById('replayAuthType');
  var tok = document.getElementById('replayAuthToken');
  var key = document.getElementById('replayAuthKey');
  var keyF = document.getElementById('replayAuthKeyFields');
  if (sel) setupAuthUI(sel, tok, key, keyF);
  
  var tog = document.getElementById('replayAuthToggle');
  var pan = document.getElementById('replayAuthPanel');
  if (tog && pan) {
    tog.addEventListener('click', function() {
      var vis = pan.style.display !== 'none';
      pan.style.display = vis ? 'none' : '';
      tog.querySelector('.params-arrow').textContent = vis ? '\u25b8' : '\u25be';
    });
  }
})();

// ===== GraphQL Console =====
var gqlRequest = null;

function openGqlConsole(req) {
  gqlRequest = req;
  var overlay = document.getElementById('gqlConsoleOverlay');
  var ep = document.getElementById('gqlEndpoint');
  ep.textContent = req ? req.url : '';
  document.getElementById('gqlResponse').textContent = '';
  document.getElementById('gqlStatus').textContent = '';
  document.getElementById('gqlSchemaTree').innerHTML = 'Click Load Schema to browse types';
  overlay.style.display = 'flex';
}

document.getElementById('gqlConsoleClose').addEventListener('click', function() {
  document.getElementById('gqlConsoleOverlay').style.display = 'none';
});

document.getElementById('gqlClearBtn').addEventListener('click', function() {
  document.getElementById('gqlQueryEditor').value = '';
  document.getElementById('gqlResponse').textContent = '';
  document.getElementById('gqlStatus').textContent = '';
});

document.getElementById('gqlPrettyBtn').addEventListener('click', function() {
  var editor = document.getElementById('gqlQueryEditor');
  try {
    var parsed = JSON.parse(editor.value);
    editor.value = JSON.stringify(parsed, null, 2);
  } catch(e) {
    // try formatting as GraphQL SDL (basic indent)
    var lines = editor.value.split('\n');
    var out = [];
    var indent = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('}') >= 0 || line.indexOf(')') >= 0) indent = Math.max(0, indent - 1);
      out.push('  '.repeat(indent) + line);
      if (line.indexOf('{') >= 0 || line.indexOf('(') >= 0) indent++;
    }
    editor.value = out.join('\n');
  }
});

document.getElementById('gqlExecuteBtn').addEventListener('click', function() {
  var gqlUrl = document.getElementById('gqlEndpoint').textContent;
  var gqlQuery = document.getElementById('gqlQueryEditor').value.trim();
  if (gqlUrl) {
    openBuilderPanel({ url: gqlUrl, requestBody: gqlQuery ? JSON.stringify({ query: gqlQuery }) : null }, 'graphql');
  }
});

document.getElementById('gqlLoadSchemaBtn').addEventListener('click', function() {
  var url = document.getElementById('gqlEndpoint').textContent;
  if (!url) { document.getElementById('gqlStatus').textContent = 'No endpoint'; return; }
  
  var tree = document.getElementById('gqlSchemaTree');
  var statusEl = document.getElementById('gqlStatus');
  tree.innerHTML = 'Loading schema...';
  statusEl.textContent = 'Introspecting...';
  
  var query = 'query IntrospectionQuery { __schema { queryType { name } mutationType { name } subscriptionType { name } types { kind name description fields(includeDeprecated:true) { name description args { name description type { kind name ofType { kind name } } } type { kind name ofType { kind name ofType { kind name } } } } } } }';
  
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: query })
  }).then(function(r) { return r.json(); }).then(function(result) {
    if (result.errors) {
      tree.innerHTML = '<span style="color:#b91c1c">Schema introspection failed</span>';
      statusEl.textContent = 'Error: ' + result.errors[0].message;
      return;
    }
    var schema = result.data.__schema;
    var html = '';
    html += '<div style="font-weight:600;margin-bottom:4px">Query: ' + (schema.queryType ? schema.queryType.name : 'none') + '</div>';
    html += '<div style="font-weight:600;margin-bottom:4px">Mutation: ' + (schema.mutationType ? schema.mutationType.name : 'none') + '</div>';
    html += '<div style="font-weight:600;margin-bottom:8px">Subscription: ' + (schema.subscriptionType ? schema.subscriptionType.name : 'none') + '</div>';
    
    // Build type map
    var typeMap = {};
    for (var i = 0; i < schema.types.length; i++) {
      var t = schema.types[i];
      if (t.name.indexOf('__') === 0) continue;
      typeMap[t.name] = t;
    }
    
    var typeNames = Object.keys(typeMap).sort();
    for (var i = 0; i < typeNames.length; i++) {
      var t = typeMap[typeNames[i]];
      var kind = t.kind === 'SCALAR' ? '🟢' : t.kind === 'OBJECT' ? '🔵' : t.kind === 'ENUM' ? '🟡' : t.kind === 'INPUT_OBJECT' ? '🟠' : '⚪';
      html += '<div style="margin:2px 0"><details><summary style="cursor:pointer;padding:2px 4px;border-radius:3px">' + kind + ' <span style="font-weight:600">' + t.name + '</span> <span style="color:#9ca3af;font-size:10px">' + t.kind + '</span></summary>';
      if (t.description) html += '<div style="color:#6b7280;font-size:10px;margin:2px 0 4px 16px">' + t.description + '</div>';
      if (t.fields) {
        for (var j = 0; j < t.fields.length; j++) {
          var f = t.fields[j];
          var ftype = f.type || {};
          var typeName = ftype.name || (ftype.ofType ? ftype.ofType.name || (ftype.ofType.ofType ? ftype.ofType.ofType.name : '?') : '?');
          html += '<div style="margin:1px 0 1px 16px;font-size:10px"><span style="color:#2563eb">' + f.name + '</span>: <span style="color:#059669">' + typeName + '</span></div>';
        }
      }
      if (t.kind === 'ENUM' && t.enumValues) {
        for (var j = 0; j < t.enumValues.length; j++) {
          html += '<div style="margin:1px 0 1px 16px;font-size:10px;color:#9333ea">' + t.enumValues[j].name + '</div>';
        }
      }
      html += '</details></div>';
    }
    tree.innerHTML = html;
    statusEl.textContent = 'Schema loaded (' + typeNames.length + ' types)';
  }).catch(function(err) {
    tree.innerHTML = '<span style="color:#b91c1c">Request failed</span>';
    statusEl.textContent = 'Error: ' + err.message;
  });
});

// ===== JSON Beautify / Compress =====
function setupJsonToolbar(textareaId, beautifyId, compressId, sizeId) {
  var ta = document.getElementById(textareaId);
  var btnB = document.getElementById(beautifyId);
  var btnC = document.getElementById(compressId);
  var sizeEl = document.getElementById(sizeId);
  if (!ta) return;
  
  function isXml(str) {
    return /^\s*<[\?!]?\w/m.test(str);
  }

  function beautifyXml(str) {
    var out = ''; var indent = 0;
    str.replace(/(>)(<)(\/*)/g, '$1\n$2$3').split('\n').forEach(function(line) {
      line = line.trim(); if (!line) return;
      if (/^<\/\w/.test(line)) indent--;
      out += '  '.repeat(Math.max(0, indent)) + line + '\n';
      if (/^<\w[^>]*[^\/]>.*$/.test(line) && !/^<\w+[^>]*\/>/.test(line)) indent++;
    });
    return out.trim();
  }

  function compressXml(str) {
    return str.replace(/>\s+</g, '><').replace(/\n\s*/g, '').trim();
  }
  
  function update() {
    var v = ta.value.trim();
    if (!v) { btnB.style.display = 'none'; btnC.style.display = 'none'; if(sizeEl) sizeEl.textContent = ''; return; }
    var isJson = false;
    try { JSON.parse(v); isJson = true; } catch(e) {}
    var isXmlDoc = isXml(v);
    btnB.style.display = (isJson || isXmlDoc) ? 'inline-block' : 'none';
    btnC.style.display = (isJson || isXmlDoc) ? 'inline-block' : 'none';
    if (sizeEl) {
      var bytes = new TextEncoder().encode(v).length;
      sizeEl.textContent = bytes > 1024 ? (bytes/1024).toFixed(1) + 'KB' : bytes + 'B';
    }
  }
  
  ta.addEventListener('input', update);
  
  if (btnB) btnB.addEventListener('click', function() {
    try {
      var v = ta.value;
      if (isXml(v)) { ta.value = beautifyXml(v); }
      else { ta.value = JSON.stringify(JSON.parse(v), null, 2); }
      update();
    } catch(e) {}
  });
  
  if (btnC) btnC.addEventListener('click', function() {
    try {
      var v = ta.value;
      if (isXml(v)) { ta.value = compressXml(v); }
      else { ta.value = JSON.stringify(JSON.parse(v)); }
      update();
    } catch(e) {}
  });
  
  update();
}

// Init builder and replay JSON toolbars
(function() {
  // Try immediately (DOM already loaded since script is at end of body)
  var ta = document.getElementById('builderBody');
  if (ta) {
    setupJsonToolbar('builderBody', 'builderBeautifyJson', 'builderCompressJson', 'builderBodySize');
  }
})();

