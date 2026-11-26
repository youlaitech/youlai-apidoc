/**
 * 剪贴板工具与带反馈的复制入口
 *
 * 正常浏览器：Clipboard API / execCommand 兜底，成功提示。
 * 受限容器（宿主禁用 clipboard-write 且 execCommand 被拒）：
 * 退化为「手动复制」弹窗，文本自动全选供 Ctrl+C，避免死胡同报错。
 */
import { ref } from "vue";
import { ElMessage } from "element-plus";

export const fallbackVisible = ref(false);
export const fallbackText = ref("");

export async function copyWithFeedback(text: string, tip: string): Promise<void> {
  const ok = await copyToClipboard(text);
  if (ok) {
    ElMessage.success(tip);
    return;
  }
  fallbackText.value = text;
  fallbackVisible.value = true;
}

/**
 * 复制文本到剪贴板
 *
 * 优先异步 Clipboard API；在嵌入式容器 / 非安全上下文等被拒绝的环境
 * 回退到隐藏 textarea + execCommand，避免「复制失败」。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 继续走兜底
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-1000px;left:-1000px;opacity:0;";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
