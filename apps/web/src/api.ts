let accessToken = "";
export function setAccessToken(value: string) {
  accessToken = value;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status = 0,
    public code = "",
    public fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}
type ApiOptions = RequestInit & { timeoutMs?: number };
async function request(
  path: string,
  { timeoutMs = 15000, ...options }: ApiOptions = {},
) {
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    response = await fetch(`/api${path}`, {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, timeout])
        : timeout,
      headers: {
        ...(options.body != null ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...options.headers,
      },
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError")
      throw new ApiError("连接超时，请检查服务状态后重试。", 0, "TIMEOUT");
    if (name === "AbortError")
      throw new ApiError("请求已停止，已保留当前输入。", 0, "ABORTED");
    throw new ApiError(
      "暂时无法连接服务，请检查网络或后端服务。",
      0,
      "NETWORK_ERROR",
    );
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      body.error || `请求未完成（${response.status}），请稍后重试。`,
      response.status,
      body.code,
      body.fields,
    );
  }
  return response;
}
export async function api<T>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const response = await request(path, options);
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(
      "服务返回了无法读取的结果，请重试。",
      0,
      "INVALID_RESPONSE",
    );
  }
}
export async function download(id: string, report = false) {
  const response = await request(
    `/artifacts/${id}/${report ? "report" : "download"}`,
    { timeoutMs: 45000 },
  );
  let file: Blob;
  try {
    file = await response.blob();
  } catch {
    throw new ApiError(
      "文件传输未完成，请检查连接后重试下载。",
      0,
      "DOWNLOAD_FAILED",
    );
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  const encodedName = response.headers
    .get("Content-Disposition")
    ?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  let filename = `qmt_${id.slice(0, 8)}${report ? "_report.pdf" : ".py"}`;
  if (encodedName) {
    try {
      filename = decodeURIComponent(encodedName);
    } catch {
      /* Retain the safe fallback name. */
    }
  }
  link.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "_");
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function readVerifiedScript(id: string) {
  const response = await request(`/artifacts/${id}/download`, {
    timeoutMs: 45000,
  });
  try {
    return new TextDecoder("gbk", { fatal: true }).decode(
      await response.arrayBuffer(),
    );
  } catch {
    throw new ApiError(
      "无法读取完整源码，请下载文件并按 GBK 编码打开。",
      0,
      "SOURCE_READ_FAILED",
    );
  }
}
