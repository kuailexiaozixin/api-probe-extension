// API Probe - Bridge (ISOLATED world)
// 桥接 MAIN world (postMessage) ↔ background (chrome.runtime)

// 上行：MAIN world → background
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.source !== 'API_PROBE_MAIN') return;

  const msg = event.data;

  if (msg.type === 'API_PROBE_RECORD') {
    console.log('[Bridge] Forwarding API_PROBE_RECORD, data.id=' + (msg.data ? msg.data.id : 'null'));
    chrome.runtime.sendMessage({ type: 'API_PROBE_RECORD', data: msg.data }).catch(function(e) {
      console.error('[Bridge] sendMessage API_PROBE_RECORD failed:', e);
    });
    return;
  }

  // 通配转发：所有 API_PROBE_* 类型消息自动转发到 background/service worker
  if (msg.type && msg.type.startsWith('API_PROBE_') && msg.type !== 'API_PROBE_RECORD' && msg.type !== 'API_PROBE_GET_TABS') {
    chrome.runtime.sendMessage({ type: msg.type, data: msg.data }).catch(() => {});
    return;
  }

  if (msg.type === 'API_PROBE_GET_TABS') {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      const list = tabs.map(t => ({ id: t.id, title: t.title || t.url, url: t.url }));
      chrome.runtime.sendMessage({ type: 'API_PROBE_TABS_LIST', tabs: list }).catch(() => {});
    });
    return;
  }
});

// 下行：background → MAIN world
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'API_PROBE_SET_RECORDING') {
    window.postMessage({
      source: 'API_PROBE_BRIDGE',
      type: 'API_PROBE_SET_RECORDING',
      recording: msg.recording,
    }, '*');
    return false;
  }

  if (msg.type === 'API_PROBE_CLEAR') {
    window.postMessage({
      source: 'API_PROBE_BRIDGE',
      type: 'API_PROBE_CLEAR',
    }, '*');
    return false;
  }
});

// 页面加载时查询当前录制状态（解决页面刷新后录制信号丢失的问题）
chrome.runtime.sendMessage({ type: 'API_PROBE_GET_RECORDING' }).catch(function() {});
