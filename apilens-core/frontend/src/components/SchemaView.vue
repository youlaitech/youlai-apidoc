<script setup lang="ts">
import { computed } from "vue";
import type { OpenAPIDocument, Schema } from "../types/openapi";
import { resolveRef, getSchemaType } from "../api/openapi";

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

/**
 * 将 Schema 解析为表格行数据
 * 递归解析嵌套对象和数组中的对象，深度限制 3 层避免无限递归
 */
function parseSchema(schema: Schema, doc: OpenAPIDocument, depth: number): FieldRow[] {
  let resolved = schema;
  // 解析 $ref 引用
  if (schema.$ref) {
    resolved = resolveRef(schema.$ref, doc) || schema;
  }
  // allOf 合并多个 Schema 的字段
  if (resolved.allOf) {
    let rows: FieldRow[] = [];
    for (const part of resolved.allOf) {
      rows = rows.concat(parseSchema(part, doc, depth));
    }
    return rows;
  }
  if (!resolved.properties) return [];

  const requiredFields = resolved.required || [];
  const rows: FieldRow[] = [];

  for (const [name, propSchema] of Object.entries(resolved.properties)) {
    const row: FieldRow = {
      name,
      type: getSchemaType(propSchema, doc),
      required: requiredFields.includes(name),
      description: propSchema.description || "",
      example: propSchema.example ?? propSchema.default ?? "",
      depth,
    };
    // 嵌套对象递归（限制深度 3 层）
    if (depth < 3) {
      let nested = propSchema;
      if (propSchema.$ref) {
        nested = resolveRef(propSchema.$ref, doc) || propSchema;
      }
      if (nested.properties && Object.keys(nested.properties).length > 0) {
        row.children = parseSchema(nested, doc, depth + 1);
      }
      // 数组中的嵌套对象
      if (nested.type === "array" && nested.items) {
        let itemSchema = nested.items;
        if (itemSchema.$ref) {
          itemSchema = resolveRef(itemSchema.$ref, doc) || itemSchema;
        }
        if (itemSchema.properties && Object.keys(itemSchema.properties).length > 0) {
          row.children = parseSchema(itemSchema, doc, depth + 1);
        }
      }
    }
    rows.push(row);
  }
  return rows;
}

const tableData = computed(() => parseSchema(props.schema, props.doc, 0));
const treeProps = { children: "children" };
</script>

<template>
  <el-table :data="tableData" :tree-props="treeProps" row-key="name" border size="small" default-expand-all>
    <el-table-column prop="name" label="字段" min-width="160">
      <template #default="{ row }">
        <span :style="{ paddingLeft: row.depth * 16 + 'px' }">{{ row.name }}</span>
      </template>
    </el-table-column>
    <el-table-column prop="type" label="类型" width="180" />
    <el-table-column prop="required" label="必填" width="70" align="center">
      <template #default="{ row }">
        <span :style="{ color: row.required ? '#f56c6c' : '#909399' }">
          {{ row.required ? "是" : "否" }}
        </span>
      </template>
    </el-table-column>
    <el-table-column prop="description" label="说明" min-width="200" />
    <el-table-column prop="example" label="示例值" min-width="140" />
  </el-table>
</template>
