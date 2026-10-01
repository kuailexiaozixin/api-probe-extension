// API Probe - Content Script (MAIN world)
// 拦截页面�?fetch/XHR，通过 postMessage 发送到支持工作流编排的功能
// 支持响应值提取、变量引用、依赖链

let recording = false;
let requestCount = 0;
let currentStep = 0;
const API_TIMEOUT = 30000; // 30s 超时

// ---- 工作流变量存�?----
// 存储提取的变量，支持 {{varName}} 引用语法
var workflowVars = new Map();

// ---- 调用栈捕�?----
function captureStack() {
  const raw = new Error().stack;
  if (!raw) return '';
  const lines = raw.split('\n');
  return lines.slice(2).filter(l => {
    const t = l.trim();
    return !t.includes('content.js') && !t.includes('bridge.js') && t.length > 0;
  }).join('\n').trim();
}


// ---- 自动提取响应中的关键字段（token、ID等） ----
function autoExtractFields(responseBody) {
  if (!responseBody || typeof responseBody !== 'object') return {};
  var extracted = {};
  var keysToExtract = ['token', 'access_token', 'refresh_token', 'id', 'userId', 'user_id', 
                       'sessionId', 'session_id', 'uid', 'userid', 'appId', 'app_id',
                       'orderId', 'order_id', 'taskId', 'task_id', 'fileId', 'file_id',
                       'documentId', 'document_id', 'resourceId', 'resource_id'];
  function search(obj, path) {
    if (!obj || typeof obj !== 'object') return;
    for (var key in obj) {
      if (!obj.hasOwnProperty(key)) continue;
      var val = obj[key];
      var fullPath = path ? path + '.' + key : key;
      // 匹配关键字段�?
      var keyLower = key.toLowerCase();
      for (var k = 0; k < keysToExtract.length; k++) {
        if (keyLower === keysToExtract[k].toLowerCase()) {
          extracted[fullPath] = typeof val === 'string' || typeof val === 'number' ? val : JSON.stringify(val).slice(0, 100);
        }
      }
      // 递归搜索嵌套对象（最�?3 层）
      if (path.split('.').length < 3 && typeof val === 'object' && !Array.isArray(val)) {
        search(val, fullPath);
      }
    }
  }
  search(responseBody, '');
  return extracted;
}

// ---- 从响应中提取变量 ----
function extractVariables(responseBody, extractPaths) {
  if (!responseBody || !extractPaths || extractPaths.length === 0) return {};
  const extracted = {};
  for (const path of extractPaths) {
    try {
      const keys = path.split('.');
      let value = responseBody;
      for (const k of keys) {
        if (value && typeof value === 'object') {
          value = value[k];
        } else {
          value = undefined;
          break;
        }
      }
      extracted[path] = value !== undefined ? value : null;
    } catch (e) {
      console.warn('[API Probe] Extract variable failed:', path, e);
    }
  }
  return extracted;
}

// ---- 替换请求体中的变量引�?----
function replaceVarsInBody(body, vars) {
  if (!body) return body;
  if (typeof body === 'string') {
    return body.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return vars.has(key) ? String(vars.get(key)) : match;
    });
  }
  if (typeof body === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string') {
        result[k] = v.replace(/\{\{(\w+)\}\}/g, (match, key) => {
          return vars.has(key) ? String(vars.get(key)) : match;
        });
      } else {
        result[k] = v;
      }
    }
    return result;
  }
  return body;
}

// ---- 替换请求头中的变量引�?----
function replaceVarsInHeaders(headers, vars) {
  if (!headers) return headers;
  const result = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === 'string') {
      result[k] = v.replace(/\{\{(\w+)\}\}/g, (match, key) => {
        return vars.has(key) ? String(vars.get(key)) : match;
      });
    } else {
      result[k] = v;
    }
  }
  return result;
}

