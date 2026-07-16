/**
 * ai-test-harness/lib/schema-validator.js
 * 轻量 JSON Schema 校验引擎 - 零依赖
 * 支持: type, required, properties, items, enum, minLength, maxLength, minItems, maxItems, pattern
 */

function validateType(value, expectedType) {
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (expectedType === 'string') return typeof value === 'string';
  if (expectedType === 'number') return typeof value === 'number';
  if (expectedType === 'integer') return Number.isInteger(value);
  if (expectedType === 'boolean') return typeof value === 'boolean';
  if (expectedType === 'null') return value === null;
  return true;
}

function validate(data, schema, path = '$') {
  const errors = [];

  if (!schema || typeof schema !== 'object') {
    return { valid: true, errors: [] };
  }

  if (schema.type && !validateType(data, schema.type)) {
    errors.push({ path, message: `期望类型 ${schema.type}，实际为 ${typeof data}` });
    return { valid: false, errors };
  }

  if (schema.enum && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(data)) {
      errors.push({ path, message: `值 "${data}" 不在枚举范围 [${schema.enum.join(', ')}]` });
    }
  }

  if (schema.type === 'string') {
    if (schema.minLength !== undefined && typeof data === 'string' && data.length < schema.minLength) {
      errors.push({ path, message: `字符串长度 ${data.length} < minLength ${schema.minLength}` });
    }
    if (schema.maxLength !== undefined && typeof data === 'string' && data.length > schema.maxLength) {
      errors.push({ path, message: `字符串长度 ${data.length} > maxLength ${schema.maxLength}` });
    }
    if (schema.pattern && typeof data === 'string') {
      const re = new RegExp(schema.pattern);
      if (!re.test(data)) {
        errors.push({ path, message: `不匹配 pattern: ${schema.pattern}` });
      }
    }
  }

  if (schema.type === 'array' && Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push({ path, message: `数组长度 ${data.length} < minItems ${schema.minItems}` });
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push({ path, message: `数组长度 ${data.length} > maxItems ${schema.maxItems}` });
    }
    if (schema.items) {
      data.forEach((item, i) => {
        const itemResult = validate(item, schema.items, `${path}[${i}]`);
        errors.push(...itemResult.errors);
      });
    }
  }

  if (schema.type === 'object' && data && typeof data === 'object' && !Array.isArray(data)) {
    if (schema.required && Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (data[key] === undefined || data[key] === null) {
          errors.push({ path: `${path}.${key}`, message: `缺少必填字段: ${key}` });
        }
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (data[key] !== undefined && data[key] !== null) {
          const propResult = validate(data[key], propSchema, `${path}.${key}`);
          errors.push(...propResult.errors);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validate, validateType };
}
if (typeof window !== 'undefined') {
  window.AITestHarnessSchemaValidator = { validate, validateType };
}
