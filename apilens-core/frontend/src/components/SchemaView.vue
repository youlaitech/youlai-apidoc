<script setup lang="ts">
import { computed } from "vue";
import type { OpenAPIDocument, Schema } from "../types/openapi";
import { resolveRef, getSchemaType, getSchemaExample } from "../api/openapi";

const props = defineProps<{
  schema: Schema;
  doc: OpenAPIDocument;
}>();

interface FieldRow {
  name: string;
  type: string;
  required: boolean;
  description: string;
  example: any;
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
function parseSchema(schema: Schema, doc: OpenAPIDocument, depth: number, seen: Set<string>): FieldRow[] {
  const resolved = deref(schema, doc, seen);
  if (!resolved) return [];
  const { schema: target, seen: nextSeen } = resolved;

  // allOf 合并多个 Schema 的字段
  if (target.allOf) {
    let rows: FieldRow[] = [];
    for (const part of target.allOf) {
      rows = rows.concat(parseSchema(part, doc, depth, nextSeen));
    }
    return rows;
  }
  if (!target.properties) return [];

  const requiredFields = target.required || [];
  const rows: FieldRow[] = [];

  for (const [name, propSchema] of Object.entries(target.properties)) {
    const row: FieldRow = {
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
          row.children = parseSchema(nested.schema, doc, depth + 1, nested.seen);
        } else if (nested.schema.type === "array" && nested.schema.items) {
          const itemSchema = deref(nested.schema.items, doc, nested.seen);
          if (itemSchema?.schema.properties && Object.keys(itemSchema.schema.properties).length > 0) {
            row.children = parseSchema(itemSchema.schema, doc, depth + 1, itemSchema.seen);
          }
        }
      }
    }
    rows.push(row);
  }
  return rows;
}

const tableData = computed(() => parseSchema(props.schema, props.doc, 0, new Set()));
const treeProps = { children: "children" };
</script>

<template>
  <el-table :data="tableData" :tree-props="treeProps" row-key="name" size="small" default-expand-all class="schema-table">
    <el-table-column prop="name" label="字段" min-width="180">
      <template #default="{ row }">
        <span class="schema-name" :style="{ paddingLeft: row.depth * 16 + 'px' }">{{ row.name }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="type" label="类型" width="180">
      <template #default="{ row }">
        <span class="schema-type">{{ row.type }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="required" label="必填" width="60" align="center">
      <template #default="{ row }">
        <span v-if="row.required" class="schema-required">*</span>
        <span v-else class="schema-optional">—</span>
      </template>
    </el-table-column>
    <el-table-column prop="description" label="说明" min-width="200">
      <template #default="{ row }">
        <span class="schema-desc">{{ row.description || "—" }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="example" label="示例值" min-width="140">
      <template #default="{ row }">
        <span class="schema-example">{{ row.example === "" ? "—" : row.example }}</span>
      </template>
    </el-table-column>
  </el-table>
</template>

<style scoped>
.schema-table { --el-table-border-color: var(--yl-border); --el-table-header-bg-color: var(--yl-bg-subtle); --el-table-row-hover-bg-color: var(--yl-bg-subtle); border: 1px solid var(--yl-border); border-radius: 8px; overflow: hidden; }
.schema-table :deep(.el-table__header th) { font-size: 12px; font-weight: 500; color: var(--yl-text-tertiary); background: var(--yl-bg-subtle); border-bottom: 1px solid var(--yl-border); }
.schema-table :deep(.el-table__cell) { padding: 9px 0; font-size: 13px; }
.schema-table :deep(.el-table__inner-wrapper::before) { display: none; }
.schema-name { font-family: var(--yl-font-mono); font-size: 12.5px; font-weight: 500; color: var(--yl-text); }
.schema-type { font-family: var(--yl-font-mono); font-size: 12px; color: var(--yl-text-secondary); }
.schema-required { color: #dc4c4c; font-weight: 600; }
.schema-optional { color: var(--yl-text-tertiary); }
.schema-desc { color: var(--yl-text-secondary); font-size: 12.5px; }
.schema-example { font-family: var(--yl-font-mono); font-size: 12px; color: var(--yl-text-secondary); word-break: break-all; }
</style>