// ---- fetch 拦截 ----
const origFetch = window.fetch;
window.fetch = async function(input, init) {
  if (!recording) return origFetch.call(this, input, init);

  const url = typeof input === 'string' ? input
    : (input instanceof Request ? input.url : input?.href || '');
  const method = init?.method || (input instanceof Request ? input.method : 'GET');
  const reqId = ++requestCount;
  const startTime = Date.now();
  let requestBody = null;
  const callStack = captureStack();

  // 捕获请求体（先做变量替换�?
  try {
    if (init?.body) {
      if (typeof init.body === 'string') {
        requestBody = replaceVarsInBody(init.body, workflowVars);
      } else if (init.body instanceof URLSearchParams) {
        const obj = Object.fromEntries(init.body);
        requestBody = replaceVarsInBody(obj, workflowVars);
      } else if (init.body instanceof FormData) {
        const obj = {};
        for (const [k, v] of init.body.entries()) obj[k] = v;
        requestBody = obj;
      }
    } else if (input instanceof Request && input.body) {
      requestBody = '(stream)';
    }
  } catch {}

  // 提取请求头（做变量替换）
  let reqHeaders = {};
  try {
    if (init?.headers) {
      const h = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
      h.forEach((v, k) => { reqHeaders[k] = v; });
    }
    reqHeaders = replaceVarsInHeaders(reqHeaders, workflowVars);
  } catch {}

  try {
    const response = await origFetch.call(this, input, init);
    if (!recording) return response;
    const duration = Date.now() - startTime;

    // 追踪重定向链
    var redirectChain = [];
    if (response.redirected) {
      redirectChain.push(response.url);
    }

    // 克隆响应以读取内�?
    const clone = response.clone();
    let responseBody = null;
    let contentType = response.headers.get('content-type') || '';
    var bodyTruncated = false;

    try {
      if (contentType.includes('json')) {
        var raw = await clone.json();
        var rawStr = JSON.stringify(raw);
        // 响应体截断：超过50KB截断
        if (rawStr.length > 51200) {
          bodyTruncated = true;
          responseBody = JSON.parse(rawStr.slice(0, 51200));
        } else {
          responseBody = raw;
        }
      } else if (contentType.includes('text') || contentType.includes('html') || contentType.includes('xml')) {
        var rawText = await clone.text();
        if (rawText.length > 51200) {
          bodyTruncated = true;
          responseBody = rawText.slice(0, 51200);
        } else {
          responseBody = rawText;
        }
      }
    } catch {}

    // 发送录制数据，包含工作流相关信�?
    window.postMessage({
      source: 'API_PROBE_MAIN',
      type: 'API_PROBE_RECORD',
      data: {
        id: reqId,
        url,
        method,
        status: response.status,
        duration,
        redirect_chain: redirectChain.length > 0 ? redirectChain : undefined,
        body_truncated: bodyTruncated || undefined,
        requestHeaders: reqHeaders,
        requestBody: requestBody,
        responseBody,
        contentType,
        type: contentType.includes('text/event-stream') ? 'SSE' : undefined,
        callStack,
        timestamp: new Date().toISOString(),
        step: ++currentStep, // 步骤序号
        dependencies: [], // 依赖的步骤ID（目前为空，可在 UI 中设置）
        extractFields: [], // 要提取的字段路径（如 ["data.token", "user.id"]�?
      }
    }, '*');

    // ---- 基于 fetch API �?SSE 流式消息捕获 ----
    if (contentType.includes('text/event-stream') && response.body) {
      var sseClone = response.clone();
      var reader = sseClone.body.getReader();
      var decoder = new TextDecoder();
      var prevFetchSseLen = 0;

      function readFetchStream() {
        reader.read().then(function(result) {
          if (result.done) return;
          if (!recording) return;

          var chunkText = decoder.decode(result.value, { stream: true });
          window.postMessage({
            source: 'API_PROBE_MAIN',
            type: 'API_PROBE_SSE_MESSAGE',
            data: {
              id: reqId,
              event: 'data',
              data: chunkText,
              timestamp: new Date().toISOString(),
            }
          }, '*');

          readFetchStream();
        }).catch(function(err) {
          console.log('[API Probe] fetch SSE read error:', err.message);
        });
      }
      readFetchStream();
    }
    // ---- 结束 fetch SSE 流式捕获 ----

    // ---- 响应值提取并存储到工作流变量 ----
    if (responseBody && typeof responseBody === 'object') {
      const record = window.__apiProbeLastRecord || {};
      const extractPaths = record.extractFields || [];
      // 自动提取关键字段
      var autoExtracted = autoExtractFields(responseBody);
      if (Object.keys(autoExtracted).length > 0) {
        window.postMessage({
          source: 'API_PROBE_MAIN',
          type: 'API_PROBE_AUTO_EXTRACTED',
          data: { fields: autoExtracted, step: currentStep, url: url }
        }, '*');
      }
      if (extractPaths.length > 0) {
        const extracted = extractVariables(responseBody, extractPaths);
        for (const [key, value] of Object.entries(extracted)) {
          workflowVars.set(key, value);
        }
        // 通知侧边栏变量已更新
        window.postMessage({
          source: 'API_PROBE_MAIN',
          type: 'API_PROBE_VARS_UPDATED',
          data: {
            vars: Object.fromEntries(workflowVars),
            step: record.step || currentStep
          }
        }, '*');
      }
    }

    return response;
  } catch (err) {
    if (recording) {
      window.postMessage({
        source: 'API_PROBE_MAIN',
        type: 'API_PROBE_RECORD',
        data: {
          id: reqId,
          url,
          method,
          status: 0,
          duration: Date.now() - startTime,
          callStack,
          error: err.message,
          timestamp: new Date().toISOString(),
          step: currentStep,
          dependencies: [],
          extractFields: [],
        }
      }, '*');
    }
    throw err;
  }
};

// ---- XHR 拦截 ----
const origXHROpen = XMLHttpRequest.prototype.open;
const origXHRSend = XMLHttpRequest.prototype.send;
const xhrMap = new WeakMap();

XMLHttpRequest.prototype.open = function(method, url) {
  xhrMap.set(this, {
    url: typeof url === 'string' ? url : url?.href || '',
    method: method || 'GET',
    startTime: 0,
    reqHeaders: {},
    requestBody: null,
  });
  return origXHROpen.apply(this, arguments);
};

const origSetReqHeader = XMLHttpRequest.prototype.setRequestHeader;
XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
  const info = xhrMap.get(this);
  if (info) info.reqHeaders[name] = value;
  return origSetReqHeader.apply(this, arguments);
};

