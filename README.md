# API Probe

录制并探测网页中的 API 请求，自动分析端点、参数和响应格式的浏览器扩展（Chrome / Edge，Manifest V3）。

## 功能特性

- **API 请求录制**：拦截页面中的 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource`，记录方法、URL、请求头、请求体、响应状态、响应头与响应体
- **多标签页捕获**：按标签页维度组织录制的请求，自动记录来源页面 URL
- **SSE 流式捕获**：基于 `fetch` 的 Server-Sent Events 流式消息逐条捕获
- **响应关键字段提取**：自动提取响应中的 `token`、`id` 等关键字段
- **代码导出**：一键生成 cURL、Python (requests/httpx)、JavaScript (fetch/axios) 代码片段
- **请求集合**：右键将请求保存到自定义集合，按集合组织与回放
- **API 构建器**：可视化编辑方法、URL、请求头、查询参数与请求体，实时发送并查看响应
- **环境变量**：定义键值对并在请求中引用
- **工作流编排**：基于多步请求构建工作流并导出
- **深色 / 浅色主题**：跟随系统自动切换

## 安装

1. 打开浏览器扩展管理页：Chrome 地址栏输入 `chrome://extensions/`，Edge 输入 `edge://extensions/`
2. 右上角开启「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本目录
4. 点击工具栏的 API Probe 图标打开侧边栏

## 使用

1. 打开目标网页，在侧边栏点击「录制」
2. 在页面中进行操作（点击、提交表单、触发接口调用）
3. 返回侧边栏查看录制的请求列表，点击任意请求查看详情
4. 右键请求可导出代码片段或保存到集合

> 非录制状态下扩展不做任何拦截包装，不采集页面数据，对页面性能零影响。

## 项目结构

```
api-probe-extension/
├── manifest.json          # Manifest V3 清单：权限、脚本注入、侧边栏配置
├── content.js             # MAIN world：拦截 fetch/XHR/WebSocket/EventSource，录制请求
├── bridge.js              # ISOLATED world：桥接 MAIN world ↔ background（postMessage ↔ chrome.runtime）
├── background.js          # Service Worker：消息路由、录制状态管理、代理请求（绕过 CORS）
├── sidepanel.html         # 侧边栏界面
├── sidepanel.js           # 侧边栏逻辑：请求列表、详情、代码生成、集合、API 构建器、工作流
└── api-probe-fix-summary.md  # 金山文档兼容性修复记录
```

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 保存录制状态与请求数据 |
| `sidePanel` | 侧边栏界面 |
| `scripting` | 页面脚本注入 |
| `host_permissions` | 代理请求（绕过页面 CORS 限制） |

## 免责声明

本扩展仅用于调试与开发用途。请勿使用本扩展采集、保存或滥用包含个人隐私或商业机密的数据。使用者在目标网站上录制请求时应遵守该网站的服务条款与当地法律法规。
