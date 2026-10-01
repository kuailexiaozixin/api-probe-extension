# API Probe 金山文档兼容性修复

## 修复日期
2026-06-25

## 修复内容 (content.js)

### 修复 1: WebSocket 非录制状态快速返回
**位置**: `window.WebSocket = function(...) {`
**修改**: 函数体开头添加 `if (!recording) return new OrigWebSocket(url, protocols);`
**原因**: 即使在非录制状态下，每次创建 WebSocket 都会执行完整的拦截包装代码

### 修复 2: EventSource 非录制状态快速返回
**位置**: `window.EventSource = function(...) {`
**修改**: 函数体开头添加 `if (!recording) return new OrigEventSource(url, eventSourceInitDict);`
**原因**: 同 WebSocket，非录制时无需包装

### 修复 3: 移除 DOMNodeInserted 监听器
**位置**: 原第1531行附近
**修改**: 移除 `document.addEventListener('DOMNodeInserted', ...)`
**原因**: DOMNodeInserted 是废弃的同步 MutationEvent，每次 DOM 插入都会阻塞主线程

### 修复 4: Fetch SSE 响应体读取使用 clone
**位置**: Fetch 拦截中 SSE 流式捕获块
**修改**: `response.body.getReader()` → `sseClone.body.getReader()`（先用 `response.clone()`）
**原因**: 直接读取原 response.body 会锁定流，导致原始调用方无法读取响应

## 已排除的假设
- `detectWsProtocol` 函数已正确定义于 content.js 第553行，不会导致 ReferenceError

## 测试步骤
1. 打开浏览器 edge://extensions/
2. 找到 API Probe 扩展，点击 🔄 重新加载
3. 打开金山文档测试页面
4. 确认非录制状态下文档正常加载和编辑
5. 开启录制，确认 API 拦截正常工作且文档编辑不卡顿