XMLHttpRequest.prototype.send = function(body) {
  const info = xhrMap.get(this);
  if (!info || !recording) return origXHRSend.apply(this, arguments);

  info.startTime = Date.now();
  const callStack = captureStack();

  // 请求体变量替�?
  if (body) {
    try {
      if (typeof body === 'string') {
        info.requestBody = replaceVarsInBody(body, workflowVars);
      } else if (body instanceof FormData || body instanceof URLSearchParams) {
        const obj = {};
        body.forEach((v, k) => obj[k] = v);
        info.requestBody = replaceVarsInBody(obj, workflowVars);
      } else info.requestBody = '(binary)';
    } catch {}
  }

  const reqId = ++requestCount;

  // ---- XHR-based SSE 流式消息捕获 ----
  this.addEventListener('readystatechange', () => {
    if (!recording) return;
    var rs = this.readyState;
    if (rs === XMLHttpRequest.HEADERS_RECEIVED || rs === XMLHttpRequest.LOADING || rs === XMLHttpRequest.DONE) {
      var ct = '';
      try { ct = this.getResponseHeader('content-type') || ''; } catch(e) { ct = '(err:'+e.message+')'; }
      if (rs === XMLHttpRequest.HEADERS_RECEIVED) {
        console.log('[API Probe XHR-SSE] HEADERS_RECEIVED ct=' + ct + ' url=' + (info.url||'').slice(-40));
      }
      if (ct.includes('text/event-stream')) {
        if (rs === XMLHttpRequest.LOADING || rs === XMLHttpRequest.DONE) {
          var currentText = this.responseText || '';
          var prevLen = info._lastSseLen || 0;
          if (currentText.length > prevLen) {
            var newData = currentText.substring(prevLen);
            info._lastSseLen = currentText.length;
            window.postMessage({
              source: 'API_PROBE_MAIN',
              type: 'API_PROBE_SSE_MESSAGE',
              data: {
                id: reqId,
                event: 'data',
                data: newData,
                timestamp: new Date().toISOString(),
              }
            }, '*');
          }
        }
      }
    }
  });
  // ---- 结束 XHR SSE 流式捕获 ----

  this.addEventListener('loadend', () => {
    const duration = Date.now() - info.startTime;
    let responseBody = null;
    let contentType = this.getResponseHeader('content-type') || '';
    var bodyTruncated = false;

    try {
      if (contentType.includes('json')) {
        var rawStr = this.responseText;
        if (rawStr && rawStr.length > 51200) {
          bodyTruncated = true;
          responseBody = JSON.parse(rawStr.slice(0, 51200));
        } else {
          responseBody = rawStr ? JSON.parse(rawStr) : null;
        }
      } else if (contentType.includes('text') || contentType.includes('html')) {
        var rawText = this.responseText;
        if (rawText && rawText.length > 51200) {
          bodyTruncated = true;
          responseBody = rawText.slice(0, 51200);
        } else {
          responseBody = rawText;
        }
      }
    } catch {
      responseBody = this.responseText?.slice(0, 51200);
    }

    // 发送录制数�?
    window.postMessage({
      source: 'API_PROBE_MAIN',
      type: 'API_PROBE_RECORD',
      data: {
        id: reqId,
        url: info.url,
        method: info.method,
        status: this.status,
        body_truncated: bodyTruncated || undefined,
        duration,
        requestHeaders: replaceVarsInHeaders(info.reqHeaders, workflowVars),
        requestBody: info.requestBody,
        responseBody,
        contentType,
        type: contentType.includes('text/event-stream') ? 'SSE' : undefined,
        callStack,
        timestamp: new Date().toISOString(),
        step: ++currentStep,
        dependencies: [],
        extractFields: [],
      }
    }, '*');

    // ---- 响应值提取并存储到工作流变量 ----
    if (responseBody && typeof responseBody === 'object') {
      // 自动提取关键字段
      var autoExtractedXHR = autoExtractFields(responseBody);
      if (Object.keys(autoExtractedXHR).length > 0) {
        window.postMessage({
          source: 'API_PROBE_MAIN',
          type: 'API_PROBE_AUTO_EXTRACTED',
          data: { fields: autoExtractedXHR, step: currentStep, url: info.url }
        }, '*');
      }
      const extractPaths = info.extractFields || [];
      if (extractPaths.length > 0) {
        const extracted = extractVariables(responseBody, extractPaths);
        for (const [key, value] of Object.entries(extracted)) {
          workflowVars.set(key, value);
        }
        window.postMessage({
          source: 'API_PROBE_MAIN',
          type: 'API_PROBE_VARS_UPDATED',
          data: {
            vars: Object.fromEntries(workflowVars),
            step: currentStep
          }
        }, '*');
      }
    }
  });

  return origXHRSend.apply(this, arguments);
};

