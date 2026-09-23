/**
 * Roy 的治理層接線(2026-09-01):vLLM tool-call 修補 proxy。
 *
 * 現象(curl 直測自架的上游 vLLM 伺服器確認過):vLLM 沒開
 * --enable-auto-tool-choice --tool-call-parser,模型想呼叫工具時把呼叫寫成
 * Qwen 的 XML 格式塞進 `reasoning`/`content` 欄位,`tool_calls` 回空陣列。
 * 這支 proxy 攔截 /v1/chat/completions 回應,把那段 XML 解析回正常的
 * OpenAI tool_calls 陣列,其餘原樣轉發。
 *
 * 原本是獨立的 Python script(vllm_toolcall_proxy.py),這裡改寫成
 * Node.js 版本、跑在 Electron 主行程裡——這個 app 本來就內建 Node,
 * 不需要再額外綁一份 Python 執行環境,也不用管子行程的啟動/關閉時機,
 * 跟著 app 生命週期自動起停。
 *
 * 正式修法仍是 Roy 在 vLLM 啟動參數加
 * --enable-auto-tool-choice --tool-call-parser qwen3_xml(或 hermes)——
 * 這支 proxy 只是修好之前的權宜之計。
 */

import http from "node:http";
import https from "node:https";

const TOOL_CALL_RE = /<tool_call>\s*<function=([^>]+)>([\s\S]*?)<\/function>\s*<\/tool_call>/g;
const PARAM_RE = /<parameter=([^>]+)>\s*([\s\S]*?)\s*<\/parameter>/g;

function extractToolCalls(text) {
  if (!text) return null;
  const calls = [];
  let match;
  TOOL_CALL_RE.lastIndex = 0;
  while ((match = TOOL_CALL_RE.exec(text)) !== null) {
    const [, name, body] = match;
    const args = {};
    let paramMatch;
    PARAM_RE.lastIndex = 0;
    while ((paramMatch = PARAM_RE.exec(body)) !== null) {
      args[paramMatch[1].trim()] = paramMatch[2].trim();
    }
    calls.push({
      id: `call_${Math.random().toString(16).slice(2, 14)}`,
      type: "function",
      function: { name: name.trim(), arguments: JSON.stringify(args) },
    });
  }
  return calls.length > 0 ? calls : null;
}

function patchToolCalls(payload) {
  try {
    const parsed = JSON.parse(payload);
    for (const choice of parsed.choices ?? []) {
      const msg = choice.message ?? {};
      if (msg.tool_calls && msg.tool_calls.length > 0) continue;
      const sourceText = msg.reasoning || msg.content || "";
      const calls = extractToolCalls(sourceText);
      if (calls) {
        msg.tool_calls = calls;
        msg.content = null;
        choice.finish_reason = "tool_calls";
      }
    }
    return JSON.stringify(parsed);
  } catch {
    return payload; // 解析失敗就原樣轉發,不擋請求
  }
}

/**
 * 啟動 proxy,回傳 { close() } 供 app quit 時關閉。
 * @param {{ port?: number, upstreamBaseUrl?: string, log?: (msg: string) => void }} opts
 */
