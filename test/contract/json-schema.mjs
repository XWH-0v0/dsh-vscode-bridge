/**
 * 最小 JSON Schema 校验器，镜像 DSH 对工具输出值的校验规则：
 * type / required / additionalProperties / items / enum。
 * 只实现我们 schema 里实际用到的子集，够用来抓"handler 返回了什么、schema 没声明"这类 bug。
 */
export function validateValue(schema, value, path = 'value') {
  const errors = []
  if (!schema || typeof schema !== 'object') return errors

  if (schema.type) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
    const matches = schema.type === 'integer'
      ? typeof value === 'number' && Number.isInteger(value)
      : schema.type === 'number'
        ? typeof value === 'number'
        : schema.type === actual
    if (!matches) errors.push(`${path} must be a ${schema.type}`)
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of ${schema.enum.join(', ')}`)
  }

  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateValue(schema.items, item, `${path}[${index}]`))
    })
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`"${path}.${key}" is required`)
    }
    const properties = schema.properties ?? {}
    for (const [key, item] of Object.entries(value)) {
      if (properties[key]) {
        errors.push(...validateValue(properties[key], item, `${path}.${key}`))
      } else if (schema.additionalProperties === false) {
        errors.push(`"${path}.${key}" is not a declared property (additionalProperties: false)`)
      }
    }
  }

  return errors
}

/** 工具返回值在交给校验前会经过一次 JSON 序列化，undefined 属性会消失。 */
export function asJson(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

export function expectValid(schema, value) {
  return validateValue(schema, asJson(value))
}
