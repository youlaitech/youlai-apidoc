<script setup lang="ts">
import { computed } from "vue";
import type { OpenAPIDocument, Schema } from "../types/openapi";
import { resolveRef, getSchemaType, getSchemaExample } from "../api/openapi";
import { formatExample } from "../utils/request";

const props = defineProps<{
  schema: Schema;
  doc: OpenAPIDocument;
}>();

interface FieldRow {
  /** 路径唯一键，避免不同层级同名字段在 el-table 树中冲突 */
  key: string;
  name: string;
  type: string;
  required: boolean;
  description: string;
  example: unknown;
  children?: FieldRow[];
  depth: number;
}

// 嵌套渲染深度上限；循环引用由 seen 集合兜底，不靠深度截断
const MAX_DEPTH = 6;

interface DerefResult {
  schema: Schema;
  /** 展开路径上已出现的 $ref，用于循环引用检测 */
  seen: Set<string>;
}

/**
 * 解析 $ref 并检查循环引用，返回 null 表示循环，不应继续展开
 */
function deref(schema: Schema, doc: OpenAPIDocument, seen: Set<string>): DerefResult | null {
  if (!schema.$ref) return { schema, seen };
  if (seen.has(schema.$ref)) return null;
  const next = new Set(seen);
  next.add(schema.$ref);
  return { schema: resolveRef(schema.$ref, doc) ?? schema, seen: next };
}

/**
 * 将 Schema 解析为表格行数据
 * 递归解析嵌套对象和数组中的对象；allOf 合并各分支字段
 */
function parseSchema(schema: Schema, doc: OpenAPIDocument, depth: number, seen: Set<string>, prefix: string): FieldRow[] {
  const resolved = deref(schema, doc, seen);
  if (!resolved) return [];
  const { schema: target, seen: nextSeen } = resolved;

  // allOf 合并多个 Schema 的字段
  if (target.allOf) {
    let rows: FieldRow[] = [];
    for (const part of target.allOf) {
      rows = rows.concat(parseSchema(part, doc, depth, nextSeen, prefix));
    }
    return rows;
  }
  if (!target.properties) return [];

  const requiredFields = target.required || [];
  const rows: FieldRow[] = [];

  for (const [name, propSchema] of Object.entries(target.properties)) {
    const key = prefix ? `${prefix}.${name}` : name;
    const row: FieldRow = {
      key,
      name,
      type: getSchemaType(propSchema, doc),
      required: requiredFields.includes(name),
      description: propSchema.description || "",
      example: getSchemaExample(propSchema) ?? "",
      depth,
    };
    if (depth < MAX_DEPTH) {
      const nested = deref(propSchema, doc, nextSeen);
      if (nested) {
        if (nested.schema.properties && Object.keys(nested.schema.properties).length > 0) {
          row.children = parseSchema(nested.schema, doc, depth + 1, nested.seen, key);
        } else if (nested.schema.type === "array" && nested.schema.items) {
          const itemSchema = deref(nested.schema.items, doc, nested.seen);
          if (itemSchema?.schema.properties && Object.keys(itemSchema.schema.properties).length > 0) {
            row.children = parseSchema(itemSchema.schema, doc, depth + 1, itemSchema.seen, key);
          }
        }
      }
    }
    rows.push(row);
  }
  return rows;
}

const tableData = computed(() => parseSchema(props.schema, props.doc, 0, new Set(), ""));
const treeProps = { children: "children" };
</script>

<template>
  <div class="schema-wrap">
    <el-table :data="tableData" :tree-props="treeProps" row-key="key" size="small" default-expand-all class="schema-table">
      <el-table-column prop="name" label="字段" min-width="200">
        <template #default="{ row }">
          <span class="schema-name">{{ row.name }}<span v-if="row.required" class="required-mark" title="必填" aria-label="必填">*</span></span>
        </template>
      </el-table-column>
      <el-table-column prop="type" label="类型" width="180">
        <template #default="{ row }">
          <span class="schema-type">{{ row.type }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="description" label="说明" min-width="200">
        <template #default="{ row }">
          <span class="schema-desc">{{ row.description || "—" }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="example" label="示例值" min-width="140">
        <template #default="{ row }">
          <span class="schema-example">{{ formatExample(row.example) || "—" }}</span>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.schema-wrap { border: 1px solid var(--ad-border); border-radius: var(--ad-radius); overflow: hidden; }
.schema-table {
  --el-table-border-color: var(--ad-border-soft);
  --el-table-header-bg-color: var(--ad-bg-subtle);
  --el-table-row-hover-bg-color: var(--ad-hover);
  --el-table-bg-color: var(--ad-bg);
  --el-table-tr-bg-color: var(--ad-bg);
  --el-table-expanded-cell-bg-color: var(--ad-bg);
  width: 100%;
}
.schema-table :deep(.el-table__header th) { font-size: var(--ad-fs-aux); font-weight: 600; color: var(--ad-text-tertiary); background: var(--ad-bg-subtle); border-bottom: 1px solid var(--ad-border-soft); padding: 10px 0; }
.schema-table :deep(.el-table__cell) { padding: 10px 0; font-size: var(--ad-fs-secondary); border-bottom: 1px solid var(--ad-border-soft); }
.schema-table :deep(.el-table__inner-wrapper::before) { display: none; }
.schema-table :deep(.el-table__row:last-child .el-table__cell) { border-bottom: none; }
.schema-table :deep(.el-table__expand-icon) { color: var(--ad-text-tertiary); }
.schema-name { font-family: var(--ad-font-mono); font-size: var(--ad-fs-secondary); font-weight: 600; color: var(--ad-put); }
.schema-type { font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); color: var(--ad-text-tertiary); }
.required-mark { margin-left: 3px; color: var(--ad-danger-text, var(--ad-danger)); font-weight: 700; }
.schema-desc { color: var(--ad-text-secondary); font-size: var(--ad-fs-secondary); line-height: 1.5; }
.schema-example { font-family: var(--ad-font-mono); font-size: var(--ad-fs-aux); color: var(--ad-text-secondary); word-break: break-all; }
</style>
