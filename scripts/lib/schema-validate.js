"use strict";
/* =============================================================================
   schema-validate.js — dependency-free JSON Schema (subset) validator
   -----------------------------------------------------------------------------
   ProductSnap Pulse automation requires every handoff/audit file to be a typed,
   schema-checked artifact, with ZERO npm dependencies (the GitHub pipeline runs
   on plain `node` + built-ins only). This is a deliberately small, deterministic
   validator covering exactly the JSON Schema keywords our schemas use:

     type            string | number | integer | boolean | object | array | null
                     (also accepts an array of allowed types)
     required        array of required property names (objects)
     properties      per-property subschemas (objects)
     additionalProperties
                     false to forbid unlisted props; or a subschema applied to them
     items           subschema applied to every array element
     enum            value must be one of the listed literals
     const           value must deep-equal the literal
     minimum/maximum exclusiveMinimum/exclusiveMaximum   (numbers)
     minLength/maxLength                                  (strings)
     minItems/maxItems                                    (arrays)
     pattern         RegExp source string                 (strings)
     format          "date" (YYYY-MM-DD) | "date-time" (ISO 8601) | "uri" (http/https)
     nullable        true to also allow null

   It is NOT a full JSON Schema implementation (no $ref, allOf/anyOf/oneOf,
   dependencies, etc.). Our schemas are written to stay inside this subset.

   Usage:
     const { validate } = require("./lib/schema-validate");
     const { valid, errors } = validate(data, schema);
     // errors: [{ path: "findings[0].confidence", message: "..." }]
   ===========================================================================*/

function typeOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (Number.isInteger(v)) return "integer";
  if (typeof v === "number") return "number";
  return typeof v; // string | boolean | object | undefined
}

function matchesType(v, t) {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  if (t === "integer") return actual === "integer";
  return actual === t;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeOf(a) !== typeOf(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((x, i) => deepEqual(x, b[i]));
  }
  if (a && typeof a === "object") {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const URI_RE = /^https?:\/\/[^\s]+$/i;

function checkFormat(value, format) {
  if (typeof value !== "string") return null;
  if (format === "date") {
    if (!DATE_RE.test(value)) return "must be a YYYY-MM-DD date";
    const d = new Date(value + "T00:00:00Z");
    if (isNaN(d.getTime())) return "is not a valid calendar date";
    return null;
  }
  if (format === "date-time") {
    const d = new Date(value);
    if (isNaN(d.getTime())) return "must be an ISO 8601 date-time";
    return null;
  }
  if (format === "uri") {
    if (!URI_RE.test(value)) return "must be an http(s) URL";
    return null;
  }
  return null; // unknown formats are not enforced
}

function validateNode(value, schema, path, errors) {
  if (!schema || typeof schema !== "object") return;

  // nullable / null allowance
  if (value === null) {
    const types = schema.type
      ? (Array.isArray(schema.type) ? schema.type : [schema.type])
      : null;
    if (schema.nullable === true) return;
    if (types && types.indexOf("null") !== -1) return;
    if (!types) return; // no type constraint, null is fine
    errors.push({ path, message: "must not be null" });
    return;
  }

  // type
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push({ path, message: "expected type " + types.join(" | ") + " but got " + typeOf(value) });
      return; // further checks are meaningless on wrong type
    }
  }

  // const
  if (Object.prototype.hasOwnProperty.call(schema, "const")) {
    if (!deepEqual(value, schema.const)) {
      errors.push({ path, message: "must equal " + JSON.stringify(schema.const) });
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((e) => deepEqual(value, e))) {
      errors.push({ path, message: "must be one of " + JSON.stringify(schema.enum) });
    }
  }

  const kind = typeOf(value);

  // numbers
  if (kind === "number" || kind === "integer") {
    if (schema.minimum != null && value < schema.minimum)
      errors.push({ path, message: "must be >= " + schema.minimum });
    if (schema.maximum != null && value > schema.maximum)
      errors.push({ path, message: "must be <= " + schema.maximum });
    if (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum)
      errors.push({ path, message: "must be > " + schema.exclusiveMinimum });
    if (schema.exclusiveMaximum != null && value >= schema.exclusiveMaximum)
      errors.push({ path, message: "must be < " + schema.exclusiveMaximum });
  }

  // strings
  if (kind === "string") {
    if (schema.minLength != null && value.length < schema.minLength)
      errors.push({ path, message: "must be at least " + schema.minLength + " chars" });
    if (schema.maxLength != null && value.length > schema.maxLength)
      errors.push({ path, message: "must be at most " + schema.maxLength + " chars" });
    if (schema.pattern) {
      let re;
      try { re = new RegExp(schema.pattern); } catch (e) { re = null; }
      if (re && !re.test(value))
        errors.push({ path, message: "must match pattern " + schema.pattern });
    }
    if (schema.format) {
      const f = checkFormat(value, schema.format);
      if (f) errors.push({ path, message: f });
    }
  }

  // arrays
  if (kind === "array") {
    if (schema.minItems != null && value.length < schema.minItems)
      errors.push({ path, message: "must have at least " + schema.minItems + " items" });
    if (schema.maxItems != null && value.length > schema.maxItems)
      errors.push({ path, message: "must have at most " + schema.maxItems + " items" });
    if (schema.items) {
      value.forEach((el, i) => validateNode(el, schema.items, path + "[" + i + "]", errors));
    }
  }

  // objects
  if (kind === "object") {
    const props = schema.properties || {};
    if (Array.isArray(schema.required)) {
      schema.required.forEach((req) => {
        if (!Object.prototype.hasOwnProperty.call(value, req))
          errors.push({ path: path ? path + "." + req : req, message: "is required" });
      });
    }
    Object.keys(value).forEach((key) => {
      const childPath = path ? path + "." + key : key;
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        validateNode(value[key], props[key], childPath, errors);
      } else if (schema.additionalProperties === false) {
        // allow underscore-prefixed comment keys everywhere
        if (key.charAt(0) !== "_")
          errors.push({ path: childPath, message: "is not an allowed property" });
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateNode(value[key], schema.additionalProperties, childPath, errors);
      }
    });
  }
}

function validate(data, schema) {
  const errors = [];
  validateNode(data, schema, "", errors);
  return { valid: errors.length === 0, errors };
}

module.exports = { validate, deepEqual };