// ---- SSE (EventSource) 拦截 ----
const OrigEventSource = window.EventSource;
window.EventSource = function(url, eventSourceInitDict) {
  if (!recording) return new OrigEventSource(url, eventSourceInitDict);
  var esUrl = typeof url === 'string' ? url : (url ? url.href : '');
  if (esUrl && !esUrl.match(/^https?:\/\//i)) {
    try { esUrl = new URL(esUrl, window.location.origin).href; } catch(e) {}
  }
  var es = new OrigEventSource(url, eventSourceInitDict);
  var reqId = ++requestCount;
  var recorded = false;

  var origAddEventListener = es.addEventListener.bind(es);
  var listeners = {};

  es.addEventListener = function(type, listener, options) {
    if (!listeners[type]) listeners[type] = [];
    listeners[type].push(listener);
    return origAddEventListener(type, listener, options);
  };

  es.onopen = function() {
    if (!recording || recorded) return;
    recorded = true;
    window.postMessage({
      source: 'API_PROBE_MAIN',
      type: 'API_PROBE_RECORD',
      data: {
        id: reqId,
        url: esUrl,
        method: 'EVENTSOURCE',
        type: 'SSE',
        status: 101,
        duration: 0,
        timestamp: new Date().toISOString(),
        step: ++currentStep,
        dependencies: [],
        extractFields: [],
      }
    }, '*');
  };

  es.onmessage = function(e) {
    if (!recording) return;
    window.postMessage({
      source: 'API_PROBE_MAIN',
      type: 'API_PROBE_SSE_MESSAGE',
      data: {
        id: reqId,
        event: e.type || 'message',
        data: e.data || '',
        lastEventId: e.lastEventId || '',
        timestamp: new Date().toISOString(),
      }
    }, '*');
  };

  es.onerror = function() {
    if (!recording) return;
    window.postMessage({
      source: 'API_PROBE_MAIN',
      type: 'API_PROBE_SSE_MESSAGE',
      data: {
        id: reqId,
        event: 'error',
        data: 'Connection error (readyState=' + es.readyState + ')',
        timestamp: new Date().toISOString(),
      }
    }, '*');
  };

  return es;
};
window.EventSource.OPEN = OrigEventSource.OPEN;
window.EventSource.CONNECTING = OrigEventSource.CONNECTING;
window.EventSource.CLOSED = OrigEventSource.CLOSED;

// ---- WebSocket 协议检�?----
function detectWsProtocol(url) {
  if (!url) return 'WEBSOCKET';
  var l = url.toLowerCase();
  if (l.indexOf('collab') >= 0 || l.indexOf('sync') >= 0) return 'COLLAB';
  if (l.indexOf('/ws') >= 0 || l.indexOf('/socket') >= 0) return 'WS';
  return 'WEBSOCKET';
}

// ---- WebSocket 拦截 ----
const OrigWebSocket = window.WebSocket;
window.WebSocket = function(url, protocols) {
  if (!recording) return new OrigWebSocket(url, protocols);
  var wsUrl = typeof url === 'string' ? url : (url ? url.href : '');
  if (wsUrl && !wsUrl.match(/^wss?:\/\//i)) {
    try { wsUrl = new URL(wsUrl, window.location.origin).href; } catch(e) {}
  }
  var ws = new OrigWebSocket(url, protocols);
  try {
  var reqId = ++requestCount;
  var recorded = false;

  var origSend = ws.send.bind(ws);
  ws.send = function(data) {
    if (recording) {
      window.postMessage({
        source: 'API_PROBE_MAIN',
        type: 'API_PROBE_WS_MESSAGE',
        data: {
          id: reqId,
          direction: 'send',
          data: typeof data === 'string' ? data.slice(0, 5000) : '(binary)',
          timestamp: new Date().toISOString(),
        }
      }, '*');
    }
    return origSend(data);
  };

  var wsProtocol = 'WEBSOCKET';

  ws.onopen = function() {
    if (!recording || recorded) return;
    recorded = true;
    window.postMessage({
      source: 'API_PROBE_MAIN',
      type: 'API_PROBE_RECORD',
      data: {
        id: reqId,
        url: wsUrl,
        method: 'WEBSOCKET',
        type: wsProtocol,
        status: 101,
        duration: 0,
        timestamp: new Date().toISOString(),
        step: ++currentStep,
        dependencies: [],
        extractFields: [],
      }
    }, '*');
  };

  ws.onmessage = function(e) {
    if (!recording) return;
    var data = e.data;
    var dataStr = typeof data === 'string' ? data.slice(0, 5000)
      : (data instanceof Blob ? '(Blob:' + data.size + 'b)'
         : (data instanceof ArrayBuffer ? '(ArrayBuffer:' + data.byteLength + 'b)' : String(data).slice(0, 5000)));
    window.postMessage({
      source: 'API_PROBE_MAIN',
      type: 'API_PROBE_WS_MESSAGE',
      data: {
        id: reqId,
        direction: 'receive',
        data: dataStr,
        timestamp: new Date().toISOString(),
      }
    }, '*');
  };

  ws.onclose = function(e) {
    if (!recording) return;
    window.postMessage({
      source: 'API_PROBE_MAIN',
      type: 'API_PROBE_WS_MESSAGE',
      data: {
        id: reqId,
        direction: 'close',
        code: e.code,
        reason: e.reason || '',
        wasClean: e.wasClean,
        timestamp: new Date().toISOString(),
      }
    }, '*');
  };

  ws.onerror = function() {
    if (!recording) return;
    window.postMessage({
      source: 'API_PROBE_MAIN',
      type: 'API_PROBE_WS_MESSAGE',
      data: {
        id: reqId,
        direction: 'error',
        data: 'WebSocket error',
        timestamp: new Date().toISOString(),
      }
    }, '*');
  };
  } catch(e) {}

  return ws;
};
window.WebSocket.CONNECTING = OrigWebSocket.CONNECTING;
window.WebSocket.OPEN = OrigWebSocket.OPEN;
window.WebSocket.CLOSING = OrigWebSocket.CLOSING;
window.WebSocket.CLOSED = OrigWebSocket.CLOSED;
window.WebSocket.prototype = OrigWebSocket.prototype;

window.EventSource.prototype = OrigEventSource.prototype;

// ---- 消息监听 (via postMessage from bridge) ----
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== 'API_PROBE_BRIDGE') return;
  const msg = event.data;
  if (msg.type === 'API_PROBE_SET_RECORDING') {
    recording = msg.recording;
    if (!recording) {
      requestCount = 0;
      currentStep = 0;
      workflowVars.clear();
    }
    console.log(`[API Probe] Recording: ${recording ? 'ON' : 'OFF'}`);
    if (recording) {
      startMutationObserver();
      snapshotStorage();
      // 录制开始时记录当前页面作为初始导航
      sendUIEventWithStorage('navigation', {
        type: 'initial',
        url: window.location.href,
        title: document.title,
      });
    } else {
      stopMutationObserver();
    }
    try {
      var frames = document.querySelectorAll('iframe');
      for (var fi = 0; fi < frames.length; fi++) {
        try {
          frames[fi].contentWindow.postMessage(msg, '*');
        } catch(e) {}
      }
    } catch(e) {}
  }
  if (msg.type === 'API_PROBE_CLEAR') {
    requestCount = 0;
    currentStep = 0;
    workflowVars.clear();
    try {
      var frames = document.querySelectorAll('iframe');
      for (var fi = 0; fi < frames.length; fi++) {
        try {
          frames[fi].contentWindow.postMessage(msg, '*');
        } catch(e) {}
      }
    } catch(e) {}
  }
  // 设置提取字段（从 UI 配置�?
  if (msg.type === 'API_PROBE_SET_EXTRACT_FIELDS') {
    const { requestId, fields } = msg;
    window.__apiProbeLastRecord = { step: currentStep, extractFields: fields || [] };
    console.log('[API Probe] Set extract fields for request', requestId, fields);
  }
});

// ---- User Interaction Events (for event recording) ----
function sendUIEvent(subtype, data) {
  if (!recording) return;
  window.postMessage({
    source: 'API_PROBE_MAIN',
    type: 'API_PROBE_UI_EVENT',
    data: {
      subtype: subtype,
      data: data,
      timestamp: new Date().toISOString(),
      step: currentStep,
    }
  }, '*');
}

// ---- Enhanced DOM Selector ----
function getSelectorInfo(el) {
  if (!el || el === document.documentElement) return _emptySel();
  var computed = window.getComputedStyle ? window.getComputedStyle(el) : {};
  var info = {
    css: getCssPath(el),
    xpath: getXPath(el),
    text: (el.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 100),
    id: el.id || '',
    name: el.name || '',
    placeholder: el.placeholder || '',
    aria_label: el.getAttribute('aria-label') || '',
    role: el.getAttribute('role') || '',
    title: el.title || '',
    tag: el.tagName ? el.tagName.toLowerCase() : '',
    type: el.type || '',
    value: (el.value !== undefined && el.value !== null) ? String(el.value).substring(0, 200) : '',
    checked: el.checked !== undefined ? el.checked : undefined,
    disabled: el.disabled || false,
    visible: computed.display !== 'none' && computed.visibility !== 'hidden' && computed.opacity !== '0',
    href: el.href || el.getAttribute('href') || '',
    src: el.src || el.getAttribute('src') || '',
    alt: el.getAttribute('alt') || '',
    data_attrs: getDataAttrs(el),
    rect: getBoundingRect(el),
    // 元素完整样式（computed style�?
    computed_style: {
      display: computed.display || '',
      visibility: computed.visibility || '',
      opacity: computed.opacity || '',
      zIndex: computed.zIndex || '',
      overflow: computed.overflow || '',
      position: computed.position || '',
      pointerEvents: computed.pointerEvents || '',
      cursor: computed.cursor || '',
      transform: computed.transform || '',
    },
    // 父元�?tag 名（帮助 AI 理解上下文）
    parent_tag: el.parentElement ? el.parentElement.tagName.toLowerCase() : '',
    parent_text: el.parentElement ? (el.parentElement.textContent || '').trim().replace(/\s+/g, ' ').substring(0, 80) : '',
    // iframe 路径
    iframe_path: getIframePath(el),
  };
  return info;
}

