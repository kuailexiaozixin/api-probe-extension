chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Handle ALL messages in one listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // ---- API Probe messages ----
  if (msg.type && msg.type.startsWith('API_PROBE_') && msg.type !== 'API_PROBE_SET_RECORDING' && msg.type !== 'API_PROBE_GET_RECORDING' && msg.type !== 'API_PROBE_CLEAR' && msg.type !== 'API_PROBE_GET_TABS' && msg.type !== 'API_PROBE_PROXY_FETCH') {
    if (msg.data && sender.tab) {
      msg.data.tabId = sender.tab.id;
      msg.data.pageUrl = sender.tab.url || '';
    }
    chrome.runtime.sendMessage(msg).catch(() => {});
    return false;
  }
  if (msg.type === 'API_PROBE_GET_TABS') {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const list = tabs.map(t => ({ id: t.id, title: t.title || t.url, url: t.url }));
      chrome.runtime.sendMessage({ type: 'API_PROBE_TABS_LIST', tabs: list }).catch(() => {});
    });
    return false;
  }
  if (msg.type === 'API_PROBE_SET_RECORDING') {
    const { recording } = msg;
    chrome.storage.session.set({ apiProbeRecording: recording }).catch(function() {});
    chrome.tabs.query({ currentWindow: true }, function(tabs) {
      for (var i = 0; i < tabs.length; i++) {
        chrome.tabs.sendMessage(tabs[i].id, { type: 'API_PROBE_SET_RECORDING', recording: recording }).catch(function() {});
      }
    });
    chrome.runtime.sendMessage({ type: 'API_PROBE_RECORDING_CHANGED', recording: recording }).catch(() => {});
    return false;
  }
  if (msg.type === 'API_PROBE_CLEAR') {
    const { tabId } = msg;
    chrome.tabs.sendMessage(tabId, { type: 'API_PROBE_CLEAR' }).catch(() => {});
    chrome.runtime.sendMessage({ type: 'API_PROBE_CLEARED', tabId }).catch(() => {});
    return false;
  }
  if (msg.type === 'API_PROBE_GET_RECORDING') {
    chrome.storage.session.get('apiProbeRecording', function(r) {
      var recording = r && r.apiProbeRecording ? true : false;
      chrome.tabs.sendMessage(sender.tab ? sender.tab.id : msg.tabId, {
        type: 'API_PROBE_SET_RECORDING',
        recording: recording
      }).catch(function() {});
    });
    return false;
  }
  if (msg.type === 'API_PROBE_PROXY_FETCH') {
    var proxyReq = {
      method: msg.options.method || 'GET',
      url: msg.url,
      requestHeaders: msg.options.headers || {},
      requestBody: msg.options.body || null
    };
    var proxyId = msg._proxyId || '';
    sendRequest(proxyReq).then(function(resp) {
      resp._proxyId = proxyId;
      resp.type = 'API_PROBE_PROXY_RESULT';
      chrome.runtime.sendMessage(resp).catch(() => {});
    }).catch(function(err) {
      chrome.runtime.sendMessage({
        type: 'API_PROBE_PROXY_RESULT',
        _proxyId: proxyId,
        status: 0,
        error: err.message,
        body: null,
        headers: {},
        duration: 0
      }).catch(() => {});
    });
    return false;
  }

});

async function sendRequest(req) {
  var startTime = Date.now();
  try {
    var headers = {};
    if (req.requestHeaders) {
      for (var k in req.requestHeaders) {
        var lk = k.toLowerCase();
        if (lk === 'host' || lk === 'origin' || lk === 'referer' || lk === 'referrer') continue;
        headers[k] = String(req.requestHeaders[k]);
      }
    }
    var opts = { method: req.method, headers: headers };
    if (req.requestBody && req.method !== 'GET' && req.method !== 'HEAD') {
      var body = req.requestBody;
      if (typeof body === 'object') body = JSON.stringify(body);
      opts.body = body;
    }
    var resp = await fetch(req.url, opts);
    var duration = Date.now() - startTime;
    var responseBody = null;
    var ct = resp.headers.get('content-type') || '';
    try {
      responseBody = await resp.text();
      if (responseBody && responseBody.length > 50000) responseBody = responseBody.slice(0, 50000);
    } catch(e) { responseBody = '(unreadable)'; }
    var respHeaders = {};
    resp.headers.forEach(function(v, k) { respHeaders[k] = v; });
    return { status: resp.status, statusText: resp.statusText, duration: duration, headers: respHeaders, contentType: ct, body: responseBody, error: null };
  } catch(err) {
    return { status: 0, duration: Date.now() - startTime, error: err.message, body: null, headers: {} };
  }
}