export function startVllmToolcallProxy(opts = {}) {
  const port = opts.port ?? 8899;
  const upstreamBaseUrl = opts.upstreamBaseUrl ?? "https://your-vllm-server.example.com";
  const log = opts.log ?? (() => {});

  const server = http.createServer((req, res) => {
    log(`[req] ${req.method} ${req.url}`);
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("error", (err) => log(`[req] error reading request body: ${err.message}`));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const upstreamUrl = new URL(req.url, upstreamBaseUrl);
      const client = upstreamUrl.protocol === "https:" ? https : http;

      const proxyReq = client.request(
        upstreamUrl,
        {
          method: req.method,
          headers: {
            ...req.headers,
            host: upstreamUrl.host,
            "user-agent": "curl/8.7.1", // 上游對預設 Node UA 回 403,比照 Python 版修法
            // 根因(2026-09-01 用 DEBUG=true log 追出,error -3 incorrect header
            // check):上游(Cloudflare 前面的 vLLM)在非串流模式下常回
            // Content-Encoding: gzip。這支 proxy 需要把 body 轉成字串做
            // patchToolCalls() 文字比對,但 gzip 是二進位資料,經過
            // toString('utf-8') 再轉回 Buffer 的往返會直接破壞 gzip bytes,
            // 導致下游 httpx 解壓縮失敗、整個請求判定為 Connection error
            // 反覆重試——這正是「LLM 一直被呼叫但對話永遠沒完成」的真正原因。
            // 本地短距離轉發不需要壓縮,直接跟上游要未壓縮內容最乾淨。
            "accept-encoding": "identity",
          },
        },
        (proxyRes) => {
          const contentType = proxyRes.headers["content-type"] || "";
          const isStreaming = contentType.includes("text/event-stream");
          log(
            `[resp] status=${proxyRes.statusCode} content-type=${contentType} ` +
              `transfer-encoding=${proxyRes.headers["transfer-encoding"]} ` +
              `content-length=${proxyRes.headers["content-length"]} streaming=${isStreaming}`,
          );
          res.on("error", (err) => log(`[resp] error writing response to client: ${err.message}`));

          // Streaming(SSE)回應:直接 pipe 過去,不緩衝整個回應。
          // 原本的實作等 proxyRes 觸發 'end' 才轉發——但 SSE 連線可能長時間
          // 保持開啟(keep-alive/分段傳輸),導致整個 request 卡死不回應
          // (這正是 GUI 卡在 Thinking 永遠不動的根因)。而且 streaming 模式下
          // vLLM 本身就正確吐出結構化 tool_calls(已用 curl -d '{"stream":true}'
          // 實測確認),不需要這支 proxy 做任何修補,原樣轉發即可。
          if (isStreaming) {
            res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
            proxyRes.pipe(res);
            return;
          }

          // 非串流回應:才需要緩衝+修補(vLLM 在非串流模式下才會把 tool_call
          // 寫成 Qwen XML 塞進 reasoning,streaming 模式沒有這個問題)。
          const respChunks = [];
          proxyRes.on("data", (c) => respChunks.push(c));
          proxyRes.on("end", () => {
            let out = Buffer.concat(respChunks);
            const isCompressed = Boolean(proxyRes.headers["content-encoding"]);
            if (isCompressed) {
              // 防護網:就算 accept-encoding: identity 沒被上游尊重,也絕對
              // 不能把壓縮過的二進位內容當文字處理——toString('utf-8') 對
              // 非 UTF-8 二進位資料是有損轉換,會直接破壞 gzip bytes。
              // 寧可跳過修補、原樣轉發,也不要冒著送出無法解壓縮內容的風險。
              log(`[resp] content-encoding=${proxyRes.headers["content-encoding"]} present, skipping patch to avoid corrupting binary body`);
            } else if (contentType.includes("application/json") && req.method === "POST") {
              const patched = patchToolCalls(out.toString("utf-8"));
              out = Buffer.from(patched, "utf-8");
            }
            // 根因(2026-09-01 用 DEBUG=true 的 agent-server log 追出):上游若用
            // Transfer-Encoding: chunked 回應,原本的 {...proxyRes.headers,
            // "content-length": ...} 會讓 Content-Length 跟 Transfer-Encoding
            // 同時出現在同一個回應——這違反 HTTP/1.1(RFC 7230),大多數 client
            // 會容忍,但 OpenAI Python client 的 httpx 驗證很嚴格,直接判定整個
            // 回應格式錯誤(ClientResponseError 400)反覆重試,GUI 上看起來就像
            // 「終端機指令卡住逾時」,實際上是每一次後續的 LLM 呼叫都在這裡失敗。
            // 這裡已經把整個 body 緩衝完、body 長度確定,不再是 chunked 形態,
            // 要把上游的 transfer-encoding/content-length 都拿掉,只保留自己
            // 重新計算的 content-length。
            const headers = { ...proxyRes.headers };
            delete headers["transfer-encoding"];
            delete headers["content-length"];
            headers["content-length"] = Buffer.byteLength(out);
            log(`[resp] sending ${out.length} bytes to client, headers=${JSON.stringify(headers)}`);
            res.writeHead(proxyRes.statusCode ?? 502, headers);
            res.end(out);
          });
        },
      );

      proxyReq.on("error", (err) => {
        log(`[vllm-proxy] upstream error: ${err.message}`);
        res.writeHead(502);
        res.end(JSON.stringify({ error: `upstream error: ${err.message}` }));
      });

      if (body.length > 0) proxyReq.write(body);
      proxyReq.end();
    });
  });

  server.listen(port, "127.0.0.1", () => {
    log(`[vllm-proxy] listening on http://127.0.0.1:${port} -> ${upstreamBaseUrl}`);
  });

  server.on("error", (err) => {
    log(`[vllm-proxy] server error: ${err.message}`);
  });

  return {
    close: () => {
      server.close();
    },
  };
}
