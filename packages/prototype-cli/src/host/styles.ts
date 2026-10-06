/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

/** The host page's own styles (the prototype's are the theme's, inside the frame). */

export const HOST_CSS = `
html,body,#root{height:100%;margin:0}
body{font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#e9ecf1;color:#1f2328}
.ph-app{height:100%;display:flex;flex-direction:column;position:relative}
.ph-toolbar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;padding:8px 16px;background:#fff;border-bottom:1px solid #d5dae1}
.ph-toolbar label{display:flex;gap:6px;align-items:center}
.ph-toolbar select,.ph-toolbar button,.ph-bubble button,.ph-bubble textarea,.ph-bar button{font:inherit}
.ph-name{margin:0 8px 0 0;font-size:13px}
.ph-modes{display:inline-flex;margin-left:auto}
.ph-modes button[aria-pressed=true]{background:#2563eb;color:#fff;border-color:#2563eb}
.ph-body{flex:1;min-height:0;display:flex;gap:16px;padding:16px;position:relative}
.ph-body-annotate{padding-bottom:76px}
.ph-primary{background:#2563eb;color:#fff;border:1px solid #2563eb;border-radius:6px;padding:4px 12px;cursor:pointer}
.ph-primary:disabled{background:#93b4f5;border-color:#93b4f5;cursor:default}
.ph-danger{color:#b42318}
.ph-bubble{position:fixed;z-index:20;width:320px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;background:#fff;border:1px solid #d5dae1;border-radius:10px;padding:12px;box-shadow:0 8px 24px rgba(15,23,42,.18)}
.ph-bubble p{margin:0}
.ph-bubble-on{color:#59636e;font-size:12px;overflow-wrap:anywhere}
.ph-bubble-text{white-space:pre-wrap;overflow-wrap:anywhere}
.ph-bubble-actions{display:flex;justify-content:flex-end;gap:8px}
.ph-field{display:flex;flex-direction:column;gap:4px}
.ph-field label{font-size:12px;color:#59636e}
.ph-field textarea{color:#1f2328;resize:vertical;border:1px solid #d5dae1;border-radius:6px;padding:6px 8px}
.ph-field small{align-self:flex-end;color:#59636e}
.ph-bar{position:absolute;z-index:10;left:50%;bottom:16px;transform:translateX(-50%);width:min(560px,calc(100% - 32px));display:flex;flex-direction:column;background:#fff;border:1px solid #d5dae1;border-radius:10px;box-shadow:0 8px 24px rgba(15,23,42,.18);overflow:hidden}
.ph-bar p{margin:0;padding:8px 12px;border-bottom:1px solid #e3e7ec;font-size:12px}
.ph-bar p[role=note]{background:#fff8e6;color:#7a4b00}
.ph-bar-row{display:flex;align-items:center;gap:8px;padding:6px 8px}
.ph-bar-count{font-weight:600;background:none;border:0;padding:4px 8px;border-radius:6px;cursor:pointer}
.ph-caret{margin-left:6px;color:#59636e}
.ph-spacer{flex:1}
.ph-bar-list{margin:0;padding:6px;list-style:none;max-height:40vh;overflow-y:auto;display:flex;flex-direction:column;gap:2px;border-bottom:1px solid #e3e7ec}
.ph-bar-list li{display:flex;align-items:flex-start;gap:4px}
.ph-bar-empty{padding:8px;color:#59636e}
.ph-bar-entry{flex:1;min-width:0;display:flex;gap:8px;align-items:flex-start;text-align:left;background:none;border:0;border-radius:6px;padding:6px;cursor:pointer}
.ph-bar-entry:hover,.ph-bar-count:hover{background:#f1f3f6}
.ph-bar-entry small{display:block;color:#59636e;overflow-wrap:anywhere}
.ph-bar-text{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.ph-badge{flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#2563eb;color:#fff;font-size:12px;font-weight:700;display:grid;place-items:center}
.ph-bar-remove{background:none;border:0;color:#59636e;font-size:16px;line-height:1;padding:6px;border-radius:6px;cursor:pointer}
.ph-bar-remove:hover{background:#f1f3f6;color:#b42318}
.ph-waiting{margin:auto;color:#59636e}
.ph-findings{position:absolute;z-index:30;left:16px;right:16px;bottom:16px;max-height:40%;overflow:auto;background:#fff8f0;border:1px solid #f0b37e;border-radius:10px;padding:12px 16px;box-shadow:0 8px 24px rgba(15,23,42,.18)}
.ph-findings h2{margin:0 0 8px;font-size:14px;color:#9a3412}
.ph-findings ul{margin:0;padding-left:18px}
.ph-where{color:#59636e}
`;
