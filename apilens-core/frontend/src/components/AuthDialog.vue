<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import type { SecurityScheme } from "../types/openapi";
import { authValues, setAuthValue, clearAuthValues } from "../stores/auth";

/**
 * 文档声明的 securitySchemes
 */
const props = defineProps<{
  schemes: Record<string, SecurityScheme>;
}>();

interface SchemeItem {
  name: string;
  scheme: SecurityScheme;
}

const visible = ref(false);
const values = reactive<Record<string, string>>({});
const basicUsers = reactive<Record<string, string>>({});
const basicPasswords = reactive<Record<string, string>>({});

const schemeList = computed<SchemeItem[]>(() =>
  Object.entries(props.schemes || {}).map(([name, scheme]) => ({ name, scheme }))
);

function isBasic(item: SchemeItem): boolean {
  return item.scheme.type === "http" && item.scheme.scheme?.toLowerCase() === "basic";
}

/**
 * scheme 在请求中的位置说明
 */
function schemeLocation(item: SchemeItem): string {
  if (item.scheme.type === "apiKey") {
    return `${item.scheme.in || "header"} · ${item.scheme.name || item.name}`;
  }
  if (item.scheme.type === "http") {
    return `http · ${item.scheme.scheme || "bearer"}`;
  }
  return item.scheme.type;
}

/**
 * 输入框提示语
 */
function placeholder(item: SchemeItem): string {
  if (item.scheme.type === "apiKey" && item.scheme.in === "header") {
    return item.scheme.scheme?.toLowerCase() === "bearer" ? "粘贴 token，发送时自动补 Bearer 前缀" : "Header 值";
  }
  if (item.scheme.type === "apiKey") {
    return "参数值";
  }
  if (item.scheme.type === "http") {
    return "访问令牌，不含 Bearer 前缀";
  }
  return "access_token";
}

function open() {
  visible.value = true;
  for (const item of schemeList.value) {
    const saved = authValues.value[item.name] || "";
    if (isBasic(item)) {
      const index = saved.indexOf(":");
      basicUsers[item.name] = index >= 0 ? saved.slice(0, index) : saved;
      basicPasswords[item.name] = index >= 0 ? saved.slice(index + 1) : "";
    } else {
      values[item.name] = saved;
    }
  }
}

function save() {
  for (const item of schemeList.value) {
    let value = values[item.name] || "";
    if (isBasic(item)) {
      const user = basicUsers[item.name] || "";
      const password = basicPasswords[item.name] || "";
      value = user || password ? `${user}:${password}` : "";
    }
    setAuthValue(item.name, value.trim());
  }
  visible.value = false;
}

function clearAll() {
  clearAuthValues();
  for (const item of schemeList.value) {
    values[item.name] = "";
    basicUsers[item.name] = "";
    basicPasswords[item.name] = "";
  }
}

defineExpose({ open });
</script>

<template>
  <el-dialog v-model="visible" title="全局授权" width="560px" :close-on-click-modal="false">
    <p class="auth-dialog-tip">凭据保存在本机浏览器，调试时按接口声明的安全方案自动附加到请求头或查询参数。</p>
    <el-empty v-if="!schemeList.length" description="文档未声明 securitySchemes" :image-size="60" />

    <div v-for="item in schemeList" :key="item.name" class="scheme">
      <div class="scheme-head">
        <span class="scheme-name">{{ item.name }}</span>
        <span class="scheme-loc">{{ schemeLocation(item) }}</span>
      </div>
      <div v-if="item.scheme.description" class="scheme-desc">{{ item.scheme.description }}</div>

      <template v-if="isBasic(item)">
        <el-input v-model="basicUsers[item.name]" size="default" placeholder="用户名" class="scheme-input" />
        <el-input
          v-model="basicPasswords[item.name]"
          size="default"
          type="password"
          show-password
          placeholder="密码"
          class="scheme-input"
        />
      </template>
      <el-input
        v-else
        v-model="values[item.name]"
        size="default"
        :placeholder="placeholder(item)"
        class="scheme-input"
        clearable
      />
    </div>

    <template #footer>
      <el-button text type="danger" @click="clearAll">清除全部</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.auth-dialog-tip {
  margin: 0 0 8px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--yl-text-tertiary);
}
.scheme {
  padding: 14px 0;
  border-bottom: 1px solid var(--yl-border);
}
.scheme:last-child {
  border-bottom: none;
}
.scheme-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
}
.scheme-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--yl-text);
}
.scheme-loc {
  font-size: 12px;
  color: var(--yl-text-tertiary);
  font-family: "Consolas", "Monaco", monospace;
}
.scheme-desc {
  font-size: 12px;
  color: var(--yl-text-tertiary);
  margin-bottom: 8px;
}
.scheme-input {
  margin-bottom: 8px;
}
</style>
