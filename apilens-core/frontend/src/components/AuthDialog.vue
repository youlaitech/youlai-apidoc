<script setup lang="ts">
import { ref, reactive } from "vue";
import axios from "axios";
import { setToken } from "../stores/auth";
import { copyToClipboard } from "../utils/curl";

/**
 * OAuth2 授权弹窗
 *
 * 支持 OAuth2 密码模式（password grant）自动获取 token：
 * 1. 用户输入 tokenUrl / username / password / clientId / clientSecret
 * 2. 向 tokenUrl 发送 password grant 请求
 * 3. 获取 access_token 后自动填充到全局 auth store
 *
 * 同时也支持直接粘贴 token（跳过 OAuth2 流程）。
 */

const visible = ref(false);

// OAuth2 配置
const oauthForm = reactive({
  tokenUrl: "/auth/oauth2/token",
  username: "",
  password: "",
  clientId: "client",
  clientSecret: "secret",
});

// 当前模式：oauth2 | manual
const mode = ref<"oauth2" | "manual">("oauth2");

// 手动输入的 token
const manualToken = ref("");

const loading = ref(false);
const errorMsg = ref("");

function open() {
  visible.value = true;
  errorMsg.value = "";
}

/** OAuth2 密码模式获取 token */
async function fetchToken() {
  if (!oauthForm.username || !oauthForm.password) {
    errorMsg.value = "请输入用户名和密码";
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    // OAuth2 password grant 请求
    const params = new URLSearchParams();
    params.append("grant_type", "password");
    params.append("username", oauthForm.username);
    params.append("password", oauthForm.password);

    const res = await axios.post(oauthForm.tokenUrl, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // 客户端凭证通过 Basic 认证传递
        Authorization: "Basic " + btoa(`${oauthForm.clientId}:${oauthForm.clientSecret}`),
      },
      validateStatus: () => true,
    });

    if (res.data?.access_token) {
      setToken(res.data.access_token);
      visible.value = false;
    } else {
      errorMsg.value = res.data?.error_description || res.data?.error || JSON.stringify(res.data);
    }
  } catch (e: any) {
    errorMsg.value = e.message || "获取 token 失败";
  } finally {
    loading.value = false;
  }
}

/** 手动设置 token */
function applyManualToken() {
  if (!manualToken.value.trim()) {
    errorMsg.value = "请输入 token";
    return;
  }
  setToken(manualToken.value.trim());
  visible.value = false;
}

defineExpose({ open });
</script>

<template>
  <el-dialog v-model="visible" title="Authorization" width="500px" :close-on-click-modal="false">
    <!-- 模式切换 -->
    <el-radio-group v-model="mode" class="mode-switch">
      <el-radio-button value="oauth2">OAuth2 密码模式</el-radio-button>
      <el-radio-button value="manual">手动输入 Token</el-radio-button>
    </el-radio-group>

    <!-- OAuth2 密码模式 -->
    <el-form v-if="mode === 'oauth2'" label-width="100px" class="oauth-form" @submit.prevent="fetchToken">
      <el-form-item label="Token URL">
        <el-input v-model="oauthForm.tokenUrl" size="small" placeholder="/auth/oauth2/token" />
      </el-form-item>
      <el-form-item label="Client ID">
        <el-input v-model="oauthForm.clientId" size="small" />
      </el-form-item>
      <el-form-item label="Client Secret">
        <el-input v-model="oauthForm.clientSecret" size="small" show-password />
      </el-form-item>
      <el-form-item label="用户名">
        <el-input v-model="oauthForm.username" size="small" />
      </el-form-item>
      <el-form-item label="密码">
        <el-input v-model="oauthForm.password" size="small" type="password" show-password @keyup.enter="fetchToken" />
      </el-form-item>
    </el-form>

    <!-- 手动输入 -->
    <div v-else class="manual-form">
      <el-input
        v-model="manualToken"
        type="textarea"
        :rows="4"
        placeholder="粘贴 Bearer Token..."
        @keyup.ctrl.enter="applyManualToken"
      />
      <div class="manual-tip">Ctrl+Enter 快速应用</div>
    </div>

    <el-alert v-if="errorMsg" :title="errorMsg" type="error" show-icon :closable="false" class="error-alert" />

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="mode === 'oauth2'" type="primary" :loading="loading" @click="fetchToken">获取 Token</el-button>
      <el-button v-else type="primary" @click="applyManualToken">应用</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.mode-switch { margin-bottom: 20px; }
.oauth-form { padding-right: 20px; }
.manual-form { padding: 10px 0; }
.manual-tip { font-size: 12px; color: #909399; margin-top: 6px; }
.error-alert { margin-top: 12px; }
</style>