function getDataAttrs(el) {
  var attrs = {};
  if (!el.attributes) return attrs;
  for (var i = 0; i < el.attributes.length; i++) {
    var name = el.attributes[i].name;
    if (name.startsWith('data-')) {
      attrs[name] = el.attributes[i].value;
      if (Object.keys(attrs).length >= 5) break;
    }
  }
  return attrs;
}

function getBoundingRect(el) {
  try {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  } catch(e) { return {}; }
}

function getIframePath(el) {
  try {
    var path = [];
    var win = el.ownerDocument.defaultView;
    while (win && win !== window.top) {
      var frames = Array.from(window.top.document.querySelectorAll('iframe, frame, object[type="text/html"], embed[type="text/html"]'));
      for (var i = 0; i < frames.length; i++) {
        try {
          if (frames[i].contentWindow === win) {
            var tag = frames[i].tagName.toLowerCase();
            var sel = tag;
            if (frames[i].id) sel += '#' + frames[i].id;
            else if (frames[i].name) sel += '[name="' + frames[i].name + '"]';
            else if (frames[i].src) sel += '[src*="' + frames[i].src.split('?')[0].slice(-30) + '"]';
            else sel += ':nth-of-type(' + (i + 1) + ')';
            path.unshift(sel);
            break;
          }
        } catch(e) {}
      }
      try { win = win.parent; } catch(e) { break; }
    }
    return path.length > 0 ? path.join(' > ') : '';
  } catch(e) { return ''; }
}

function _emptySel() {
  return { css: '', xpath: '', text: '', id: '', name: '', placeholder: '', aria_label: '', role: '', title: '', tag: '', type: '' };
}

function getCssPath(el) {
  if (!el || el === document.documentElement) return '';
  var parts = [];
  var cur = el;
  while (cur && cur !== document.documentElement && cur !== document.body) {
    var sel = cur.tagName ? cur.tagName.toLowerCase() : '';
    if (cur.id) { sel = '#' + CSS.escape(cur.id); parts.unshift(sel); break; }
    if (cur.className && typeof cur.className === 'string') {
      var cls = cur.className.trim().split(/\s+/).slice(0, 2).map(function(c) { return CSS.escape(c); }).join('.');
      if (cls) sel += '.' + cls;
    }
    var parent = cur.parentElement;
    if (parent) {
      var sameTagSiblings = parent.querySelectorAll(':scope > ' + (cur.tagName || '').toLowerCase());
      if (sameTagSiblings.length > 1) {
        for (var i = 0; i < sameTagSiblings.length; i++) {
          if (sameTagSiblings[i] === cur) { sel += ':nth-child(' + (i + 1) + ')'; break; }
        }
      }
    }
    parts.unshift(sel);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

function getXPath(el) {
  if (!el || el === document.documentElement) return '';
  var parts = [];
  var cur = el;
  while (cur && cur !== document.documentElement) {
    var tag = cur.tagName ? cur.tagName.toLowerCase() : '*';
    var idx = 1;
    var sib = cur.previousElementSibling;
    while (sib) {
      if (sib.tagName && sib.tagName.toLowerCase() === tag) idx++;
      sib = sib.previousElementSibling;
    }
    var piece = tag + '[' + idx + ']';
    if (cur.id) { piece = tag + '[@id="' + cur.id + '"]'; parts.unshift(piece); break; }
    parts.unshift(piece);
    cur = cur.parentElement;
  }
  return '/html/body/' + parts.join('/');
}

// ---- Storage snapshot capture ----
// ---- 存储快照：增量diff模式 ----
var _prevStorageSnapshot = null;

function captureFullSnapshot() {
  var snap = { timestamp: new Date().toISOString() };
  snap.pageUrl = window.location.href;
  snap.title = document.title;
  try {
    snap.cookie = document.cookie ? document.cookie.slice(0, 3000) : '';
  } catch(e) { snap.cookie = '(inaccessible)'; }
  try {
    var ls = {};
    for (var i = 0; i < localStorage.length && i < 100; i++) {
      var k = localStorage.key(i);
      var v = localStorage.getItem(k);
      if (v && v.length > 300) v = v.slice(0, 300) + '...';
      ls[k] = v;
    }
    snap.localStorage = ls;
  } catch(e) { snap.localStorage = '(inaccessible)'; }
  try {
    var ss = {};
    for (var i = 0; i < sessionStorage.length && i < 100; i++) {
      var k = sessionStorage.key(i);
      var v = sessionStorage.getItem(k);
      if (v && v.length > 300) v = v.slice(0, 300) + '...';
      ss[k] = v;
    }
    snap.sessionStorage = ss;
  } catch(e) { snap.sessionStorage = '(inaccessible)'; }
  return snap;
}

function computeStorageDiff(current, previous) {
  if (!previous) return { full: current, is_full: true };
  var diff = { timestamp: current.timestamp, pageUrl: current.pageUrl, title: current.title };
  // Cookie diff
  if (current.cookie !== previous.cookie) {
    diff.cookie = { from: previous.cookie?.slice(0, 500) || '', to: current.cookie?.slice(0, 500) || '', changed: true };
  }
  // localStorage diff
  if (current.localStorage && previous.localStorage && typeof current.localStorage === 'object' && typeof previous.localStorage === 'object') {
    var lsChanges = {};
    var allLsKeys = Object.keys(current.localStorage);
    for (var li = 0; li < allLsKeys.length; li++) {
      var lk = allLsKeys[li];
      if (current.localStorage[lk] !== previous.localStorage[lk]) {
        lsChanges[lk] = { from: previous.localStorage[lk] || null, to: current.localStorage[lk] };
      }
    }
    // Check deleted keys
    for (var lk2 in previous.localStorage) {
      if (!(lk2 in current.localStorage)) {
        lsChanges[lk2] = { from: previous.localStorage[lk2], to: null, deleted: true };
      }
    }
    if (Object.keys(lsChanges).length > 0) diff.localStorage = lsChanges;
  } else {
    diff.localStorage = current.localStorage;
  }
  // sessionStorage diff
  if (current.sessionStorage && previous.sessionStorage && typeof current.sessionStorage === 'object' && typeof previous.sessionStorage === 'object') {
    var ssChanges = {};
    var allSsKeys = Object.keys(current.sessionStorage);
    for (var si = 0; si < allSsKeys.length; si++) {
      var sk = allSsKeys[si];
      if (current.sessionStorage[sk] !== previous.sessionStorage[sk]) {
        ssChanges[sk] = { from: previous.sessionStorage[sk] || null, to: current.sessionStorage[sk] };
      }
    }
    for (var sk2 in previous.sessionStorage) {
      if (!(sk2 in current.sessionStorage)) {
        ssChanges[sk2] = { from: previous.sessionStorage[sk2], to: null, deleted: true };
      }
    }
    if (Object.keys(ssChanges).length > 0) diff.sessionStorage = ssChanges;
  } else {
    diff.sessionStorage = current.sessionStorage;
  }
  return diff;
}

function snapshotStorage() {
  var current = captureFullSnapshot();
  var diff = computeStorageDiff(current, _prevStorageSnapshot);
  _prevStorageSnapshot = current;
  return diff;
}

function sendUIEventWithStorage(subtype, data) {
  data.storageState = snapshotStorage();
  data.pageUrl = window.location.href;
  data.title = document.title;
  sendUIEvent(subtype, data);
}

// ---- 截屏请求（由 side panel 处理实际�?chrome.tabs.captureVisibleTab�?----
function captureScreenshot() {
  if (!recording) return;
  window.postMessage({
    source: 'API_PROBE_MAIN',
    type: 'API_PROBE_SCREENSHOT',
    data: {
      timestamp: new Date().toISOString(),
      url: window.location.href,
      title: document.title,
    }
  }, '*');
}

// ---- Navigation Event Interceptors ----
(function() {
  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function() {
    var url = arguments[2] || '';
    var res = origPush.apply(this, arguments);
    if (recording) {
      sendUIEvent('navigation', {
        type: 'pushState', url: url ? url.toString() : '', title: arguments[1] || '',
        currentUrl: window.location.href, storageState: snapshotStorage()
      });
    }
    return res;
  };
  history.replaceState = function() {
    var url = arguments[2] || '';
    var res = origReplace.apply(this, arguments);
    if (recording) {
      sendUIEvent('navigation', {
        type: 'replaceState', url: url ? url.toString() : '', title: arguments[1] || '',
        currentUrl: window.location.href, storageState: snapshotStorage()
      });
    }
    return res;
  };
  window.addEventListener('hashchange', function(e) {
    if (recording) {
      sendUIEvent('navigation', {
        type: 'hashchange', newUrl: e.newURL || '', oldUrl: e.oldURL || '',
        currentUrl: window.location.href,
      });
    }
  });
  window.addEventListener('popstate', function(e) {
    if (recording) {
      sendUIEvent('navigation', {
        type: 'popstate', currentUrl: window.location.href, storageState: snapshotStorage()
      });
    }
  });
})();

// ---- MutationObserver for DOM state changes ----
// 【关键修改】改为空函数：只录制人工操作，禁止自动DOM变动事件
function startMutationObserver() {
  // 启动可见性变化监控（仅限交互式元素的属性变化，不录制DOM树变动）
  startVisibilityObserver();
}

function stopMutationObserver() {
  // 不执行任何操�?
}

// Click events
document.addEventListener('click', function(e) {
  var el = e.target;
  var sel = getSelectorInfo(el);
  sendUIEventWithStorage('click', {
    selector: sel,
    position: { x: e.clientX, y: e.clientY },
    ctrl: e.ctrlKey, shift: e.shiftKey, meta: e.metaKey,
  });
}, true);

// Input/change events
document.addEventListener('input', function(e) {
  var el = e.target;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    sendUIEventWithStorage('input', {
      selector: getSelectorInfo(el),
      value: (el.value || '').substring(0, 200),
    });
  }
}, true);

document.addEventListener('change', function(e) {
  var el = e.target;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    var eventData = {
      selector: getSelectorInfo(el),
      value: (el.value || '').substring(0, 200),
    };
    // 捕获select选项列表
    if (el.tagName === 'SELECT') {
      var options = [];
      for (var oi = 0; oi < el.options.length && oi < 50; oi++) {
        var opt = el.options[oi];
        options.push({
          value: opt.value || '',
          text: (opt.text || '').substring(0, 100),
          selected: opt.selected || false,
        });
      }
      eventData.options = options;
    }
    sendUIEventWithStorage('change', eventData);
  }
}, true);

// Form submit
document.addEventListener('submit', function(e) {
  sendUIEventWithStorage('submit', {
    selector: getSelectorInfo(e.target),
    action: e.target.action || '',
  });
}, true);

// Keyboard shortcuts
document.addEventListener('keydown', function(e) {
  var keys = ['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'];
  if (keys.indexOf(e.key) >= 0 || ((e.ctrlKey || e.metaKey) && e.key)) {
    sendUIEventWithStorage('key', {
      key: e.key,
      selector: getSelectorInfo(e.target),
      ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey, meta: e.metaKey,
    });
  }
}, true);

// Dblclick events
document.addEventListener('dblclick', function(e) {
  sendUIEventWithStorage('dblclick', {
    selector: getSelectorInfo(e.target),
    position: { x: e.clientX, y: e.clientY },
  });
}, true);

// Focus events
document.addEventListener('focus', function(e) {
  var el = e.target;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
    sendUIEventWithStorage('focus', {
      selector: getSelectorInfo(el),
    });
  }
}, true);

// ---- Scroll events (with throttle) ----
var scrollThrottleTimer = null;
document.addEventListener('scroll', function(e) {
  if (!recording) return;
  if (scrollThrottleTimer) return;
  scrollThrottleTimer = setTimeout(function() {
    scrollThrottleTimer = null;
    sendUIEventWithStorage('scroll', {
      scrollX: Math.round(window.scrollX || window.pageXOffset || 0),
      scrollY: Math.round(window.scrollY || window.pageYOffset || 0),
      maxScrollX: Math.round(document.documentElement.scrollWidth - window.innerWidth),
      maxScrollY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
    });
  }, 300); // 300ms节流
}, true);

// ---- Hover / mouseover events ----
var lastHoverEl = null;
var hoverThrottleTimer = null;
document.addEventListener('mouseover', function(e) {
  if (!recording) return;
  var el = e.target;
  if (el === lastHoverEl) return;
  lastHoverEl = el;
  if (hoverThrottleTimer) return;
  hoverThrottleTimer = setTimeout(function() {
    hoverThrottleTimer = null;
    var tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'a' || tag === 'button' || el.getAttribute('role') === 'button' || el.onclick || el.getAttribute('data-hover')) {
      sendUIEventWithStorage('hover', {
        selector: getSelectorInfo(el),
      });
    }
  }, 200);
}, true);

// ---- Context menu / right-click events ----
document.addEventListener('contextmenu', function(e) {
  if (!recording) return;
  sendUIEventWithStorage('contextmenu', {
    selector: getSelectorInfo(e.target),
    position: { x: e.clientX, y: e.clientY },
  });
}, true);

// ---- Drag & Drop events ----
document.addEventListener('dragstart', function(e) {
  if (!recording) return;
  sendUIEventWithStorage('dragstart', {
    selector: getSelectorInfo(e.target),
  });
}, true);

document.addEventListener('drop', function(e) {
  if (!recording) return;
  sendUIEventWithStorage('drop', {
    selector: getSelectorInfo(e.target),
    position: { x: e.clientX, y: e.clientY },
  });
}, true);

// ---- 生命周期事件 —�?标签页切�?关闭 ----
document.addEventListener('visibilitychange', function() {
  if (!recording) return;
  sendUIEvent('navigation', {
    type: 'visibility',
    state: document.visibilityState,
    url: window.location.href,
    title: document.title,
  });
});

window.addEventListener('pagehide', function(e) {
  if (!recording) return;
  sendUIEvent('navigation', {
    type: 'pagehide',
    persisted: e.persisted || false,
    url: window.location.href,
    title: document.title,
  });
});

window.addEventListener('beforeunload', function() {
  if (!recording) return;
  sendUIEvent('navigation', {
    type: 'beforeunload',
    url: window.location.href,
  });
});

// ---- 获取当前工作流变量（�?UI 读取�?----
window.getWorkflowVars = function() {
  return Object.fromEntries(workflowVars);
};

// ---- 清除工作流变�?----
window.clearWorkflowVars = function() {
  workflowVars.clear();
  window.postMessage({
    source: 'API_PROBE_MAIN',
    type: 'API_PROBE_VARS_UPDATED',
    data: { vars: {}, step: 0 }
  }, '*');
};

// ========== 新增功能：v2.0 ==========

// ---- 3. 剪贴板操�?(copy/cut/paste) ----
document.addEventListener('copy', function(e) {
  if (!recording) return;
  sendUIEventWithStorage('clipboard', {
    action: 'copy',
    selection: window.getSelection()?.toString().slice(0, 200) || '',
  });
}, true);

document.addEventListener('cut', function(e) {
  if (!recording) return;
  sendUIEventWithStorage('clipboard', {
    action: 'cut',
    selection: window.getSelection()?.toString().slice(0, 200) || '',
  });
}, true);

document.addEventListener('paste', function(e) {
  if (!recording) return;
  var pasted = '';
  try {
    pasted = e.clipboardData?.getData('text')?.slice(0, 200) || '';
  } catch(ex) {}
  sendUIEventWithStorage('clipboard', {
    action: 'paste',
    data: pasted,
  });
}, true);


// ---- 3.5 execCommand 拦截（捕获编程式剪贴板操作） ----
(function() {
  var origExec = document.execCommand;
  if (origExec) {
    document.execCommand = function(command, showUI, value) {
      var cmd = (command || '').toLowerCase();
      if ((cmd === 'copy' || cmd === 'cut') && recording) {
        sendUIEventWithStorage('clipboard', {
          action: cmd,
          selection: window.getSelection()?.toString().slice(0, 200) || '',
          source: 'execCommand',
        });
      }
      try {
        return origExec.call(this, command, showUI, value);
      } catch(e) {
        return false;
      }
    };
  }
})();

// ---- 4. 浏览器原生对话框拦截 ----
(function() {
  var origAlert = window.alert;
  var origConfirm = window.confirm;
  var origPrompt = window.prompt;
  
  window.alert = function(msg) {
    sendUIEvent('dialog', { type: 'alert', message: String(msg || '').slice(0, 500) });
    if (window.__dialogSilent) return undefined;
    return origAlert.apply(this, arguments);
  };
  
  window.confirm = function(msg) {
    sendUIEvent('dialog', { type: 'confirm', message: String(msg || '').slice(0, 500) });
    if (window.__dialogSilent) return true;
    return origConfirm.apply(this, arguments);
  };
  
  window.prompt = function(msg, defaultVal) {
    if (window.__dialogSilent) {
      sendUIEvent('dialog', {
        type: 'prompt', message: String(msg || '').slice(0, 500),
        defaultValue: String(defaultVal ?? '').slice(0, 200),
        result: null,
      });
      return null;
    }
    var result = origPrompt.apply(this, arguments);
    sendUIEvent('dialog', {
      type: 'prompt',
      message: String(msg || '').slice(0, 500),
      defaultValue: String(defaultVal ?? '').slice(0, 200),
      result: result !== null ? String(result).slice(0, 200) : null,
    });
    return result;
  };
})();

// ---- 5. 新窗�?新标签页拦截 ----
(function() {
  var origOpen = window.open;
  window.open = function(url, name, features) {
    if (recording) {
      sendUIEventWithStorage('new_window', {
        url: url || '',
        target: name || '',
        features: features || '',
      });
    }
    return origOpen.apply(this, arguments);
  };
  
  // 拦截目标为_blank的链接点�?
  document.addEventListener('click', function(e) {
    if (!recording) return;
    var el = e.target;
    while (el && el !== document) {
      if (el.tagName === 'A' && el.getAttribute('target') === '_blank') {
        sendUIEventWithStorage('new_window', {
          url: el.href || '',
          target: '_blank',
          source: 'link_click',
          selector: getSelectorInfo(el),
        });
        break;
      }
      el = el.parentElement;
    }
  }, true);
})();

// ---- 6. 元素可见性变化追踪（轻量MutationObserver�?----
// 只在录制期间监控可见性变化，限定较小的范围避免性能问题
var _visObserver = null;

var __visibilityWatchTags = ['button', 'a', 'input', 'select', 'textarea'];

function startVisibilityObserver() {
  if (_visObserver) return;
  try {
    _visObserver = new MutationObserver(function(mutations) {
      if (!recording) return;
      var changes = [];
      for (var mi = 0; mi < Math.min(mutations.length, 20); mi++) {
        var m = mutations[mi];
        if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class' || m.attributeName === 'hidden' || m.attributeName === 'disabled')) {
          var el = m.target;
          var tag = el.tagName ? el.tagName.toLowerCase() : '';
          // 只关注交互式元素的可见性变�?
          if (__visibilityWatchTags.indexOf(tag) >= 0 || el.getAttribute('role') === 'button' || el.getAttribute('aria-hidden')) {
            var computed = window.getComputedStyle ? window.getComputedStyle(el) : {};
            changes.push({
              tag: tag,
              id: el.id || '',
              class: (el.className || '').slice(0, 100),
              text: (el.textContent || '').trim().slice(0, 50),
              now_visible: computed.display !== 'none' && computed.visibility !== 'hidden' && !el.disabled,
              attr_changed: m.attributeName,
            });
          }
        }
      }
      if (changes.length > 0) {
        sendUIEventWithStorage('visibility_change', { changes: changes });
      }
    });
    // 只监�?body 子树下的属性变�?
    _visObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'disabled'],
      subtree: true,
    });
  } catch(e) {}
}

function stopVisibilityObserver() {
  if (_visObserver) {
    try { _visObserver.disconnect(); } catch(e) {}
    _visObserver = null;
  }
}

// 注入到录制启�?停止�?
// （通过覆盖 startMutationObserver/stopMutationObserver 来集成）

// ---- 7. Console 输出录制 ----
(function() {
  if (window.__apiProbeConsolePatched) return;
  window.__apiProbeConsolePatched = true;
  
  var levels = ['log', 'info', 'warn', 'error', 'debug'];
  for (var ci = 0; ci < levels.length; ci++) {
    var level = levels[ci];
    var orig = console[level];
    console[level] = function() {
      if (recording && arguments.length > 0) {
        var args = [];
        for (var ai = 0; ai < Math.min(arguments.length, 5); ai++) {
          try {
            var a = arguments[ai];
            args.push(typeof a === 'object' ? JSON.stringify(a).slice(0, 500) : String(a).slice(0, 500));
          } catch(e) { args.push(String(a)); }
        }
        var msg = args.join(' ').slice(0, 1000);
        if (msg) {
          window.postMessage({
            source: 'API_PROBE_MAIN',
            type: 'API_PROBE_CONSOLE',
            data: { level: level, message: msg, timestamp: new Date().toISOString() }
          }, '*');
        }
      }
      return orig.apply(this, arguments);
    };
  }
})();

// ---- 2. Iframe 事件完整路由 ----
// 向所有iframe广播录制状态并收集iframe内的postMessage事件
(function() {
  var _origPostMessage = window.postMessage;
  
  // 当录制状态改变时，广播到所有iframe
  var _origRecordingHandler = window.addEventListener;
  var _apiProbeMsgHandler = null;
  
  // 在消息监听中增强iframe处理
  // 已有代码会在API_PROBE_SET_RECORDING时向iframe广播，这里补充：
  // 收集iframe内产生的事件
  window.addEventListener('message', function(event) {
    if (event.source === window) return; // 忽略自身消息
    if (!recording) return;
    // 捕获来自iframe的消�?
    if (event.data && event.data.source === 'API_PROBE_IFRAME_EVENT') {
      // 将iframe事件转发到side panel
      window.postMessage({
        source: 'API_PROBE_MAIN',
        type: 'API_PROBE_UI_EVENT',
        data: event.data.event,
      }, '*');
    }
  });
  
  // 在每个iframe中注入录制代理脚�?
  function injectIntoIframes() {
    if (!recording) return;
    try {
      var frames = document.querySelectorAll('iframe');
      for (var fi = 0; fi < frames.length; fi++) {
        try {
          var fw = frames[fi].contentWindow;
          if (fw && !fw.__apiProbeInjected) {
            fw.__apiProbeInjected = true;
            // 在iframe中注入事件转发器
            var script = fw.document.createElement('script');
            script.textContent = '(' + function() {
              // iframe内代理：监听用户交互事件并转发给父页�?
              var iframeRecording = false;
              window.addEventListener('message', function(e) {
                if (e.data && e.data.type === 'API_PROBE_SET_RECORDING') {
                  iframeRecording = e.data.recording;
                }
              });
              // 在iframe内转发点击事�?
              document.addEventListener('click', function(e) {
                if (!iframeRecording) return;
                var el = e.target;
                var info = {
                  subtype: 'click',
                  data: {
                    selector: {
                      tag: el.tagName ? el.tagName.toLowerCase() : '',
                      id: el.id || '',
                      text: (el.textContent || '').trim().slice(0, 100),
                    },
                    position: { x: e.clientX, y: e.clientY },
                  },
                  timestamp: new Date().toISOString(),
                  tabId: null,
                  pageUrl: window.location.href,
                };
                window.parent.postMessage({ source: 'API_PROBE_IFRAME_EVENT', event: info }, '*');
              }, true);
            }.toString() + ')();';
            fw.document.body.appendChild(script);
          }
        } catch(e) {}
      }
    } catch(e) {}
  }
  
  // 定期检查新iframe（页面动态创建iframe的情况）
  setInterval(function() {
    if (recording) injectIntoIframes();
  }, 3000);
  
  // DOMNodeInserted REMOVED - deprecated sync MutationEvent blocks main thread
})();

// ---- 集成可见性观察到录制启动/停止 ----
// 覆盖原有的startMutationObserver/stopMutationObserver
var _origStartObserver = startMutationObserver;
var _origStopObserver = stopMutationObserver;
startMutationObserver = function() {
  _origStartObserver && _origStartObserver();
  startVisibilityObserver();
};
stopMutationObserver = function() {
  _origStopObserver && _origStopObserver();
  stopVisibilityObserver();
};
